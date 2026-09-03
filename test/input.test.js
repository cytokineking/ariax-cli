import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { readAndValidateInput } from '../src/input.js';
import { prepareStructureInput } from '../src/structure-input.js';
import { run as submit } from '../src/commands/submit.js';
import { run as validate } from '../src/commands/validate.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-input-test-'));
after(() => fs.rmSync(directory, { recursive: true, force: true }));

function write(name, value) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, value);
  return file;
}

describe('local structure input validation', () => {
  it('accepts PDB and mmCIF protein atoms', () => {
    const pdb = write('target.pdb', 'ATOM      1  N   ALA A   1      10.000  10.000  10.000  1.00 20.00           N\n');
    const cif = write('target.mmcif', 'data_target\nloop_\n_atom_site.group_PDB\n_atom_site.label_atom_id\n_atom_site.label_comp_id\nATOM N ALA\n');
    assert.equal(readAndValidateInput(pdb).targetFilename, 'input.pdb');
    assert.equal(readAndValidateInput(cif).targetFilename, 'input.cif');
  });

  it('reads and prepares CIF with group_PDB after the coordinate columns', async () => {
    const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/structure-correctness.json', import.meta.url))).cases[1];
    const lines = fixture.text.split('\n');
    const start = lines.indexOf('_atom_site.group_PDB');
    lines.splice(start, 1);
    const end = lines.findIndex(line => line.startsWith('ATOM '));
    lines.splice(end, 0, '_atom_site.group_PDB');
    const reordered = lines.map(line => line.startsWith('ATOM ') ? line.slice(5) + ' ATOM' : line).join('\n');
    const input = readAndValidateInput(write('reordered.cif', reordered));
    const prepared = await prepareStructureInput({
      ...input, spec: {protocol:'pxdesign', chains:'A', sequence_by_chain:{A:'ACD'}},
    });
    assert.equal(prepared.spec.sequence_by_chain.A, 'ACD');
  });

  it('rejects unknown extensions and content without protein atoms', () => {
    assert.throws(() => readAndValidateInput(write('target.txt', 'ATOM X\n')), /\.pdb/);
    assert.throws(() => readAndValidateInput(write('empty.pdb', 'HEADER only\n')), /protein atoms/);
  });
});

