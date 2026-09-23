import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { compactBindcraft2FileInspection, inspectBindcraft2Bundle, prepareBindcraft2Bundle, requiredBindcraft2Inputs, writeBindcraft2Bundle } from '../src/bindcraft2-inputs.js';
import { run as submit } from '../src/commands/submit.js';
import { run as inputs } from '../src/commands/inputs.js';
import { run as validate } from '../src/commands/validate.js';
import { listOperations, verifyReplayInputs } from '../src/operations.js';

const PDB_A = 'ATOM      1  N   ALA A   1      10.000  10.000  10.000  1.00 20.00           N\n';
const PDB_X = 'ATOM      1  N   GLY X   7      10.000  10.000  10.000  1.00 20.00           N\n';

function pdbResidues(chain, residues) {
  return residues.map((residue, index) => (
    `ATOM  ${String(index + 1).padStart(5)}  N   ALA ${chain}${String(residue).padStart(4)}      10.000  10.000  10.000  1.00 20.00           N\n`
  )).join('');
}

function spec({ scaffold = false } = {}) {
  return {
    protocol: 'bindcraft2',
    protocol_config: {
      schema_version: 1,
      modality: [scaffold ? 'DARPin' : 'binder'],
      properties: [],
      targets: [
        { name: 'target', input_file: 'input.pdb', chains: ['A'], hotspots: 'A1', objective: 'target', weight: 1 },
        { name: 'avoid', input_file: 'avoid.fasta', chains: ['B'], objective: 'detarget', weight: -1 },
      ],
      binder: scaffold ? { scaffold_file: 'scaffold.pdb', mutate_positions: 'X7' } : { lengths: [80, 100] },
      campaign: { num_designs: 1 },
      advanced: { max_detarget_iptm_final: 0.3 },
    },
  };
}

function inputDirectory(root, { scaffold = false } = {}) {
  const directory = path.join(root, 'inputs');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'input.pdb'), PDB_A);
  fs.writeFileSync(path.join(directory, 'avoid.fasta'), '>B\nACDE\n');
  if (scaffold) fs.writeFileSync(path.join(directory, 'scaffold.pdb'), PDB_X);
  return directory;
}

