import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { main } from '../src/main.js';
import { MAX_INPUT_SIZE } from '../src/input.js';
import { sha256 } from '../src/input-source.js';
import { sequencePositions } from '../src/input-manifest.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-inputs-command-'));
after(() => fs.rmSync(root, {recursive:true, force:true}));
const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/structure-correctness.json', import.meta.url)));
const write = (name, text) => { const file = path.join(root, name); fs.writeFileSync(file, text); return file; };
const pdb = write('target.pdb', fixtures.cases[0].text);
const cif = write('target.cif', fixtures.cases[1].text);
const job = write('source-job.json', JSON.stringify({protocol:'pxdesign', project_type:'miniprotein', chains:'A', hotspots_by_chain:{A:[102]}, crop_by_chain:{A:'101-103'}}));
const noNetwork = async () => { throw new Error('Unexpected network call'); };

async function run(args, runtime = {}, env = {}) {
  let stdout = '', stderr = '';
  const originalOut = process.stdout.write, originalErr = process.stderr.write;
  process.stdout.write = (chunk, ...args) => {
    if (typeof chunk !== 'string') return originalOut.call(process.stdout, chunk, ...args);
    stdout += chunk; return true;
  };
  process.stderr.write = (chunk, ...args) => {
    if (typeof chunk !== 'string') return originalErr.call(process.stderr, chunk, ...args);
    stderr += chunk; return true;
  };
  try {
    const code = await main(args, env, {fetchImpl:noNetwork, interactive:false,
      credentialStore:{read:async () => { throw new Error('Credentials must not be accessed'); }}, ...runtime});
    return {code, data:stdout ? JSON.parse(stdout).data : undefined, error:stdout ? JSON.parse(stdout).error : undefined, stdout, stderr};
  } finally { process.stdout.write = originalOut; process.stderr.write = originalErr; }
}

