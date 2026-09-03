import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../src/main.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const preferences = { priority_mode: 'cost', allowed_gpus: ['H100', 'A100_80GB'], turbo_mode: false, turbo_multiples: [] };
let dir;
let file;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-gpu-prefs-'));
  file = path.join(dir, 'preferences.json');
  fs.writeFileSync(file, JSON.stringify(preferences));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function invoke(args, fetchImpl) {
  const oldOut = process.stdout.write;
  const oldErr = process.stderr.write;
  let stdout = '';
  let stderr = '';
  process.stdout.write = (chunk) => { stdout += chunk; return true; };
  process.stderr.write = (chunk) => { stderr += chunk; return true; };
  try {
    const code = await main(['gpu-preferences', ...args, '--json'], { ARIAX_API_KEY: 'arx_testcredential' }, { fetchImpl });
    return { code, stdout, stderr };
  } finally { process.stdout.write = oldOut; process.stderr.write = oldErr; }
}

describe('GPU preference command', () => {
  it('sends one authenticated PUT and prints the effective allocation semantics', async () => {
    const calls = [];
    const data = { project_id: projectId, ...preferences, applies_to: 'next_provisioning_attempt', active_instances_changed: false };
    const result = await invoke([projectId, '-f', file], async (url, options) => {
      calls.push({ url, options });
      return Response.json({ data, request_id: 'gpu-request' });
    });
    assert.equal(result.code, 0);
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0].url).pathname, `/api/v1/projects/${projectId}/gpu-preferences`);
    assert.equal(calls[0].options.method, 'PUT');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer arx_testcredential');
    assert.deepEqual(JSON.parse(calls[0].options.body), preferences);
    assert.deepEqual(JSON.parse(result.stdout), { data, request_id: 'gpu-request' });
    assert.equal(result.stderr, '');
  });

  it('resolves an exact project name before updating the saved policy', async () => {
    const calls = [];
    const result = await invoke(['pilot', '-f', file], async (url, options) => {
      calls.push(options.method);
      if (options.method === 'GET') {
        assert.equal(new URL(url).searchParams.get('name'), 'pilot');
        return Response.json({ data: [{ id: projectId, name: 'pilot' }] });
      }
      return Response.json({ data: { project_id: projectId, ...preferences } });
    });
    assert.equal(result.code, 0);
    assert.deepEqual(calls, ['GET', 'PUT']);
  });

  it('does not retry a failed update or call any compute action', async () => {
    let calls = 0;
    const result = await invoke([projectId, '-f', file], async (_url, options) => {
      calls++;
      assert.equal(options.method, 'PUT');
      return Response.json({ error: { code: 'dependency_failure', message: 'Try later', retryable: true } }, { status: 503 });
    });
    assert.equal(result.code, 10);
    assert.equal(calls, 1);
  });

  it('rejects missing files, extra operands, unknown flags, and non-object input before requests', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; throw new Error('Unexpected request'); };
    for (const args of [[projectId], [projectId, 'other', '-f', file], [projectId, '-f', file, '--priority', 'cost']]) {
      assert.equal((await invoke(args, fetchImpl)).code, 1);
    }
    fs.writeFileSync(file, '[]');
    assert.equal((await invoke([projectId, '-f', file], fetchImpl)).code, 1);
    assert.equal(calls, 0);
  });
});
