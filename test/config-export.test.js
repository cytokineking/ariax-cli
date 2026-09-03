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
