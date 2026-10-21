/** Direct session HTTPS transport. Temporary authority never enters request journals. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { credentialFilePath } from '../credentials.js';
import { accountIdentity } from '../operations.js';
import { createClient, ApiError, NetworkError } from '../http.js';
import { isUUID } from '../uuid.js';
import { EXIT } from '../exit-codes.js';
import { usageError } from '../args.js';

const accounts = new WeakMap();
const connections = new Map();
const REFRESH_MARGIN_MS = 10_000;

function checkAbort(signal) {
  if (signal?.aborted) {
    const error = new Error('Request interrupted.');
    error.exitCode = EXIT.INTERRUPTED;
    throw error;
  }
}

async function identity(ctx, signal) {
  checkAbort(signal);
  let item = accounts.get(ctx);
  if (!item || item.apiKey !== ctx.config.apiKey || item.origin !== ctx.config.baseUrl) {
    item = { apiKey: ctx.config.apiKey, origin: ctx.config.baseUrl, value: accountIdentity(ctx, { signal }) };
    accounts.set(ctx, item);
  }
  // Account lookup uses existing Ariax authentication. Cancellation also bounds
  // the caller's wait while that lookup is in flight.
  let abort;
  try {
    if (!signal) return await item.value;
    return await Promise.race([item.value, new Promise((_, reject) => {
      abort = () => { try { checkAbort(signal); } catch (error) { reject(error); } };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } catch (error) {
    accounts.delete(ctx);
    throw error;
  } finally { if (abort) signal.removeEventListener('abort', abort); }
}

function cacheFile(ctx, account, sessionId) {
  const parent = path.dirname(credentialFilePath());
  const directory = path.join(parent, 'forge-connections');
  const project = path.resolve(ctx.config.rootDir);
  const inside = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);
  if ((project !== path.resolve(os.homedir()) && inside(project, directory)) || ['/workspace', '/scratch', '/inputs', '/models'].some(root => inside(root, directory))) {
    throw usageError('Session credentials require protected user configuration outside workload and request storage.');
  }
  // Never traverse a symlink in the configuration path. Protect only the
  // application's own directories, leaving shared system directories alone.
  let current = path.parse(directory).root;
  for (const component of directory.slice(current.length).split(path.sep)) {
    current = path.join(current, component);
    try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = fs.lstatSync(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw usageError('Session credential storage must use real directories.');
    if (current === parent || current === directory) {
      if (process.getuid && info.uid !== process.getuid()) throw usageError('Session credential directory has another owner.');
      fs.chmodSync(current, 0o700);
    }
  }
  // An auth-secret fingerprint prevents a second API key for the same account
  // from reusing a more privileged cached connection. It is never transmitted.
  const key = createHash('sha256').update(ctx.config.apiKey).digest('hex');
  const origin = Buffer.from(account.api_origin).toString('base64url');
  if (origin.length > 100) throw usageError('API origin is too long for session credential storage.');
  return path.join(directory, `${account.actor_user_id}-${origin}-${sessionId}-${key}.json`);
}

function validateConnection(value, sessionId) {
  try {
    const url = new URL(value.endpoint);
    if (value.session_id !== sessionId || !isUUID(value.project_id) || value.api_version !== 1
        || url.protocol !== 'https:' || !url.hostname || url.username || url.password
        || url.search || url.hash || url.pathname !== '/' || value.endpoint.replace(/\/$/, '') !== url.origin
        || typeof value.access_token !== 'string' || !value.access_token || value.access_token.length > 8192
        || !Number.isFinite(Date.parse(value.expires_at))) throw new Error();
    return { session_id: sessionId, project_id: value.project_id, endpoint: url.origin,
      access_token: value.access_token, expires_at: value.expires_at, api_version: 1 };
  } catch { throw new NetworkError('Session connection response is invalid.'); }
}

function readConnection(file, account, sessionId) {
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.size > 16_384 || (process.getuid && info.uid !== process.getuid()) || (info.mode & 0o077)) {
      throw usageError('Session credential file must be private and owned by the current user.');
    }
    const record = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (!isUUID(record.account?.actor_user_id) || !isUUID(record.account?.billing_account_id)
        || !['user', 'team'].includes(record.account?.billing_account_type)
        || record.account.actor_user_id !== account.actor_user_id || record.account.api_origin !== account.api_origin
        || (account.billing_account_id && record.account.billing_account_id !== account.billing_account_id)
        || (account.billing_account_type && record.account.billing_account_type !== account.billing_account_type)) return null;
    return { account: record.account, connection: validateConnection(record.connection, sessionId) };
  } catch (error) {
    if (error?.code === 'ARIAX_USAGE') throw error;
    return null;
  } finally { fs.closeSync(fd); }
}

function cachedConnection(ctx, sessionId) {
  // The exact API-key fingerprint binds this protected cache to the verified
  // account from its original connect. Reuse does not call /me per observer.
  const origin = new URL(ctx.config.baseUrl).origin;
  const probe = cacheFile(ctx, { actor_user_id: '', api_origin: origin }, sessionId);
  const suffix = path.basename(probe);
  const candidates = fs.readdirSync(path.dirname(probe)).filter(name =>
    name.endsWith(suffix) && isUUID(name.slice(0, -suffix.length)));
  if (candidates.length !== 1) return null;
  const file = path.join(path.dirname(probe), candidates[0]);
  const actor = candidates[0].slice(0, -suffix.length);
  const record = readConnection(file, { actor_user_id: actor, api_origin: origin }, sessionId);
  if (!record || Date.parse(record.connection.expires_at) - Date.now() <= REFRESH_MARGIN_MS) return null;
  return { file, ...record };
}

export function hasCachedForgeConnection(ctx, sessionId) {
  return cachedConnection(ctx, sessionId) !== null;
}

function saveConnection(file, account, connection) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ account, connection }) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
    const directory = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } finally { fs.rmSync(temporary, { force: true }); }
}

async function connect(ctx, file, account, sessionId, signal, refresh = false) {
  checkAbort(signal);
  if (!refresh) {
    const cached = readConnection(file, account, sessionId)?.connection;
    if (cached && Date.parse(cached.expires_at) - Date.now() > REFRESH_MARGIN_MS) return cached;
  }
  let pending = connections.get(file);
  if (!pending) {
    pending = (async () => {
      const response = await ctx.client.post(`/api/v1/forge/sessions/${sessionId}/connect`, { signal });
      const value = validateConnection(response.data, sessionId);
      if (Date.parse(value.expires_at) - Date.now() <= REFRESH_MARGIN_MS) throw new NetworkError('Session connection has expired.');
      saveConnection(file, account, value);
      return value;
    })();
    connections.set(file, pending);
    const settled = () => { if (connections.get(file) === pending) connections.delete(file); };
    pending.then(settled, settled);
  }
  let abort;
  try {
    if (!signal) return await pending;
    return await Promise.race([pending, new Promise((_, reject) => {
      abort = () => { try { checkAbort(signal); } catch (error) { reject(error); } };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    })]);
  }
  finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}

function sessionIdentifier(value) {
  if (!isUUID(value)) throw usageError('Forge session ID must be a UUID.');
  return value.trim().toLowerCase();
}

async function sessionConnection(ctx, sessionId, options, refresh = false) {
  checkAbort(options.signal);
  if (!refresh) {
    const cached = cachedConnection(ctx, sessionId);
    if (cached) return cached;
  }
  const account = await identity(ctx, options.signal);
  const file = cacheFile(ctx, account, sessionId);
  const connection = await connect(ctx, file, account, sessionId, options.signal, refresh);
  checkAbort(options.signal);
  return { file, account, connection };
}

/** The existing saved-request identity, bound to a usable protected connection. */
export async function forgeAccountIdentity(ctx, sessionId, options = {}) {
  const { account } = await sessionConnection(ctx, sessionIdentifier(sessionId), options);
  return {
    actor_user_id: account.actor_user_id,
    billing_account_type: account.billing_account_type,
    billing_account_id: account.billing_account_id,
    api_origin: account.api_origin,
  };
}

