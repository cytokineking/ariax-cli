import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/ariax.js', import.meta.url));
const project = '01111111-1111-4111-8111-111111111111';
const receipt = '02222222-2222-4222-8222-222222222222';
const otherId = '03333333-3333-4333-8333-333333333333';
const statusPath = `/api/v1/projects/${project}/storage/deletions/${receipt}`;
const statusArgs = ['storage', 'status', project, '--deletion-id', receipt];
const historicalPath = ['output', 'a'.repeat(250), 'b'.repeat(250), 'Cafe\u0301.cif'].join('/');

test('selected deletion receipts through the CLI process', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ariax-storage-receipt-'));
  const calls = [];
  const original = {
    kind: 'selected', project_id: project, status: 'completed', control: { revision: 7 },
    deletion: { id: receipt, path: historicalPath, recursive: false, state: 'pending' },
  };
  let outcome = original;
  const server = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    const read = req.method === 'GET' && req.url === statusPath;
    res.writeHead(read ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(read ? { data: outcome } : { error: { code: 'not_found' } }));
  });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const env = {
    NO_UPDATE_NOTIFIER: '1', ARIAX_API_KEY: 'arx_synthetic_local_only', ARIAX_ROOT_DIR: root,
    ARIAX_BASE_URL: `http://127.0.0.1:${server.address().port}`,
  };
  const run = async (args, expectedCode = 0) => {
    let result;
    try { result = await exec(process.execPath, [cli, ...args, '--json'], { env, cwd: root, timeout: 10_000 }); }
    catch (error) { result = error; }
    assert.equal(result.code ?? 0, expectedCode, result.stderr || result.message);
    return JSON.parse(result.stdout);
  };

  await t.test('reads the retained path by ID and rejects the same path for a new request or preview', async () => {
    const observed = await run(statusArgs);
    assert.equal(observed.meta.deletion_request_id, receipt);
    assert.equal(observed.data.deletion.path, historicalPath);
    const deleteArgs = ['storage', 'delete', project, '--path', historicalPath];
    for (const action of ['--yes', '--dry-run']) {
      const refused = await run([...deleteArgs, action], 1);
      assert.equal(refused.error.code, 'ARIAX_USAGE');
    }
    assert.deepEqual(calls.splice(0), [`GET ${statusPath}`]);
  });

  await t.test('accepts 4,096 printable code points and preserves original spelling', async () => {
    const prefix = 'output /Caf\u0065\u0301: ';
    const path = prefix + '😀'.repeat(4096 - [...prefix].length);
    outcome = { ...original, deletion: { ...original.deletion, path } };
    const observed = await run(statusArgs);
    assert.equal(observed.data.deletion.path, path);
    assert.deepEqual(calls.splice(0), [`GET ${statusPath}`]);
  });

  await t.test('rejects malformed retained paths, scopes, and receipt identities', async () => {
    const invalidPaths = ['', '/output/x', 'output/', 'output//x', 'output/./x', 'output/../x', 'output\\x',
      'output/%2e', 'output/a*', 'output/a?', 'output/\u001bx', 'output/\u202ex', 'output/\u2028x', 'x'.repeat(4097), 123];
    const invalid = [
      ...invalidPaths.map(path => ({ ...original, deletion: { ...original.deletion, path } })),
      { ...original, deletion: { ...original.deletion, recursive: undefined } },
      { ...original, deletion: { ...original.deletion, id: otherId } },
      { ...original, project_id: otherId },
    ];
    for (const response of invalid) {
      outcome = response;
      const refused = await run(statusArgs, 10);
      assert.match(refused.error.message, /invalid observation/);
      assert.equal(refused.data, undefined);
    }
    assert.deepEqual(calls, invalid.map(() => `GET ${statusPath}`));
  });
});
