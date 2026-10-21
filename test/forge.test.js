import { it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { exerciseForgeCli, exerciseForgeControls } from './helpers/forge-http.js';

it('recovers accepted Forge requests after lost responses without duplicate work, and keeps waits, cancellation, and cleanup scoped', async () => {
  await exerciseForgeCli(fileURLToPath(new URL('../bin/ariax.js', import.meta.url)));
});

it('keeps device sets, mutable caps and same-project resume scoped across lost replies and human holds', async () => {
  await exerciseForgeControls(fileURLToPath(new URL('../bin/ariax.js', import.meta.url)));
});


// This scenario runs on B58's Linux GPU host, where XDG_CONFIG_HOME isolates
// protected connection storage from the test project's mutation journals.
it('uses a warm session during backend partition and retains mutation identity after a lost reply',
  { skip: process.platform !== 'linux' }, async (t) => {
    const assert = (await import('node:assert/strict')).default;
    const fs = (await import('node:fs')).default;
    const os = (await import('node:os')).default;
    const path = (await import('node:path')).default;
    const { randomUUID } = await import('node:crypto');
    const { createClient } = await import('../src/http.js');
    const { forgeRequest } = await import('../src/lib/forge-client.js');
    const { run } = await import('../src/commands/forge.js');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-warm-'));
    const root = path.join(temporary, 'project');
    const config = path.join(temporary, 'configuration');
    const oldConfig = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = config;
    t.after(() => {
      if (oldConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = oldConfig;
      fs.rmSync(temporary, { recursive: true, force: true });
    });
    const sid = randomUUID(), pid = randomUUID(), actor = randomUUID(), cid = randomUUID();
    const key = 'arx_partition_test_key', token = 'temporary-session-authority';
    const api = 'https://api.fixture.invalid', endpoint = 'https://workspace.fixture.invalid';
    let online = true, loseReply = true, executions = 0;
    const commands = new Map();
    const success = (data, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });
    const failure = (status, code) => new Response(JSON.stringify({ error: { code, message: code } }), { status, headers: { 'Content-Type': 'application/json' } });
    t.mock.method(globalThis, 'fetch', async (input, options) => {
      const url = new URL(input);
      if (url.origin === api) {
        if (!online) throw new TypeError('Backend unreachable');
        assert.equal(options.headers.Authorization, `Bearer ${key}`);
        if (url.pathname === '/api/v1/me') return success({ actor: { user_id: actor }, billing: { account_type: 'user', account_id: actor } });
        if (url.pathname === `/api/v1/forge/sessions/${sid}/connect`) return success({ session_id: sid, project_id: pid, endpoint, access_token: token, api_version: 1, expires_at: new Date(Date.now() + 300000).toISOString() });
        throw new Error('Unexpected backend operation');
      }
      assert.equal(url.origin, endpoint);
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      if (options.method === 'GET' && url.pathname === '/v1/session') return success({ session_id: sid, state: 'available' });
      if (options.method === 'POST' && url.pathname === '/v1/commands') {
        const body = JSON.parse(options.body);
        const journal = JSON.parse(fs.readFileSync(path.join(root, '.ariax', 'forge', `${cid}.json`), 'utf8'));
        assert.equal(journal.actor_user_id, actor);
        assert.equal(journal.request.session_id, sid);
        assert.deepEqual(journal.request.body, body);
        if (!commands.has(cid)) { executions++; commands.set(cid, { ...body, state: 'running' }); }
        if (loseReply) { loseReply = false; throw new TypeError('Accepted reply lost'); }
        return success(commands.get(cid), 202);
      }
      if (options.method === 'GET' && url.pathname.startsWith('/v1/checkpoints/')) return failure(404, 'file_operation_not_found');
      if (options.method === 'POST' && url.pathname === '/v1/checkpoints') return failure(503, 'control_unavailable');
      throw new Error('Unexpected direct operation');
    });
    const context = (positionals, flags = {}, passthrough = []) => ({
      config: { rootDir: root, baseUrl: api, apiKey: key }, json: true,
      client: createClient({ baseUrl: api, apiKey: key, sleepImpl: async () => {} }),
      positionals, flags, passthrough,
    });
    await forgeRequest(context(['status', sid]), sid, 'GET', '/v1/session');
    online = false;
    const runContext = () => context(['run', sid], { tool: 'base', 'command-id': cid }, ['printf', 'one execution']);
    await assert.rejects(run(runContext()));
    assert.equal(executions, 1);
    const file = path.join(root, '.ariax', 'forge', `${cid}.json`);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).result, null);
    await run(runContext());
    let journal = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(journal.result.state, 'running');
    assert.equal(executions, 1);
    assert.ok(!fs.readFileSync(file, 'utf8').includes(token));
    const checkpoint = randomUUID();
    await assert.rejects(run(context(['sync', sid], { 'checkpoint-id': checkpoint })));
    const savedFileRequest = JSON.parse(fs.readFileSync(path.join(root, '.ariax', 'forge', `${checkpoint}.json`), 'utf8'));
    assert.equal(savedFileRequest.actor_user_id, actor);
    assert.equal(savedFileRequest.request.session_id, sid);
    assert.equal(savedFileRequest.request.body.checkpoint_id, checkpoint);
    assert.equal(savedFileRequest.result, null);
    journal.actor_user_id = randomUUID();
    fs.writeFileSync(file, JSON.stringify(journal));
    await assert.rejects(run(runContext()), /different account or API origin/);
    assert.equal(executions, 1);
  });
