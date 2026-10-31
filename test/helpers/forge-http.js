/** Stateful public API boundary shared by source and installed-package checks. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { createHash, randomUUID, generateKeyPairSync, sign, verify } from 'node:crypto';

const execute = promisify(execFile);
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherActor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const key = 'arx_forge_testcredential';
const partSize = 16 * 1024 * 1024;
const digest = bytes => createHash('md5').update(bytes).digest();
function fileChecksum(bytes) {
  const parts = [];
  for (let offset = 0; offset < bytes.length || !parts.length; offset += partSize) {
    parts.push(digest(bytes.subarray(offset, offset + partSize)));
  }
  return `${digest(Buffer.concat(parts)).toString('hex')}-${parts.length}`;
}

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
    resources: { min_gpu_count: ['boltz2', 'bindcraft2'].includes(tool) ? 1 : 0, min_vram_gib_per_gpu: null,
      min_ram_gib: 64, min_cpu_count: null, min_disk_gib: 100 },
    sources: [{ name: tool, repository: `https://example.org/${tool}`, commit: 'source-revision', version: null }],
    patches: [], models: [{ id: 'default', assets: tool === 'boltz2' ? ['boltz2'] : [], modes: ['native'],
      resources: tool === 'bindcraft2' ? { min_gpu_count: 1, min_vram_gib_per_gpu: 80 } : null }],
    resource_evidence: [],
    capabilities: { tasks: tool === 'bindcraft2' ? ['binder-design', 'antibodies'] : ['molecular-prediction'],
      guide: tool, terms: [], citations: [], qualification: [{ model: 'default', mode: 'native',
        upstream_maturity: 'experimental', native: 'passed', installation: 'held', restoration: 'untested',
        scope: 'HTTP fixture: bounded native case only', workload: 'One chain' },
      ...(tool === 'bindcraft2' ? [{ model: 'default', mode: 'other', upstream_maturity: 'unknown',
        native: 'unknown', installation: 'passed', restoration: 'held', scope: 'Not qualified', workload: null }] : [])] },
  }));
  const toolState = (tool, state) => ({ ...catalog.find(item => item.tool === tool), tool, state, error: null });
  const state = { sessions, projects, allocations: 0, executions: 0, releases: 0, posts: 0, preparations: 0,
    drop: 'create', holdReads: false, unknown: false, cleanupBlocked: false, fault: null,
    connects: 0, rejectPost401: 0, rejectedPost401: 0, liveCommandMissing: false, liveInputMissing: false,
    pendingAdmission: false, commandFailures: 0, rejectedCommands: 0, inputAdmissions: 0,
    copyPosts: 0, finishPosts: 0, finishAutoComplete: false, finishFailure: false, bumpResume: false,
    syncMode: 'saved', syncPosts: 0, fileError: false, fileBadPath: false, fileBadGrant: false, fileCursorCycle: false, legacyResume: false };
  const reply = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data })); };
  const error = (res, status, code, message, details) => {
    res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': 'request-fixture-1' });
    res.end(JSON.stringify({ error: { code, message, retryable: false, ...(details ? { details } : {}) } }));
  };
  const held = (res, project) => error(res, 409, 'human_resume_required', 'A human must allow this project to resume', {
    project_id: project.id, approval_path: `/projects/forge/${project.id}`, control_revision: project.control.revision,
  });
  const makeSession = (body, user, project) => {
    state.allocations++;
    const allocatedAt = new Date().toISOString();
    assert.equal(body.files_contract, 2);
    const session = { owner: user, request: body, commands: new Map(), selections: new Map(), syncs: new Map(), inputs: new Map(), inputRequests: new Map(), data: {
      session_id: body.session_id, project_id: project.id, name: project.name,
      state: 'starting', gpu_type: body.gpu_type, gpu_count: body.gpu_count,
      tools: [toolState('base', 'queued'), ...body.tools.map(tool => toolState(tool, 'queued'))],
      max_gpu_hours: body.max_gpu_hours ?? null, limit_revision: 0, applied_limit_revision: 0, allocated_at: allocatedAt,
      expires_at: body.max_gpu_hours === undefined ? null : new Date(Date.parse(allocatedAt) + body.max_gpu_hours / body.gpu_count * 3600000).toISOString(),
      hardware: { gpu_count: body.gpu_count, vram_gib_per_gpu: 48, ram_gib: 128, cpu_count: 16, disk_gib: 500 },
      persistence: { state: 'pending', error: null }, error: null,
    } };
    sessions.set(body.session_id, session);
    return session;
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'PUT' && url.pathname.startsWith('/__part/')) {
        const [, , projectId, operationId, attemptId, number] = url.pathname.split('/');
        const operation = projects.get(projectId)?.fileOperations.get(operationId);
        if (!operation || operation.attempt_id !== attemptId || url.searchParams.get('signature') !== 'private-transfer-grant') return error(res,403,'forbidden','Transfer denied');
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        assert.equal(req.headers['content-length'],String(bytes.length));
        assert.equal(req.headers['content-md5'],digest(bytes).toString('base64'));
        operation.parts.set(Number(number),bytes);
        if (state.drop === 'input-put') { state.drop = null; req.socket.destroy(); return; }
        res.writeHead(200); res.end(); return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/__object/')) {
        const project = projects.get(url.pathname.slice('/__object/'.length));
        const file = project?.files.get(url.searchParams.get('path'));
        if (url.searchParams.get('signature') !== 'private-transfer-grant' || !file) return error(res, 403, 'forbidden', 'Transfer denied');
        res.writeHead(200, {'content-type':'application/octet-stream'});
        res.end(file);
        return;
      }
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
        state.connects++;
        const access = issue(session, user);
        return reply(res, 200, { session_id:connect[1], project_id:session.data.project_id,
          endpoint:`https://${connect[1].replaceAll('-', '')}.forge.test`, access_token:access.token,
          expires_at:new Date(access.exp*1000).toISOString(), api_version:1 });
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/me') {
        return reply(res, 200, { actor: { user_id: user }, billing: { account_type: 'user', account_id: user } });
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/forge/catalog') return reply(res, 200, { tools: catalog });
      if (direct && req.method === 'POST' && state.rejectPost401 > 0) {
        state.rejectPost401--;
        state.rejectedPost401++;
        return error(res,401,'unauthorized','Session authentication required');
      }
      let body;
      if (req.method === 'POST') {
        state.posts++;
        let text = '';
        for await (const chunk of req) text += chunk;
        body = text ? JSON.parse(text) : undefined;
        // Every mutation reaches this boundary only after its complete local record exists.
        const files = await fs.readdir(path.join(root, '.ariax/forge'));
        const records = await Promise.all(files.filter(f => f.endsWith('.json')).map(async f =>
          JSON.parse(await fs.readFile(path.join(root, '.ariax/forge', f), 'utf8'))));
        const projectMutation = /\/files\/intents(?:\/([0-9a-f-]{36}))?/.exec(url.pathname);
        if (projectMutation) {
          const operationId = projectMutation[1] ?? body?.operation_id;
          assert.ok(records.some(record => record.actor_user_id === user && record.id === operationId
            && record.request.type === 'project-file-input-v2'), 'project input has no durable request');
        } else if (url.pathname.endsWith('/files/recover')) {
          assert.ok(records.some(record => record.actor_user_id === user && record.id === body.operation_id
            && record.request.type === 'project-file-copy-v1' && isDeepStrictEqual(record.request.body,body)), 'file recovery has no durable request');
        } else if (direct && direct[2] === '/v1/inputs') {
          assert.ok(records.some(record => record.actor_user_id === user && record.id === body.input_id
            && record.request.body?.source?.kind === body.source.kind), 'input import has no durable request');
        } else if (!url.pathname.endsWith('/files/presign')) assert.ok(records.some(record => record.actor_user_id === user
          && isDeepStrictEqual(record.request, { method: 'POST', ...(direct ? {session_id:direct[1]} : {}), path: direct ? direct[2] : url.pathname, body })), 'mutation has no durable request');
      }
      if (url.pathname === '/api/v1/forge/sessions') {
        if (req.method === 'GET') return reply(res, 200, { sessions: [...sessions.values()].filter(s => s.owner === user).map(s => s.data) });
        assert.equal(req.method, 'POST');
        let session = sessions.get(body.session_id);
        if (session && (session.owner !== user || !isDeepStrictEqual(session.request, body))) return error(res, 409, 'request_conflict', 'Session request differs');
        if (!session) {
          assert.equal(Object.hasOwn(body, 'restore'), false);
          const project = { id: randomUUID(), owner: user, name: body.name, status: 'running', files: new Map(), fileOperations: new Map(), fileRevision:0, control: {
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
        if (parts[5] === 'files') {
          assert.ok(req.headers['x-request-id']);
          if (state.fileError) return error(res, 503, 'storage_unavailable', 'private-transfer-grant https://example.org/?signature=secret');
          const active = history.find(item => item.data.state === 'available');
          if (req.method === 'GET' && parts[6] === 'status') return reply(res,200,{
            session_id:active?.data.session_id ?? history[0]?.data.session_id,writer_session_id:active?.data.session_id ?? null,
            session_state:active?.data.state ?? 'closed',hydration_state:'ready',control_revision:project.control.revision,
            writer_epoch:state.fileWriterEpoch ?? 1,mutation_revision:project.fileRevision,sync_state:'saved',last_synced_at:null,durability_gap:false});
          if (req.method === 'GET' && parts[6] === 'metadata') {
            const name = url.searchParams.get('path'), file = project.files.get(name);
            return reply(res,200,file ? {kind:'file',version:1,mutation_revision:project.fileRevision,size_bytes:file.length}
              : {kind:'absent',version:0,mutation_revision:project.fileRevision});
          }
          if (req.method === 'GET' && parts[6] === 'operations') {
            const operation = project.fileOperations.get(parts[7]);
            if (!operation) return error(res,404,'not_found','File operation not found');
            if (state.confirmAfterReads > 0 && --state.confirmAfterReads === 0) state.confirmInstall = true;
            if (!operation.copy && state.confirmInstall && operation.state === 'published') {
              const installed = path.join(root,'inputs',operation.body.path.slice('/inputs/'.length));
              await fs.mkdir(path.dirname(installed),{recursive:true});
              await fs.writeFile(installed,project.files.get(operation.body.path));
            }
            return reply(res,200,{operation_id:parts[7],session_id:operation.body.session_id,source:operation.source ?? 'host',
              state:operation.state,version:operation.version ?? null,expires_at:new Date(Date.now()+3600000).toISOString(),
              // The updated backend obtains this status from the current writer daemon.
              local_state:operation.source === 'offline' || state.noFileWriter ? 'not_applicable'
                : operation.copy ? (state.copyConflict ? 'conflict' : state.copyInstall ? 'ready' : 'pending')
                : state.conflictInstall ? 'conflict' : state.confirmInstall ? 'ready'
                : state.pendingInstall ? 'pending' : 'unknown'});
          }
          if (req.method === 'POST' && parts[6] === 'recover') {
            state.copyPosts++;
            let operation = project.fileOperations.get(body.operation_id);
            if (operation && !isDeepStrictEqual(operation.body,body)) return error(res,409,'idempotency_conflict','File recovery request differs');
            if (!operation) {
              if (body.control_revision !== project.control.revision || body.writer_epoch !== (state.fileWriterEpoch ?? 1)) return error(res,409,'writer_fenced','Writer changed');
              if (body.expected_project_revision !== project.fileRevision) return error(res,409,'file_revision_conflict','Files changed');
              operation = {body,state:'open',copy:true,source:active ? 'host' : 'offline',posts:0};
              project.fileOperations.set(body.operation_id,operation);
            }
            operation.posts++;
            if (operation.source === 'host' || operation.posts >= 2) {
              operation.state = 'published';
              operation.version ??= ++project.fileRevision;
              project.files.set(body.path,Buffer.from('recovered'));
            }
            if (state.drop === 'file-copy') { state.drop = null; req.socket.destroy(); return; }
            return reply(res,200,{state:operation.state,...(operation.version ? {version:operation.version} : {retry_after:1})});
          }
          if (req.method === 'GET' && parts.length === 6) {
            const pageState = {mutation_revision:project.fileRevision,sync_state:'saved',last_synced_at:null,durability_gap:false};
            if (state.fileCursorCycle) return reply(res,200,{entries:[],next_cursor:'repeated-cursor',...pageState});
            const directory = url.searchParams.get('path'), cursor = Number(url.searchParams.get('cursor') || 0);
            const byName = new Map();
            for (const [name, bytes] of project.files) {
              if (!name.startsWith(directory + '/')) continue;
              const relative = name.slice(directory.length + 1), slash = relative.indexOf('/');
              const entryPath = directory + '/' + (slash < 0 ? relative : relative.slice(0,slash));
              byName.set(entryPath,slash < 0 ? {path:entryPath,kind:'file',size_bytes:bytes.length,version:1,mode:0o644}
                : {path:entryPath,kind:'directory',size_bytes:null,version:1,mode:null});
            }
            const entries = [...byName.values()].sort((a,b) => a.path.localeCompare(b.path));
            if (state.fileBadPath) entries[0] = {path:'/workspace/../escape',kind:'file',size_bytes:1,version:1,mode:0o644};
            if (state.fileBadSize) entries[0].size_bytes = null;
            return reply(res, 200, {entries:entries.slice(cursor,cursor+1),next_cursor:cursor+1<entries.length?String(cursor+1):null,...pageState});
          }
          if (req.method === 'POST' && parts[6] === 'intents') {
            if (parts.length === 7) {
              assert.equal(body.session_id,active?.data.session_id);
              assert.equal(body.control_revision,project.control.revision);
              assert.equal(body.writer_epoch,state.fileWriterEpoch ?? 1);
              assert.equal(body.part_size,partSize);
              assert.match(body.checksum,/^[0-9a-f]{32}-[1-9][0-9]*$/);
              let operation = project.fileOperations.get(body.operation_id);
              if (operation && !isDeepStrictEqual(operation.body,body)) return error(res,409,'idempotency_conflict','Input intent differs');
              if (!operation) {
                assert.equal(body.expected_project_revision,project.fileRevision);
                assert.equal(body.expected_version,0);
                operation = {body,state:'open',parts:new Map(),attempt_id:null};
                project.fileOperations.set(body.operation_id,operation);
              }
              if (state.drop === 'input-intent') { state.drop = null; req.socket.destroy(); return; }
              return reply(res,200,{state:operation.state,...(operation.version ? {version:operation.version} : {})});
            }
            const operation = project.fileOperations.get(parts[7]);
            if (!operation) return error(res,404,'not_found','File operation not found');
            if (parts.length === 9 && parts[8] === 'attempts') {
              if (operation.state === 'published') return reply(res,200,{state:'published',version:operation.version});
              operation.attempt_id ??= randomUUID();
              if (state.drop === 'input-attempt') { state.drop = null; req.socket.destroy(); return; }
              return reply(res,200,{state:'uploading',attempt_id:operation.attempt_id});
            }
            assert.equal(parts[9],operation.attempt_id);
            if (parts[10] === 'parts') {
              if (operation.state === 'published') return reply(res,200,{state:'published',version:operation.version});
              const remaining = Math.max(0,operation.body.size_bytes-(body.number-1)*partSize);
              const grant = new URL(`http://127.0.0.1:${server.address().port}/__part/${project.id}/${parts[7]}/${parts[9]}/${body.number}`);
              grant.searchParams.set('signature','private-transfer-grant');
              return reply(res,200,{upload_url:grant.href,upload_method:'PUT',upload_headers:{
                'Content-Length':String(Math.min(partSize,remaining)),'Content-MD5':body.md5},expires_in:900});
            }
            assert.equal(parts[10],'complete');
            if (operation.state !== 'published') {
              const count = Math.max(1,Math.ceil(operation.body.size_bytes/partSize));
              assert.equal(operation.parts.size,count);
              const bytes = Buffer.concat(Array.from({length:count},(_,index) => operation.parts.get(index+1)));
              assert.equal(bytes.length,operation.body.size_bytes);
              assert.equal(fileChecksum(bytes),operation.body.checksum);
              project.files.set(operation.body.path,bytes);
              operation.version = ++project.fileRevision;
              operation.state = 'published';
            }
            if (state.drop === 'input-complete') { state.drop = null; req.socket.destroy(); return; }
            return reply(res,200,{state:'published',version:operation.version});
          }
          assert.equal(req.method, 'POST');
          assert.equal(parts[6], 'presign');
          assert.deepEqual(Object.keys(body), ['path']);
          const file = project.files.get(body.path);
          if (!file) return error(res, 404, 'not_found', 'File not found');
          const grant = new URL(`http://127.0.0.1:${server.address().port}/__object/${project.id}`);
          grant.searchParams.set('path',body.path);
          grant.searchParams.set('signature','private-transfer-grant');
          return reply(res, 200, {path:state.fileBadGrant?'/workspace/other':body.path,size_bytes:file.length,
            version:1,checksum:state.fileBadChecksum?'00000000000000000000000000000000-1':fileChecksum(file),
            part_size:partSize,mode:0o644,download_url:grant.href,expires_at:new Date(Date.now()+900000).toISOString()});
        }
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
          if (state.bumpResume) { state.bumpResume = false; project.control.revision++; project.control.human_resume_required = true; }
          if (project.control.human_resume_required) return held(res, project);
          if (state.legacyResume) return error(res, 409, 'checkpoint_required', 'Legacy server requires a checkpoint');
          if (body.expected_control_revision !== project.control.revision) return error(res, 409, 'control_revision_conflict', 'Project control changed');
          if (history.some(s => s.data.state === 'closing')) return error(res, 409, 'session_cleanup_pending', 'Cleanup pending');
          if (history.some(s => !['closed', 'failed'].includes(s.data.state))) return error(res, 409, 'project_session_active', 'Session active');
          assert.equal(Object.hasOwn(body, 'restore'), false);
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
      if (parts[5] === 'finish') {
        if (req.method === 'GET') {
          if (!session.finish) return error(res,404,'finish_not_found','Finish not found');
          if (state.finishAutoComplete && session.finish.phase !== 'completed') {
            Object.assign(session.finish,{phase:'completed',execution:'succeeded',drain:'saved',
              durability:state.finishFailure ? 'failed' : 'saved',release:'released',termination:'finished'});
            session.data.state = 'closed';
            if (!session.released) { session.released = true; state.releases++; }
          }
          return reply(res,200,session.finish);
        }
        state.finishPosts++;
        if (session.finish && (session.finish.operation_id !== body.operation_id || session.finishTimeout !== body.timeout_seconds)) {
          return error(res,409,'idempotency_conflict','Finish request differs');
        }
        if (!session.finish) {
          const created = Date.now();
          session.finishTimeout = body.timeout_seconds;
          session.finish = {operation_id:body.operation_id,session_id:session.data.session_id,
            created_at:new Date(created).toISOString(),deadline_at:new Date(created + body.timeout_seconds*1000).toISOString(),
            budget_deadline_at:null,phase:'draining',selected_command_ids:[],execution:'pending',drain:'pending',
            durability:'pending',release:'pending',termination:null};
        }
        if (state.drop === 'finish') { state.drop = null; req.socket.destroy(); return; }
        return reply(res,202,session.finish);
      }
      if (parts[5] === 'inputs') {
        if (req.method === 'GET' && parts.length === 6) return reply(res,200,{inputs:[...session.inputs.values()]});
        if (req.method === 'GET') {
          if (direct && state.liveInputMissing) return error(res,404,'not_found','Input not found');
          const input = session.inputs.get(parts[6]);
          return input ? reply(res,200,input) : error(res,404,'not_found','Input not found');
        }
        const prior = session.inputRequests.get(body.input_id);
        if (prior && !isDeepStrictEqual(prior,body)) return error(res,409,'idempotency_conflict','Input request differs');
        let input = session.inputs.get(body.input_id);
        if (!prior) {
          input = {input_id:body.input_id,path:body.path,state:'ready',size_bytes:0};
          session.inputRequests.set(body.input_id,body);
          session.inputs.set(body.input_id,input);
          state.inputAdmissions++;
        }
        if (state.drop === 'direct-input') { state.drop = null; req.socket.destroy(); return; }
        return reply(res,202,input);
      }
      if (parts[5] === 'uploads') return error(res,426,'upgrade_required','Legacy uploads are unsupported');
      if (parts[5] === 'sync') {
        assert.ok(direct, 'sync must use the active-session transport');
        if (req.method === 'GET') {
          const operation = session.syncs.get(parts[6]);
          if (!operation) return error(res, 404, 'not_found', 'Sync not found');
          if (operation.state === 'pending' && operation.nextState) operation.state = operation.nextState;
          return reply(res, 200, operation);
        }
        assert.equal(req.method, 'POST');
        assert.equal(req.headers['idempotency-key'], body.sync_id);
        assert.ok(req.headers['x-request-id']);
        state.syncPosts++;
        let operation = session.syncs.get(body.sync_id);
        if (operation?.state === 'failed' && operation.error?.code !== 'final_sync_incomplete') {
          operation.state = state.syncMode === 'saved' ? 'saved' : 'pending';
          operation.error = null;
        }
        if (!operation) {
          if (session.data.state !== 'available') return error(res, 409, 'session_unready', 'Session not available');
          const mode = state.syncMode;
          operation = {sync_id:body.sync_id,state:mode.startsWith('pending')?'pending':mode === 'final_failed' ? 'failed' : mode,
            ...(mode === 'pending_then_saved' ? {nextState:'saved'} : {}),
            ...(mode === 'pending_then_failed' ? {nextState:'failed'} : {}),
            ...(mode.includes('failed') ? {error:{code:'file_sync_failed',message:'private-transfer-grant https://example.org/?signature=secret'},
              diagnostics:{files:[{path:'/workspace/result.txt',code:'file_revision_conflict'}],truncated:false}} : {}),
            ...(mode === 'final_failed' ? {error:{code:'final_sync_incomplete'}} : {})};
          session.syncs.set(body.sync_id,operation);
        }
        if (state.drop === 'sync') { state.drop = null; req.socket.destroy(); return; }
        return reply(res, 202, operation);
      }
      if (parts[5] === 'limit') {
        assert.equal(req.method, 'POST');
        if (['closing', 'closed', 'failed'].includes(session.data.state)) return error(res, 409, 'session_closing', 'Session closing');
        if (body.expected_limit_revision !== session.data.limit_revision) return error(res, 409, 'limit_revision_conflict', 'Limit changed');
        session.data.limit_revision++;
        if (state.applyLimit !== false) session.data.applied_limit_revision = session.data.limit_revision;
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
        if (state.commandFailures > 0) {
          state.commandFailures--;
          state.rejectedCommands++;
          return error(res,503,'runtime_unavailable','Temporarily unavailable');
        }
        let command = session.commands.get(body.command_id);
        if (command && !isDeepStrictEqual(command.request, body)) return error(res, 409, 'request_conflict', 'Command request differs');
        if (!command && state.pendingAdmission) {
          state.pendingAdmission = false;
          session.commands.set(body.command_id,{request:body,text:'',data:{...body,gpu_ids:body.gpu_ids ?? [],
            state:'pending',cancel_requested:false,exit_code:null,error:null}});
          return error(res,503,'admission_unconfirmed','Admission needs reconciliation');
        }
        if (command?.data.state === 'pending' && command.data.cancel_requested === false) {
          session.commands.delete(body.command_id);
          command = undefined;
        }
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
        if (direct && state.liveCommandMissing) return error(res,404,'command_not_found','Command not found');
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
        if (/Waiting\. Resume with:|Waiting for /.test(String(chunk))) pending.child.kill('SIGINT');
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

    const createArgs = ['forge', 'create', '--name', 'Recovery experiment', '--gpu', 'RTX5090', '--allowed-gpus', 'RTX5090,L40S', '--tools', 'boltz2,bindcraft2', '--priority', 'bindcraft2', '--max-gpu-hours', '2'];
    const lostCreate = await invoke(createArgs);
    const sessionId = lostCreate.stderr.match(/session_id: ([0-9a-f-]{36})/)[1];
    assert.equal(state.allocations, 1);
    assert.equal(state.posts, 2, 'same-ID session admission was not retried');
    assert.equal((await record(sessionId)).result.session_id, sessionId);
    const retryCreate = [...createArgs, '--session-id', sessionId];
    const accepted = await invoke(retryCreate);
    assert.equal(accepted.payload.data.session_id, sessionId);
    assert.equal(Object.hasOwn(accepted.payload.data, 'provider'), false);
    assert.equal(Object.hasOwn(state.sessions.get(sessionId).request, 'provider'), false);
    assert.equal(state.sessions.get(sessionId).request.gpu_type, 'RTX5090');
    assert.deepEqual(state.sessions.get(sessionId).request.allowed_gpus, ['RTX5090', 'L40S']);
    assert.deepEqual((await record(sessionId)).request.body.allowed_gpus, ['RTX5090', 'L40S']);
    assert.equal(state.sessions.get(sessionId).request.gpu_count, 1);
    assert.equal(state.sessions.get(sessionId).request.max_gpu_hours, 2);
    assert.equal(state.allocations, 1, 'retry allocated another VM');
    assert.equal((await record(sessionId)).project_id, accepted.payload.data.project_id);
    const listedOperations = (await invoke(['forge','operations'])).payload.data;
    assert.ok(listedOperations.operations.some(item => item.operation_id === sessionId && item.kind === 'session'));
    assert.equal((await invoke(['forge','operations'],{actorKey:'arx_forge_othercredential'})).payload.data.operations.length,0);
    assert.equal((await invoke(['forge','recover',sessionId])).payload.data.session_id, sessionId);
    assert.equal(state.allocations, 1, 'saved recovery allocated another VM');
    await invoke(['forge','recover',sessionId], {code:1, actorKey:'arx_forge_othercredential'});
    await invoke(['forge','recover',randomUUID()], {code:1});
    await invoke([...retryCreate, '--gpu', 'A100'], { code: 7 });
    await invoke(retryCreate, { code: 1, actorKey: 'arx_forge_othercredential' });
    // A second origin must not receive a mutation for a saved identity.
    const alternate = await boundary(root);
    try {
      await invoke(retryCreate, { code: 1, origin: alternate.origin });
      await invoke(['forge','recover',sessionId], {code:1, origin:alternate.origin});
      assert.equal((await invoke(['forge','operations'],{origin:alternate.origin})).payload.data.operations.length,0);
      assert.equal(alternate.state.posts, 0);
    } finally { await alternate.close(); }
    const postsBeforeWait = state.posts;
    await invoke(['forge', 'status', sessionId], { code: 4, actorKey: 'arx_forge_othercredential' });
    assert.equal((await invoke(['forge', 'list'])).payload.data.sessions.length, 1);
    assert.equal((await invoke(['forge', 'status', sessionId])).payload.data.state, 'starting');
    assert.equal((await invoke(['forge', 'tools', sessionId])).payload.data.tools[0].state, 'queued');
    const waiting = await invoke(['forge', 'tools', 'wait', sessionId, 'base', '--timeout', '0.05'], { code: 9 });
    assert.match(waiting.payload.error.message, /remote work continues/);
    assert.equal(state.posts, postsBeforeWait, 'tool wait performed a mutation');
    const session = state.sessions.get(sessionId);
    session.data.state = 'available';
    session.data.tools[0].state = 'ready';
    assert.equal((await invoke(['forge', 'tools', 'wait', sessionId, 'base', '--timeout', '30'])).payload.data.state, 'ready');
    session.data.tools[1].state = 'failed';
    session.data.tools[1].error = { code: 'install_failed', message: 'Model download failed' };
    assert.equal((await invoke(['forge', 'tools', 'wait', sessionId, 'boltz2'], { code: 10 })).payload.error.code, 'tool_failed');
    assert.equal((await invoke(['forge', 'run', sessionId, '--tool', 'boltz2', '--', process.execPath, '-e', 'process.exit(0)'], { code: 7 })).payload.error.code, 'tool_unready');
    const failedReadiness = await invoke(['forge','run',sessionId,'--tool','boltz2','--wait-ready',
      '--wait-timeout','15','--',process.execPath,'-e','process.exit(0)'], {code:10});
    assert.equal(failedReadiness.payload.error.code,'tool_failed');
    assert.equal(state.executions,0,'failed tool readiness dispatched science');

    state.drop = 'tools';
    const selectionArgs = ['forge', 'tools', 'add', sessionId, '--tools', 'boltz2', '--priority', 'boltz2'];
    const lostSelection = await invoke(selectionArgs);
    const selectionId = lostSelection.stderr.match(/selection_id: ([0-9a-f-]{36})/)[1];
    const retrySelection = [...selectionArgs, '--selection-id', selectionId];
    assert.equal((await record(selectionId)).result.selection_id, selectionId);
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
    const lostRun = await invoke(runArgs);
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
    const directTimeout = await invoke(['forge','command',sessionId,longId,'--timeout','50'], {code:9});
    assert.match(directTimeout.payload.error.message,/50ms/);
    state.holdReads = false;
    assert.equal((await invoke(['forge', 'command', sessionId, longId])).payload.data.state, 'running');
    state.unknown = true;
    const uncertain = await invoke(['forge', 'command', sessionId, longId]);
    assert.equal(uncertain.payload.data.state, 'unknown');
    assert.match(uncertain.stderr, /same command ID.*outcome is known/);
    const beforeUncertainRecovery = state.posts;
    assert.equal((await invoke(['forge','recover',longId])).payload.data.state,'unknown');
    state.liveCommandMissing = true;
    assert.equal((await invoke(['forge','recover',longId])).payload.data.command_id,longId);
    state.liveCommandMissing = false;
    await invoke(['forge','recover',longId,'--wait','--wait-timeout','0.05'], {code:9});
    assert.equal(state.posts,beforeUncertainRecovery,'recovery replayed an uncertain accepted command');
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
    const beforeFailedRecovery = state.posts;
    const failedRecovery = await invoke(['forge','recover',failedId,'--wait'], {code:10});
    assert.equal(failedRecovery.payload.error.code,'command_failed');
    assert.equal(state.posts,beforeFailedRecovery,'failed science was replayed');

    const connectionsBeforeRefresh = state.connects;
    state.rejectPost401 = 1;
    const refreshed = await invoke(['forge','run',sessionId,'--tool','base','--wait','--wait-timeout','15',
      '--',process.execPath,'-e','process.exit(0)']);
    assert.equal(refreshed.payload.data.state,'succeeded');
    assert.equal(state.rejectedPost401,1);
    assert.equal(state.connects,connectionsBeforeRefresh + 1,'a rejected session connection was not refreshed');

    const beforePendingAdmission = state.executions;
    state.pendingAdmission = true;
    const admitted = await invoke(['forge','run',sessionId,'--tool','base','--wait','--wait-timeout','15',
      '--',process.execPath,'-e','process.exit(0)']);
    assert.equal(admitted.payload.data.state,'succeeded');
    assert.equal(state.executions,beforePendingAdmission + 1,'pending admission did not start exactly once');
    const vanishedId = admitted.payload.data.command_id, beforeVanished = state.posts;
    session.commands.delete(vanishedId);
    assert.equal((await invoke(['forge','recover',vanishedId],{code:7})).payload.error.code,'command_unconfirmed');
    assert.equal(state.posts,beforeVanished,'a previously observed command was restarted after history disappeared');

    const beforeExhaustion = state.executions;
    state.commandFailures = 3;
    const exhausted = await invoke(['forge','run',sessionId,'--tool','base','--',process.execPath,'-e','process.exit(0)'],{code:10});
    const exhaustedId = exhausted.stderr.match(/command_id: ([0-9a-f-]{36})/)[1];
    assert.equal(state.rejectedCommands,3,'automatic transient retries were not bounded');
    assert.equal(state.executions,beforeExhaustion);
    assert.equal((await invoke(['forge','recover',exhaustedId,'--wait','--wait-timeout','15'])).payload.data.state,'succeeded');
    assert.equal(state.executions,beforeExhaustion + 1,'saved request was not recovered exactly once');

    const interruptedId = randomUUID();
    session.data.tools[0].state = 'queued';
    const beforeInterrupt = state.executions;
    await invoke(['forge','run',sessionId,'--tool','base','--command-id',interruptedId,'--wait-ready',
      '--wait-timeout','15','--',process.execPath,'-e','process.exit(0)'], {code:130,interrupt:true});
    assert.equal(state.executions,beforeInterrupt,'interrupting a readiness wait dispatched work');
    assert.deepEqual((await record(interruptedId)).readiness,{input_ids:[]});
    session.data.tools[0].state = 'ready';

    state.cleanupBlocked = true;
    const closing = await invoke(['forge', 'close', sessionId]);
    assert.equal(closing.payload.data.state, 'closing');
    const closeId = closing.stderr.match(/request_id: ([0-9a-f-]{36})/)[1];
    await invoke(['forge','recover',closeId,'--wait','--wait-timeout','1'],{code:9});
    assert.equal(state.releases, 0);
    state.cleanupBlocked = false;
    assert.equal((await invoke(['forge','recover',closeId,'--wait'])).payload.data.state,'closed');
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
    assert.equal(Object.hasOwn((await record(secondId)).request.body, 'max_gpu_hours'), false);
    assert.equal(state.allocations, 2);
    await invoke(['forge', 'close', secondId]);
    assert.equal(state.releases, 2);

    // Simulate an accepted pre-upgrade request whose creation reply was lost.
    // Its authenticated journal and server intent agree, but contain no core
    // fallback. Recovery must preserve that request without renting again.
    const legacy = await record(secondId);
    legacy.request.body.gpu_type = 'RTX5090';
    legacy.result = null;
    state.sessions.get(secondId).request.gpu_type = 'RTX5090';
    await fs.writeFile(path.join(root, '.ariax/forge', `${secondId}.json`), JSON.stringify(legacy), { mode: 0o600 });
    const recovered = await invoke(['forge', 'create', '--name', 'Second workspace', '--gpu', 'RTX5090', '--session-id', secondId]);
    assert.equal(recovered.payload.data.session_id, secondId);
    assert.equal(state.allocations, 2, 'legacy recovery rented another VM');
    await invoke(['forge', 'create', '--name', 'Second workspace', '--gpu', 'RTX5090', '--session-id', secondId], { code: 1, actorKey: 'arx_forge_othercredential' });
    const beforeCoreRejection = state.posts;
    const noncore = await invoke(['forge', 'create', '--name', 'Missing fallback', '--gpu', 'RTX5090'], { code: 5 });
    assert.match(noncore.payload.error.message, /no compatible core GPU/);
    assert.equal(state.posts, beforeCoreRejection, 'missing fallback sent an admission mutation');
    const finishSession = (await invoke(['forge','create','--name','Finish workspace','--gpu','L40'])).payload.data.session_id;
    state.sessions.get(finishSession).data.state = 'available';
    state.drop = 'finish';
    const waitingFinish = await invoke(['forge','finish',finishSession,'--timeout-seconds','120','--wait','--wait-timeout','1'],{code:9});
    const finishId = waitingFinish.stderr.match(/operation_id: ([0-9a-f-]{36})/)[1];
    assert.equal((await record(finishId)).request.body.timeout_seconds,120);
    assert.equal(state.sessions.get(finishSession).finish.phase,'draining');
    const finishPosts = state.finishPosts;
    assert.equal((await invoke(['forge','finish',finishSession])).payload.data.operation_id,finishId);
    assert.equal(state.finishPosts,finishPosts,'observing finish created another operation');
    state.finishAutoComplete = true;
    const completedFinish = await invoke(['forge','recover',finishId,'--wait','--wait-timeout','15']);
    assert.equal(completedFinish.payload.data.release,'released');
    assert.equal(completedFinish.payload.data.durability,'saved');
    assert.equal(state.sessions.get(finishSession).finish.operation_id,finishId);
    const failedSession = (await invoke(['forge','create','--name','Finish failure','--gpu','L40'])).payload.data.session_id;
    state.sessions.get(failedSession).data.state = 'available';
    state.finishFailure = true;
    const failedFinish = await invoke(['forge','finish',failedSession,'--wait','--wait-timeout','15'],{code:10});
    assert.equal(failedFinish.payload.error.code,'finish_incomplete');
    assert.equal(failedFinish.payload.error.details.finish.durability,'failed');
    assert.equal(failedFinish.payload.error.details.finish.release,'released');
    state.finishFailure = false;
    const webSession = (await invoke(['forge','create','--name','Existing finish','--gpu','L40'])).payload.data.session_id;
    state.sessions.get(webSession).data.state = 'available';
    const webFinishId = randomUUID(), now = Date.now();
    state.sessions.get(webSession).finish = {operation_id:webFinishId,session_id:webSession,
      created_at:new Date(now).toISOString(),deadline_at:new Date(now+60000).toISOString(),budget_deadline_at:null,
      phase:'draining',selected_command_ids:[],execution:'pending',drain:'pending',durability:'pending',release:'pending',termination:null};
    state.finishAutoComplete = false;
    const beforeWebFinish = state.finishPosts;
    const conflictingFinish = await invoke(['forge','finish',webSession,'--operation-id',randomUUID()],{code:7});
    assert.equal(conflictingFinish.payload.error.code,'idempotency_conflict');
    assert.equal(state.sessions.get(webSession).finish.operation_id,webFinishId);
    const afterConflict = state.finishPosts;
    const webWait = await invoke(['forge','finish',webSession,'--wait','--wait-timeout','1'],{code:9});
    assert.match(webWait.payload.error.message,new RegExp(`forge finish ${webSession}`));
    assert.doesNotMatch(webWait.payload.error.message,/no operation was sent/);
    assert.equal(state.finishPosts,afterConflict,'existing finish was recreated');
    assert.equal(afterConflict,beforeWebFinish+1);
    state.finishAutoComplete = true;
    assert.equal((await invoke(['forge','finish',webSession,'--wait'])).payload.data.release,'released');
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
  async function invoke(args, code = 0, human = false, actorKey = key) {
    let out;
    try { out = { code: 0, ...await execute(process.execPath, [script, human ? '--no-json' : '--json',
      '--root-dir', root, '--base-url', api.origin, ...args], { env:{...env,ARIAX_API_KEY:actorKey}, timeout: 60_000 }) }; }
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
    assert.equal((await record(sid)).request.body.files_contract,2);
    const legacyId = randomUUID(), legacy = await record(sid);
    legacy.id = legacyId;
    legacy.request.body.session_id = legacyId;
    delete legacy.request.body.files_contract;
    await fs.writeFile(path.join(root,'.ariax/forge',`${legacyId}.json`),JSON.stringify(legacy));
    const beforeLegacy = state.posts;
    const legacyReplay = await invoke(['forge','create','--name','Device experiment','--gpu','L40','--session-id',legacyId],7);
    assert.equal(legacyReplay.payload.error.code,'upgrade_required');
    assert.equal(state.posts,beforeLegacy,'legacy admission was silently replayed');

    const emptyPath = path.join(root,'empty-input'), multiPath = path.join(root,'multipart-input');
    await fs.writeFile(emptyPath,Buffer.alloc(0));
    await fs.writeFile(multiPath,Buffer.alloc(partSize + 23,0x61));
    const emptyId = randomUUID();
    const empty = await invoke(['forge','inputs','add',sid,'--file',emptyPath,'--path','harness/empty','--input-id',emptyId]);
    assert.equal(empty.payload.data.storage_state,'published');
    assert.equal(empty.payload.data.state,'pending');
    assert.equal(empty.payload.data.installation_status,'unconfirmed');
    assert.equal(project.files.get('/inputs/harness/empty').length,0);
    assert.equal((await invoke(['forge','inputs','status',sid,emptyId])).payload.data.state,'pending');
    await invoke(['forge','inputs','status',sid,emptyId],4,false,'arx_forge_othercredential');
    assert.ok((await invoke(['forge','inputs','list',sid])).payload.data.inputs.some(item => item.input_id === emptyId));
    state.pendingInstall = true;
    assert.equal((await invoke(['forge','inputs','status',sid,emptyId])).payload.data.installation_status,'pending');
    state.pendingInstall = false;
    state.conflictInstall = true;
    assert.equal((await invoke(['forge','inputs','status',sid,emptyId])).payload.data.state,'failed');
    state.conflictInstall = false;
    state.noFileWriter = true;
    assert.equal((await invoke(['forge','inputs','status',sid,emptyId])).payload.data.state,'pending');
    state.noFileWriter = false;
    state.confirmInstall = true;
    assert.equal((await invoke(['forge','inputs','status',sid,emptyId])).payload.data.state,'ready');
    assert.equal((await invoke(['forge','inputs','list',sid])).payload.data.inputs.find(item => item.input_id === emptyId).state,'ready');
    state.fileWriterEpoch = 2;
    assert.equal((await invoke(['forge','inputs','status',sid,emptyId])).payload.data.state,'pending');
    state.fileWriterEpoch = 1;
    state.confirmInstall = false;
    const collisionId = randomUUID();
    session.inputs.set(collisionId,{input_id:collisionId,path:'collision.txt',state:'ready',size_bytes:0});
    session.inputRequests.set(collisionId,{input_id:collisionId,path:'collision.txt',source:{kind:'artifact',project_id:pid,path:'different.txt'}});
    const conflictingInput = await invoke(['forge','inputs','add',sid,'--artifact',`${pid}:artifact.txt`,
      '--path','collision.txt','--input-id',collisionId],7);
    assert.equal(conflictingInput.payload.error.code,'idempotency_conflict');
    state.drop = 'direct-input';
    const beforeArtifact = state.inputAdmissions;
    const artifact = await invoke(['forge','inputs','add',sid,'--artifact',`${pid}:artifact.txt`,'--path','artifact.txt']);
    assert.equal(artifact.payload.data.state,'ready');
    assert.equal(state.inputAdmissions,beforeArtifact + 1,'lost input response caused a duplicate import');
    assert.equal((await invoke(['forge','inputs','status',sid,artifact.payload.data.input_id])).payload.data.state,'ready');
    const artifactPosts = state.posts;
    assert.equal((await invoke(['forge','recover',artifact.payload.data.input_id])).payload.data.state,'ready');
    assert.equal(state.posts,artifactPosts,'an accepted input import was repeated');
    state.liveInputMissing = true;
    assert.equal((await invoke(['forge','recover',artifact.payload.data.input_id])).payload.meta.source,'retained');
    assert.equal((await invoke(['forge','recover',artifact.payload.data.input_id,'--wait'],7)).payload.error.code,'input_unavailable');
    assert.equal(state.posts,artifactPosts,'retained input was imported again');
    state.liveInputMissing = false;
    const artifactRecord = session.inputs.get(artifact.payload.data.input_id);
    artifactRecord.path = 'other.txt';
    assert.equal((await invoke(['forge','recover',artifact.payload.data.input_id],7)).payload.error.code,'request_conflict');
    artifactRecord.path = 'artifact.txt';
    const remote = await invoke(['forge','inputs','add',sid,'--url','https://example.org/input.dat','--path','remote.dat']);
    assert.equal(remote.payload.data.state,'ready');
    const urlId = remote.payload.data.input_id;
    assert.doesNotMatch(JSON.stringify(await record(urlId)),/example\.org/);
    session.inputs.delete(urlId);
    const urlPosts = state.posts;
    assert.equal((await invoke(['forge','recover',urlId],7)).payload.error.code,'input_unconfirmed');
    const unacceptedUrl = await record(urlId), unacceptedUrlId = randomUUID();
    unacceptedUrl.id = unacceptedUrlId;
    unacceptedUrl.request.body.input_id = unacceptedUrlId;
    unacceptedUrl.result = null;
    await fs.writeFile(path.join(root,'.ariax/forge',`${unacceptedUrlId}.json`),JSON.stringify(unacceptedUrl),{mode:0o600});
    assert.match((await invoke(['forge','recover',unacceptedUrlId],1)).payload.error.message,/original URL.*not saved/);
    assert.equal(state.posts,urlPosts,'recovery invented an unavailable URL');
    await invoke(['forge','recover',emptyId],1,false,'arx_forge_othercredential');
    const publishedPosts = state.posts;
    await fs.rename(emptyPath,`${emptyPath}.moved`);
    assert.equal((await invoke(['forge','recover',emptyId])).payload.data.storage_state,'published');
    await fs.rename(`${emptyPath}.moved`,emptyPath);
    assert.equal(state.posts,publishedPosts,'published input required a source or repeated an upload');
    const emptyOperation = project.fileOperations.get(emptyId);
    emptyOperation.state = 'open';
    await fs.writeFile(emptyPath,'changed');
    const beforeChangedSource = state.posts;
    assert.equal((await invoke(['forge','recover',emptyId],7)).payload.error.code,'request_conflict');
    assert.equal(state.posts,beforeChangedSource,'changed input bytes were uploaded under the old ID');
    await fs.writeFile(emptyPath,Buffer.alloc(0));
    emptyOperation.state = 'published';
    for (const loss of ['input-intent','input-attempt','input-put','input-complete']) {
      const id = randomUUID(), target = `harness/${loss}`;
      const args = ['forge','inputs','add',sid,'--file',multiPath,'--path',target,'--input-id',id];
      state.drop = loss;
      const lost = await invoke(args);
      assert.doesNotMatch(lost.stdout+lost.stderr,/private-transfer-grant|signature=/);
      const retried = await invoke(args);
      assert.equal(retried.payload.data.state,'pending');
      assert.equal(retried.payload.data.storage_state,'published');
      assert.deepEqual(project.files.get(`/inputs/${target}`),await fs.readFile(multiPath));
      const journal = await record(id);
      assert.match(journal.request.body.checksum,/-2$/);
      assert.doesNotMatch(JSON.stringify(journal),/private-transfer-grant|signature=|upload_url|upload_headers/);
    }
    project.files.set('/workspace/source.dat',Buffer.from('original'));
    const copyId = randomUUID();
    state.drop = 'file-copy';
    const copy = await invoke(['forge','files','recover',pid,'--path','/workspace/copied.dat',
      '--catalog',`${pid}:/workspace/source.dat`,'--version','1','--operation-id',copyId]);
    assert.equal(copy.payload.data.storage_state,'published');
    assert.equal(copy.payload.data.state,'pending');
    assert.equal((await record(copyId)).request.body.source.version,1);
    state.copyInstall = true;
    const copyPosts = state.copyPosts;
    assert.equal((await invoke(['forge','recover',copyId,'--wait'])).payload.data.state,'ready');
    assert.equal(state.copyPosts,copyPosts,'published recovery was copied again');
    await invoke(['forge','files','recover',pid,'--path','/workspace/copied.dat','--catalog',`${pid}:/workspace/source.dat`,
      '--version','2','--operation-id',copyId],7);
    assert.equal(state.copyPosts,copyPosts,'changed source reused a file recovery ID');
    await invoke(['forge','files','recover',pid,'--path','/workspace/copied.dat','--catalog',`${pid}:/workspace/source.dat`,'--version','1'],1);
    const overwritten = await invoke(['forge','files','recover',pid,'--path','/workspace/copied.dat',
      '--catalog',`${pid}:/workspace/source.dat`,'--version','1','--overwrite']);
    assert.equal(overwritten.payload.data.state,'ready');
    state.copyConflict = true;
    assert.equal((await invoke(['forge','recover',copyId],10)).payload.error.code,'file_recovery_failed');
    state.copyConflict = false;
    const archiveId = randomUUID();
    const archive = await invoke(['forge','files','recover',pid,'--path','/workspace/archive.dat',
      '--archive',`${pid}:${archiveId}:/workspace/old.dat`,'--wait']);
    assert.equal(archive.payload.data.source.checkpoint_id,archiveId);
    const managedProject = randomUUID();
    const artifactCopy = await invoke(['forge','files','recover',pid,'--path','/workspace/artifact.dat',
      '--artifact',`${managedProject}:output/file.cif`,'--wait']);
    assert.equal(artifactCopy.payload.data.source.kind,'artifact');
    assert.equal(artifactCopy.payload.data.source.project_id,managedProject);
    for (const item of ['/workspace/source.dat','/workspace/copied.dat','/workspace/archive.dat','/workspace/artifact.dat']) project.files.delete(item);
    state.copyInstall = false;
    const catalog = await invoke(['forge', 'catalog', '--details'], 0, true);
    assert.match(catalog.stdout, /sources:.*https:\/\/example.org\/boltz2/);
    assert.match(catalog.stdout, /models:.*boltz2/);
    const routed = await invoke(['forge', 'catalog', '--task', 'antibodies']);
    assert.deepEqual(routed.payload.data.tools.map(tool => tool.tool), ['bindcraft2']);
    const qualification = routed.payload.data.tools[0].capabilities.qualification[0];
    assert.equal(qualification.native, 'passed');
    assert.equal(qualification.installation, 'held');
    assert.equal(qualification.restoration, 'untested');
    const full = await invoke(['forge', 'catalog']);
    assert.equal(full.payload.data.tools.length, 4);
    const selected = await invoke(['forge', 'catalog', '--tool', 'bindcraft2']);
    assert.deepEqual(selected.payload.data.tools, full.payload.data.tools.filter(tool => tool.tool === 'bindcraft2'));
    assert.equal(selected.payload.data.tools[0].capabilities.qualification[1].scope, 'Not qualified');
    const selectedHuman = await invoke(['forge', 'catalog', '--tool', 'bindcraft2'], 0, true);
    assert.match(selectedHuman.stdout, /Not qualified/);
    assert.match(selectedHuman.stdout, /min_vram_gib_per_gpu/);
    const compact = await invoke(['forge', 'catalog', '--task', 'antibodies', '--tool', 'bindcraft2', '--compact']);
    assert.deepEqual(compact.payload.data.tools.map(tool => tool.tool), ['bindcraft2']);
    const compactTool = compact.payload.data.tools[0];
    assert.deepEqual(compactTool.resources, selected.payload.data.tools[0].resources);
    assert.deepEqual(compactTool.models[0].resources, selected.payload.data.tools[0].models[0].resources);
    assert.equal(compactTool.capabilities.guide, 'bindcraft2');
    assert.deepEqual(compactTool.capabilities.qualification, {
      rows: 2, native: ['passed', 'unknown'], installation: ['held', 'passed'], restoration: ['untested', 'held'],
    });
    assert.equal(Object.hasOwn(compactTool.capabilities.qualification, 'scope'), false);
    const noMatch = await invoke(['forge', 'catalog', '--task', 'molecular-prediction', '--tool', 'bindcraft2']);
    assert.deepEqual(noMatch.payload.data.tools, []);
    await invoke(['forge', 'catalog', '--tool', 'not-in-catalog'], 1);
    await invoke(['forge', 'catalog', '--compact', '--details'], 1);
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
    const lost = await invoke(request), cid = lost.stderr.match(/command_id: ([0-9a-f-]{36})/)[1];
    const retry = [...base, '--gpus', '0', '--command-id', cid, '--', ...native];
    await invoke(retry);
    assert.equal(state.executions, 1);
    assert.deepEqual((await record(cid)).request.body.gpu_ids, [0]);
    await invoke([...base, '--gpus', '1', '--command-id', cid, '--', ...native], 7);
    const occupied = await invoke([...base, '--gpus', '0,1', '--', ...native], 7);
    assert.equal(occupied.payload.error.code, 'gpu_busy');
    const parallel = await invoke([...base, '--gpus', '1', '--', ...native]);
    assert.equal(state.executions, 2);
    const capacityId = randomUUID();
    const capacity = await invoke([...base,'--gpus','0','--command-id',capacityId,'--wait-ready','--wait-timeout','1',
      '--',process.execPath,'-e','process.exit(0)'],9);
    assert.match(capacity.payload.error.message,/Local wait timed out/);
    assert.match(capacity.stderr,/Waiting for command readiness: gpu_busy/);
    assert.equal(state.executions,2,'busy GPU readiness launched another command');
    await invoke(['forge', 'cancel', sid, cid]);
    await invoke(['forge', 'watch', sid, cid, '--timeout', '30']);
    await invoke(['forge', 'cancel', sid, parallel.payload.data.command_id]);
    await invoke(['forge', 'watch', sid, parallel.payload.data.command_id, '--timeout', '30']);
    const capacityRecovery = await invoke(['forge','recover',capacityId,'--wait','--wait-timeout','15']);
    assert.equal(capacityRecovery.payload.data.state,'succeeded');
    assert.equal(state.executions,3,'saved capacity wait did not dispatch exactly once');
    const savedName = 'control result ?+.txt';
    const multiple = await invoke([...base, '--gpus', '1,0', '--', process.execPath, '-e',
      'require("node:fs").writeFileSync(process.argv[1], "saved command output"); console.log("explicit devices")', savedName]);
    assert.deepEqual(multiple.payload.data.gpu_ids, [1, 0]);
    await invoke(['forge', 'watch', sid, multiple.payload.data.command_id, '--timeout', '30']);
    const inputWaitId = randomUUID(), beforeInputWait = state.executions;
    const inputWait = await invoke(['forge','run',sid,'--tool','base','--command-id',inputWaitId,'--wait-ready',
      '--input-ids',emptyId,'--wait-timeout','1','--',process.execPath,'-e',
      'if (require("node:fs").readFileSync(process.argv[1]).length !== 0) process.exit(23)',
      path.join(root,'inputs/harness/empty')],9);
    assert.match(inputWait.payload.error.message,/Local wait timed out/);
    assert.match(inputWait.stderr,/Waiting for input/);
    assert.deepEqual((await record(inputWaitId)).readiness,{input_ids:[emptyId]});
    assert.equal(state.executions,beforeInputWait,'unconfirmed input dispatched a command');
    state.confirmInstall = true;
    const inputRecovered = await invoke(['forge','recover',inputWaitId,'--wait','--wait-timeout','15']);
    assert.equal(inputRecovered.payload.data.state,'succeeded');
    const beforeRepeatRecovery = state.executions;
    assert.equal((await invoke(['forge','recover',inputWaitId,'--wait'])).payload.data.state,'succeeded');
    assert.equal(state.executions,beforeRepeatRecovery,'completed science was replayed');
    state.confirmInstall = false;
    state.confirmAfterReads = 2;
    const singleWait = await invoke(['forge','run',sid,'--tool','base','--wait-ready','--input-ids',emptyId,
      '--wait','--wait-timeout','15','--',process.execPath,'-e','process.exit(0)']);
    assert.match(singleWait.stderr,/Waiting for input/);
    assert.equal(singleWait.payload.data.state,'succeeded');
    assert.equal((await invoke(['forge','inputs','status',sid,emptyId])).payload.data.state,'ready');
    const inputConsumer = await invoke(['forge','run',sid,'--tool','base','--',process.execPath,'-e',
      'if (require("node:fs").readFileSync(process.argv[1]).length !== 0) process.exit(23)',
      path.join(root,'inputs/harness/empty')]);
    assert.equal((await invoke(['forge','watch',sid,inputConsumer.payload.data.command_id,'--timeout','30'])).payload.data.state,'succeeded');
    state.confirmInstall = false;

    state.drop = 'limit';
    const limitId = randomUUID();
    const edit = ['forge', 'limit', sid, '--gpu-hours', '12', '--operation-id',limitId];
    const lostLimit = await invoke(edit, 7);
    assert.equal(lostLimit.payload.error.code, 'limit_revision_conflict');
    assert.match(lostLimit.payload.error.action, /limit_revision/);
    assert.equal((await record(limitId)).request.body.expected_limit_revision,0);
    const limitRecovery = await invoke(['forge','recover',limitId],7);
    assert.match(limitRecovery.payload.error.action,new RegExp(`forge status ${sid}`));
    assert.match(limitRecovery.payload.error.action,/does not establish/);
    const capped = (await invoke(['forge', 'status', sid])).payload.data;
    assert.equal(capped.limit_revision, 1);
    assert.equal(capped.control.revision, 0);
    assert.equal(capped.max_gpu_hours, 12);
    assert.equal(Date.parse(capped.expires_at) - Date.parse(capped.allocated_at), 6 * 3600000);
    assert.equal((await invoke(edit, 7)).payload.error.code, 'limit_revision_conflict');
    await invoke(['forge', 'limit', sid, '--gpu-hours', '4']);
    assert.equal(Date.parse(session.data.expires_at) - Date.parse(session.data.allocated_at), 2 * 3600000);
    state.applyLimit = false;
    const pending = await invoke(['forge', 'limit', sid, '--clear', '--limit-revision', '2'], 0, true);
    assert.match(pending.stderr, /saved; host application is pending/);
    assert.match(pending.stderr, /previous deadline/);
    const pendingJson = (await invoke(['forge', 'status', sid])).payload.data;
    assert.equal(pendingJson.limit_revision, 3);
    assert.equal(pendingJson.applied_limit_revision, 2);
    session.data.applied_limit_revision = 3;
    const delivered = await invoke(['forge', 'status', sid], 0, true);
    assert.doesNotMatch(delivered.stderr, /host application is pending/);
    assert.equal(session.data.max_gpu_hours, null);
    assert.equal(session.data.expires_at, null);
    assert.equal(session.data.limit_revision, 3);
    await invoke(['forge', 'limit', sid, '--clear', '--gpu-hours', '4', '--limit-revision', '3'], 1);

    session.data.persistence = {state:'failed',error:{code:'upload_failed',
      message:'transfer https://storage.example/file?X-Amz-Signature=private-signature',
      download_url:'https://storage.example/file?X-Amz-Signature=private-signature',access_token:'private-token',token:'private-token'}};
    const redactedStatus = await invoke(['forge','status',sid]);
    assert.doesNotMatch(redactedStatus.stdout + redactedStatus.stderr,/private-signature|private-token|download_url|access_token/);
    assert.doesNotMatch(JSON.stringify(await record(sid)),/private-signature|private-token|download_url|access_token/);
    session.data.persistence = {state:'pending',error:null};

    const commandsBeforeSync = state.executions;
    state.syncMode = 'pending_then_saved';
    const flushed = await invoke(['forge','sync',sid,'--wait','--timeout','30']);
    assert.equal(flushed.payload.data.state,'saved');
    assert.equal(state.executions,commandsBeforeSync,'sync replayed a scientific command');
    state.syncMode = 'pending_then_failed';
    const syncFailure = await invoke(['forge','sync',sid,'--wait','--timeout','30'],10);
    assert.equal(syncFailure.payload.error.code,'sync_failed');
    assert.deepEqual(syncFailure.payload.error.details.diagnostics.files,[{path:'/workspace/result.txt',code:'file_revision_conflict'}]);
    assert.doesNotMatch(syncFailure.stdout + syncFailure.stderr,/private-transfer-grant|signature=/);
    const failedSyncId = syncFailure.stderr.match(/sync_id: ([0-9a-f-]{36})/)[1], failedSyncPosts = state.syncPosts;
    state.syncMode = 'saved';
    assert.equal((await invoke(['forge','recover',failedSyncId,'--wait'])).payload.data.state,'saved');
    assert.equal(state.syncPosts,failedSyncPosts + 1,'failed flush did not reuse the same ID');
    assert.equal(state.executions,commandsBeforeSync,'flush retry repeated scientific work');
    state.syncMode = 'final_failed';
    const finalFailure = await invoke(['forge','sync',sid],10);
    const finalSyncId = finalFailure.stderr.match(/sync_id: ([0-9a-f-]{36})/)[1], finalPosts = state.syncPosts;
    assert.equal((await invoke(['forge','recover',finalSyncId],10)).payload.error.code,'sync_failed');
    assert.equal(state.syncPosts,finalPosts,'final-save deadline was reopened');
    state.syncMode = 'pending';
    const pendingSync = await invoke(['forge','sync',sid]);
    assert.equal(pendingSync.payload.data.state,'pending');
    const syncId = pendingSync.payload.data.sync_id, beforeSyncWait = state.syncPosts;
    const syncTimeout = await invoke(['forge','sync',sid,'--sync-id',syncId,'--wait','--timeout','0.05'],9);
    assert.match(syncTimeout.payload.error.message,/remote work continues/);
    assert.equal(state.syncPosts,beforeSyncWait,'sync wait submitted another flush');
    session.syncs.get(syncId).state = 'saved';
    assert.equal((await invoke(['forge','sync',sid,'--sync-id',syncId,'--wait'])).payload.data.state,'saved');
    assert.equal(state.syncPosts,beforeSyncWait,'sync recovery resubmitted an accepted flush');
    session.syncs.delete(syncId);
    assert.equal((await invoke(['forge','recover',syncId],7)).payload.error.code,'sync_unconfirmed');
    assert.equal(state.syncPosts,beforeSyncWait,'a previously observed flush was restarted after history disappeared');
    state.syncMode = 'saved';
    state.drop = 'sync';
    const lostSync = await invoke(['forge','sync',sid]);
    const lostSyncId = lostSync.stderr.match(/sync_id: ([0-9a-f-]{36})/)[1];
    const afterLostSync = state.syncPosts;
    assert.equal((await invoke(['forge','sync',sid,'--sync-id',lostSyncId,'--wait'])).payload.data.state,'saved');
    assert.equal(state.syncPosts,afterLostSync,'uncertain accepted flush was duplicated');
    assert.equal(state.executions,commandsBeforeSync,'sync recovery replayed a scientific command');

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
    const heldOperation = randomUUID();
    session.data.tools[0].state = 'queued';
    await invoke(['forge','run',sid,'--tool','base','--command-id',heldOperation,'--wait-ready',
      '--wait-timeout','1','--',process.execPath,'-e','process.exit(0)'],9);
    session.data.tools[0].state = 'ready';
    const heldRecovery = await invoke(['forge','recover',heldOperation],7);
    assert.equal(heldRecovery.payload.error.code,'human_resume_required');
    assert.match(heldRecovery.payload.error.action,/Allow agent to resume/);
    assert.equal(state.executions,executions,'recovery bypassed the human stop');
    await invoke(['forge', 'close', sid]);
    const beforeOfflineCopy = state.copyPosts;
    const offlineCopy = await invoke(['forge','files','recover',pid,'--path','/workspace/offline.dat',
      '--artifact',`${managedProject}:output/retained.cif`,'--wait','--wait-timeout','15']);
    assert.equal(offlineCopy.payload.data.state,'saved');
    assert.equal(offlineCopy.payload.data.installation_status,'not_applicable');
    assert.equal(state.copyPosts,beforeOfflineCopy + 2,'offline copy did not advance with the same operation');
    assert.equal(state.allocations,allocations,'offline recovery allocated compute');
    project.files.delete('/workspace/offline.dat');
    const savedPath = `/workspace/${savedName}`;
    project.files.set(savedPath,await fs.readFile(path.join(root,savedName)));
    project.files.set('/workspace/another.txt',Buffer.from('another'));
    project.files.set('/inputs/source.txt',Buffer.from('input'));
    const inputListing = (await invoke(['forge','files',pid,'--path','/inputs'])).payload.data;
    assert.deepEqual(inputListing.entries.map(e => e.path),['/inputs/harness','/inputs/source.txt']);
    assert.equal(inputListing.entries[0].kind,'directory');
    assert.equal(inputListing.entries[0].size_bytes,null);
    assert.equal(inputListing.entries[0].mode,null);
    assert.equal(inputListing.mutation_revision,project.fileRevision);
    assert.equal(inputListing.sync_state,'saved');
    assert.equal(inputListing.durability_gap,false);
    const listed = (await invoke(['forge','files',pid,'--path','/workspace'])).payload.data;
    assert.equal(listed.entries.length,2, 'all pages were not fetched');
    assert.deepEqual(listed.entries.map(entry => entry.path).sort(), ['/workspace/another.txt',savedPath].sort());
    const destination = path.join(root,'downloaded-result.txt');
    const downloaded = await invoke(['forge','download',pid,savedPath,'--dest',destination]);
    assert.equal(await fs.readFile(destination,'utf8'),'saved command output');
    assert.doesNotMatch(downloaded.stdout + downloaded.stderr,/private-transfer-grant|download_url|signature=/);
    state.fileBadChecksum = true;
    const corruptedDest = path.join(root,'bad-checksum');
    await invoke(['forge','download',pid,savedPath,'--dest',corruptedDest],10);
    await assert.rejects(fs.access(corruptedDest));
    state.fileBadChecksum = false;
    await invoke(['forge','download',pid,savedPath,'--dest',path.join(root,'forbidden')],4,false,'arx_forge_othercredential');
    const linked = (await invoke(['forge', 'link', pid, savedPath])).payload.data;
    const savedUrl = new URL(linked.url);
    assert.equal(savedUrl.pathname, `/projects/forge/${pid}`);
    assert.equal(savedUrl.searchParams.get('session'), null);
    assert.equal(savedUrl.searchParams.get('checkpoint'), null);
    assert.equal(savedUrl.searchParams.get('path'), savedPath);
    assert.equal(linked.size_bytes, project.files.get(savedPath).length);
    assert.doesNotMatch(JSON.stringify(linked), /private-transfer-grant|download_url|signature=/);
    state.fileError = true;
    const fileFailure = await invoke(['forge','download',pid,savedPath,'--dest',path.join(root,'error')],10);
    assert.equal(fileFailure.payload.error.code,'storage_unavailable');
    assert.equal(fileFailure.payload.request_id,'request-fixture-1');
    assert.doesNotMatch(fileFailure.stdout + fileFailure.stderr,/private-transfer-grant|signature=|https:\/\/example.org/);
    state.fileError = false;
    state.fileBadPath = true;
    await invoke(['forge','files',pid],9);
    state.fileBadPath = false;
    state.fileBadSize = true;
    await invoke(['forge','files',pid],9);
    state.fileBadSize = false;
    state.fileCursorCycle = true;
    await invoke(['forge','files',pid],9);
    state.fileCursorCycle = false;
    state.fileBadGrant = true;
    await invoke(['forge','link',pid,savedPath],9);
    state.fileBadGrant = false;
    const formerSession = await invoke(['forge','files',sid],4);
    assert.match(formerSession.payload.error.action,/PROJECT ID.*SESSION form is unsupported/);
    for (const unsafe of ['/etc/passwd','/workspace/../bad','/workspace//bad','/workspace/./bad','/workspace/','/workspace/..\\bad']) {
      await invoke(['forge','link',pid,unsafe],1);
    }
    const resume = ['forge', 'resume', pid, '--control-revision', '1', '--gpu', 'L40', '--gpu-count', '2', '--tools', 'boltz2'];
    const heldResume = await invoke(resume, 7);
    assert.match(heldResume.payload.error.action, new RegExp(`/projects/forge/${pid}`));
    const automaticHeld = await invoke(['forge','resume',pid,'--gpu','L40'],7);
    assert.equal(automaticHeld.payload.error.code,'human_resume_required');
    const removed = await invoke(['forge', 'resume', pid, '--restore-session', sid, '--checkpoint', randomUUID(),
      '--control-revision', '1', '--gpu', 'L40'], 1);
    assert.match(removed.payload.error.message, /no longer supported.*current project workspace/);
    for (const args of [['checkpoints',sid],['checkpoint',sid,randomUUID()],['files',pid,'--checkpoint',randomUUID()],
      ['sync',sid,'--checkpoint-id',randomUUID()]]) {
      const rejected = await invoke(['forge',...args],1);
      assert.match(rejected.payload.error.message,/no longer supported/);
    }
    assert.equal(state.allocations, allocations, 'a human hold allocated compute');
    assert.equal(state.projects.size, 1, 'held resume created a replacement project');
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
    const raceId = randomUUID();
    state.bumpResume = true;
    const raced = await invoke(['forge','resume',pid,'--gpu','L40','--session-id',raceId],7);
    assert.equal(raced.payload.error.code,'human_resume_required');
    assert.equal((await record(raceId)).request.body.expected_control_revision,2);
    assert.equal(state.allocations,allocations);
    project.control.human_resume_required = false;
    project.control.revision = 4;
    assert.equal((await invoke(['forge','recover',raceId],7)).payload.error.code,'control_revision_conflict');
    assert.equal((await record(raceId)).request.body.expected_control_revision,2,'recovery refreshed a fenced revision');
    const approved = ['forge','resume',pid,'--gpu','L40','--gpu-count','2','--tools','boltz2'];
    state.legacyResume = true;
    const legacyServer = await invoke(approved,7);
    assert.match(legacyServer.payload.error.action,/removed Forge checkpoint contract.*Upgrade/);
    state.legacyResume = false;
    assert.equal(state.allocations,allocations,'legacy-server rejection allocated compute');
    state.drop = 'resume';
    const lostResume = await invoke(approved), resumedId = lostResume.stderr.match(/session_id: ([0-9a-f-]{36})/)[1];
    assert.equal((await record(resumedId)).result.session_id, resumedId);
    const retryResume = [...approved, '--session-id', resumedId];
    const resumed = await invoke(retryResume);
    assert.equal(resumed.payload.data.project_id, pid);
    assert.equal(resumed.payload.data.name, 'Device experiment');
    assert.equal(resumed.payload.data.max_gpu_hours, null, 'resume inherited an old session cap');
    assert.equal((await record(resumedId)).request.body.expected_control_revision, 4);
    assert.equal((await record(resumedId)).request.body.name, undefined);
    assert.equal(Object.hasOwn((await record(resumedId)).request.body,'restore'),false);
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
