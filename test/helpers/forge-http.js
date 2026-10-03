/** Stateful public API boundary shared by source and installed-package checks. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';

const execute = promisify(execFile);
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherActor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const key = 'arx_forge_testcredential';

async function boundary(root) {
  const sessions = new Map(), children = new Set(), heldResponses = new Set();
  const state = { sessions, allocations: 0, executions: 0, releases: 0, posts: 0, preparations: 0,
    drop: 'create', holdReads: false, unknown: false, cleanupBlocked: false, fault: null };
  const reply = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data })); };
  const error = (res, status, code, message) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code, message, retryable: false } }));
  };
  const server = http.createServer(async (req, res) => {
    try {
      const user = req.headers.authorization === `Bearer ${key}` ? actor
        : req.headers.authorization === 'Bearer arx_forge_othercredential' ? otherActor : null;
      if (!user) return error(res, 401, 'invalid_api_key', 'Authentication required');
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/v1/me') {
        return reply(res, 200, { actor: { user_id: user }, billing: { account_type: 'user', account_id: user } });
      }
      let body;
      if (req.method === 'POST') {
        state.posts++;
        let text = '';
        for await (const chunk of req) text += chunk;
        body = JSON.parse(text);
        // Every mutation reaches this boundary only after its complete local record exists.
        const files = await fs.readdir(path.join(root, '.ariax/forge'));
        const records = await Promise.all(files.filter(f => f.endsWith('.json')).map(async f =>
          JSON.parse(await fs.readFile(path.join(root, '.ariax/forge', f), 'utf8'))));
        assert.ok(records.some(record => record.actor_user_id === user
          && isDeepStrictEqual(record.request, { method: 'POST', path: url.pathname, body })), 'mutation has no durable request');
      }
      if (url.pathname === '/api/v1/forge/sessions') {
        if (req.method === 'GET') return reply(res, 200, { sessions: [...sessions.values()].filter(s => s.owner === user).map(s => s.data) });
        assert.equal(req.method, 'POST');
        let session = sessions.get(body.session_id);
        if (session && (session.owner !== user || !isDeepStrictEqual(session.request, body))) return error(res, 409, 'request_conflict', 'Session request differs');
        if (!session) {
          state.allocations++;
          session = { owner: user, request: body, commands: new Map(), selections: new Map(), data: {
            session_id: body.session_id, project_id: randomUUID(), name: body.name,
            state: 'starting', provider: body.provider, gpu_type: body.gpu_type,
            tools: [{ tool: 'base', state: 'queued', error: null }, ...body.tools.map(tool => ({ tool, state: 'queued', error: null }))],
            expires_at: null, persistence: { state: 'pending', checkpoint: null, error: null }, error: null,
          } };
          sessions.set(body.session_id, session);
        }
        if (state.drop === 'create') { state.drop = null; req.socket.destroy(); return; }
        return reply(res, 202, session.data);
      }
      const parts = url.pathname.split('/').filter(Boolean);
      assert.deepEqual(parts.slice(0, 4), ['api', 'v1', 'forge', 'sessions']);
      const session = sessions.get(parts[4]);
      if (!session || session.owner !== user) return error(res, 404, 'not_found', 'Session not found');
      if (parts.length === 5) { assert.equal(req.method, 'GET'); return reply(res, 200, session.data); }
      if (parts[5] === 'tools') {
        assert.equal(req.method, 'POST');
        const previous = session.selections.get(body.selection_id);
        if (previous && !isDeepStrictEqual(previous, body)) return error(res, 409, 'idempotency_conflict', 'Selection request differs');
        if (!previous) {
          if (session.data.state !== 'available') return error(res, 409, 'session_unready', 'Session is not available');
          session.selections.set(body.selection_id, body);
          for (const tool of body.tools) {
            let item = session.data.tools.find(item => item.tool === tool);
            if (!item) { item = { tool, state: 'queued', error: null }; session.data.tools.push(item); state.preparations++; }
            else if (item.state === 'failed') { item.state = 'queued'; item.error = null; state.preparations++; }
          }
        }
        if (state.drop === 'tools') { state.drop = null; req.socket.destroy(); return; }
        return reply(res, 202, { ...session.data, selection_id: body.selection_id });
      }
      if (parts[5] === 'close') {
        assert.equal(req.method, 'POST');
        for (const command of session.commands.values()) {
          if (command.child) { command.data.cancel_requested = true; command.child.kill(); }
        }
        session.data.state = state.cleanupBlocked ? 'closing' : 'closed';
        session.data.error = state.cleanupBlocked ? { code: 'cleanup_failed', message: 'Termination is pending' } : null;
        if (!state.cleanupBlocked && !session.released) { session.released = true; state.releases++; }
        return reply(res, 202, session.data);
      }
      assert.equal(parts[5], 'commands');
      if (parts.length === 6) {
        if (req.method === 'GET') return reply(res, 200, { commands: [...session.commands.values()].map(c => c.data) });
        assert.equal(req.method, 'POST');
        let command = session.commands.get(body.command_id);
        if (command && !isDeepStrictEqual(command.request, body)) return error(res, 409, 'request_conflict', 'Command request differs');
        if (!command) {
          if (session.data.state !== 'available') return error(res, 409, 'session_unavailable', 'Session is not available');
          if (!session.data.tools.some(t => t.tool === body.tool && t.state === 'ready')) return error(res, 409, 'tool_unready', 'Tool is not ready');
          state.executions++;
          command = { request: body, text: '', data: { ...body, state: 'running', cancel_requested: false, exit_code: null, error: null } };
          session.commands.set(body.command_id, command);
          command.child = execFile(body.argv[0], body.argv.slice(1), { cwd: root }, (cause, stdout, stderr) => {
            command.text = stdout + stderr;
            command.data.state = command.data.cancel_requested ? 'cancelled' : cause ? 'failed' : 'succeeded';
            command.data.exit_code = cause ? (typeof cause.code === 'number' ? cause.code : null) : 0;
            if (cause && !command.data.cancel_requested) command.data.error = { code: 'execution_failed', message: 'Native command failed' };
            children.delete(command.child);
            command.child = null;
          });
          children.add(command.child);
        }
        if (state.drop === 'run') { state.drop = null; req.socket.destroy(); return; }
        return reply(res, 202, command.data);
      }
      const command = session.commands.get(parts[6]);
      if (!command) return error(res, 404, 'not_found', 'Command not found');
      if (parts.length === 7) {
        assert.equal(req.method, 'GET');
        if (state.holdReads) { heldResponses.add(res); res.once('close', () => heldResponses.delete(res)); return; }
        return reply(res, 200, state.unknown ? { ...command.data, state: 'unknown' } : command.data);
      }
      if (parts[7] === 'logs') {
        assert.equal(req.method, 'GET');
        const tail = Number(url.searchParams.get('tail'));
        assert.ok(tail >= 1 && tail <= 5000);
        return reply(res, 200, { command_id: command.data.command_id, text: command.text.split('\n').slice(-tail).join('\n') });
      }
      assert.equal(parts[7], 'cancel');
      assert.equal(req.method, 'POST');
      command.data.cancel_requested = true;
      command.child?.kill();
      return reply(res, 202, command.data);
    } catch (cause) {
      state.fault = cause;
      error(res, 500, 'test_boundary_failure', cause.message);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { state, origin: `http://127.0.0.1:${server.address().port}`,
    async close() {
      for (const child of children) child.kill();
      for (const res of heldResponses) res.destroy();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    } };
}

export async function exerciseForgeCli(script, baseEnv = process.env) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ariax-forge-http-'));
  const api = await boundary(root);
  const { state } = api;
  const env = { ...baseEnv, ARIAX_API_KEY: key, NO_UPDATE_NOTIFIER: '1' };
  async function invoke(args, { code = 0, actorKey = key, origin = api.origin, interrupt = false } = {}) {
    let out;
    try {
      const pending = execute(process.execPath, [script, '--json', '--root-dir', root, '--base-url', origin, ...args], {
        env: { ...env, ARIAX_API_KEY: actorKey }, timeout: 15_000,
      });
      if (interrupt) pending.child.stderr.on('data', chunk => {
        if (String(chunk).includes('state:')) pending.child.kill('SIGINT');
      });
      out = { code: 0, ...await pending };
    } catch (error) {
      if (typeof error.code !== 'number') throw error;
      out = error;
    }
    assert.equal(out.code, code, `${args}: ${out.stdout}\n${out.stderr}`);
    assert.doesNotMatch(out.stdout + out.stderr, new RegExp(key));
    return { ...out, payload: JSON.parse(out.stdout) };
  }
  const record = async id => JSON.parse(await fs.readFile(path.join(root, '.ariax/forge', `${id}.json`), 'utf8'));
  try {
    const guide = await invoke(['skills', 'forge', '--read']);
    assert.equal(guide.payload.data.scope, 'platform');
    assert.equal(guide.payload.data.platform, 'forge');
    assert.ok(guide.payload.data.content.length > 0);
    const alias = await invoke(['skills', 'ariax-forge', '--read']);
    assert.equal(alias.payload.data.content, guide.payload.data.content);

    const createArgs = ['forge', 'create', '--name', 'Recovery experiment', '--gpu', 'L40', '--tools', 'boltz2,bindcraft2', '--priority', 'bindcraft2', '--max-hours', '2'];
    const lostCreate = await invoke(createArgs, { code: 9 });
    const sessionId = lostCreate.stderr.match(/session_id: ([0-9a-f-]{36})/)[1];
    assert.equal(state.allocations, 1);
    assert.equal(state.posts, 1, 'POST was automatically retried');
    assert.equal((await record(sessionId)).result, null);
    const retryCreate = [...createArgs, '--session-id', sessionId];
    const accepted = await invoke(retryCreate);
    assert.equal(accepted.payload.data.session_id, sessionId);
    assert.equal(accepted.payload.data.provider, 'hyperstack');
    assert.equal(state.sessions.get(sessionId).request.provider, 'hyperstack');
    assert.equal(state.allocations, 1, 'retry allocated another VM');
    assert.equal((await record(sessionId)).project_id, accepted.payload.data.project_id);
    await invoke([...retryCreate, '--gpu', 'A100'], { code: 7 });
    await invoke(retryCreate, { code: 1, actorKey: 'arx_forge_othercredential' });
    // A second origin must not receive a mutation for a saved identity.
    const alternate = await boundary(root);
    try {
      await invoke(retryCreate, { code: 1, origin: alternate.origin });
      assert.equal(alternate.state.posts, 0);
    } finally { await alternate.close(); }
    assert.equal(state.posts, 2);
    await invoke(['forge', 'status', sessionId], { code: 4, actorKey: 'arx_forge_othercredential' });
    assert.equal((await invoke(['forge', 'list'])).payload.data.sessions.length, 1);
    assert.equal((await invoke(['forge', 'status', sessionId])).payload.data.state, 'starting');
    assert.equal((await invoke(['forge', 'tools', sessionId])).payload.data.tools[0].state, 'queued');
    const waiting = await invoke(['forge', 'tools', 'wait', sessionId, 'base', '--timeout', '0.05'], { code: 9 });
    assert.match(waiting.payload.error.message, /remote work continues/);
    assert.equal(state.posts, 2, 'tool wait performed a mutation');
    const session = state.sessions.get(sessionId);
    session.data.state = 'available';
    session.data.tools[0].state = 'ready';
    assert.equal((await invoke(['forge', 'tools', 'wait', sessionId, 'base', '--timeout', '1'])).payload.data.state, 'ready');
    session.data.tools[1].state = 'failed';
    session.data.tools[1].error = { code: 'install_failed', message: 'Model download failed' };
    assert.equal((await invoke(['forge', 'tools', 'wait', sessionId, 'boltz2'], { code: 10 })).payload.error.code, 'tool_failed');
    assert.equal((await invoke(['forge', 'run', sessionId, '--tool', 'boltz2', '--', process.execPath, '-e', 'process.exit(0)'], { code: 7 })).payload.error.code, 'tool_unready');

    state.drop = 'tools';
    const selectionArgs = ['forge', 'tools', 'add', sessionId, '--tools', 'boltz2', '--priority', 'boltz2'];
    const lostSelection = await invoke(selectionArgs, { code: 9 });
    const selectionId = lostSelection.stderr.match(/selection_id: ([0-9a-f-]{36})/)[1];
    const retrySelection = [...selectionArgs, '--selection-id', selectionId];
    assert.equal((await record(selectionId)).result, null);
    assert.equal(state.preparations, 1);
    const boltz = session.data.tools.find(item => item.tool === 'boltz2');
    boltz.state = 'failed';
    boltz.error = { code: 'tool_preparation_failed', message: 'Private image pull failed' };
    const retriedSelection = await invoke(retrySelection);
    assert.equal(retriedSelection.payload.data.selection_id, selectionId);
    assert.equal((await record(selectionId)).project_id, accepted.payload.data.project_id);
    assert.equal(boltz.state, 'failed');
    const beforePoll = state.posts;
    await invoke(['forge', 'tools', 'wait', sessionId, 'boltz2'], { code: 10 });
    await invoke(['forge', 'status', sessionId]);
    assert.equal(state.posts, beforePoll, 'tool polling replayed a selection');
    assert.equal(state.preparations, 1, 'same selection ID restarted failed preparation');
    await invoke([...retrySelection, '--tools', 'ipsae,boltz2'], { code: 7 });
    await invoke(retrySelection, { code: 1, actorKey: 'arx_forge_othercredential' });
    assert.equal(state.posts, beforePoll, 'conflicting selection reached the API');
    const explicitRetry = await invoke(['forge', 'tools', 'add', sessionId, '--tools', 'boltz2,ipsae', '--priority', 'ipsae']);
    assert.notEqual(explicitRetry.payload.data.selection_id, selectionId);
    assert.equal(state.preparations, 3);
    assert.deepEqual(session.selections.get(explicitRetry.payload.data.selection_id).priority, ['ipsae', 'boltz2']);
    assert.equal(session.data.tools[0].state, 'ready');
    assert.equal((await invoke(retryCreate)).payload.data.session_id, sessionId);
    assert.equal(state.allocations, 1, 'adding tools changed create idempotency');

    state.drop = 'run';
    const nativeArgs = ['--json', '--cwd', '/somewhere', '; touch injected', 'two words', ''];
    const runArgs = ['forge', 'run', sessionId, '--tool', 'base', '--cwd', '/workspace/results', '--timeout-seconds', '60', '--', process.execPath,
      '-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '--', ...nativeArgs];
    const lostRun = await invoke(runArgs, { code: 9 });
    const commandId = lostRun.stderr.match(/command_id: ([0-9a-f-]{36})/)[1];
    assert.equal(state.executions, 1);
    assert.equal((await record(commandId)).request.body.argv.at(-1), '');
    const retryRun = [...runArgs.slice(0, runArgs.indexOf('--')), '--command-id', commandId, ...runArgs.slice(runArgs.indexOf('--'))];
    await invoke(retryRun);
    assert.equal(state.executions, 1, 'lost response recovery executed twice');
    const finished = await invoke(['forge', 'watch', sessionId, commandId, '--timeout', '8']);
    assert.equal(finished.payload.data.state, 'succeeded');
    assert.equal(finished.payload.data.exit_code, 0);
    assert.deepEqual(JSON.parse((await invoke(['forge', 'logs', sessionId, commandId, '--tail', '1000'])).payload.data.text), nativeArgs);
    assert.equal((await record(commandId)).result.state, 'succeeded');
    await assert.rejects(fs.access(path.join(root, 'injected')));
    await invoke([...retryRun, 'changed'], { code: 7 });
    assert.equal(state.executions, 1);

    const longRun = await invoke(['forge', 'run', sessionId, '--tool', 'base', '--', process.execPath, '-e', 'setInterval(() => {}, 1000)']);
    const longId = longRun.payload.data.command_id;
    state.holdReads = true;
    const started = Date.now();
    await invoke(['forge', 'watch', sessionId, longId, '--timeout', '0.05'], { code: 9 });
    assert.ok(Date.now() - started < 2000, 'local deadline failed to interrupt HTTP');
    state.holdReads = false;
    state.unknown = true;
    await invoke(['forge', 'watch', sessionId, longId, '--timeout', '0.05'], { code: 9 });
    state.unknown = false;
    const beforeWatch = state.posts;
    await invoke(['forge', 'watch', sessionId, longId], { code: 130, interrupt: true });
    assert.equal((await invoke(['forge', 'command', sessionId, longId])).payload.data.state, 'running');
    assert.equal(state.posts, beforeWatch, 'local waits cancelled remote work');
    assert.equal(state.executions, 2);
    await invoke(['forge', 'cancel', sessionId, longId]);
    await invoke(['forge', 'cancel', sessionId, longId]);
    assert.equal((await invoke(['forge', 'watch', sessionId, longId, '--timeout', '8'])).payload.data.state, 'cancelled');
    assert.equal((await invoke(['forge', 'commands', sessionId])).payload.data.commands.length, 2);

    const failedRun = await invoke(['forge', 'run', sessionId, '--tool', 'base', '--', process.execPath, '-e', 'process.exit(2)']);
    const failedId = failedRun.payload.data.command_id;
    await invoke(['forge', 'watch', sessionId, failedId, '--timeout', '8'], { code: 10 });
    assert.equal((await invoke(['forge', 'command', sessionId, failedId])).payload.data.exit_code, 2);

    state.cleanupBlocked = true;
    assert.equal((await invoke(['forge', 'close', sessionId])).payload.data.state, 'closing');
    assert.equal(state.releases, 0);
    state.cleanupBlocked = false;
    await invoke(['forge', 'close', sessionId]);
    await invoke(['forge', 'close', sessionId]);
    assert.equal((await invoke(['forge', 'status', sessionId])).payload.data.state, 'closed');
    assert.equal(state.releases, 1, 'repeated close released the allocation twice');
    assert.equal((await record(sessionId)).result.state, 'closed');
    const beforeInvalid = state.posts;
    await invoke(['forge', 'run', sessionId, '--tool', 'base', '--cwd', '/workspace/../etc', '--', 'true'], { code: 1 });
    await invoke(['forge', 'create', '--name', 'Unsafe ID', '--gpu', 'L40', '--session-id', '../outside'], { code: 1 });
    await invoke(['forge', 'files', sessionId, '--path', '/etc'], { code: 1 });
    await invoke(['forge', 'create', '--name', 'Direct host', '--gpu', 'L40', '--endpoint', api.origin], { code: 1 });
    const invalidProvider = await invoke(['forge', 'create', '--name', 'Invalid provider', '--gpu', 'L40', '--provider', 'aws'], { code: 1 });
    assert.match(invalidProvider.payload.error.message, /hyperstack or vastai/);
    const storage = path.join(root, '.ariax/forge');
    await fs.rename(storage, `${storage}-saved`);
    await fs.symlink(`${storage}-saved`, storage, 'dir');
    try { await invoke(['forge', 'create', '--name', 'Unsafe storage', '--gpu', 'L40'], { code: 1 }); }
    finally { await fs.unlink(storage); await fs.rename(`${storage}-saved`, storage); }
    assert.equal(state.posts, beforeInvalid, 'unsafe paths or unsupported surfaces sent a mutation');
    const vast = await invoke(['forge', 'create', '--name', 'Vast workspace', '--gpu', 'L40', '--provider', 'vastai']);
    const vastId = vast.payload.data.session_id;
    assert.equal(vast.payload.data.provider, 'vastai');
    assert.equal(state.sessions.get(vastId).request.provider, 'vastai');
    assert.equal((await record(vastId)).request.body.provider, 'vastai');
    assert.equal(state.allocations, 2);
    await invoke(['forge', 'close', vastId]);
    assert.equal(state.releases, 2);
    for (const name of await fs.readdir(path.join(root, '.ariax/forge'))) {
      const bytes = await fs.readFile(path.join(root, '.ariax/forge', name), 'utf8');
      assert.doesNotMatch(bytes, new RegExp(key));
      if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(root, '.ariax/forge', name))).mode & 0o777, 0o600);
    }
    assert.equal(state.fault, null, state.fault?.stack);
  } finally { await api.close(); await fs.rm(root, { recursive: true, force: true }); }
}
