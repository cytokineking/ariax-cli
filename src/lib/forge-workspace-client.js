/** Proposed current-project file and active-session sync contract.
 * Transfer grants and daemon error text stay out of ordinary output and journals.
 */
import { usageError } from '../args.js';
import { ApiError, NetworkError, sanitize, validateTransferUrl } from '../http.js';
import { forgeRequest } from './forge-client.js';

const API = '/api/v1/forge';
const SYNC_STATES = new Set(['pending', 'queued', 'syncing', 'saved', 'failed']);

// Responses and diagnostics can contain URLs supplied by remote services. Keep
// grants and bearer credentials out of human/JSON output and local journals.
export function redactForgeText(value) {
  return sanitize(value).replace(/https?:\/\/[^\s"'<>]+/gi, candidate => {
    try {
      const url = new URL(candidate);
      const sensitive = [...url.searchParams.keys()].some(key =>
        /signature|credential|security.?token|access.?key|api.?key|key.?pair|(?:^|[-_])(sig|token|secret|password|policy|key)(?:$|[-_])/i.test(key));
      return sensitive || url.username || url.password ? '[REDACTED TRANSFER URL]' : candidate;
    } catch { return candidate; }
  });
}

export function redactForgeOutput(value) {
  if (typeof value === 'string') return redactForgeText(value);
  if (Array.isArray(value)) return value.map(redactForgeOutput);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/^(?:access_token|api_token|bearer_token|token|api_key|authorization|download_url|upload_url|signed_url|credential|credentials|secret|client_secret|private_key|password)$/i.test(key))
    .map(([key, item]) => [key, redactForgeOutput(item)]));
}

export function workspacePath(value, directory = false) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 1024
      || !/^\/(workspace|inputs)(\/|$)/.test(value) || value.includes('\\')
      || /[\x00-\x1f\x7f]/.test(value)) {
    throw usageError('Forge paths must be absolute POSIX paths under /workspace or /inputs.');
  }
  const parts = value.slice(1).split('/');
  if ((!directory && parts.length < 2) || parts.some(part => !part || part === '.' || part === '..' || Buffer.byteLength(part) > 255)) {
    throw usageError('Forge paths cannot contain empty, dot, traversal, or backslash components.');
  }
  return value;
}

function invalidResponse() {
  return new NetworkError('Current Forge workspace response is invalid or incompatible. Upgrade the CLI and server together.');
}

function publicRequestId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value)
    ? redactForgeText(value) : undefined;
}

function cleanError(error, label) {
  if (!(error instanceof ApiError)) return error;
  const code = typeof error.code === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(error.code) ? error.code : 'workspace_request_failed';
  const result = new ApiError({ status:error.status, code,
    message:`${label} failed${error.status ? ` (HTTP ${error.status})` : ''}.`,
    retryable:error.retryable, requestId:publicRequestId(error.requestId), retryAfterMs:error.retryAfterMs });
  if (error.status === 404) result.action = label.startsWith('Project')
    ? 'File commands require an authorized PROJECT ID; the former SESSION form is unsupported. Check access and upgrade the CLI and API together for the current project workspace.'
    : 'Check the active SESSION ID and access. The CLI, API and daemon must all support the current project workspace; upgrade them together.';
  return result;
}

function dataEnvelope(result) {
  if (!result?.raw || typeof result.raw !== 'object' || !Object.hasOwn(result.raw, 'data')
      || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw invalidResponse();
  return result.data;
}

function publicResult(result, data) {
  return { status:result.status, data, requestId:publicRequestId(result.requestId) };
}

function entryForDirectory(entry, directory) {
  if (!entry || typeof entry !== 'object' || !['file', 'directory'].includes(entry.kind)
      || !Number.isSafeInteger(entry.size_bytes) || entry.size_bytes < 0) throw invalidResponse();
  try { workspacePath(entry.path); } catch { throw invalidResponse(); }
  const prefix = directory + '/';
  if (!entry.path.startsWith(prefix) || entry.path.slice(prefix.length).includes('/')) throw invalidResponse();
  return { path:entry.path, kind:entry.kind, size_bytes:entry.size_bytes };
}

export async function listProjectFiles(ctx, projectId, target) {
  let cursor, result;
  const entries = [], seen = new Set();
  for (let page = 0; page < 1000; page++) {
    try {
      result = await ctx.client.get(`${API}/projects/${projectId}/files`, { query:{path:target, ...(cursor ? {cursor} : {})} });
    } catch (error) { throw cleanError(error, 'Project file listing'); }
    const data = dataEnvelope(result);
    if (!Array.isArray(data.entries) || !(data.next_cursor === null || typeof data.next_cursor === 'string')) throw invalidResponse();
    entries.push(...data.entries.map(entry => entryForDirectory(entry,target)));
    if (entries.length > 100000) throw new NetworkError('File listing exceeded its entry limit.');
    cursor = data.next_cursor;
    if (cursor === null) return publicResult(result,{project_id:projectId,path:target,entries,next_cursor:null});
    if (!cursor || cursor.length > 4096 || seen.has(cursor)) throw invalidResponse();
    seen.add(cursor);
  }
  throw new NetworkError('File listing exceeded its page limit.');
}

export async function projectFileGrant(ctx, projectId, target) {
  let result;
  try {
    result = await ctx.client.post(`${API}/projects/${projectId}/files/presign`, {body:{path:target}});
  } catch (error) { throw cleanError(error, 'Project file authorization'); }
  const data = dataEnvelope(result);
  if (data.path !== target || !Number.isSafeInteger(data.size_bytes) || data.size_bytes < 0
      || typeof data.download_url !== 'string') throw invalidResponse();
  validateTransferUrl(data.download_url, 'Download');
  return publicResult(result,{path:target,size_bytes:data.size_bytes,download_url:data.download_url});
}

function syncResult(result, syncId) {
  const data = dataEnvelope(result);
  if (data.sync_id !== syncId || !SYNC_STATES.has(data.state)) throw invalidResponse();
  const value = {sync_id:syncId,state:data.state};
  for (const field of ['saved_count','pending_count','failed_count']) {
    if (data[field] !== undefined) {
      if (!Number.isSafeInteger(data[field]) || data[field] < 0) throw invalidResponse();
      value[field] = data[field];
    }
  }
  for (const field of ['completed_at','last_successful_at']) {
    if (data[field] !== undefined && data[field] !== null) {
      if (typeof data[field] !== 'string' || !Number.isFinite(Date.parse(data[field]))) throw invalidResponse();
      value[field] = data[field];
    }
  }
  if (data.state === 'saved' && value.failed_count > 0) throw invalidResponse();
  if (data.error && typeof data.error.code === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(data.error.code)) {
    value.error = {code:data.error.code};
  }
  return publicResult(result,value);
}

export async function readSync(ctx, sessionId, syncId, options = {}) {
  try { return syncResult(await forgeRequest(ctx,sessionId,'GET',`/v1/sync/${syncId}`,options),syncId); }
  catch (error) { throw cleanError(error, 'Sync inspection'); }
}

export async function startSync(ctx, sessionId, syncId) {
  try {
    return syncResult(await forgeRequest(ctx,sessionId,'POST','/v1/sync',
      {body:{sync_id:syncId},idempotencyKey:syncId}),syncId);
  } catch (error) { throw cleanError(error, 'Sync'); }
}
