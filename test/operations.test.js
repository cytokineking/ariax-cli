import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createOperation, listOperations, loadOperation, operationPath, updateOperation, sourceIdentity, waitForOperation } from '../src/operations.js';
import { run as submit } from '../src/commands/submit.js';
import { run as recover } from '../src/commands/recover.js';
import { run as restart } from '../src/commands/restart.js';
import { loadResume, saveResume, clearResume } from '../src/resume.js';
import { NetworkError, ApiError } from '../src/http.js';

const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const project = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const serverId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const account = { actor_user_id: actor, billing_account_type: 'user', billing_account_id: actor, api_origin: 'https://www.ariax.bio' };
const roots = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));
function context() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-operation-test-'));
  roots.push(rootDir);
  const file = path.join(rootDir, 'job.json');
  fs.writeFileSync(file, '{"protocol":"fixture","value":1}');
  return { config: { rootDir, baseUrl: account.api_origin }, flags: { file, name: 'fixture' }, positionals: [], json: true,
    client: { get: async (url) => {
      if (url === '/api/v1/me') return { data: { actor: { user_id: actor }, billing: { account_type: 'user', account_id: actor } } };
      throw new ApiError({ status: 404, message: 'not found' });
    } } };
}
function record(ctx, extra = {}) {
  return createOperation(ctx, { action: 'project:create', account,
    request: { method: 'POST', path: '/api/v1/projects', body: { name: 'fixture' } }, ...extra });
}
function remote(state = 'completed', extra = {}) {
  return { operation_id: serverId, action: 'project:create', state, project_id: state === 'completed' ? project : null,
    job_id: null, response_status: state === 'completed' ? 201 : null, result: null, error: null,
    expires_at: new Date(Date.now() + 86400000).toISOString(), replay_allowed: false, ...extra };
}
function recoveryContext(ctx, id) { return { ...ctx, flags: {}, positionals: [id] }; }

it('journals before a lost response and explicitly replays the identical key and request when absent', async () => {
  const ctx = context();
  const attempts = [];
  ctx.client.post = async (url, opts) => {
    const stored = listOperations(ctx.config.rootDir)[0];
    assert.equal(stored.idempotency_key, opts.idempotencyKey);
    assert.deepEqual(stored.request, { method: 'POST', path: url, body: opts.body });
    attempts.push(opts);
    if (attempts.length === 1) throw new NetworkError('reply lost before server received request');
    return { status: 201, data: { project_id: project, status: 'pending' } };
  };
  await assert.rejects(submit(ctx), /Recover with: ariax recover/);
  const saved = listOperations(ctx.config.rootDir)[0];
  await recover(recoveryContext(ctx, saved.id));
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[1], attempts[0]);
  assert.equal(loadOperation(ctx.config.rootDir, saved.id).project_id, project);
});

it('reconciles a lost response after creation without another mutation, even if source was later removed', async () => {
  const ctx = context();
  let posts = 0;
  ctx.client.post = async () => { posts++; throw new NetworkError('reply lost after creation'); };
  await assert.rejects(submit(ctx));
  const saved = listOperations(ctx.config.rootDir)[0];
  fs.unlinkSync(ctx.flags.file);
  const get = ctx.client.get;
  ctx.client.get = async (url) => url.includes('/operations/') ? { data: remote() } : get(url);
  await recover(recoveryContext(ctx, saved.id));
  assert.equal(posts, 1);
  assert.equal(loadOperation(ctx.config.rootDir, saved.id).state, 'completed');
});

it('reports a reconciled failed operation as terminal and never retries its mutation', async () => {
  const ctx = context();
  const saved = record(ctx);
  let posts = 0;
  const get = ctx.client.get;
  ctx.client.get = async (url) => url.includes('/operations/') ? { data: remote('failed', {
    response_status: 503,
    error: { code: 'dependency_failure', message: 'Compute service is unavailable', retryable: true },
  }) } : get(url);
  ctx.client.post = async () => { posts++; throw new Error('must not send'); };

  await assert.rejects(recover(recoveryContext(ctx, saved.id)), (error) => {
    assert.equal(error.code, 'dependency_failure');
    assert.equal(error.status, 503);
    assert.equal(error.retryable, false);
    assert.match(error.message, new RegExp(`Operation ${saved.id} is terminal \\(state: failed\\)`));
    assert.match(error.message, /Retrying ariax recover cannot advance this operation/);
    return true;
  });
  assert.equal(posts, 0);
  assert.equal(loadOperation(ctx.config.rootDir, saved.id).state, 'failed');
});