describe('inputs commands through the CLI dispatcher', () => {
  it('inspects local sources without credentials or even an interactive update request', async () => {
    const result = await run(['inputs','inspect','--input',pdb,'--no-json'], {interactive:true}, {ARIAX_API_KEY:'arx_must_not_send'});
    assert.equal(result.code, 0, result.stdout);
    assert.equal(result.data.kind, 'ariax_input_inspection');
    assert.equal(result.data.source.sha256, sha256(fs.readFileSync(pdb)));
    assert.equal(result.data.chains[0].sequence_source, 'polymer_metadata');
    assert.equal(result.data.chains[0].sequence_length, 3);
    assert.deepEqual(result.data.chains[0].residues.map(row => row.sequence_position), [1,2,3]);
    assert.ok(result.data.chains[0].residues.every(row => row.label_chain === null && row.label_residue === null));
    assert.doesNotMatch(result.stdout + result.stderr, /arx_must_not_send/);
  });

  it('writes stable exact copies, hashes and release identity; repeat leaves files unchanged', async () => {
    const directory = path.join(root, 'prepared-pdb');
    const args = ['inputs','prepare','--input',pdb,'-f',job,'--output',directory,'--json'];
    const result = await run(args);
    assert.equal(result.code, 0, result.stdout);
    const originalPdb = fs.readFileSync(pdb), originalJob = fs.readFileSync(job);
    const manifestBytes = fs.readFileSync(result.data.manifest);
    const manifest = JSON.parse(manifestBytes);
    assert.deepEqual(fs.readFileSync(result.data.input), originalPdb);
    assert.equal(manifest.schema_version, 1);
    assert.equal(manifest.kind, 'ariax_input');
    assert.equal(manifest.source.sha256, sha256(originalPdb));
    assert.equal(manifest.prepared.sha256, sha256(fs.readFileSync(result.data.input)));
    assert.equal(manifest.job.source_sha256, sha256(originalJob));
    assert.equal(manifest.job.sha256, sha256(fs.readFileSync(result.data.job)));
    assert.equal(manifest.prepared_by.channel, 'github');
    assert.match(manifest.prepared_by.source_revision, /^[a-f0-9]{40}$/);
    assert.deepEqual(manifest.selected_chains, ['A']);
    assert.equal(JSON.parse(fs.readFileSync(result.data.job)).sequence_by_chain.A, 'ACD');
    assert.equal((await run(args)).code, 0);
    assert.deepEqual(fs.readFileSync(result.data.manifest), manifestBytes);
    assert.deepEqual(fs.readFileSync(pdb), originalPdb);
    assert.deepEqual(fs.readFileSync(job), originalJob);

    const changedJob = write('different-job.json', JSON.stringify({protocol:'pxdesign', chains:'A', num_designs:2}));
    const conflict = await run(['inputs','prepare','--input',pdb,'-f',changedJob,'--output',directory,'--json']);
    assert.equal(conflict.code, 7);
    assert.deepEqual(fs.readFileSync(result.data.manifest), manifestBytes);
  });

  it('records canonical CIF unresolved sequence positions and supported metadata repair', async () => {
    const cifJob = write('cif-job.json', JSON.stringify({protocol:'pxdesign', chains:'A', sequence_by_chain:{A:'ACD'}}));
    const result = await run(['inputs','prepare','--input',cif,'-f',cifJob,'--output',path.join(root,'prepared-cif'),'--json']);
    assert.equal(result.code, 0, result.stdout);
    const manifest = JSON.parse(fs.readFileSync(result.data.manifest));
    assert.deepEqual(manifest.chains[0].unresolved_regions, [{start:2,end:2}]);
    assert.deepEqual(manifest.chains[0].residues.map(row => [row.author_residue,row.label_residue,row.sequence_position]), [[1,1,1],[3,3,3]]);
    assert.ok(manifest.transforms.some(item => item.kind === 'cif_polymer_metadata_fill'));
    assert.notEqual(manifest.source.sha256, manifest.prepared.sha256);
    assert.equal(fs.readFileSync(cif,'utf8'), fixtures.cases[1].text);
  });

  it('records ESM chain remapping and atom-ID repairs for a fetched RCSB source', async () => {
    const text = `data_modelcif
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_entity_id
_atom_site.label_seq_id
_atom_site.auth_comp_id
_atom_site.auth_asym_id
_atom_site.auth_seq_id
_atom_site.pdbx_PDB_ins_code
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
ATOM 1 C CA ALA X 1 1 ALA AAA 176 ? 10 10 10
ATOM 2 C CA GLY X 1 2 GLY AAA 177 ? 11 10 10
#
`;
    const file = write('esm-job.json', JSON.stringify({protocol:'esmfold2-pipeline', protocol_config:{design_type:'miniprotein',target:{source:'rcsb',pdb_id:'1ABC',chains:['AAA']}}}));
    const result = await run(['inputs','prepare','--pdb','1ABC','-f',file,'--output',path.join(root,'prepared-rcsb'),'--json'], {fetchImpl:async () => new Response(text)});
    assert.equal(result.code, 0, result.stdout);
    const manifest = JSON.parse(fs.readFileSync(result.data.manifest));
    assert.equal(manifest.source.kind, 'rcsb');
    assert.equal(manifest.source.sha256, sha256(text));
    assert.equal(manifest.chains[0].source_chain, 'AAA');
    assert.equal(manifest.chains[0].prepared_chain, 'A');
    assert.deepEqual(manifest.chains[0].residues.map(row => [row.author_residue,row.label_chain,row.label_residue,row.sequence_position]), [[176,'X',1,1],[177,'X',2,2]]);
    assert.deepEqual(manifest.transforms.map(item => item.kind), ['rcsb_snapshot_upload','cif_auth_atom_id_fill','cif_author_chain_remap']);
    const savedTarget = JSON.parse(fs.readFileSync(result.data.job)).protocol_config.target;
    assert.equal(savedTarget.sequences.A, 'AG');
    assert.equal(savedTarget.source, 'upload');
    assert.equal(savedTarget.object_key, undefined);
    assert.equal(savedTarget.pdb_id, undefined);
  });

  it('keeps BoltzGen label-chain selectors distinct from author-chain identifiers', async () => {
    const input = write('label-chain.cif', fixtures.cases[1].text.replaceAll(' A A 1 ', ' X A 1 '));
    const file = write('boltz-job.json', JSON.stringify({protocol:'boltzgen',chains:'X'}));
    const result = await run(['inputs','prepare','--input',input,'-f',file,'--output',path.join(root,'prepared-boltz'),'--json']);
    assert.equal(result.code, 0, result.stdout);
    const manifest = JSON.parse(fs.readFileSync(result.data.manifest));
    assert.deepEqual(manifest.selected_chains,['X']);
    assert.equal(manifest.chains[0].chain_id_type,'label');
    assert.equal(manifest.chains[0].prepared_chain,'X');
    assert.deepEqual(manifest.chains[0].residues.map(row => [row.author_chain,row.label_chain]), [['A','X'],['A','X']]);
    assert.equal(manifest.chains[0].mapping_status,'verified');
  });

  it('previews format limitations without writing; prepare rejects unrepresentable PX PDB', async () => {
    const gapped = write('gapped.pdb', fixtures.cases[2].text);
    const gappedJob = write('gapped-job.json', JSON.stringify({protocol:'pxdesign', chains:'A', sequence_by_chain:{A:'ACD'}}));
    const preview = await run(['inputs','inspect','--input',gapped,'-f',gappedJob,'--json']);
    assert.equal(preview.code, 0);
    assert.equal(preview.data.preparation.ready, false);
    assert.match(preview.data.preparation.error.message, /cannot preserve/);
    const out = path.join(root,'must-not-exist');
    const result = await run(['inputs','prepare','--input',gapped,'-f',gappedJob,'--output',out,'--json']);
    assert.equal(result.code, 5);
    assert.match(result.error.message, /cannot preserve/);
    assert.equal(fs.existsSync(out), false);
  });

  it('bounds default inspection output and explicitly exposes full maps', async () => {
    const rows = Array.from({length:300}, (_,index) => `ATOM  ${String(index+1).padStart(5)}  CA  ALA A${String(index+1).padStart(4)}      10.000  10.000  10.000  1.00 20.00           C`).join('\n');
    const large = write('large.pdb', rows);
    const compact = await run(['inputs','inspect','--input',large,'--json']);
    assert.equal(compact.code, 0, compact.stdout);
    assert.equal(compact.data.chains[0].residue_count, 300);
    assert.equal(compact.data.chains[0].residues.length, 200);
    assert.equal(compact.data.chains[0].residues_truncated, true);
    assert.equal(compact.data.chains[0].sequence, undefined);
    const full = await run(['inputs','inspect','--input',large,'--full','--json']);
    assert.equal(full.data.chains[0].residues.length, 300);
    assert.equal(full.data.chains[0].sequence.length, 300);
  });

  it('does not invent positions for an ambiguous full-sequence register', async () => {
    const ambiguous = write('ambiguous.pdb', 'SEQRES   1 A    2  ALA ALA\nATOM      1  CA  ALA A 101      10.000  10.000  10.000  1.00 20.00           C\n');
    const result = await run(['inputs','inspect','--input',ambiguous,'--full','--json']);
    assert.equal(result.data.chains[0].mapping_status, 'unavailable');
    assert.equal(result.data.chains[0].residues[0].sequence_position, null);
    assert.equal(result.data.chains[0].unresolved_regions, null);
  });

  it('requires explicit valid sources, protocol/chains and preparation output', async () => {
    for (const args of [
      ['inputs','inspect'], ['inputs','inspect','extra','--input',pdb],
      ['inputs','inspect','--input',pdb,'--pdb','1ABC'], ['inputs','inspect','--pdb','../x'],
      ['inputs','prepare','--input',pdb,'-f',job], ['inputs','inspect','--input',pdb,'--output','unused'],
    ]) assert.equal((await run([...args,'--json'])).code, 1);
    for (const spec of [{protocol:'unknown',chains:'A'}, {protocol:'pxdesign'}, {protocol:'pxdesign',chains:'A,A'}]) {
      const file = write('invalid-job.json', JSON.stringify(spec));
      assert.equal((await run(['inputs','prepare','--input',pdb,'-f',file,'--output',path.join(root,'invalid-out'),'--json'])).code, 5);
    }
  });

  it('submits exactly the saved prepared bytes and scientific config under mocked transport', async () => {
    const result = await run(['inputs','prepare','--input',pdb,'-f',job,'--output',path.join(root,'for-submit'),'--json']);
    const preparedJob = JSON.parse(fs.readFileSync(result.data.job));
    let uploaded, payload;
    const submitted = await run(['submit','-f',result.data.job,'--input',result.data.input,'--name','prepared-copy','--json'], {
      fetchImpl: async (url, options) => {
        if (String(url).endsWith('/me')) return Response.json({data:{
          actor:{user_id:'33333333-3333-4333-8333-333333333333'},
          billing:{account_type:'user',account_id:'33333333-3333-4333-8333-333333333333'},
        }});
        if (options.method === 'PUT') { uploaded = Buffer.from(options.body); return new Response(''); }
        if (String(url).endsWith('/uploads/init')) return Response.json({data:{upload_url:'https://storage.example/upload', upload_headers:{}, upload_intent_id:'11111111-1111-4111-8111-111111111111'}});
        if (String(url).endsWith('/projects')) { payload = JSON.parse(options.body); return Response.json({data:{project_id:'22222222-2222-4222-8222-222222222222'}}); }
        throw new Error('Unexpected endpoint');
      },
    }, {ARIAX_API_KEY:'arx_test_for_mock_submission'});
    assert.equal(submitted.code, 0, submitted.stdout);
    assert.deepEqual(uploaded, fs.readFileSync(result.data.input));
    delete payload.name; delete payload.input_upload_intent_id;
    assert.deepEqual(payload, preparedJob);
  });
});

