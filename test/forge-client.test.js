/** Cached direct authority must remain usable during a bounded backend partition.
 * Network services are the substituted boundary; transport, protected files and
 * fresh-context cache reuse are real. Joined remote tests own actual JWT/local limits.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient, ApiError, NetworkError } from '../src/http.js';
import { credentialFilePath } from '../src/credentials.js';
import { forgeAccountIdentity, forgeRequest } from '../src/lib/forge-client.js';

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_SESSION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PROJECT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const API = 'https://www.ariax.bio';
const OTHER_API = 'https://api.example';
const HOST = 'https://workspace.example';
const WRITE_KEY = 'arx_forge_write_testcredential';
const READ_KEY = 'arx_forge_read_testcredential';
const OTHER_KEY = 'arx_forge_other_testcredential';
const ACCOUNT = { actor_user_id: ACTOR, billing_account_type: 'user', billing_account_id: ACTOR, api_origin: API };

function boundary(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ariax-forge-client-'));
  const previous = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, APPDATA: process.env.APPDATA };
  process.env.XDG_CONFIG_HOME = path.join(root, 'config');
  process.env.APPDATA = path.join(root, 'appdata');
  t.mock.method(os, 'homedir', () => path.join(root, 'home'));
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const keys = new Map([[WRITE_KEY, { actor: ACTOR, write: true }],
    [READ_KEY, { actor: ACTOR, write: false }], [OTHER_KEY, { actor: OTHER, write: true }]]);
  const state = { online: true, backend: [], direct: [], tokens: new Map(), commands: new Map(),
    loseReply: false, localDeadline: null };
  const reply = (status, value) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  const error = (status, code) => reply(status, { error: { code, message: code } });
  const fetchImpl = async (address, options = {}) => {
    const url = new URL(address);
    const bearer = new Headers(options.headers).get('authorization')?.replace(/^Bearer /, '');
    assert.equal(options.redirect, 'error');
    if ([API, OTHER_API].includes(url.origin)) {
      state.backend.push({ path: url.pathname, key: bearer });
      if (!state.online) return error(503, 'dependency_failure');
      const principal = keys.get(bearer);
      if (!principal) return error(401, 'unauthorized');
      if (options.method === 'GET' && url.pathname === '/api/v1/me') {
        return reply(200, { data: { actor: { user_id: principal.actor },
          billing: { account_type: 'user', account_id: principal.actor } } });
      }
      if (options.method === 'POST' && url.pathname === `/api/v1/forge/sessions/${SESSION}/connect`) {
        if (principal.actor !== ACTOR) return error(404, 'not_found');
        const token = 'temporary-' + randomUUID();
        state.tokens.set(token, { ...principal, key: bearer });
        return reply(200, { data: { session_id: SESSION, project_id: PROJECT, endpoint: HOST,
          access_token: token, expires_at: new Date(Date.now() + 300_000).toISOString(), api_version: 1 } });
      }
      return error(404, 'not_found');
    }
    assert.equal(url.origin, HOST);
    state.direct.push({ path: url.pathname, method: options.method, bearer });
    const principal = state.tokens.get(bearer);
    if (!principal) return error(401, 'unauthorized');
    assert.notEqual(bearer, WRITE_KEY);
    assert.notEqual(bearer, READ_KEY);
    if (options.method === 'GET' && url.pathname === '/v1/session') return reply(200, { data: { session_id: SESSION } });
    if (options.method === 'POST' && url.pathname === '/v1/commands') {
      if (!principal.write) return error(403, 'forbidden');
      if (state.localDeadline !== null && Date.now() >= state.localDeadline) return error(409, 'execution_stopped');
      const body = JSON.parse(options.body);
      const previousCommand = state.commands.get(body.command_id);
      if (previousCommand) assert.deepEqual(previousCommand.request, body);
      else state.commands.set(body.command_id, { command_id: body.command_id, request: body, state: 'running' });
      if (state.loseReply) { state.loseReply = false; throw new TypeError('Lost mutation reply'); }
      return reply(202, { data: state.commands.get(body.command_id) });
    }
    const command = state.commands.get(url.pathname.split('/').at(-1));
    return command ? reply(200, { data: command }) : error(404, 'not_found');
  };
  t.mock.method(globalThis, 'fetch', fetchImpl);
  const context = (key = WRITE_KEY, origin = API) => ({ config: { apiKey: key, baseUrl: origin, rootDir: path.join(root, 'project') },
    client: createClient({ baseUrl: origin, apiKey: key, fetchImpl, sleepImpl: async () => {} }) });
  const directory = path.join(path.dirname(credentialFilePath()), 'forge-connections');
  const recordFor = (key = WRITE_KEY) => {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      const record = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (state.tokens.get(record.connection.access_token)?.key === key) return { file, record };
    }
    assert.fail('Expected a protected connection cache record');
  };
  return { state, context, directory, recordFor };
}

describe('direct Forge identity cache', { concurrency: false }, () => {
  it('keeps cached identity and same-ID direct work usable through a backend partition', async (t) => {
    const { state, context, directory, recordFor } = boundary(t);
    const online = context();
    assert.deepEqual(await forgeAccountIdentity(online, ` ${SESSION.toUpperCase()} `), ACCOUNT);
    const { file, record } = recordFor();
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.ok(!directory.startsWith(online.config.rootDir + path.sep));
    record.account.access_token = 'unrelated-cache-metadata';
    fs.writeFileSync(file, JSON.stringify(record));
    state.online = false;
    const calls = state.backend.length;
    const fresh = context();
    assert.deepEqual(await forgeAccountIdentity(fresh, SESSION), ACCOUNT);
    const id = randomUUID();
    const body = { command_id: id, tool: 'base', argv: ['sleep', '1'] };
    state.loseReply = true;
    await assert.rejects(forgeRequest(fresh, SESSION, 'POST', '/v1/commands', { body }), NetworkError);
    assert.equal(state.direct.filter(call => call.method === 'POST').length, 1);
    assert.equal(state.commands.size, 1);
    assert.equal((await forgeRequest(fresh, SESSION, 'GET', `/v1/commands/${id}`)).data.command_id, id);
    assert.equal(state.backend.length, calls);
  });

  it('keeps key scopes isolated and requires fresh authority for changed origin, session or expiry', async (t) => {
    const { state, context, recordFor } = boundary(t);
    const write = context();
    await forgeAccountIdentity(write, SESSION);
    assert.deepEqual(await forgeAccountIdentity(context(READ_KEY), SESSION), ACCOUNT);
    state.online = false;
    const read = context(READ_KEY);
    const calls = state.backend.length;
    assert.deepEqual(await forgeAccountIdentity(read, SESSION), ACCOUNT);
    await assert.rejects(forgeRequest(read, SESSION, 'POST', '/v1/commands', {
      body: { command_id: randomUUID(), tool: 'base', argv: ['sleep', '1'] },
    }), (error) => error instanceof ApiError && error.status === 403);
    assert.equal(state.commands.size, 0);
    assert.equal(state.backend.length, calls);
    const id = randomUUID();
    assert.equal((await forgeRequest(context(), SESSION, 'POST', '/v1/commands', {
      body: { command_id: id, tool: 'base', argv: ['sleep', '1'] },
    })).data.command_id, id);
    const directCalls = state.direct.length;
    for (const [ctx, sid] of [[context(OTHER_KEY), SESSION], [context(WRITE_KEY, OTHER_API), SESSION], [context(), OTHER_SESSION]]) {
      await assert.rejects(forgeAccountIdentity(ctx, sid), (error) => error instanceof ApiError && error.status === 503);
    }
    state.online = true;
    await assert.rejects(forgeAccountIdentity(context(OTHER_KEY), SESSION), (error) => error instanceof ApiError && error.status === 404);
    state.online = false;
    const { file, record } = recordFor();
    record.connection.expires_at = new Date(Date.now() - 1).toISOString();
    fs.writeFileSync(file, JSON.stringify(record));
    // The original context still has a memoized online identity. An expired
    // connection must nevertheless complete a new connect before returning it.
    await assert.rejects(forgeAccountIdentity(write, SESSION), (error) => error instanceof ApiError && error.status === 503);
    assert.equal(state.direct.length, directCalls);
  });

  it('retains private-cache, symlink and request-path checks before returning cached identity', async (t) => {
    const { state, context, recordFor } = boundary(t);
    await forgeAccountIdentity(context(), SESSION);
    const { file } = recordFor();
    const original = fs.readFileSync(file);
    state.online = false;
    const calls = state.backend.length;
    fs.chmodSync(file, 0o644);
    await assert.rejects(forgeAccountIdentity(context(), SESSION), { code: 'ARIAX_USAGE' });
    fs.chmodSync(file, 0o600);
    const target = file + '.target';
    fs.renameSync(file, target);
    fs.symlinkSync(target, file);
    await assert.rejects(forgeAccountIdentity(context(), SESSION), { code: 'ELOOP' });
    fs.unlinkSync(file);
    fs.renameSync(target, file);
    await assert.rejects(forgeAccountIdentity(context(), '../session'), { code: 'ARIAX_USAGE' });
    await assert.rejects(forgeRequest(context(), SESSION, 'POST', '/v1/../../control/revoke'), { code: 'ARIAX_USAGE' });
    assert.equal(state.backend.length, calls);
    assert.equal(state.direct.length, 0);
    const invalid = JSON.parse(original);
    invalid.account.api_origin = OTHER_API;
    fs.writeFileSync(file, JSON.stringify(invalid));
    await assert.rejects(forgeAccountIdentity(context(), SESSION), (error) => error instanceof ApiError && error.status === 503);
  });
});