export async function forgeRequest(ctx, sessionId, method, routePath, options = {}) {
  sessionId = sessionIdentifier(sessionId);
  method = String(method).toUpperCase();
  if (!['GET', 'POST'].includes(method) || typeof routePath !== 'string' || !routePath.startsWith('/v1/')) {
    throw usageError('Forge requests require GET or POST and a /v1/ path.');
  }
  const probe = new URL(routePath, 'https://forge.invalid');
  if (probe.origin !== 'https://forge.invalid' || probe.pathname !== routePath || probe.search || probe.hash
      || /[\\\s]/.test(routePath) || !probe.pathname.startsWith('/v1/')) {
    throw usageError('Forge request path is invalid.');
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const { file, connection } = await sessionConnection(ctx, sessionId, options, attempt > 0);
    checkAbort(options.signal);
    const client = createClient({ baseUrl: connection.endpoint, apiKey: connection.access_token });
    try {
      const result = method === 'GET' ? await client.get(routePath, { ...options, attempts: 2 })
        : await client.post(routePath, options);
      if (!result.raw || typeof result.raw !== 'object' || !Object.hasOwn(result.raw, 'data')) {
        throw new NetworkError('Session response is invalid.');
      }
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        fs.rmSync(file, { force: true });
        if (method === 'GET' && attempt === 0) continue;
      }
      throw error;
    }
  }
}