describe('BindCraft2 deterministic input bundles', () => {
  it('derives canonical ARP project type, validates secondary FASTA/scaffold, and writes exact repeatable output', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-bc2-bundle-'));
    const directory = inputDirectory(root, { scaffold: true });
    const bundle = prepareBindcraft2Bundle({ spec: spec({ scaffold: true }), inputDir: directory });
    assert.equal(bundle.projectType, 'arp');
    assert.equal(bundle.spec.protocol_config.modality[0], 'ARP');
    assert.deepEqual(bundle.required, ['avoid.fasta', 'input.pdb', 'scaffold.pdb']);
    assert.equal(Object.hasOwn(bundle.spec.protocol_config.advanced, 'desperation_trajectories'), false);
    assert.deepEqual(Object.keys(bundle.manifest.files), bundle.required);
    const output = path.join(root, 'prepared');
    writeBindcraft2Bundle(output, bundle);
    const first = fs.readFileSync(path.join(output, 'input-manifest.json'));
    assert.equal(writeBindcraft2Bundle(output, bundle), output);
    assert.deepEqual(fs.readdirSync(output).sort(), ['avoid.fasta', 'input-manifest.json', 'input.pdb', 'job.json', 'scaffold.pdb']);
    assert(fs.readFileSync(path.join(output, 'input-manifest.json')).equals(first));
  });

  it('adopts an existing empty output directory atomically while preserving conflict safety', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-bc2-empty-output-'));
    const directory = inputDirectory(root);
    const bundle = prepareBindcraft2Bundle({ spec: spec(), inputDir: directory });
    const output = path.join(root, 'prepared');
    fs.mkdirSync(output);
    assert.equal(writeBindcraft2Bundle(output, bundle), output);
    assert.deepEqual(fs.readdirSync(output).sort(), ['avoid.fasta', 'input-manifest.json', 'input.pdb', 'job.json']);
    fs.writeFileSync(path.join(output, 'extra.txt'), 'do not replace');
    assert.throws(() => writeBindcraft2Bundle(output, bundle), /different content/);
    assert.equal(fs.readFileSync(path.join(output, 'extra.txt'), 'utf8'), 'do not replace');
  });

  it('reports compact and full per-file target, scaffold, FASTA, and author-register evidence', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-bc2-inspect-'));
    const directory = inputDirectory(root, { scaffold: true });
    const bundle = prepareBindcraft2Bundle({ spec: spec({ scaffold: true }), inputDir: directory });
    const compact = inspectBindcraft2Bundle(bundle);
    const target = compact.files.find((entry) => entry.filename === 'input.pdb');
    const fasta = compact.files.find((entry) => entry.filename === 'avoid.fasta');
    const scaffold = compact.files.find((entry) => entry.filename === 'scaffold.pdb');
    assert.deepEqual(target.chains.map((chain) => chain.chain), ['A']);
    assert.equal(target.targets[0].hotspots.value, 'A1');
    assert.equal(target.targets[0].hotspots.residue_register, 'author');
    assert.equal(target.targets[0].hotspots.validated, true);
    assert.equal(target.chains[0].sequence, undefined);
    assert.equal(target.chains[0].sequence_length, 1);
    assert.equal(target.chains[0].sequence_sha256, undefined);
    assert.equal(target.chains[0].residues, undefined);
    assert.equal(fasta.targets[0].selected_record, 'B');
    assert.equal(fasta.records[0].sequence, undefined);
    assert.equal(fasta.records[0].sequence_length, 4);
    assert.equal(scaffold.scaffold.mutate_positions, 'X7');
    assert.equal(compact.schema_version, undefined);
    assert.equal(compact.kind, undefined);
    assert.equal(compact.prepared_by, undefined);
    assert.equal(compact.required_files, undefined);
    assert.equal(compact.files.find((entry) => entry.filename === 'avoid.fasta').records[0].sequence_sha256, undefined);
    assert.match(compact.warnings[0], /does not determine biological assembly or target accessibility/);

    const full = inspectBindcraft2Bundle(bundle, { full: true });
    assert.equal(full.files.find((entry) => entry.filename === 'input.pdb').chains[0].sequence, 'A');
    assert.equal(full.files.find((entry) => entry.filename === 'avoid.fasta').records[0].sequence, 'ACDE');
    assert.deepEqual(full.files.find((entry) => entry.filename === 'input.pdb').chains[0].residues.map((row) => row.author_residue), [1]);
    assert.equal(full.prepared_by, undefined);

    const details = inspectBindcraft2Bundle(bundle, { details: true });
    assert.equal(details.kind, 'ariax_bindcraft2_input_bundle');
    assert.deepEqual(details.required_files, ['avoid.fasta', 'input.pdb', 'scaffold.pdb']);
    assert.match(details.files['input.pdb'].sha256, /^[a-f0-9]{64}$/);
    assert.match(details.file_inspections.find((entry) => entry.filename === 'input.pdb').chains[0].sequence_sha256, /^[a-f0-9]{64}$/);
    assert.equal(details.file_inspections.find((entry) => entry.filename === 'input.pdb').chains[0].sequence, undefined);

    const fullDetails = inspectBindcraft2Bundle(bundle, { full: true, details: true });
    assert.equal(fullDetails.inspection_scope.full, true);
    assert.equal(fullDetails.file_inspections.find((entry) => entry.filename === 'input.pdb').chains[0].sequence, 'A');
  });

  it('preserves authoritative counts when diagnostic previews are truncated', () => {
    const compact = compactBindcraft2FileInspection({
      filename: 'input.pdb', format: 'pdb', roles: ['target'], targets: [],
      selected_chains: ['z'], chain_count: 75, chains_truncated: true,
      chains: [{
        source_chain: 'z', prepared_chain: 'z', selected: true,
        sequence_length: 250, sequence_source: 'polymer_metadata', mapping_status: 'verified',
        unresolved_region_count: 150,
        unresolved_regions: Array.from({ length: 100 }, (_, index) => ({ start: index * 2 + 1, end: index * 2 + 1 })),
        unresolved_regions_truncated: true,
      }],
      warnings: [],
    });
    assert.equal(compact.chain_count, 75);
    assert.equal(compact.chains_truncated, true);
    assert.deepEqual(compact.selected_chains, ['z']);
    assert.equal(compact.selected_chain_count, 1);
    assert.equal(compact.chains[0].unresolved_region_count, 150);
  });

  it('prioritizes selected chains in a bounded multi-chain preview', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-bc2-many-chains-'));
    const directory = path.join(root, 'inputs');
    fs.mkdirSync(directory);
    const chainIds = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('');
    fs.writeFileSync(path.join(directory, 'input.pdb'), chainIds.map((chain) => pdbResidues(chain, [1])).join(''));
    const many = spec();
    many.protocol_config.targets = [
      { name: 'target', input_file: 'input.pdb', chains: ['z'], hotspots: 'z1', objective: 'target', weight: 1 },
    ];
    const compact = inspectBindcraft2Bundle(prepareBindcraft2Bundle({ spec: many, inputDir: directory }));
    const file = compact.files[0];
    assert.equal(file.chain_count, 52);
    assert.equal(file.chains_truncated, true);
    assert.deepEqual(file.selected_chains, ['z']);
    assert.equal(file.selected_chain_count, 1);
    assert.equal(file.chains.length, 50);
    assert.equal(file.chains[0].chain, 'z');
    assert.equal(file.chains[0].selected, true);
  });

  it('enforces single-file convenience, exact primary naming, safe files, and target selectors', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-bc2-invalid-'));
    const directory = inputDirectory(root);
    assert.throws(() => prepareBindcraft2Bundle({ spec: spec(), inputFile: path.join(directory, 'input.pdb') }), /exactly one unique/);
    fs.rmSync(path.join(directory, 'avoid.fasta'));
    assert.throws(() => prepareBindcraft2Bundle({ spec: spec(), inputDir: directory }), /Cannot read BindCraft2 input/);
    const bad = spec();
    bad.protocol_config.targets = [{ name: 'target', input_file: 'input.pdb', chains: ['Z'], objective: 'target', weight: 1 }];
    assert.throws(() => prepareBindcraft2Bundle({ spec: bad, inputDir: directory }), /selected chain Z is absent/);
    const unsafe = spec();
    unsafe.protocol_config.targets[1].input_file = '../avoid.fasta';
    assert.throws(() => requiredBindcraft2Inputs(unsafe), /safe .* basename/);
  });

  it('matches native multi-digit, unqualified-first-chain, and range target selection semantics', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-bc2-target-selections-'));
    const directory = inputDirectory(root);
    fs.writeFileSync(path.join(directory, 'input.pdb'), `${pdbResidues('A', [54, 55, 100, 101])}${pdbResidues('B', [1])}`);
    const selected = spec();
    selected.protocol_config.targets[0].chains = ['A', 'B'];
    selected.protocol_config.targets[0].hotspots = 'A54,55,A101-100';
    selected.protocol_config.targets[0].coldspots = '54-55';
    assert.doesNotThrow(() => prepareBindcraft2Bundle({ spec: selected, inputDir: directory }));

    for (const value of ['A54(5,8)', 'A54*', 'A54-999', '54+HOTSPOT', 'A54-']) {
      const rejected = structuredClone(selected);
      rejected.protocol_config.targets[0].hotspots = value;
      assert.throws(
        () => prepareBindcraft2Bundle({ spec: rejected, inputDir: directory }),
        /invalid native|cannot resize|absent/i,
        value,
      );
    }
  });

  it('tokenizes native scaffold replacement choices and flags without splitting inner commas', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-bc2-scaffold-selections-'));
    const directory = inputDirectory(root, { scaffold: true });
    fs.writeFileSync(path.join(directory, 'scaffold.pdb'), pdbResidues('X', [7, 54, 100]));
    const selected = spec({ scaffold: true });
    selected.protocol_config.binder.mutate_positions = 'X7(5,8),X100-54(2-4)*!+COLDSPOT-DESIGN';
    assert.doesNotThrow(() => prepareBindcraft2Bundle({ spec: selected, inputDir: directory }));

    for (const value of ['X7+FAKE', 'X7+', 'X7(0,8)', 'X7(5,2001)', '7*', 'X7(5,8', 'Z7*']) {
      const rejected = structuredClone(selected);
      rejected.protocol_config.binder.mutate_positions = value;
      assert.throws(
        () => prepareBindcraft2Bundle({ spec: rejected, inputDir: directory }),
        /invalid native|unknown native|between 1 and 2000|absent chain/i,
        value,
      );
    }
  });

  it('shares bundle preparation across inspect, prepare, and server validation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-bc2-commands-'));
    const directory = inputDirectory(root);
    const job = path.join(root, 'job.json');
    fs.writeFileSync(job, JSON.stringify(spec()));
    const currentBuild = { version: 'test', channel: 'source', source_revision: 'a'.repeat(40), source_dirty: false };
    await inputs({ positionals: ['inspect'], flags: { file: job, 'input-dir': directory }, json: true, currentBuild });
    const output = path.join(root, 'prepared');
    await inputs({ positionals: ['prepare'], flags: { file: job, 'input-dir': directory, output }, json: true, currentBuild });
    assert.deepEqual(fs.readdirSync(output).sort(), ['avoid.fasta', 'input-manifest.json', 'input.pdb', 'job.json']);
    let validated;
    await validate({ flags: { file: job, 'input-dir': directory }, json: true, client: { post: async (url, options) => {
      assert.equal(url, '/api/v1/validate');
      validated = options.body;
      return { data: { valid: true, protocol_id: 'bindcraft2', normalized_job_spec: options.body } };
    } } });
    assert.equal(validated.protocol, 'bindcraft2');
    await assert.rejects(validate({ flags: { file: job, input: path.join(directory, 'input.pdb'), 'input-dir': directory },
      json: true, client: { post: async () => assert.fail('must not call server') } }), /choose only one input source/i);
  });
});