it('handles 202 before a project ID and polls read-only through completion', async () => {
  const ctx = context();
  let posts = 0;
  ctx.client.post = async () => { posts++; return { status: 202, data: { operation_id: serverId, state: 'in_progress', project_id: null } }; };
  const out = await submit(ctx);
  assert.equal(out.projectId, null);
  assert.equal(listOperations(ctx.config.rootDir)[0].state, 'in_progress');
  const get = ctx.client.get;
  ctx.client.get = async (url) => url.includes('/operations/') ? { data: remote('in_progress') } : get(url);
  await recover(recoveryContext(ctx, out.operationId));
  assert.equal(posts, 1);
  let lookups = 0;
  ctx.client.get = async (url) => {
    if (url.includes('/operations/')) return { data: ++lookups === 1 ? remote('in_progress') : remote() };
    if (url.includes('/projects/')) return { data: { id: project, status: 'completed' } };
    return get(url);
  };
  await recover({ ...recoveryContext(ctx, out.operationId), flags: { wait: true } });
  assert.equal(posts, 1);
});

it('reuses an expired unstarted lease only when the server explicitly permits it', async () => {
  const ctx = context();
  const saved = record(ctx);
  const get = ctx.client.get;
  ctx.client.get = async (url) => url.includes('/operations/') ? { data: remote('in_progress', { replay_allowed: true }) } : get(url);
  let key;
  ctx.client.post = async (_url, opts) => { key = opts.idempotencyKey; return { data: { project_id: project } }; };
  await recover(recoveryContext(ctx, saved.id));
  assert.equal(key, saved.id);
});

it('refuses changed source files and changed frozen prepared bytes before replay', async () => {
  const ctx = context();
  const saved = record(ctx, { sources: [sourceIdentity(ctx.flags.file)], preparedBytes: Buffer.from('prepared') });
  ctx.client.post = async () => { throw new Error('must not send'); };
  fs.writeFileSync(ctx.flags.file, 'changed');
  await assert.rejects(recover(recoveryContext(ctx, saved.id)), /source files changed/);
  const frozen = path.join(path.dirname(operationPath(ctx.config.rootDir, saved.id)), saved.prepared_input.filename);
  assert.equal(fs.readFileSync(frozen, 'utf8'), 'prepared');
  updateOperation(ctx, saved, { sources: [] });
  fs.writeFileSync(frozen, 'tampered');
  await assert.rejects(recover(recoveryContext(ctx, saved.id)), /Prepared input changed/);
});

it('recovers the frozen request and prepared input after original transient files are deleted', async () => {
  const ctx = context();
  const saved = record(ctx, { sources: [sourceIdentity(ctx.flags.file)], preparedBytes: Buffer.from('prepared') });
  fs.unlinkSync(ctx.flags.file);
  let sent;
  ctx.client.post = async (_url, opts) => { sent = opts; return { data: { project_id: project } }; };
  await recover(recoveryContext(ctx, saved.id));
  assert.deepEqual(sent.body, saved.request.body);
  assert.equal(sent.idempotencyKey, saved.id);
});

it('refuses account and origin changes without looking up or replaying an unrelated operation', async () => {
  const ctx = context();
  const saved = record(ctx);
  ctx.client.post = async () => { throw new Error('must not send'); };
  let lookups = 0;
  ctx.client.get = async () => { lookups++; return { data: { actor: { user_id: project }, billing: { account_type: 'user', account_id: project } } }; };
  await assert.rejects(recover(recoveryContext(ctx, saved.id)), /different account/);
  assert.equal(lookups, 1);
  ctx.config.baseUrl = 'https://other.example';
  await assert.rejects(recover(recoveryContext(ctx, saved.id)), /different API origin/);
  assert.equal(lookups, 1);
});

it('refuses a billing-account switch under the same actor', async () => {
  const ctx = context();
  const saved = record(ctx);
  ctx.client.get = async () => ({ data: { actor: { user_id: actor }, billing: { account_type: 'team', account_id: project } } });
  ctx.client.post = async () => { throw new Error('must not send'); };
  await assert.rejects(recover(recoveryContext(ctx, saved.id)), /different billing account/);
});

