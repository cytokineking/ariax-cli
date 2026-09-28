import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalGpu, checkGpuPolicy } from '../src/gpu-policy.js';
import { run as submit } from '../src/commands/submit.js';
import { run as validate } from '../src/commands/validate.js';
import { EXIT } from '../src/exit-codes.js';

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));
function jobFile(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-gpu-policy-'));
  roots.push(root);
  const file = path.join(root, 'job.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  return { root, file };
}

it('recognizes server GPU aliases but does not confuse A100 40 GB or RTX6000ADA with core classes', async () => {
  assert.equal(canonicalGpu(' A100 '), 'A100_80GB');
  assert.equal(canonicalGpu('RTX-PRO6000'), 'RTX6000PRO');
  assert.equal(canonicalGpu('A100-40GB'), 'A100_40GB');
  const ctx = { client: { get: async () => { throw new Error('unexpected schema lookup'); } } };
  await checkGpuPolicy(ctx, { protocol: 'bindcraft', allowed_gpus: ['A100', 'H200'] });
  await checkGpuPolicy(ctx, { protocol: 'Bindcraft v1.5', allowed_gpus: ['RTX-PRO6000', 'H200'] });
  for (const allowed_gpus of [['A100_40GB', 'H200'], ['RTX6000ADA', 'A6000']]) {
    await assert.rejects(checkGpuPolicy(ctx, { protocol: 'boltzgen', allowed_gpus }), (error) => {
      assert.equal(error.exitCode, EXIT.VALIDATION);
      assert.deepEqual(error.details.allowed_gpus, allowed_gpus);
      assert.ok(error.details.core_gpus.includes('H100'));
      return true;
    });
  }
});

it('uses the live schema default only when allowed_gpus is omitted', async () => {
  const paths = [];
  const ctx = { client: { get: async (url) => {
    paths.push(url);
    return { data: { json_schema: { properties: { allowed_gpus: { default: ['H200', 'H100'] } } } } };
  } } };
  await checkGpuPolicy(ctx, { protocol: 'boltzgen' });
  assert.deepEqual(paths, ['/api/v1/protocols/boltzgen/schema']);
  for (const allowed_gpus of [null, [], 'H100']) {
    await assert.rejects(checkGpuPolicy(ctx, { protocol: 'boltzgen', allowed_gpus }), (error) => error.exitCode === EXIT.VALIDATION);
  }
  assert.equal(paths.length, 1);
});

it('requests the public BindCraft schema slug and rejects an invalid live default', async () => {
  let requested;
  const ctx = { client: { get: async (url) => {
    requested = url;
    return { data: { json_schema: { properties: { allowed_gpus: { default: ['H200'] } } } } };
  } } };
  await assert.rejects(checkGpuPolicy(ctx, { protocol: 'bindcraft' }), (error) => error.exitCode === EXIT.VALIDATION);
  assert.equal(requested, '/api/v1/protocols/bindcraft-v1.5/schema');
});

it('requires a core GPU compatible with the selected protocol', async () => {
  const ctx = { client: {} };
  await assert.rejects(checkGpuPolicy(ctx, { protocol: 'pxdesign', allowed_gpus: ['RTX6000PRO', 'B200'] }), /no compatible core GPU/);
  await assert.rejects(checkGpuPolicy(ctx, { protocol: 'esmfold2-pipeline', allowed_gpus: ['L40', 'H200'] }), /no compatible core GPU/);
  await checkGpuPolicy(ctx, { protocol: 'esmfold2-pipeline', allowed_gpus: ['RTX6000PRO', 'H200'] });
});

it('warns on one core GPU through stderr only', async () => {
  const previous = process.stderr.write;
  let diagnostic = '';
  process.stderr.write = (chunk) => { diagnostic += chunk; return true; };
  try {
    await checkGpuPolicy({ client: {} }, { protocol: 'boltzgen', allowed_gpus: ['H100', 'H100'] });
  } finally { process.stderr.write = previous; }
  assert.match(diagnostic, /GPU availability advisory/);
  assert.match(diagnostic, /Turbo and GPU count are separate/);
});

it('rejects limited-only jobs before validation or any upload reservation', async () => {
  const { root, file } = jobFile({ protocol: 'bindcraft-v1.5', allowed_gpus: ['H200'] });
  const calls = [];
  const client = { get: async (url) => { calls.push(url); throw new Error('unexpected GET'); },
    post: async (url) => { calls.push(url); throw new Error('unexpected POST'); } };
  const ctx = { client, flags: { file, name: 'gpu-test' }, config: { rootDir: root }, json: true };
  await assert.rejects(submit(ctx), (error) => error.exitCode === EXIT.VALIDATION);
  await assert.rejects(validate({ ...ctx, flags: { file } }), (error) => error.exitCode === EXIT.VALIDATION);
  assert.deepEqual(calls, []);
  assert.equal(fs.existsSync(path.join(root, '.ariax')), false);
});

it('rejects a normalized validation policy that lost its core selection', async () => {
  const { file } = jobFile({ protocol: 'bindcraft-v1.5', allowed_gpus: ['H100', 'H200'] });
  const client = { post: async () => ({ data: {
    valid: true, normalized_job_spec: { allowed_gpus: ['H200'] },
  } }) };
  await assert.rejects(validate({ client, flags: { file }, json: true }), (error) => {
    assert.equal(error.exitCode, EXIT.VALIDATION);
    assert.deepEqual(error.details.allowed_gpus, ['H200']);
    return true;
  });
});

it('blocks limited-only structure submissions before upload authorization', async () => {
  const { root, file } = jobFile({ protocol: 'pxdesign', project_type: 'miniprotein', chains: 'A', allowed_gpus: ['H200'] });
  const input = path.join(root, 'input.pdb');
  fs.writeFileSync(input, 'ATOM      1  N   ALA A   1      10.000  10.000  10.000  1.00 20.00           N\n');
  const ctx = { client: { get: async () => assert.fail('no GET expected'), post: async () => assert.fail('no POST expected') },
    flags: { file, input, name: 'gpu-test' }, config: { rootDir: root }, json: true };
  await assert.rejects(submit(ctx), (error) => error.exitCode === EXIT.VALIDATION);
  assert.equal(fs.existsSync(path.join(root, '.ariax')), false);
});