describe('credential-free bounded RCSB input', () => {
  it('uses the fixed endpoint with redirects disabled and no authentication', async () => {
    let requested;
    const result = await run(['inputs','inspect','--pdb','1abc','--json'], {
      fetchImpl:async (url, options) => { requested = {url, options}; return new Response(fixtures.cases[1].text); },
    }, {ARIAX_API_KEY:'arx_never_send_to_rcsb'});
    assert.equal(result.code, 0, result.stdout);
    assert.equal(requested.url, 'https://files.rcsb.org/download/1ABC.cif');
    assert.equal(requested.options.redirect, 'error');
    assert.equal(requested.options.headers.Authorization, undefined);
    assert.equal(result.data.source.pdb_id, '1ABC');
    assert.equal(result.data.source.sha256, sha256(fixtures.cases[1].text));
  });

  it('fetches native PDB for an explicit BindCraft job', async () => {
    let requested;
    const file = write('bindcraft-job.json', JSON.stringify({protocol:'bindcraft-v1.5', chains:'A', hotspots:'A102'}));
    const result = await run(['inputs','prepare','--pdb','1ABC','-f',file,'--output',path.join(root,'prepared-bindcraft'),'--json'], {
      fetchImpl:async url => { requested = url; return new Response(fixtures.cases[0].text); },
    });
    assert.equal(result.code, 0, result.stdout);
    assert.equal(requested, 'https://files.rcsb.org/download/1ABC.pdb');
    assert.equal(JSON.parse(fs.readFileSync(result.data.manifest)).job.protocol, 'bindcraft-v1.5');
    assert.deepEqual(fs.readFileSync(result.data.input), fs.readFileSync(pdb));
  });

  it('bounds advertised and streamed response sizes', async () => {
    for (const response of [new Response('irrelevant', {headers:{'content-length':String(MAX_INPUT_SIZE+1)}}), new Response(Buffer.alloc(MAX_INPUT_SIZE+1, 32))]) {
      const result = await run(['inputs','inspect','--pdb','1ABC','--json'], {fetchImpl:async () => response});
      assert.equal(result.code, 5, result.stdout);
      assert.match(result.error.message, /10 MB/);
    }
  });

  it('times out both stalled headers and stalled bodies', async () => {
    for (const fetchImpl of [async () => new Promise(() => {}), async () => new Response(new ReadableStream({pull:() => new Promise(() => {})}))]) {
      const result = await run(['inputs','inspect','--pdb','1ABC','--timeout','5','--json'], {fetchImpl});
      assert.equal(result.code, 9, result.stdout);
      assert.match(result.error.message, /timed out/);
    }
  });

  it('reports RCSB not-found and rejects non-structure response bodies', async () => {
    assert.equal((await run(['inputs','inspect','--pdb','1ABC','--json'], {fetchImpl:async () => new Response('', {status:404})})).code, 4);
    assert.equal((await run(['inputs','inspect','--pdb','1ABC','--json'], {fetchImpl:async () => new Response('<html>error</html>')})).code, 5);
  });
});

it('sequence mapping agrees with the pinned upstream cases', () => {
  assert.deepEqual(sequencePositions('ACD', [{author:101,aminoAcid:'A'},{author:103,aminoAcid:'D'}]), [1,3]);
  assert.equal(sequencePositions('AA', [{author:101,aminoAcid:'A'}]), null);
  assert.deepEqual(sequencePositions('AAAA', [{author:176,register:1,aminoAcid:'A'},{author:177,register:2,aminoAcid:'A'}], true), [1,2]);
});