it('refuses missing-record replay after retention and refuses unknown retention', async () => {
  const ctx = context();
  const saved = record(ctx);
  ctx.client.post = async () => { throw new Error('must not send'); };
  for (const replay_not_after of ['2000-01-01T00:00:00Z', null]) {
    updateOperation(ctx, saved, { replay_not_after });
    await assert.rejects(recover(recoveryContext(ctx, saved.id)), /retention has expired or is unknown/);
  }
});

it('keeps atomic private journals usable after a process exits before POST', async () => {
  const ctx = context();
  const modulePath = new URL('../src/operations.js', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {createOperation} from ${JSON.stringify(modulePath)};
    const operation=createOperation(${JSON.stringify({ config: ctx.config })}, ${JSON.stringify({ action: 'project:create', account, request: { method: 'POST', path: '/api/v1/projects', body: { name: 'fixture' } } })});
    process.stdout.write(operation.id); process.exit(99);
  `], { encoding: 'utf8' });
  assert.equal(child.status, 99);
  const saved = loadOperation(ctx.config.rootDir, child.stdout);
  const file = operationPath(ctx.config.rootDir, saved.id);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), [`${saved.id}.json`]);
  ctx.client.post = async () => ({ data: { project_id: project } });
  await recover(recoveryContext(ctx, saved.id));
});

it('rejects malformed or hash-modified journals without changing them', () => {
  const ctx = context();
  const saved = record(ctx);
  const file = operationPath(ctx.config.rootDir, saved.id);
  fs.writeFileSync(file, '{partial');
  assert.throws(() => loadOperation(ctx.config.rootDir, saved.id), /record was left unchanged/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{partial');
  fs.writeFileSync(file, JSON.stringify({ ...saved, request: { ...saved.request, body: { name: 'different' } } }));
  assert.throws(() => loadOperation(ctx.config.rootDir, saved.id), /request hash changed/);
});

it('refuses symlink journals and credential fields', () => {
  const ctx = context();
  const saved = record(ctx);
  const file = operationPath(ctx.config.rootDir, saved.id);
  fs.unlinkSync(file);
  fs.symlinkSync(ctx.flags.file, file);
  assert.throws(() => loadOperation(ctx.config.rootDir, saved.id), /Cannot read operation/);
  assert.throws(() => record(ctx, { request: { method: 'POST', path: '/api/v1/projects', body: { api_key: 'secret' } } }), /credential field/);
});

it('keeps simultaneous operations and project waits separate, including legacy resume migration', async () => {
  const ctx = context();
  const a = record(ctx);
  const b = record(ctx);
  ctx.client.get = async (url) => ({ data: remote('completed', { project_id: url.includes(a.id) ? project : actor }) });
  await Promise.all([waitForOperation(ctx, a), waitForOperation(ctx, b)]);
  assert.equal(listOperations(ctx.config.rootDir).length, 2);
  assert.equal(loadOperation(ctx.config.rootDir, a.id).project_id, project);
  assert.equal(loadOperation(ctx.config.rootDir, b.id).project_id, actor);
  await saveResume(ctx.config.rootDir, { projectId: project }, { separate: true });
  await saveResume(ctx.config.rootDir, { projectId: actor }, { separate: true });
  await assert.rejects(loadResume(ctx.config.rootDir), /Several saved waits/);
  await clearResume(ctx.config.rootDir, project);
  assert.equal((await loadResume(ctx.config.rootDir)).projectId, actor);
  await saveResume(ctx.config.rootDir, { projectId: serverId });
  await clearResume(ctx.config.rootDir, actor);
  assert.equal((await loadResume(ctx.config.rootDir)).projectId, serverId);
});

it('journals restart before POST and does not treat a 202 as a completed restart', async () => {
  const ctx = context();
  ctx.positionals = [project];
  ctx.flags = {};
  ctx.client.post = async (_url, opts) => {
    assert.equal(listOperations(ctx.config.rootDir)[0].idempotency_key, opts.idempotencyKey);
    return { status: 202, data: { state: 'in_progress', operation_id: serverId, project_id: project } };
  };
  await restart(ctx);
  const saved = listOperations(ctx.config.rootDir)[0];
  assert.equal(saved.action, 'project:restart');
  assert.equal(saved.state, 'in_progress');
});
