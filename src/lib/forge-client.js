/** Direct session HTTPS transport. Temporary authority never enters request journals. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { credentialFilePath } from '../credentials.js';
import { accountIdentity } from '../operations.js';
import { createClient, ApiError, NetworkError } from '../http.js';
import { isReadOnlyFsError } from '../state-dir.js';
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

function normalizeSystemTmpPrefix(candidate) {
  const resolved = path.resolve(candidate);
  if (process.platform !== 'darwin') return resolved;
  // On macOS, os.tmpdir() lives under /var -> /private/var and /tmp -> /private/tmp.
  // Normalize only those OS-managed root aliases so explicit cache dirs under os.tmpdir()
  // do not fail the symlink walk while still rejecting symlinks in any user component.
  const rawTmp = path.resolve(os.tmpdir());
  let realTmp = rawTmp;
  try { realTmp = fs.realpathSync(rawTmp); } catch { /* ignore */ }
  if (realTmp !== rawTmp && (resolved === rawTmp || resolved.startsWith(rawTmp + path.sep))) {
    return realTmp + resolved.slice(rawTmp.length);
  }
  if (resolved === '/tmp' || resolved.startsWith('/tmp/')) {
    try {
      const realSlashTmp = fs.realpathSync('/tmp');
      if (realSlashTmp !== '/tmp') return realSlashTmp + resolved.slice('/tmp'.length);
    } catch { /* ignore */ }
  }
  return resolved;
}

function ensureSafeCacheDirectory(ctx, directory, protectedDirs) {
  const inside = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);
  const project = path.resolve(ctx.config.rootDir);
  let realProject = project;
  try { realProject = fs.realpathSync(project); } catch { /* ignore */ }
  const home = path.resolve(ctx.env?.HOME || os.homedir());
  let realHome = home;
  try { realHome = fs.realpathSync(home); } catch { /* ignore */ }
  const insideProject = (project !== home && project !== realHome && inside(project, directory))
    || (realProject !== home && realProject !== realHome && inside(realProject, directory));
  if (insideProject || ['/workspace', '/scratch', '/inputs', '/models'].some(root => inside(root, directory))) {
    throw usageError('Session credentials require protected user configuration outside workload and request storage.');
  }
  // Never traverse a symlink in the configuration path. Protect only the
  // application's own directories, leaving shared system directories alone.
  let current = path.parse(directory).root;
  const parts = directory.slice(current.length).split(path.sep).filter(Boolean);
  for (const component of parts) {
    current = path.join(current, component);
    try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = fs.lstatSync(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw usageError('Session credential storage must use real directories.');
    if (protectedDirs.has(current)) {
      if (process.getuid && info.uid !== process.getuid()) throw usageError('Session credential directory has another owner.');
      if (process.platform !== 'win32') fs.chmodSync(current, 0o700);
    }
  }
  // Probe writability so read-only / sandboxed directories trigger fallback deterministically.
  const probe = path.join(directory, `.ariax-conn-probe-${process.pid}-${randomUUID()}`);
  let fd;
  try {
    fd = fs.openSync(probe, 'wx', 0o600);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.rmSync(probe, { force: true }); } catch { /* ignore */ }
  }
  return directory;
}

function resolveConnectionCacheDir(ctx) {
  const rawExplicit = ctx.config?.connectionCacheDir
    ?? (typeof ctx.env?.ARIAX_CONNECTION_CACHE_DIR === 'string' && ctx.env.ARIAX_CONNECTION_CACHE_DIR.trim()
      ? ctx.env.ARIAX_CONNECTION_CACHE_DIR.trim()
      : null);
  if (rawExplicit) {
    const directory = normalizeSystemTmpPrefix(rawExplicit);
    return ensureSafeCacheDirectory(ctx, directory, new Set([directory]));
  }
  const credEnv = ctx.env ?? process.env;
  const customHome = process.platform === 'win32'
    ? (credEnv !== process.env && credEnv.USERPROFILE && credEnv.USERPROFILE !== process.env.USERPROFILE ? credEnv.USERPROFILE : os.homedir())
    : (credEnv !== process.env && credEnv.HOME && credEnv.HOME !== process.env.HOME ? credEnv.HOME : os.homedir());
  const defaultParent = normalizeSystemTmpPrefix(path.dirname(credentialFilePath({
    env: credEnv,
    home: customHome,
  })));
  const defaultDir = path.join(defaultParent, 'forge-connections');
  try {
    return ensureSafeCacheDirectory(ctx, defaultDir, new Set([defaultParent, defaultDir]));
  } catch (error) {
    if (!isReadOnlyFsError(error)) throw error;
    let realTmp = path.resolve(os.tmpdir());
    try { realTmp = fs.realpathSync(realTmp); } catch { /* ignore */ }
    const uid = process.getuid?.() ?? 'user';
    const fallbackParent = path.join(realTmp, `ariax-cli-conn-${uid}`);
    const fallbackDir = path.join(fallbackParent, 'forge-connections');
    return ensureSafeCacheDirectory(ctx, fallbackDir, new Set([fallbackParent, fallbackDir]));
  }
}

function cacheFile(ctx, account, sessionId) {
  const directory = resolveConnectionCacheDir(ctx);
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
    const client = createClient({ baseUrl: connection.endpoint, apiKey: connection.access_token,
      timeoutMs: ctx.timeoutMs, fetchImpl: ctx.fetchImpl, telemetry: ctx.telemetry });
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
        // A rejected bearer token cannot authorize the request. Refresh once;
        // callers still reconcile any ambiguous transport failure themselves.
        if (attempt === 0) continue;
      }
      throw error;
    }
  }
}
