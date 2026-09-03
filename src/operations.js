/** Durable, account-bound mutation attempts. Credentials and signed URLs stay in memory. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { usageError } from './args.js';
import { isUUID } from './uuid.js';
import { ApiError } from './http.js';
import { EXIT } from './exit-codes.js';
import { printProgress } from './output.js';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // claim_agent_idempotency retention
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function directory(rootDir) {
  let dir = path.resolve(rootDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const name of ['.ariax', 'operations']) {
    dir = path.join(dir, name);
    try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink()) {
      throw usageError('Operation storage must use real directories, not symlinks.');
    }
    fs.chmodSync(dir, 0o700);
  }
  return dir;
}

export function operationPath(rootDir, id) {
  if (!isUUID(id)) throw usageError('Operation ID must be a UUID from ariax operations.');
  return path.join(directory(rootDir), `${id}.json`);
}

function atomicWrite(file, bytes, exclusive = false) {
  if (fs.existsSync(file) && !fs.lstatSync(file).isFile()) throw usageError('Operation file must be a regular file.');
  const temp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  try {
    if (exclusive) { fs.linkSync(temp, file); fs.unlinkSync(temp); }
    else fs.renameSync(temp, file);
    const parent = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  } finally { fs.rmSync(temp, { force: true }); }
}

function readRegular(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!fs.fstatSync(fd).isFile()) throw usageError('Operation file must be a regular file.');
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

function rejectCredentials(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret)$/i.test(key)) {
      throw usageError(`Remove credential field ${key} from the job; credentials cannot be stored in an operation journal.`);
    }
    rejectCredentials(child);
  }
}

export function sourceIdentity(file) {
  return { path: path.resolve(file), sha256: sha256(fs.readFileSync(file)) };
}

export async function accountIdentity(ctx) {
  const res = await ctx.client.get('/api/v1/me');
  const actor = res.data?.actor?.user_id;
  if (!isUUID(actor)) throw new Error('Account lookup returned no valid actor ID; no mutation was sent.');
  const billing = res.data?.billing;
  if (!['user', 'team'].includes(billing?.account_type) || !isUUID(billing.account_id)) {
    throw new Error('Account lookup returned no valid billing identity; no mutation was sent.');
  }
  return { actor_user_id: actor, billing_account_type: billing.account_type, billing_account_id: billing.account_id,
    api_origin: new URL(ctx.config.baseUrl ?? 'https://www.ariax.bio').origin };
}

export function createOperation(ctx, { action, request, account, sources = [], preparedBytes }) {
  rejectCredentials(request.body);
  const id = randomUUID();
  const file = operationPath(ctx.config.rootDir, id);
  const now = new Date().toISOString();
  const record = {
    version: 1, id, idempotency_key: id, action, ...account,
    created_at: now, updated_at: now, replay_not_after: new Date(Date.now() + RETENTION_MS).toISOString(),
    request, request_sha256: sha256(JSON.stringify(request)), sources,
    prepared_input: preparedBytes === undefined ? null : { filename: `${id}.input`, sha256: sha256(preparedBytes) },
    upload_intent_id: request.body.input_upload_intent_id ?? null,
    state: 'pending', operation_id: null, project_id: null, job_id: null,
  };
  if (preparedBytes !== undefined) atomicWrite(path.join(path.dirname(file), `${id}.input`), preparedBytes, true);
  atomicWrite(file, JSON.stringify(record, null, 2) + '\n', true);
  return record;
}

export function loadOperation(rootDir, id) {
  const file = operationPath(rootDir, id);
  let record;
  try { record = JSON.parse(readRegular(file)); }
  catch (error) { throw usageError(`Cannot read operation ${id}: ${error.message}. The record was left unchanged.`); }
  if (record.version !== 1 || record.id !== id || record.idempotency_key !== id
      || !['project:create', 'project:restart'].includes(record.action)
      || !isUUID(record.actor_user_id)
      || !['user', 'team'].includes(record.billing_account_type) || !isUUID(record.billing_account_id)
      || !Array.isArray(record.sources)
      || record.sources.some((source) => typeof source?.path !== 'string' || !path.isAbsolute(source.path) || !/^[a-f0-9]{64}$/.test(source.sha256))
      || !['pending', 'in_progress', 'completed', 'failed'].includes(record.state)
      || record.request?.method !== 'POST'
      || !record.request.body || typeof record.request.body !== 'object' || Array.isArray(record.request.body)
      || record.request_sha256 !== sha256(JSON.stringify(record.request))
      || (record.action === 'project:create' ? record.request.path !== '/api/v1/projects'
        : !/^\/api\/v1\/projects\/[0-9a-f-]{36}\/restart$/i.test(record.request.path))) {
    throw usageError(`Operation ${id} is malformed or its request hash changed. No mutation was sent.`);
  }
  rejectCredentials(record.request.body);
  return record;
}

export function listOperations(rootDir) {
  return fs.readdirSync(directory(rootDir)).filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name))
    .map((name) => loadOperation(rootDir, name.slice(0, -5)));
}

export function updateOperation(ctx, operation, patch) {
  const next = { ...operation, ...patch, updated_at: new Date().toISOString() };
  atomicWrite(operationPath(ctx.config.rootDir, operation.id), JSON.stringify(next, null, 2) + '\n');
  Object.assign(operation, next);
  return operation;
}

export async function verifyAccount(ctx, operation) {
  const origin = new URL(ctx.config.baseUrl ?? 'https://www.ariax.bio').origin;
  if (operation.api_origin !== origin) throw usageError('Operation belongs to a different API origin. Restore the original --base-url before recovery.');
  const account = await accountIdentity(ctx);
  if (account.actor_user_id !== operation.actor_user_id) throw usageError('Operation belongs to a different account. Restore the original account before recovery.');
  if (account.billing_account_type !== operation.billing_account_type || account.billing_account_id !== operation.billing_account_id) {
    throw usageError('Operation belongs to a different billing account. Restore the original billing account before recovery.');
  }
}

export function verifyReplayInputs(ctx, operation) {
  // Missing records are safe to replay only within the original seven-day window.
  // Leave a minute for the claim to reach the server before key reuse becomes legal.
  if (!(Date.parse(operation.replay_not_after) > Date.now() + 60_000)) {
    throw usageError('Operation retention has expired or is unknown. Inspect the project; this attempt cannot be replayed safely.');
  }
  for (const source of operation.sources ?? []) {
    let bytes;
    try { bytes = fs.readFileSync(source.path); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (sha256(bytes) !== source.sha256) {
      throw usageError('Operation source files changed. Restore the original files to recover, or submit changed inputs as a new operation.');
    }
  }
  if (operation.prepared_input) {
    const prepared = operation.prepared_input;
    if (prepared.filename !== `${operation.id}.input`
        || sha256(readRegular(path.join(directory(ctx.config.rootDir), prepared.filename))) !== prepared.sha256) {
      throw usageError('Prepared input changed or is corrupt. No mutation was sent.');
    }
  }
}

export async function lookupOperation(ctx, operation) {
  try {
    const res = await ctx.client.get(`/api/v1/operations/${operation.idempotency_key}`, { query: { action: operation.action }, signal: ctx.signal });
    const remote = res.data;
    if (!remote || !isUUID(remote.operation_id) || remote.action !== operation.action
        || !['in_progress', 'completed', 'failed'].includes(remote.state)) throw new Error('Operation lookup returned an invalid response.');
    updateOperation(ctx, operation, {
      state: remote.state, operation_id: remote.operation_id, project_id: remote.project_id, job_id: remote.job_id,
      response_status: remote.response_status, result: remote.result, error: remote.error,
      ...(typeof remote.expires_at === 'string' ? { replay_not_after: remote.expires_at } : {}),
    });
    return remote;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

export async function sendOperation(ctx, operation) {
  // The durable record already exists when this spending POST starts.
  verifyReplayInputs(ctx, operation);
  printProgress(`operation_id: ${operation.id} (recover with: ariax recover ${operation.id})`);
  try {
    const res = await ctx.client.post(operation.request.path, {
      body: operation.request.body, idempotencyKey: operation.idempotency_key,
    });
    const data = res.data?.project ?? res.data ?? {};
    const pending = res.status === 202 || data.state === 'in_progress';
    const projectId = data.project_id ?? data.id ?? null;
    if (!pending && !isUUID(projectId)) throw new Error('Mutation response carried no valid project ID; recover this operation.');
    updateOperation(ctx, operation, {
      state: pending ? 'in_progress' : 'completed', operation_id: data.operation_id ?? operation.operation_id,
      project_id: projectId, job_id: data.job_id ?? null,
      response_status: res.status ?? (pending ? 202 : 200), result: pending ? null : data,
    });
    return res;
  } catch (error) {
    // A timeout, interruption, or ambiguous HTTP failure must retain the exact attempt.
    error.message += ` Recover with: ariax recover ${operation.id}`;
    throw error;
  }
}

export function operationFailure(operation) {
  const error = operation.error ?? {};
  const message = error.message || 'The operation failed.';
  return new ApiError({ status: operation.response_status || 500, code: error.code,
    message: `Operation ${operation.id} is terminal (state: failed): ${message} Retrying ariax recover cannot advance this operation.`,
    retryable: false, details: error.details });
}

export function operationSummary(operation) {
  return { id: operation.id, action: operation.action, state: operation.state, project_id: operation.project_id,
    job_id: operation.job_id, operation_id: operation.operation_id, created_at: operation.created_at };
}

/** Poll only. Waiting never replays a spending request, even after a lease expires. */
export async function waitForOperation(ctx, operation) {
  const interval = Number(ctx.flags['poll-interval'] ?? 3) * 1000;
  const timeout = Number(ctx.flags['wait-timeout'] ?? 0) * 1000;
  if (!Number.isFinite(interval) || interval <= 0 || !Number.isFinite(timeout) || timeout < 0) {
    throw usageError('Wait intervals must be positive seconds and timeouts nonnegative seconds.');
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  const started = Date.now();
  try {
    while (operation.state !== 'completed' && operation.state !== 'failed') {
      controller.signal.throwIfAborted();
      const remote = await lookupOperation({ ...ctx, signal: controller.signal }, operation);
      if (!remote || remote.replay_allowed) {
        throw usageError(`Operation needs explicit recovery: ariax recover ${operation.id}`);
      }
      if (operation.state === 'completed' || operation.state === 'failed') break;
      if (timeout && Date.now() - started >= timeout) {
        const error = new Error(`Operation wait timed out; remote work continues. Resume with: ariax recover ${operation.id} --wait`);
        error.exitCode = EXIT.NETWORK;
        throw error;
      }
      await delay(timeout ? Math.min(interval, Math.max(1, timeout - (Date.now() - started))) : interval, undefined, { signal: controller.signal });
    }
    if (operation.state === 'failed') throw operationFailure(operation);
    if (!isUUID(operation.project_id)) throw new Error('Completed operation has no project; inspect the operation before continuing.');
    return operation;
  } catch (error) {
    if (controller.signal.aborted) {
      error = new Error(`Interrupted; remote work continues. Resume with: ariax recover ${operation.id} --wait`);
      error.exitCode = EXIT.INTERRUPTED;
    }
    throw error;
  } finally { process.removeListener('SIGINT', interrupt); }
}
