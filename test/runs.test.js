import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/main.js';
const project = '11111111-1111-4111-8111-111111111111';
const job = '22222222-2222-4222-8222-222222222222';
async function invoke(args, fetchImpl) {
  const out = process.stdout.write, err = process.stderr.write; let stdout = '';
  process.stdout.write = s => { stdout += s; return true; }; process.stderr.write = () => true;
  try { return { code: await main(['runs', ...args, '--json'], { ARIAX_API_KEY: 'arx_testcredential' }, { fetchImpl }), stdout }; }
  finally { process.stdout.write = out; process.stderr.write = err; }
}
describe('run manifest retrieval', () => {
  it('traverses all pages including empty pages without an arbitrary page cap', async () => {
    let count = 0;
    const result = await invoke([project, '--all'], async (url, options) => {
      assert.equal(options.method, 'GET'); assert.equal(new URL(url).pathname, `/api/v1/projects/${project}/runs`);
      count++;
      return Response.json({ data: count === 2 ? [] : [{ job_id: job, provenance_status: 'recorded' }], meta: { next_cursor: count < 22 ? String(count) : null } });
    });
    assert.equal(result.code, 0); assert.equal(count, 22); assert.equal(JSON.parse(result.stdout).data.length, 21);
  });
  it('returns unavailable fields as evidence rather than inventing a manifest', async () => {
    const manifest = { job_id: job, provenance_status: 'unavailable', settings: null, capture_scope: null, reason: "not_recorded" };
    const result = await invoke([project, '--job', job], async url => {
      assert.equal(new URL(url).pathname, `/api/v1/projects/${project}/runs/${job}`);
      return Response.json({ data: manifest });
    });
    assert.equal(result.code, 0); assert.deepEqual(JSON.parse(result.stdout).data, manifest);
  });
  it('preserves the passive accepted-settings DTO, including optional unknown fields', async () => {
    const manifest = {
      schema_version: 1, kind: 'ariax_run_settings', project_id: project, job_id: job,
      provenance_status: 'recorded', reason: null, protocol: 'esmfold2-pipeline',
      capture_scope: 'accepted_job_configuration', settings: { campaign: { num_designs: 3 } },
      compute_preferences: { turbo_mode: false },
      input: { source: 'upload', filename: 'input.cif', pdb_id: null, sha256: null },
      ariax_build: null, future_display_metadata: 'permitted',
    };
    const result = await invoke([project, '--job', job], async (_url, options) => {
      assert.equal(options.method, 'GET');
      return Response.json({ data: manifest });
    });
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout).data, manifest);
  });
  it('rejects a cursor cycle without printing a partial result', async () => {
    const result = await invoke([project, '--all', '--cursor', 'same'], async () => Response.json({ data: [], meta: { next_cursor: 'same' } }));
    assert.equal(result.code, 10); assert.equal(JSON.parse(result.stdout).data, undefined);
  });
  it('rejects invalid job and pagination combinations before requests', async () => {
    let requests = 0;
    for (const args of [[], [project, '--job', 'bad'], [project, '--job', job, '--all'], [project, '--limit', '101'], [project, '--limit', '2e1'], [project, '--unknown', 'x']]) {
      assert.equal((await invoke(args, async () => { requests++; throw new Error('unexpected'); })).code, 1);
    }
    assert.equal(requests, 0);
  });
});
