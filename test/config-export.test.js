import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../src/main.js';
const parent = '22222222-2222-4222-8222-222222222222';
const roots = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, {recursive:true, force:true})));
const rootDir = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-export-')); roots.push(dir); return dir; };
const response = (data, status = 200) => new Response(JSON.stringify({data}), {status, headers:{'Content-Type':'application/json'}});
async function run(args, root, fetchImpl) {
  let stdout = '', stderr = '';
  const out = process.stdout.write, err = process.stderr.write;
  process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
  process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
  try {
    const code = await main([...args, '--json', '--root-dir', root], {ARIAX_API_KEY:'arx_test', NO_UPDATE_NOTIFIER:'1'}, {interactive:false, fetchImpl});
    return {code, stdout, stderr, parsed: stdout ? JSON.parse(stdout) : null};
  } finally { process.stdout.write = out; process.stderr.write = err; }
}
it('projects export writes only the normalized public job JSON and does not overwrite an existing file', async () => {
  const root = rootDir(), output = path.join(root, 'job.json');
  const spec = {protocol:'esmfold2-pipeline', protocol_config:{campaign:{num_designs:3}}};
  const fetch = async (url, opts) => {
    assert.equal(new URL(url).pathname, `/api/v1/projects/${parent}/config`);
    assert.equal(opts.method, 'GET');
    return response({schema_version:1, job_spec:spec, job_spec_hash:'hash', project_id:parent, notes:[]});
  };
  const args = ['projects','export',parent,'--output',output];
  const first = await run(args, root, fetch);
  assert.equal(first.code, 0, first.stdout);
  assert.deepEqual(JSON.parse(fs.readFileSync(output)), spec);
  assert.equal(first.parsed.data.job_spec_hash, 'hash');
  const second = await run(args, root, fetch);
  assert.equal(second.code, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(output)), spec);
});
it('rejects bad nested project commands and incompatible export flags before requests', async () => {
  const root = rootDir(), noNetwork = async () => { throw new Error('Unexpected request'); };
  for (const args of [ ['projects','unknown'], ['projects','export',parent,'--status','running'] ]) {
    const result = await run(args, root, noNetwork);
    assert.equal(result.code, 1, result.stdout);
  }
});

for (const cysteine of [0, 1]) it(`BindCraft2 export and detailed validation preserve sparse preferences with C=${cysteine}`, async () => {
  const root = rootDir(), output = path.join(root, 'job.json');
  const input = path.join(root, 'input.pdb');
  fs.writeFileSync(input, 'ATOM      1  N   ALA A   1      10.000  10.000  10.000  1.00 20.00           N\n');
  const aaBias = { C: cysteine, W: 0.4, Y: 2 };
  const spec = {
    protocol: 'bindcraft2',
    allowed_gpus: ['H100'],
    protocol_config: {
      schema_version: 1, modality: ['binder'], properties: [],
      targets: [{ name: 'target', input_file: 'input.pdb', chains: ['A'], objective: 'target', weight: 1 }],
      binder: { lengths: [60, 90] }, campaign: { num_designs: 2, max_trajectories: 20 },
      advanced: { aa_bias: aaBias },
    },
  };
  const calls = [];
  const fetch = async (url, opts) => {
    const route = new URL(url).pathname;
    calls.push([opts.method, route]);
    if (route === `/api/v1/projects/${parent}/config`) return response({ job_spec: spec });
    assert.equal(route, '/api/v1/validate');
    const body = JSON.parse(opts.body);
    assert.deepEqual(body.protocol_config.advanced.aa_bias, aaBias);
    return response({ valid: true, normalized_job_spec: body });
  };
  const exported = await run(['projects', 'export', parent, '--output', output], root, fetch);
  assert.equal(exported.code, 0, exported.stdout);
  assert.deepEqual(JSON.parse(fs.readFileSync(output)), spec);
  assert.deepEqual(exported.parsed.data.job_spec.protocol_config.advanced.aa_bias, aaBias);
  const validated = await run(['validate', '-f', output, '--input', input, '--details'], root, fetch);
  assert.equal(validated.code, 0, validated.stdout);
  assert.deepEqual(validated.parsed.data.normalized_job_spec.protocol_config.advanced.aa_bias, aaBias);
  assert.deepEqual(calls, [['GET', `/api/v1/projects/${parent}/config`], ['POST', '/api/v1/validate']]);
});