describe('submit input upload', () => {
  it('rejects unsafe project names before making a request', async () => {
    const ctx = {
      client: { post: async () => { throw new Error('unexpected request'); } },
      fetchImpl: async () => { throw new Error('unexpected upload'); },
      flags: {
        file: 'unused.json',
        name: 'unsafe project',
      },
      json: false,
      config: { rootDir: directory },
    };
    await assert.rejects(() => submit(ctx), /letters, numbers, and dashes/);
  });

  it('validates locally, uploads directly, then submits the intent id', async () => {
    const specFile = write('job.json', JSON.stringify({
      protocol: 'pxdesign',
      project_type: 'miniprotein',
      chains: 'A',
    }));
    const inputFile = write('submit.pdb', 'ATOM      1  N   ALA A   1      10.000  10.000  10.000  1.00 20.00           N\n');
    const posts = [];
    const puts = [];
    const ctx = {
      client: {
        get: async () => ({ data: { actor: { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, billing: { account_type: 'user', account_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } } }),
        post: async (route, options) => {
          posts.push({ route, options });
          if (route === '/api/v1/uploads/init') {
            return { data: {
              upload_intent_id: '11111111-1111-4111-8111-111111111111',
              upload_url: 'https://storage.example/upload?signature=secret',
              upload_headers: { 'content-type': 'chemical/x-pdb' },
            } };
          }
          return { data: { project_id: '22222222-2222-4222-8222-222222222222', status: 'pending' } };
        },
      },
      fetchImpl: async (url, options) => {
        puts.push({ url, options });
        return new Response(null, { status: 200 });
      },
      flags: {
        file: specFile,
        input: inputFile,
        name: 'cli-direct-upload',
      },
      json: false,
      config: { rootDir: directory },
    };

    await submit(ctx);

    assert.equal(puts.length, 1);
    assert.equal(puts[0].options.method, 'PUT');
    assert.equal(posts[0].route, '/api/v1/uploads/init');
    assert.equal(posts[1].route, '/api/v1/projects');
    assert.match(posts[1].options.idempotencyKey, /^[0-9a-f-]{36}$/);
    assert.equal(posts[1].options.body.input_upload_intent_id, '11111111-1111-4111-8111-111111111111');
  });

  it('reuses an uploaded intent for an exact project retry without another PUT', async () => {
    const specFile = write('retry-job.json', JSON.stringify({ protocol: 'pxdesign', project_type: 'miniprotein' }));
    let submitted;
    const ctx = {
      client: {
        get: async () => ({ data: { actor: { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, billing: { account_type: 'user', account_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } } }),
        post: async (route, options) => {
          assert.equal(route, '/api/v1/projects');
          submitted = options;
          return { data: { project_id: '33333333-3333-4333-8333-333333333333', status: 'pending' } };
        },
      },
      fetchImpl: async () => { throw new Error('unexpected upload'); },
      flags: {
        file: specFile,
        name: 'cli-direct-upload-retry',
        'input-upload-intent-id': '11111111-1111-4111-8111-111111111111',
      },
      json: false,
      config: { rootDir: directory },
    };

    await submit(ctx);
    assert.equal(submitted.body.input_upload_intent_id, '11111111-1111-4111-8111-111111111111');
  });

  it('replays local preparation with --input while reusing an upload intent without another PUT', async () => {
    const specFile = write('prepared-retry-job.json', JSON.stringify({
      protocol: 'pxdesign',
      project_type: 'miniprotein',
      chains: 'A',
    }));
    const inputFile = write(
      'prepared-retry.pdb',
      [
        'ATOM      1  CA  ALA A   1      10.000  10.000  10.000  1.00 20.00           C',
        'ATOM      2  CA  CYS A   2      11.000  10.000  10.000  1.00 20.00           C',
      ].join('\n'),
    );
    let submitted;
    const ctx = {
      client: {
        get: async () => ({ data: { actor: { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, billing: { account_type: 'user', account_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } } }),
        post: async (route, options) => {
          assert.equal(route, '/api/v1/projects');
          submitted = options.body;
          return { data: { project_id: '66666666-6666-4666-8666-666666666666', status: 'pending' } };
        },
      },
      fetchImpl: async () => { throw new Error('unexpected upload'); },
      flags: {
        file: specFile,
        input: inputFile,
        name: 'cli-prepared-retry',
        'input-upload-intent-id': '11111111-1111-4111-8111-111111111111',
      },
      json: false,
      config: { rootDir: directory },
    };

    await submit(ctx);
    assert.equal(submitted.input_upload_intent_id, '11111111-1111-4111-8111-111111111111');
    assert.equal(submitted.sequence_by_chain.A, 'AC');
  });

  it('does not contact Ariax or object storage when a required sequence is unavailable', async () => {
    const specFile = write('missing-sequence-job.json', JSON.stringify({
      protocol: 'pxdesign',
      project_type: 'miniprotein',
      chains: 'A',
    }));
    const inputFile = write(
      'missing-sequence.pdb',
      [
        'ATOM      1  CA  ALA A   1      10.000  10.000  10.000  1.00 20.00           C',
        'ATOM      2  CA  CYS A   3      11.000  10.000  10.000  1.00 20.00           C',
      ].join('\n'),
    );
    let requests = 0;
    const ctx = {
      client: { post: async () => { requests += 1; } },
      fetchImpl: async () => { requests += 1; },
      flags: {
        file: specFile,
        input: inputFile,
        name: 'cli-no-unsafe-upload',
      },
      json: true,
      config: { rootDir: directory },
    };

    await assert.rejects(() => submit(ctx), /cannot be reconstructed safely/);
    assert.equal(requests, 0);
  });

  it('rejects BindCraft CIF after local validation and does not upload', async () => {
    const specFile = write('bindcraft-cif.json', JSON.stringify({
      protocol: 'BINDCRAFT-V1.5',
      project_type: 'miniprotein',
    }));
    const inputFile = write(
      'bindcraft.mmcif',
      'data_target\nloop_\n_atom_site.group_PDB\n_atom_site.label_atom_id\n_atom_site.label_comp_id\nATOM N ALA\n',
    );
    const ctx = {
      client: {
        get: async () => ({ data: { actor: { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, billing: { account_type: 'user', account_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } } }),
        post: async () => { throw new Error('unexpected request'); },
      },
      fetchImpl: async () => { throw new Error('unexpected upload'); },
      flags: {
        file: specFile,
        input: inputFile,
        name: 'cli-bindcraft-cif',
      },
      json: false,
      config: { rootDir: directory },
    };

    await assert.rejects(
      () => submit(ctx),
      (error) => {
        assert.equal(error.code, 'validation_failed');
        assert.equal(error.exitCode, 5);
        assert.match(error.message, /BindCraft currently requires PDB/i);
        return true;
      },
    );
  });

  it('uploads CIF for a non-BindCraft protocol', async () => {
    const specFile = write('boltzgen-cif.json', JSON.stringify({
      protocol: 'boltzgen',
      project_type: 'miniprotein',
      chains: 'A',
    }));
    const inputFile = write(
      'boltzgen.cif',
      [
        'data_target',
        'loop_',
        '_atom_site.group_PDB',
        '_atom_site.label_atom_id',
        '_atom_site.label_comp_id',
        '_atom_site.label_asym_id',
        '_atom_site.label_seq_id',
        '_atom_site.auth_comp_id',
        '_atom_site.auth_asym_id',
        '_atom_site.auth_seq_id',
        '_atom_site.label_entity_id',
        'ATOM CA ALA A 1 ALA A 1 1',
        '#',
      ].join('\n'),
    );
    const posts = [];
    const puts = [];
    const ctx = {
      client: {
        get: async () => ({ data: { actor: { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, billing: { account_type: 'user', account_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } } }),
        post: async (route, options) => {
          posts.push({ route, options });
          if (route === '/api/v1/uploads/init') {
            return {
              data: {
                upload_intent_id: '44444444-4444-4444-8444-444444444444',
                upload_url: 'https://storage.example/upload?signature=cif',
                upload_headers: { 'content-type': 'chemical/x-cif' },
              },
            };
          }
          return { data: { project_id: '55555555-5555-4555-8555-555555555555', status: 'pending' } };
        },
      },
      fetchImpl: async (url, options) => {
        puts.push({ url, options });
        return new Response(null, { status: 200 });
      },
      flags: {
        file: specFile,
        input: inputFile,
        name: 'cli-boltzgen-cif',
      },
      json: false,
      config: { rootDir: directory },
    };

    await submit(ctx);

    assert.equal(puts.length, 1);
    assert.equal(posts[0].route, '/api/v1/uploads/init');
    assert.equal(posts[0].options.body.target_filename, 'input.cif');
    assert.equal(posts[1].route, '/api/v1/projects');
    assert.equal(posts[1].options.body.input_upload_intent_id, '44444444-4444-4444-8444-444444444444');
  });

  it('uploads the normalized ESMFold2 CIF bytes without modifying the local file', async () => {
    const specFile = write('esmfold2-cif.json', JSON.stringify({
      protocol: 'esmfold2-pipeline',
      protocol_config: {
        design_type: 'miniprotein',
        target: { chains: ['A'] },
      },
    }));
    const sourceText = [
      'data_modelcif',
      'loop_',
      '_atom_site.group_PDB',
      '_atom_site.type_symbol',
      '_atom_site.Cartn_x',
      '_atom_site.Cartn_y',
      '_atom_site.Cartn_z',
      '_atom_site.label_atom_id',
      '_atom_site.label_comp_id',
      '_atom_site.label_asym_id',
      '_atom_site.label_entity_id',
      '_atom_site.label_seq_id',
      '_atom_site.auth_comp_id',
      '_atom_site.auth_asym_id',
      '_atom_site.auth_seq_id',
      '_atom_site.pdbx_PDB_ins_code',
      'ATOM C 10.0 10.0 10.0 CA ALA A 1 1 ALA A 1 ?',
      '#',
    ].join('\n');
    const inputFile = write('esmfold2.cif', sourceText);
    const posts = [];
    let uploadedText = '';
    const ctx = {
      client: {
        get: async () => ({ data: { actor: { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, billing: { account_type: 'user', account_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } } }),
        post: async (route, options) => {
          posts.push({ route, options });
          if (route === '/api/v1/uploads/init') {
            return {
              data: {
                upload_intent_id: '77777777-7777-4777-8777-777777777777',
                upload_url: 'https://storage.example/upload?signature=esmfold2',
                upload_headers: { 'content-type': 'chemical/x-cif' },
              },
            };
          }
          return { data: { project_id: '88888888-8888-4888-8888-888888888888', status: 'pending' } };
        },
      },
      fetchImpl: async (_url, options) => {
        uploadedText = Buffer.from(options.body).toString('utf8');
        return new Response(null, { status: 200 });
      },
      flags: {
        file: specFile,
        input: inputFile,
        name: 'cli-esmfold2-cif',
      },
      json: false,
      config: { rootDir: directory },
    };

    await submit(ctx);

    assert.match(uploadedText, /_atom_site\.auth_atom_id/);
    assert.match(uploadedText, /ATOM C 10.0 10.0 10.0 CA ALA A 1 1 ALA A 1 \? CA/);
    assert.equal(fs.readFileSync(inputFile, 'utf8'), sourceText);
    assert.equal(posts[1].options.body.input_upload_intent_id, '77777777-7777-4777-8777-777777777777');
  });
});

describe('validate with structure input', () => {
  it('sends the locally prepared spec to the side-effect-free validation API', async () => {
    const specFile = write('validate-with-input.json', JSON.stringify({
      protocol: 'pxdesign',
      project_type: 'miniprotein',
      chains: 'A',
    }));
    const inputFile = write(
      'validate-with-input.pdb',
      [
        'ATOM      1  CA  ALA A   1      10.000  10.000  10.000  1.00 20.00           C',
        'ATOM      2  CA  CYS A   2      11.000  10.000  10.000  1.00 20.00           C',
      ].join('\n'),
    );
    let request;
    const ctx = {
      client: {
        get: async () => ({ data: { actor: { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, billing: { account_type: 'user', account_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } } }),
        post: async (route, options) => {
          request = { route, body: options.body };
          return { data: { valid: true, protocol: 'pxdesign' } };
        },
      },
      flags: { file: specFile, input: inputFile },
      json: false,
    };

    await validate(ctx);
    assert.equal(request.route, '/api/v1/validate');
    assert.equal(request.body.sequence_by_chain.A, 'AC');
  });
});