describe('BindCraft2 signed upload and durable recovery', () => {
  it('validates, authorizes the exact set, uploads frozen bytes, and writes a v2 journal readable without sources', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-bc2-submit-'));
    const directory = inputDirectory(root);
    const job = path.join(root, 'job.json');
    const requested = spec();
    requested.protocol_config.advanced.desperation = true;
    requested.protocol_config.advanced.desperation_trajectories = 0;
    fs.writeFileSync(job, JSON.stringify(requested));
    const posts = [];
    const puts = [];
    const normalized = { ...requested, project_type: 'miniprotein' };
    const client = {
      get: async (url) => {
        assert.equal(url, '/api/v1/me');
        return { data: { actor: { user_id: '11111111-1111-4111-8111-111111111111' }, billing: {
          account_type: 'user', account_id: '22222222-2222-4222-8222-222222222222',
        } } };
      },
      post: async (url, options) => {
        posts.push({ url, options });
        if (url === '/api/v1/validate') return { data: { normalized_job_spec: normalized } };
        if (url === '/api/v1/uploads/init') return { data: {
          upload_intent_id: '33333333-3333-4333-8333-333333333333',
          expires_at: '2099-01-01T00:00:00Z',
          uploads: [
            { filename: 'input.pdb', upload_url: 'https://uploads.example/input', upload_method: 'PUT', upload_headers: { 'x-one': '1' } },
            { filename: 'avoid.fasta', upload_url: 'https://uploads.example/avoid', upload_method: 'PUT', upload_headers: { 'x-two': '2' } },
          ],
        } };
        if (url === '/api/v1/projects') return { data: { id: '44444444-4444-4444-8444-444444444444', status: 'pending' } };
        throw new Error(`Unexpected POST ${url}`);
      },
    };
    const fetchImpl = async (url, options) => {
      puts.push({ url: String(url), body: Buffer.from(options.body), headers: options.headers });
      return new Response('', { status: 200 });
    };
    const ctx = {
      client, fetchImpl, timeoutMs: 1000, json: true,
      flags: { file: job, name: 'bc2-test', 'input-dir': directory },
      config: { rootDir: root, baseUrl: 'https://www.ariax.bio' },
    };
    await submit(ctx);
    assert.equal(posts.find((entry) => entry.url === '/api/v1/validate').options.body.protocol_config.advanced.desperation_trajectories, 0);
    assert.equal(posts.find((entry) => entry.url === '/api/v1/projects').options.body.protocol_config.advanced.desperation_trajectories, 0);
    const init = posts.find((entry) => entry.url === '/api/v1/uploads/init').options.body;
    assert.deepEqual(init, { project_name: 'bc2-test', project_type: 'miniprotein', target_filename: 'input.pdb', input_files: ['avoid.fasta', 'input.pdb'] });
    assert.equal(puts.length, 2);
    assert.equal(puts.find((entry) => entry.url.endsWith('/avoid')).body.toString(), '>B\nACDE\n');
    assert.equal(puts.find((entry) => entry.url.endsWith('/input')).body.toString(), PDB_A);
    const operation = listOperations(root)[0];
    assert.equal(operation.version, 2);
    assert.equal(operation.request.body.protocol_config.advanced.desperation_trajectories, 0);
    assert.deepEqual(operation.prepared_inputs.map((entry) => entry.filename), ['avoid.fasta', 'input.pdb']);
    fs.rmSync(job);
    fs.rmSync(directory, { recursive: true });
    assert.doesNotThrow(() => verifyReplayInputs(ctx, operation));
    fs.appendFileSync(path.join(root, '.ariax', 'operations', operation.prepared_inputs[0].snapshot), 'changed');
    assert.throws(() => verifyReplayInputs(ctx, operation), /bundle changed or is corrupt/);
  });

  it('checks local operation storage before reserving a BindCraft2 upload', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-bc2-preflight-'));
    const directory = inputDirectory(root);
    const job = path.join(root, 'job.json');
    fs.writeFileSync(job, JSON.stringify(spec()));
    fs.symlinkSync(directory, path.join(root, '.ariax'), 'dir');
    const posts = [];
    await assert.rejects(() => submit({
      client: {
        get: async () => assert.fail('account lookup must not run'),
        post: async (url) => {
          posts.push(url);
          assert.equal(url, '/api/v1/validate');
          return { data: { normalized_job_spec: { ...spec(), project_type: 'miniprotein' } } };
        },
      },
      fetchImpl: async () => assert.fail('upload must not run'),
      flags: { file: job, name: 'bc2-preflight', 'input-dir': directory },
      config: { rootDir: root, baseUrl: 'https://www.ariax.bio' },
      json: true,
    }), (error) => {
      assert.match(error.message, /Operation storage must use real directories/);
      assert.match(error.message, /No upload was reserved/);
      assert.match(error.message, /--root-dir WRITABLE_DIRECTORY/);
      return true;
    });
    assert.deepEqual(posts, ['/api/v1/validate']);
  });

  it('reports a reusable bundle intent when journaling fails after both PUTs', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-bc2-journal-failure-'));
    const directory = inputDirectory(root);
    const job = path.join(root, 'job.json');
    fs.writeFileSync(job, JSON.stringify(spec()));
    const intentId = '33333333-3333-4333-8333-333333333333';
    const expiresAt = '2030-01-01T00:00:00Z';
    const posts = [];
    let puts = 0;
    await assert.rejects(() => submit({
      client: {
        get: async () => ({ data: { actor: { user_id: '11111111-1111-4111-8111-111111111111' }, billing: {
          account_type: 'user', account_id: '22222222-2222-4222-8222-222222222222',
        } } }),
        post: async (url) => {
          posts.push(url);
          if (url === '/api/v1/validate') return { data: { normalized_job_spec: { ...spec(), project_type: 'miniprotein' } } };
          assert.equal(url, '/api/v1/uploads/init');
          return { data: {
            upload_intent_id: intentId, expires_at: expiresAt,
            uploads: [
              { filename: 'input.pdb', upload_url: 'https://uploads.example/input', upload_method: 'PUT', upload_headers: {} },
              { filename: 'avoid.fasta', upload_url: 'https://uploads.example/avoid', upload_method: 'PUT', upload_headers: {} },
            ],
          } };
        },
      },
      fetchImpl: async () => {
        puts += 1;
        if (puts === 2) {
          const journal = path.join(root, '.ariax', 'operations');
          fs.rmdirSync(journal);
          fs.symlinkSync(root, journal, 'dir');
        }
        return new Response(null, { status: 200 });
      },
      flags: { file: job, name: 'bc2-journal-failure', 'input-dir': directory },
      config: { rootDir: root, baseUrl: 'https://www.ariax.bio' },
      json: true,
    }), (error) => {
      assert.match(error.message, /Operation storage must use real directories/);
      assert.match(error.message, new RegExp(intentId));
      assert.match(error.message, new RegExp(expiresAt));
      assert.match(error.message, /Project creation was not requested/);
      assert.match(error.message, /--input-dir INPUT_DIR/);
      assert.match(error.message, /--root-dir WRITABLE_DIRECTORY/);
      return true;
    });
    assert.deepEqual(posts, ['/api/v1/validate', '/api/v1/uploads/init']);
    assert.equal(puts, 2);
  });

  it('rejects missing upload descriptors before object upload or project creation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-bc2-descriptor-'));
    const directory = inputDirectory(root);
    const job = path.join(root, 'job.json');
    fs.writeFileSync(job, JSON.stringify(spec()));
    let fetches = 0;
    let creates = 0;
    const client = {
      get: async () => ({ data: { actor: { user_id: '11111111-1111-4111-8111-111111111111' }, billing: {
        account_type: 'user', account_id: '22222222-2222-4222-8222-222222222222',
      } } }),
      post: async (url) => {
        if (url === '/api/v1/validate') return { data: { normalized_job_spec: { ...spec(), project_type: 'miniprotein' } } };
        if (url === '/api/v1/uploads/init') return { data: { upload_intent_id: '33333333-3333-4333-8333-333333333333', uploads: [
          { filename: 'input.pdb', upload_url: 'https://uploads.example/input', upload_method: 'PUT', upload_headers: {} },
        ] } };
        if (url === '/api/v1/projects') creates += 1;
        return { data: {} };
      },
    };
    await assert.rejects(submit({ client, fetchImpl: async () => { fetches += 1; }, timeoutMs: 1000, json: true,
      flags: { file: job, name: 'bc2-test', 'input-dir': directory },
      config: { rootDir: root, baseUrl: 'https://www.ariax.bio' },
    }), /exact BindCraft2 input bundle/);
    assert.equal(fetches, 0);
    assert.equal(creates, 0);
    assert.deepEqual(listOperations(root), []);
  });
});

it('accepts whole-chain hotspots without rewriting the saved job and rejects missing chains', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-bc2-whole-chain-'));
  try {
    const directory = inputDirectory(root);
    fs.writeFileSync(path.join(directory, 'input.pdb'), pdbResidues('A', [5, 8, 20]));
    const job = spec();
    job.protocol_config.targets[0].hotspots = 'A';
    const bundle = prepareBindcraft2Bundle({ spec: job, inputDir: directory });
    assert.equal(bundle.spec.protocol_config.targets[0].hotspots, 'A');
    job.protocol_config.targets[0].hotspots = 'Z';
    assert.throws(() => prepareBindcraft2Bundle({ spec: job, inputDir: directory }), /existing selected chain/);
    job.protocol_config.targets[0].hotspots = 'A';
    job.protocol_config.targets = [job.protocol_config.targets[0]];
    job.protocol_config.targets[0].coldspots = 'A';
    assert.equal(prepareBindcraft2Bundle({ spec: job, inputDir: directory }).spec.protocol_config.targets[0].coldspots, 'A');
  } finally { fs.rmSync(root, {recursive:true, force:true}); }
});
