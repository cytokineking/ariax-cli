/** Stateful public API boundary shared by source and installed-package checks. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { randomUUID, generateKeyPairSync, sign, verify } from 'node:crypto';

const execute = promisify(execFile);
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherActor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const key = 'arx_forge_testcredential';

async function boundary(root) {
  // This fixture is the CLI's external API/tunnel boundary. Joined tests use
  // the real backend issuer and daemon verifier, rather than this server.
  const signing = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const issued = new Map();
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  function issue(session, user) {
    const now = Math.floor(Date.now() / 1000);
    const header = encode({ alg:'RS256', typ:'ariax-forge-access+jwt', kid:'fixture' });
    const claims = { iss:'https://cli-fixture.test', aud:`forge:${session.data.session_id}`, iat:now, nbf:now, exp:now+300,
      session_id:session.data.session_id, project_id:session.data.project_id, actor_id:user, api_key_id:null, scopes:['forge:read','forge:write'] };
    const input = header + '.' + encode(claims);
    const token = input + '.' + sign('RSA-SHA256', Buffer.from(input), signing.privateKey).toString('base64url');
    issued.set(token, claims);
    return { ...claims, token };
  }
  const sessions = new Map(), projects = new Map(), children = new Set(), heldResponses = new Set();
  const catalog = ['base', 'ipsae', 'boltz2', 'bindcraft2'].map(tool => ({ tool, name: tool,
    gpu: ['boltz2', 'bindcraft2'].includes(tool),
    sources: [{ name: tool, repository: `https://example.org/${tool}`, commit: 'source-revision', version: null }],
    patches: [], models: [{ id: 'default', assets: tool === 'boltz2' ? ['boltz2'] : [], modes: ['native'], resources: null }],
    resource_evidence: [],
    capabilities: { tasks: tool === 'bindcraft2' ? ['binder-design', 'antibodies'] : ['molecular-prediction'],
      guide: tool, terms: [], citations: [], qualification: [{ model: 'default', mode: 'native',
        upstream_maturity: 'experimental', native: 'passed', installation: 'held', restoration: 'untested',
        scope: 'HTTP fixture: bounded native case only', workload: 'One chain' }] },
  }));
  const toolState = (tool, state) => ({ ...catalog.find(item => item.tool === tool), tool, state, error: null });
  const state = { sessions, projects, allocations: 0, executions: 0, releases: 0, posts: 0, preparations: 0,
    drop: 'create', holdReads: false, unknown: false, cleanupBlocked: false, fault: null };
  const reply = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data })); };
  const error = (res, status, code, message, details) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code, message, retryable: false, ...(details ? { details } : {}) } }));
  };
  const held = (res, project) => error(res, 409, 'human_resume_required', 'A human must allow this project to resume', {
    project_id: project.id, approval_path: `/projects/forge/${project.id}`, control_revision: project.control.revision,
  });
  const makeSession = (body, user, project) => {
    state.allocations++;
    const allocatedAt = new Date().toISOString();
    const session = { owner: user, request: body, commands: new Map(), selections: new Map(), data: {
      session_id: body.session_id, project_id: project.id, name: project.name,
      state: 'starting', gpu_type: body.gpu_type, gpu_count: body.gpu_count,
      tools: [toolState('base', 'queued'), ...body.tools.map(tool => toolState(tool, 'queued'))],
      max_gpu_hours: body.max_gpu_hours ?? null, limit_revision: 0, allocated_at: allocatedAt,
      expires_at: body.max_gpu_hours === undefined ? null : new Date(Date.parse(allocatedAt) + body.max_gpu_hours / body.gpu_count * 3600000).toISOString(),
      hardware: { gpu_count: body.gpu_count, vram_gib_per_gpu: 48, ram_gib: 128, cpu_count: 16, disk_gib: 500 },
      persistence: { state: 'pending', checkpoint: null, error: null }, error: null,
    } };
    sessions.set(body.session_id, session);
    return session;
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const direct = /^\/__direct\/([0-9a-f-]{36})(\/v1\/.*)$/.exec(url.pathname);
      let user;
      const rawToken = (req.headers.authorization || '').replace(/^Bearer /, '');
      if (direct) {
        const claims = issued.get(rawToken), pieces = rawToken.split('.');
        if (!claims || pieces.length !== 3 || !verify('RSA-SHA256', Buffer.from(pieces[0]+'.'+pieces[1]), signing.publicKey, Buffer.from(pieces[2], 'base64url'))
            || claims.exp <= Date.now()/1000 || claims.session_id !== direct[1]) return error(res, 401, 'unauthorized', 'Session authentication required');
        user = claims.actor_id;
        url.pathname = `/api/v1/forge/sessions/${direct[1]}` + (direct[2] === '/v1/session' ? '' : direct[2].slice(3));
      } else {
        user = req.headers.authorization === `Bearer ${key}` ? actor
          : req.headers.authorization === 'Bearer arx_forge_othercredential' ? otherActor : null;
      }
      if (!user) return error(res, 401, 'invalid_api_key', 'Authentication required');
      const connect = /^\/api\/v1\/forge\/sessions\/([0-9a-f-]{36})\/connect$/.exec(url.pathname);
      if (connect && req.method === 'POST') {
        const session = sessions.get(connect[1]);
        if (!session || session.owner !== user) return error(res, 404, 'not_found', 'Session not found');
        const access = issue(session, user);
        return reply(res, 200, { session_id:connect[1], project_id:session.data.project_id,
          endpoint:`https://${connect[1].replaceAll('-', '')}.forge.test`, access_token:access.token,
          expires_at:new Date(access.exp*1000).toISOString(), api_version:1 });
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/me') {
        return reply(res, 200, { actor: { user_id: user }, billing: { account_type: 'user', account_id: user } });
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/forge/catalog') return reply(res, 200, { tools: catalog });
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
        if (!url.pathname.endsWith('/files/presign')) assert.ok(records.some(record => record.actor_user_id === user
          && isDeepStrictEqual(record.request, { method: 'POST', ...(direct ? {session_id:direct[1]} : {}), path: direct ? direct[2] : url.pathname, body })), 'mutation has no durable request');
      }
      if (url.pathname === '/api/v1/forge/sessions') {
        if (req.method === 'GET') return reply(res, 200, { sessions: [...sessions.values()].filter(s => s.owner === user).map(s => s.data) });
        assert.equal(req.method, 'POST');
        let session = sessions.get(body.session_id);
        if (session && (session.owner !== user || !isDeepStrictEqual(session.request, body))) return error(res, 409, 'request_conflict', 'Session request differs');
        if (!session) {
          if (body.restore) {
            const source = sessions.get(body.restore.session_id);
            if (!source || source.owner !== user) return error(res, 404, 'not_found', 'Source not found');
            const sourceProject = projects.get(source.data.project_id);
            if (sourceProject.control.human_resume_required) return held(res, sourceProject);
          }
          const project = { id: randomUUID(), owner: user, name: body.name, status: 'running', control: {
            revision: 0, human_resume_required: false, stop_origin: null, stop_reason: null, stopped_by: null, stopped_at: null,
          } };
          projects.set(project.id, project);
          session = makeSession(body, user, project);
        }
        if (state.drop === 'create') { state.drop = null; req.socket.destroy(); return; }
        return reply(res, 202, session.data);
      }
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[3] === 'projects') {
        const project = projects.get(parts[4]);
        if (!project || project.owner !== user) return error(res, 404, 'not_found', 'Project not found');
        const history = [...sessions.values()].filter(s => s.data.project_id === project.id).reverse();
        if (req.method === 'GET' && parts.length === 5) {
          const start = Number(url.searchParams.get('cursor') || 0), limit = Number(url.searchParams.get('limit') || 50);
          return reply(res, 200, { project_id: project.id, name: project.name, status: project.status, control: project.control,
            active_session_id: history.find(s => !['closed', 'failed'].includes(s.data.state))?.data.session_id ?? null,
            latest_session_id: history[0]?.data.session_id ?? null, sessions: history.slice(start, start + limit).map(s => s.data),
            next_cursor: start + limit < history.length ? String(start + limit) : null,
          });
        }
        assert.equal(parts[5], 'sessions');
        assert.equal(req.method, 'POST');
        let resumed = sessions.get(body.session_id);
        if (resumed && (resumed.owner !== user || resumed.data.project_id !== project.id || !isDeepStrictEqual(resumed.request, body))) return error(res, 409, 'request_conflict', 'Resume request differs');
        if (!resumed) {
          if (project.control.human_resume_required) return held(res, project);
          if (body.expected_control_revision !== project.control.revision) return error(res, 409, 'control_revision_conflict', 'Project control changed');
          if (history.some(s => s.data.state === 'closing')) return error(res, 409, 'session_cleanup_pending', 'Cleanup pending');
          if (history.some(s => !['closed', 'failed'].includes(s.data.state))) return error(res, 409, 'project_session_active', 'Session active');
          const source = sessions.get(body.restore.session_id);
          if (!source || source.owner !== user || source.data.project_id !== project.id) return error(res, 404, 'not_found', 'Source not found');
          if (source.data.persistence.checkpoint !== body.restore.checkpoint_id) return error(res, 409, 'checkpoint_required', 'Saved files required');
          resumed = makeSession(body, user, project);
          project.status = 'running';
        }
        if (state.drop === 'resume') { state.drop = null; req.socket.destroy(); return; }
        return reply(res, 202, resumed.data);
      }
      assert.deepEqual(parts.slice(0, 4), ['api', 'v1', 'forge', 'sessions']);
      const session = sessions.get(parts[4]);
      if (!session || session.owner !== user) return error(res, 404, 'not_found', 'Session not found');
      if (parts.length === 5) {
        assert.equal(req.method, 'GET');
        if (state.sessionReadsUnavailable) return error(res, 503, 'runtime_unavailable', 'Session inspection unavailable');
        return reply(res, 200, session.data);
      }
      const project = projects.get(session.data.project_id);
      if (parts[5] === 'checkpoints') {
        assert.equal(req.method, 'GET');
        const saved = session.savedFile;
        if (!saved || parts[6] !== saved.checkpoint_id) return error(res, 404, 'not_found', 'Checkpoint not found');
        return reply(res, 200, { checkpoint_id: saved.checkpoint_id, session_id: session.data.session_id,
          state: 'synced', completed_at: saved.completed_at, file_count: 1, size_bytes: saved.bytes.length });
      }
      if (parts[5] === 'files' && parts[6] === 'presign') {
        assert.equal(req.method, 'POST');
        const saved = session.savedFile;
        if (!saved || (body.checkpoint && body.checkpoint !== saved.checkpoint_id)) return error(res, 409, 'checkpoint_required', 'Saved files required');
        if (body.path !== saved.path) return error(res, 404, 'not_found', 'Saved file not found');
        return reply(res, 200, { path: saved.path, checkpoint: saved.checkpoint_id, size_bytes: saved.bytes.length,
          download_url: 'https://example.org/storage?signature=private-transfer-grant', expires_at: 'future' });
      }
      if (parts[5] === 'limit') {
        assert.equal(req.method, 'POST');
        if (['closing', 'closed', 'failed'].includes(session.data.state)) return error(res, 409, 'session_closing', 'Session closing');
        if (body.expected_limit_revision !== session.data.limit_revision) return error(res, 409, 'limit_revision_conflict', 'Limit changed');
        session.data.limit_revision++;
        session.data.max_gpu_hours = body.max_gpu_hours;
        session.data.expires_at = body.max_gpu_hours === null ? null : new Date(Date.parse(session.data.allocated_at) + body.max_gpu_hours / session.data.gpu_count * 3600000).toISOString();
        if (state.drop === 'limit') { state.drop = null; req.socket.destroy(); return; }
        return reply(res, 200, session.data);
      }
      if (parts[5] === 'tools') {
        if (req.method === 'GET') return reply(res, 200, {tools:session.data.tools});
        assert.equal(req.method, 'POST');
        const previous = session.selections.get(body.selection_id);
        if (previous && !isDeepStrictEqual(previous, body)) return error(res, 409, 'idempotency_conflict', 'Selection request differs');
        if (!previous) {
          if (project.control.human_resume_required) return held(res, project);
          if (session.data.state !== 'available') return error(res, 409, 'session_unready', 'Session is not available');
          session.selections.set(body.selection_id, body);
          for (const tool of body.tools) {
            let item = session.data.tools.find(item => item.tool === tool);
            if (!item) { item = toolState(tool, 'queued'); session.data.tools.push(item); state.preparations++; }
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
          if (project.control.human_resume_required) return held(res, project);
          if (session.data.state !== 'available') return error(res, 409, 'session_unavailable', 'Session is not available');
          if (!session.data.tools.some(t => t.tool === body.tool && t.state === 'ready')) return error(res, 409, 'tool_unready', 'Tool is not ready');
          const gpu = catalog.find(item => item.tool === body.tool).gpu;
          const ids = body.gpu_ids ?? (gpu && session.data.gpu_count === 1 ? [0] : []);
          if ((gpu && !ids.length) || (!gpu && ids.length) || ids.some(id => id >= session.data.gpu_count)) return error(res, 422, 'invalid_devices', 'Select valid devices');
          const busy = [...session.commands.values()].some(c => ['running', 'unknown', 'starting'].includes(c.data.state) && c.data.gpu_ids.some(id => ids.includes(id)));
          if (busy) return error(res, 409, 'gpu_busy', 'Selected device is reserved');
          state.executions++;
          command = { request: body, text: '', data: { ...body, gpu_ids: ids, state: 'running', cancel_requested: false, exit_code: null, error: null } };
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
        if (state.holdReads) { heldResponses.add(res); res.once('close', () => heldResponses.delete(res)); return; }
        const cursor = Number(url.searchParams.get('cursor') || '0');
        const bytes = Buffer.from(command.text);
        const current = state.unknown ? { ...command.data, state:'unknown' } : command.data;
        return reply(res, 200, { command:current, command_id:command.data.command_id,
          text:bytes.subarray(cursor).toString(), next_cursor:String(bytes.length), gap:false,
          output_available:true, output_truncated:false });
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

export async function tunnelEnvironment(root, origin, baseEnv) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ariax-forge-private-'));
  const preload = path.join(directory, 'tunnel.cjs');
  await fs.writeFile(preload, `const original=globalThis.fetch;
globalThis.fetch=function(input,options){
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(url.protocol==='https:'&&/^[0-9a-f]{32}\\.forge\\.test$/.test(url.hostname)){
  const hex=url.hostname.split('.')[0];const sid=hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  return original(process.env.ARIAX_FIXTURE_TUNNEL+'/__direct/'+sid+url.pathname+url.search,options);
 }
 return original(input,options);
};
`);
  return { directory, env:{...baseEnv, XDG_CONFIG_HOME:path.join(directory,'config'),
    ARIAX_FIXTURE_TUNNEL:origin, NODE_OPTIONS:((baseEnv.NODE_OPTIONS || '')+' --require='+preload).trim()} };
}

export async function exerciseForgeCli(script, baseEnv = process.env) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ariax-forge-http-'));
  const api = await boundary(root);
  const { state } = api;
  const privateClient = await tunnelEnvironment(root, api.origin, baseEnv);
  const env = { ...privateClient.env, ARIAX_API_KEY: key, NO_UPDATE_NOTIFIER: '1' };
  async function invoke(args, { code = 0, actorKey = key, origin = api.origin, interrupt = false } = {}) {
    let out;
    try {
      const pending = execute(process.execPath, [script, '--json', '--root-dir', root, '--base-url', origin, ...args], {
        env: { ...env, ARIAX_API_KEY: actorKey }, timeout: 60_000,
      });
      if (interrupt) pending.child.stderr.on('data', chunk => {
        if (String(chunk).includes('Waiting. Resume with:')) pending.child.kill('SIGINT');
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

    const createArgs = ['forge', 'create', '--name', 'Recovery experiment', '--gpu', 'L40', '--tools', 'boltz2,bindcraft2', '--priority', 'bindcraft2', '--max-gpu-hours', '2'];
    const lostCreate = await invoke(createArgs, { code: 9 });
    const sessionId = lostCreate.stderr.match(/session_id: ([0-9a-f-]{36})/)[1];
    assert.equal(state.allocations, 1);
    assert.equal(state.posts, 1, 'POST was automatically retried');
    assert.equal((await record(sessionId)).result, null);
    const retryCreate = [...createArgs, '--session-id', sessionId];
    const accepted = await invoke(retryCreate);
    assert.equal(accepted.payload.data.session_id, sessionId);
    assert.equal(Object.hasOwn(accepted.payload.data, 'provider'), false);
    assert.equal(Object.hasOwn(state.sessions.get(sessionId).request, 'provider'), false);
    assert.equal(state.sessions.get(sessionId).request.gpu_count, 1);
    assert.equal(state.sessions.get(sessionId).request.max_gpu_hours, 2);
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
    assert.equal((await invoke(['forge', 'tools', 'wait', sessionId, 'base', '--timeout', '30'])).payload.data.state, 'ready');
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
    await invoke(retrySelection, { code: 4, actorKey: 'arx_forge_othercredential' });
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
    const finished = await invoke(['forge', 'watch', sessionId, commandId, '--timeout', '30']);
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
    const beforeDeadlineWait = state.posts;
    const deadlineWait = await invoke(['forge', 'watch', sessionId, longId, '--timeout', '0.05'], { code: 9 });
    assert.match(deadlineWait.payload.error.message, /Wait timed out; remote work continues/);
    assert.equal(state.posts, beforeDeadlineWait, 'a local deadline mutated remote work');
    state.holdReads = false;
    assert.equal((await invoke(['forge', 'command', sessionId, longId])).payload.data.state, 'running');
    state.unknown = true;
    const uncertain = await invoke(['forge', 'command', sessionId, longId]);
    assert.equal(uncertain.payload.data.state, 'unknown');
    assert.match(uncertain.stderr, /same command ID.*outcome is known/);
    await invoke(['forge', 'watch', sessionId, longId, '--timeout', '0.05'], { code: 9 });
    state.unknown = false;
    const beforeWatch = state.posts;
    await invoke(['forge', 'watch', sessionId, longId], { code: 130, interrupt: true });
    assert.equal((await invoke(['forge', 'command', sessionId, longId])).payload.data.state, 'running');
    assert.equal(state.posts, beforeWatch, 'local waits cancelled remote work');
    assert.equal(state.executions, 2);
    await invoke(['forge', 'cancel', sessionId, longId]);
    await invoke(['forge', 'cancel', sessionId, longId]);
    assert.equal((await invoke(['forge', 'watch', sessionId, longId, '--timeout', '30'])).payload.data.state, 'cancelled');
    assert.equal((await invoke(['forge', 'commands', sessionId])).payload.data.commands.length, 2);

    const failedRun = await invoke(['forge', 'run', sessionId, '--tool', 'base', '--', process.execPath, '-e', 'process.exit(2)']);
    const failedId = failedRun.payload.data.command_id;
    const failure = await invoke(['forge', 'watch', sessionId, failedId, '--timeout', '30'], { code: 10 });
    assert.match(failure.payload.error.action, new RegExp(`forge logs ${sessionId} ${failedId}`));
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
    assert.match(invalidProvider.payload.error.message, /unsupported flag/);
    const storage = path.join(root, '.ariax/forge');
    await fs.rename(storage, `${storage}-saved`);
    await fs.symlink(`${storage}-saved`, storage, 'dir');
    try { await invoke(['forge', 'create', '--name', 'Unsafe storage', '--gpu', 'L40'], { code: 1 }); }
    finally { await fs.unlink(storage); await fs.rename(`${storage}-saved`, storage); }
    assert.equal(state.posts, beforeInvalid, 'unsafe paths or unsupported surfaces sent a mutation');
    const second = await invoke(['forge', 'create', '--name', 'Second workspace', '--gpu', 'L40']);
    const secondId = second.payload.data.session_id;
    assert.equal(Object.hasOwn(second.payload.data, 'provider'), false);
    assert.equal(Object.hasOwn((await record(secondId)).request.body, 'provider'), false);
    assert.equal(state.allocations, 2);
    await invoke(['forge', 'close', secondId]);
    assert.equal(state.releases, 2);
    for (const name of await fs.readdir(path.join(root, '.ariax/forge'))) {
      const bytes = await fs.readFile(path.join(root, '.ariax/forge', name), 'utf8');
      assert.doesNotMatch(bytes, new RegExp(key));
      if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(root, '.ariax/forge', name))).mode & 0o777, 0o600);
    }
    assert.equal(state.fault, null, state.fault?.stack);
  } finally { await api.close(); await fs.rm(root, { recursive: true, force: true }); await fs.rm(privateClient.directory, { recursive:true, force:true }); }
}

/** Device/revision mistakes must not execute again, clear a hold, or allocate a replacement project. */
export async function exerciseForgeControls(script, baseEnv = process.env) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ariax-forge-controls-'));
  const api = await boundary(root), { state } = api;
  const privateClient = await tunnelEnvironment(root, api.origin, baseEnv);
  const env = { ...privateClient.env, ARIAX_API_KEY: key, NO_UPDATE_NOTIFIER: '1' };
  async function invoke(args, code = 0, human = false) {
    let out;
    try { out = { code: 0, ...await execute(process.execPath, [script, human ? '--no-json' : '--json',
      '--root-dir', root, '--base-url', api.origin, ...args], { env, timeout: 60_000 }) }; }
    catch (cause) { if (typeof cause.code !== 'number') throw cause; out = cause; }
    assert.equal(out.code, code, `${args}: ${out.stdout}\n${out.stderr}`);
    assert.doesNotMatch(out.stdout + out.stderr, new RegExp(key));
    return human ? out : { ...out, payload: JSON.parse(out.stdout) };
  }
  const record = async id => JSON.parse(await fs.readFile(path.join(root, '.ariax/forge', `${id}.json`), 'utf8'));
  try {
    state.drop = null;
    const created = await invoke(['forge', 'create', '--name', 'Device experiment', '--gpu', 'L40', '--gpu-count', '2',
      '--tools', 'boltz2', '--min-ram-gib', '64', '--min-cpu-count', '8', '--min-disk-gib', '250', '--max-gpu-hours', '8']);
    const sid = created.payload.data.session_id, pid = created.payload.data.project_id;
    const session = state.sessions.get(sid), project = state.projects.get(pid);
    assert.deepEqual((await record(sid)).request.body.hardware, { min_ram_gib: 64, min_cpu_count: 8, min_disk_gib: 250 });
    assert.equal(Date.parse(session.data.expires_at) - Date.parse(session.data.allocated_at), 4 * 3600000);
    session.data.state = 'available';
    session.data.tools.forEach(t => t.state = 'ready');
    const catalog = await invoke(['forge', 'catalog', '--details'], 0, true);
    assert.match(catalog.stdout, /sources:.*https:\/\/example.org\/boltz2/);
    assert.match(catalog.stdout, /models:.*boltz2/);
    const routed = await invoke(['forge', 'catalog', '--task', 'antibodies']);
    assert.deepEqual(routed.payload.data.tools.map(tool => tool.tool), ['bindcraft2']);
    const qualification = routed.payload.data.tools[0].capabilities.qualification[0];
    assert.equal(qualification.native, 'passed');
    assert.equal(qualification.installation, 'held');
    assert.equal(qualification.restoration, 'untested');
    await invoke(['forge', 'catalog', '--task', 'unrecognized-task'], 1);
    const inspected = await invoke(['forge', 'tools', sid, '--details'], 0, true);
    assert.match(inspected.stdout, /source-revision/);
    const countText = await invoke(['forge', 'list'], 0, true);
    assert.match(countText.stdout, /gpu_count/);
    const native = [process.execPath, '-e', 'setInterval(() => {}, 1000)'];
    const base = ['forge', 'run', sid, '--tool', 'boltz2'];
    await invoke([...base, '--', ...native], 5); // The backend, rather than a client guess, requires explicit devices.
    await invoke([...base, '--gpus', '2', '--', ...native], 5);
    const beforeInvalid = state.posts;
    for (const gpus of ['0,0', '-1', '0.5', '0,', '9007199254740992']) {
      await invoke([...base, `--gpus=${gpus}`, '--', ...native], 1);
    }
    await invoke(['forge', 'create', '--name', 'Bad count', '--gpu', 'L40', '--gpu-count', '1.5'], 1);
    await invoke(['forge', 'create', '--name', 'Old limit', '--gpu', 'L40', '--max-hours', '2'], 1);
    assert.equal(state.posts, beforeInvalid, 'invalid local device/count flags reached admission');

    state.drop = 'run';
    const request = [...base, '--gpus', '0', '--', ...native];
    const lost = await invoke(request, 9), cid = lost.stderr.match(/command_id: ([0-9a-f-]{36})/)[1];
    const retry = [...base, '--gpus', '0', '--command-id', cid, '--', ...native];
    await invoke(retry);
    assert.equal(state.executions, 1);
    assert.deepEqual((await record(cid)).request.body.gpu_ids, [0]);
    await invoke([...base, '--gpus', '1', '--command-id', cid, '--', ...native], 7);
    const occupied = await invoke([...base, '--gpus', '0,1', '--', ...native], 7);
    assert.equal(occupied.payload.error.code, 'gpu_busy');
    const parallel = await invoke([...base, '--gpus', '1', '--', ...native]);
    assert.equal(state.executions, 2);
    await invoke(['forge', 'cancel', sid, cid]);
    await invoke(['forge', 'watch', sid, cid, '--timeout', '30']);
    await invoke(['forge', 'cancel', sid, parallel.payload.data.command_id]);
    await invoke(['forge', 'watch', sid, parallel.payload.data.command_id, '--timeout', '30']);
    const savedName = 'control result ?+.txt';
    const multiple = await invoke([...base, '--gpus', '1,0', '--', process.execPath, '-e',
      'require("node:fs").writeFileSync(process.argv[1], "saved command output"); console.log("explicit devices")', savedName]);
    assert.deepEqual(multiple.payload.data.gpu_ids, [1, 0]);
    await invoke(['forge', 'watch', sid, multiple.payload.data.command_id, '--timeout', '30']);

    state.drop = 'limit';
    const edit = ['forge', 'limit', sid, '--gpu-hours', '12', '--limit-revision', '0'];
    const lostLimit = await invoke(edit, 9);
    assert.match(lostLimit.payload.error.action, /limit_revision/);
    const capped = (await invoke(['forge', 'status', sid])).payload.data;
    assert.equal(capped.limit_revision, 1);
    assert.equal(capped.control.revision, 0);
    assert.equal(capped.max_gpu_hours, 12);
    assert.equal(Date.parse(capped.expires_at) - Date.parse(capped.allocated_at), 6 * 3600000);
    assert.equal((await invoke(edit, 7)).payload.error.code, 'limit_revision_conflict');
    await invoke(['forge', 'limit', sid, '--gpu-hours', '4', '--limit-revision', '1']);
    assert.equal(Date.parse(session.data.expires_at) - Date.parse(session.data.allocated_at), 2 * 3600000);
    await invoke(['forge', 'limit', sid, '--clear', '--limit-revision', '2']);
    assert.equal(session.data.max_gpu_hours, null);
    assert.equal(session.data.expires_at, null);
    assert.equal(session.data.limit_revision, 3);
    await invoke(['forge', 'limit', sid, '--clear', '--gpu-hours', '4', '--limit-revision', '3'], 1);

    project.control = { revision: 1, human_resume_required: true, stop_origin: 'web', stop_reason: 'human_pause',
      stopped_by: actor, stopped_at: new Date().toISOString() };
    project.status = 'paused';
    const heldStatus = await invoke(['forge', 'status', sid], 0, true);
    assert.match(heldStatus.stdout, /human_resume_required":true/);
    const executions = state.executions, allocations = state.allocations;
    state.sessionReadsUnavailable = true;
    const heldRun = await invoke(['forge', 'run', sid, '--tool', 'base', '--', ...native], 7);
    state.sessionReadsUnavailable = false;
    assert.equal(heldRun.payload.error.code, 'human_resume_required');
    assert.equal(heldRun.payload.error.details.project_id, pid);
    assert.equal(heldRun.payload.error.details.control_revision, 1);
    assert.equal(heldRun.payload.error.details.approval_url, `${api.origin}/projects/forge/${pid}`);
    assert.match(heldRun.payload.error.action, new RegExp(`/projects/forge/${pid}`));
    assert.match(heldRun.payload.error.action, /ask your user.*Allow agent to resume/);
    assert.match(heldRun.payload.error.action, /replacement project/);
    assert.equal(state.executions, executions);
    await invoke(['forge', 'close', sid]);
    session.data.persistence = { state: 'synced', checkpoint: randomUUID(), error: null };
    session.savedFile = { checkpoint_id: session.data.persistence.checkpoint, path: `/workspace/${savedName}`,
      completed_at: new Date().toISOString(), bytes: await fs.readFile(path.join(root, savedName)) };
    const linked = (await invoke(['forge', 'link', sid, session.savedFile.path])).payload.data;
    const savedUrl = new URL(linked.url);
    assert.equal(savedUrl.pathname, `/projects/forge/${pid}`);
    assert.equal(savedUrl.searchParams.get('session'), sid);
    assert.equal(savedUrl.searchParams.get('checkpoint'), session.savedFile.checkpoint_id);
    assert.equal(savedUrl.searchParams.get('path'), session.savedFile.path);
    assert.equal(linked.size_bytes, session.savedFile.bytes.length);
    assert.doesNotMatch(JSON.stringify(linked), /private-transfer-grant|download_url/);
    const resume = ['forge', 'resume', pid, '--restore-session', sid, '--checkpoint', session.data.persistence.checkpoint,
      '--control-revision', '1', '--gpu', 'L40', '--gpu-count', '2', '--tools', 'boltz2'];
    const heldResume = await invoke(resume, 7);
    assert.match(heldResume.payload.error.action, new RegExp(`/projects/forge/${pid}`));
    await invoke(['forge', 'create', '--name', 'Held replacement', '--gpu', 'L40', '--restore-session', sid,
      '--checkpoint', session.data.persistence.checkpoint], 7);
    assert.equal(state.allocations, allocations, 'a human hold allocated compute');
    assert.equal(state.projects.size, 1, 'held restore created a replacement project');
    // Represent the human-authenticated approval boundary. CLI inspection cannot approve it.
    project.control.human_resume_required = false;
    project.control.revision = 2;
    const afterApproval = state.posts;
    const control = (await invoke(['forge', 'project', pid])).payload.data;
    assert.equal(control.control.human_resume_required, false);
    assert.equal(control.control.revision, 2);
    assert.equal(state.posts, afterApproval);
    assert.equal(state.allocations, allocations);
    assert.equal((await invoke(resume, 7)).payload.error.code, 'control_revision_conflict');
    state.drop = 'resume';
    const approved = [...resume, '--control-revision', '2'];
    const lostResume = await invoke(approved, 9), resumedId = lostResume.stderr.match(/session_id: ([0-9a-f-]{36})/)[1];
    assert.equal((await record(resumedId)).result, null);
    const retryResume = [...approved, '--session-id', resumedId];
    const resumed = await invoke(retryResume);
    assert.equal(resumed.payload.data.project_id, pid);
    assert.equal(resumed.payload.data.name, 'Device experiment');
    assert.equal(resumed.payload.data.max_gpu_hours, null, 'resume inherited an old session cap');
    assert.equal((await record(resumedId)).request.body.expected_control_revision, 2);
    assert.equal((await record(resumedId)).request.body.name, undefined);
    assert.equal(state.allocations, allocations + 1);
    assert.equal(state.executions, executions, 'resume replayed a scientific command');
    await invoke([...retryResume, '--gpu-count', '1'], 7);
    const summary = (await invoke(['forge', 'project', pid, '--limit', '1'])).payload.data;
    assert.equal(summary.sessions.length, 1);
    const history = (await invoke(['forge', 'project', pid, '--limit', '1', '--cursor', summary.next_cursor])).payload.data;
    assert.equal(history.sessions[0].session_id, sid);
    assert.equal(history.active_session_id, resumedId);
    assert.equal(history.latest_session_id, resumedId);
    await invoke(['forge', 'project', pid, '--limit', '101'], 1);
    await invoke(['forge', 'status', resumedId]);
    assert.equal((await record(resumedId)).result.state, 'starting', 'status did not refresh a resumed session record');
    await invoke(['forge', 'close', resumedId]);
    assert.equal((await invoke(['forge', 'limit', resumedId, '--gpu-hours', '4', '--limit-revision', '0'], 7)).payload.error.code, 'session_closing');
    assert.equal(state.releases, state.allocations);
    for (const name of await fs.readdir(path.join(root, '.ariax/forge'))) {
      assert.doesNotMatch(await fs.readFile(path.join(root, '.ariax/forge', name), 'utf8'), new RegExp(key));
    }
    assert.equal(state.fault, null, state.fault?.stack);
  } finally { await api.close(); await fs.rm(root, { recursive: true, force: true }); await fs.rm(privateClient.directory, { recursive:true, force:true }); }
}
