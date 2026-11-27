import fs from 'node:fs';
import { forgeRequest, forgeAccountIdentity } from '../lib/forge-client.js';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { setImmediate as yieldToEvents, setTimeout as delay } from 'node:timers/promises';
import { usageError } from '../args.js';
import { isUUID } from '../uuid.js';
import { accountIdentity, atomicWrite } from '../operations.js';
import { ApiError, NetworkError, backoffDelay, validateTransferUrl } from '../http.js';
import { printProgress } from '../output.js';
import { workspacePath, listProjectFiles, projectFileGrant, readSync, startSync } from '../lib/forge-workspace-client.js';
import { isForgeOperationTerminal, pruneExpiredRecords } from '../state-dir.js';
import { uuid, required, recordPath, findRecord, readRecordFor, readRecord, saveResult, report, poll, failed, projectUrl, transient, controlled, localWaitSeconds, emitHygieneNotices, observeSessionSync } from './forge.js';

function safePath(value, absolute = false) {
  const relative = absolute ? value?.replace(/^\/(workspace|inputs)\//, '') : value;
  if (typeof value !== 'string' || (absolute && !/^\/(workspace|inputs)(\/|$)/.test(value))
      || typeof relative !== 'string' || !relative || Buffer.byteLength(value)>1024
      || relative.startsWith('/') || relative.includes('\\') || /[\x00-\x1f\x7f]/.test(relative)
      || relative.split('/').some(p => !p || p === '.' || p === '..' || Buffer.byteLength(p)>255)) {
    throw usageError('forge: path must stay within its POSIX file root and contain no empty, dot, traversal, or backslash components.');
  }
  return value;
}

async function fileRecord(ctx, id, request, label, signal) {
  const account = request.session_id && ![SESSION_INPUT_UPLOAD, INPUT_BATCH, FILE_COPY, FILE_DELETE, FILE_DELETE_TREE].includes(request.type)
    ? await forgeAccountIdentity(ctx, request.session_id, {signal})
    : await accountIdentity(ctx, {signal});
  fs.mkdirSync(ctx.config.rootDir, { recursive: true, mode: 0o700 });
  const file = recordPath(ctx, id, true);
  const candidate = { id, ...account, request, result: null };
  const found = findRecord(ctx, id);
  let record = found.record;
  if (!record) {
    try {
      atomicWrite(file, JSON.stringify(candidate, null, 2)+'\n', true);
      record = candidate;
      pruneExpiredRecords(path.dirname(file), { isTerminal: isForgeOperationTerminal });
    }
    catch (error) { if (error.code !== 'EEXIST') throw error; record = readRecord(file); }
  } else if (found.legacy) {
    atomicWrite(file, JSON.stringify(record, null, 2)+'\n');
  }
  if (record?.id !== id || !isDeepStrictEqual(record.request, request)) {
    throw new ApiError({status:409,code:'request_conflict',message:`Forge request ${id} differs from its saved fields. Use the original request to retry.`});
  }
  if (Object.keys(account).some(field => record[field] !== account[field])) {
    throw usageError(`Forge request ${id} belongs to another account or API origin.`);
  }
  printProgress(`${label}: ${id}`);
  return {file,record};
}

const PART_SIZE = 16 * 1024 * 1024;
const SESSION_INPUT_UPLOAD = 'session-file-input-v1';
const INPUT_BATCH = 'project-input-batch-v1';
const FILE_COPY = 'project-file-copy-v1';
const FILE_DELETE = 'project-file-delete-v1';
const FILE_DELETE_TREE = 'project-file-delete-tree-v1';
const API = '/api/v1/forge';
const ACTIVE_SESSION_FILE_MUTATION_ACTION = 'This project has an active Forge session. Pause or close the active session first to modify saved files externally, or edit/delete /workspace files inside the session via `ariax forge run`.';

function fileSnapshot(fd, file) {
  const info = fs.fstatSync(fd);
  if (!info.isFile() || info.size > 20 * 1024 ** 3) throw usageError('Forge upload requires a regular file up to 20 GiB.');
  return {path:file,size_bytes:info.size,mtime_ms:info.mtimeMs,ctime_ms:info.ctimeMs,dev:info.dev,ino:info.ino};
}

function openRegularFile(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    if (!fs.fstatSync(fd).isFile()) throw usageError('Forge inputs require regular files.');
    return fd;
  } catch (error) { fs.closeSync(fd); throw error; }
}

function readPart(fd, size, position) {
  const bytes = Buffer.alloc(size);
  let done = 0;
  while (done < size) {
    const count = fs.readSync(fd, bytes, done, size - done, position + done);
    if (!count) throw new Error('Local input changed during upload; use a new input ID for the completed file.');
    done += count;
  }
  return bytes;
}

async function checksums(fd, metadata, signal) {
  const digests = [];
  const count = Math.max(1, Math.ceil(metadata.size_bytes / PART_SIZE));
  for (let i = 0; i < count; i++) {
    signal?.throwIfAborted();
    const size = Math.min(PART_SIZE, metadata.size_bytes - i * PART_SIZE);
    digests.push(createHash('md5').update(readPart(fd, size, i * PART_SIZE)).digest());
    // Let local deadlines and Ctrl-C run between the existing multipart parts.
    await yieldToEvents(undefined, {signal});
  }
  if (!isDeepStrictEqual(fileSnapshot(fd, metadata.path), metadata)) throw new Error('Local input changed while preparing the upload.');
  return {parts:digests.map(value => value.toString('base64')),
    checksum:`${createHash('md5').update(Buffer.concat(digests)).digest('hex')}-${count}`};
}

function readVerifiedPart(fd, localFile, metadata, index, expectedMd5) {
  if (!isDeepStrictEqual(fileSnapshot(fd, localFile), metadata)) {
    throw new Error('Local input changed during upload; use a new input ID for the completed file.');
  }
  const bytes = readPart(fd, Math.min(PART_SIZE, metadata.size_bytes - index * PART_SIZE), index * PART_SIZE);
  if (createHash('md5').update(bytes).digest('base64') !== expectedMd5) {
    throw new Error('Local input changed during upload; use a new input ID for the completed file.');
  }
  return bytes;
}

async function putUpload(grant, body, md5, signal) {
  const url = validateTransferUrl(grant?.url, 'Upload');
  const rawHeaders = grant?.headers ?? {};
  if ((grant?.method ?? 'PUT') !== 'PUT' || !rawHeaders || typeof rawHeaders !== 'object' || Array.isArray(rawHeaders)) {
    throw new Error('Forge returned an invalid upload grant.');
  }
  const headers = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    const lower = key.toLowerCase();
    if (typeof value !== 'string' || ['authorization', 'cookie', 'host', 'proxy-authorization'].includes(lower)
        || (lower === 'content-length' && value !== String(body.length))
        || (lower === 'content-md5' && value !== md5)) {
      throw new Error('Forge returned an invalid upload grant.');
    }
    headers[key] = value;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, {once:true});
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), 900000);
  try {
    const response = await fetch(url, {method:'PUT',headers,body,redirect:'error',signal:controller.signal});
    const etag = response.headers.get('etag');
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Upload failed (HTTP ${response.status}); retry with the same input ID.`);
    return { etag };
  } catch {
    // fetch errors can carry a credentialed URL through their nested cause.
    throw new NetworkError(controller.signal.aborted ? 'Upload exceeded its 900 second limit; retry with the same input ID.' : 'Upload did not complete; retry with the same input ID.');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

function writeInputRecord(file, record) {
  atomicWrite(file, JSON.stringify(record, null, 2) + '\n');
}

async function authorizeAndDispatchInput(ctx, sessionId, payload, signal) {
  try {
    const authorized = await ctx.client.post(`${API}/sessions/${sessionId}/inputs`, { body: payload, signal });
    if (authorized.data?.input_id !== undefined && authorized.data.input_id !== payload.input_id) {
      throw new NetworkError('Forge input authorization returned a mismatched input_id.');
    }
  } catch (error) {
    if (!(payload.source?.kind === 'url' && error instanceof ApiError && error.status === 404)) throw error;
  }
  return forgeRequest(ctx, sessionId, 'POST', '/v1/inputs', { body: payload, signal });
}

async function materializeUpload(ctx, sessionId, sessionPath, file, record, { signal, knownSessionState, waitReady = false } = {}) {
  const { input_id: id, path: target, source } = record.request.body;
  let sessionState = knownSessionState;
  if (waitReady) { await waitForInputsReady(ctx, sessionId, sessionPath, signal); sessionState = 'available'; }
  else if (!sessionState) sessionState = (await ctx.client.get(sessionPath, { query: { view: 'summary' }, signal })).data?.state ?? null;
  if (['closing', 'closed', 'failed'].includes(sessionState)) failed('session_unavailable', `Session ${sessionId} is ${sessionState}`);
  if (sessionState !== 'available') {
    const data = { input_id: id, path: target, size_bytes: source.size_bytes,
      ...(record.request.project_id ? { project_id: record.request.project_id } : {}),
      state: 'queued', upload_state: 'staged',
      action: `Upload is staged in object storage while session ${sessionId} is ${sessionState ?? 'starting'}. Once available, materialize with ariax forge recover ${id} --wait.` };
    saveResult(file, readRecord(file) ?? record, data);
    return { data };
  }
  const res = await forgeRequest(ctx, sessionId, 'POST', '/v1/inputs', {
    body: { input_id: id, path: target, source: { kind: 'upload', size_bytes: source.size_bytes } }, signal,
  });
  if (res.data?.input_id !== id || res.data?.path !== target) {
    throw new ApiError({ status: 409, code: 'request_conflict', message: `Forge input ${id} does not match its saved path.` });
  }
  saveResult(file, readRecord(file) ?? record, res.data);
  return res;
}

function inputExistsAction(target, projectId) {
  const baseName = path.posix.basename(String(target || 'file'));
  const suggestedPath = `fixed/${baseName}`;
  const projectRef = projectId || '<project-id>';
  return `Path already exists in /inputs (immutable). Upload under a new --path (e.g. ${suggestedPath}) or inspect existing inputs with: ariax forge files ${projectRef} --path /inputs`;
}

async function listProjectFilesRecursive(ctx, projectId, rootPath, { maxFiles = 500, maxPages = 100 } = {}) {
  const queue = [rootPath];
  const visitedDirs = new Set([rootPath]);
  const seenFiles = new Set();
  const files = [];
  let totalBytes = 0;
  let pagesFetched = 0;
  let truncated = false;
  let rootMeta = null;

  while (queue.length > 0 && !truncated) {
    const dir = queue.shift();
    let cursor;
    const seenCursors = new Set();
    for (;;) {
      if (pagesFetched >= maxPages) {
        truncated = true;
        break;
      }
      pagesFetched += 1;
      const res = await listProjectFiles(ctx, projectId, dir, cursor);
      if (!rootMeta) {
        rootMeta = res;
      }
      const data = res.data;
      for (const entry of data.entries) {
        if (entry.kind === 'directory') {
          if (!visitedDirs.has(entry.path)) {
            visitedDirs.add(entry.path);
            queue.push(entry.path);
          }
        } else if (entry.kind === 'file') {
          if (seenFiles.has(entry.path)) continue;
          if (files.length >= maxFiles) {
            truncated = true;
            break;
          }
          seenFiles.add(entry.path);
          files.push(entry);
          if (typeof entry.size_bytes === 'number' && Number.isSafeInteger(entry.size_bytes) && entry.size_bytes >= 0) {
            totalBytes += entry.size_bytes;
          }
        }
      }
      if (truncated || !data.next_cursor) break;
      if (seenCursors.has(data.next_cursor)) {
        throw new NetworkError('Project file listing repeated a pagination cursor.');
      }
      seenCursors.add(data.next_cursor);
      cursor = data.next_cursor;
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const baseData = rootMeta?.data ?? {};
  return {
    ...(rootMeta || {}),
    data: {
      project_id: projectId,
      path: rootPath,
      recursive: true,
      entries: files,
      file_count: files.length,
      total_bytes: totalBytes,
      truncated,
      next_cursor: null,
      mutation_revision: baseData.mutation_revision ?? 0,
      sync_state: baseData.sync_state ?? 'saved',
      last_synced_at: baseData.last_synced_at ?? null,
      durability_gap: baseData.durability_gap ?? false,
    },
  };
}

async function addSessionUploadInput(ctx, sessionId, sessionPath, id, target, localFile, signal, { source, knownProjectId, knownSessionState, waitReady = false } = {}) {
  const fd = openRegularFile(localFile);
  let resolvedProjectId = knownProjectId ?? null, sessionState = knownSessionState ?? null;
  try {
    const metadata = fileSnapshot(fd, localFile);
    const digests = await checksums(fd, metadata, signal);
    if (source && (!isDeepStrictEqual(source.local_file, metadata) || source.checksum !== digests.checksum)) {
      throw usageError('Batch source changed; recover the original unchanged file or start a new batch.');
    }
    const prior = readRecordFor(ctx, id);
    let request;
    if (prior) {
      request = prior.request;
      if (isUUID(request?.project_id)) resolvedProjectId = request.project_id;
      if (request?.type !== SESSION_INPUT_UPLOAD || request.session_id !== sessionId || request.path !== '/v1/inputs'
          || request.body?.input_id !== id || request.body?.path !== target || request.body?.source?.kind !== 'upload'
          || request.body?.source?.size_bytes !== metadata.size_bytes || request.body?.source?.part_size !== PART_SIZE
          || request.body?.source?.checksum !== digests.checksum || !isDeepStrictEqual(request.local_file, metadata)) {
        throw new ApiError({status:409,code:'request_conflict',message:`Forge request ${id} differs from its saved input. Use the original request to retry.`});
      }
    } else {
      if (!resolvedProjectId || !sessionState) {
        const session = (await ctx.client.get(sessionPath, { query: { view: 'summary' }, signal })).data;
        if (!resolvedProjectId && isUUID(session?.project_id)) resolvedProjectId = session.project_id;
        if (!sessionState && typeof session?.state === 'string') sessionState = session.state;
      }
      if (resolvedProjectId) {
        const remote = (await ctx.client.get(`${API}/projects/${resolvedProjectId}/files/metadata`, { query: { path: `/inputs/${target}` }, signal })).data;
        if (remote && remote.kind !== 'absent') {
          const existsErr = new ApiError({status:409,code:'input_exists',message:'This project input path already exists; choose a new path.'});
          existsErr.action = inputExistsAction(target, resolvedProjectId);
          throw existsErr;
        }
      }
      request = {
        type: SESSION_INPUT_UPLOAD, method: 'POST', session_id: sessionId,
        ...(resolvedProjectId ? { project_id: resolvedProjectId } : {}), path: '/v1/inputs',
        body: { input_id: id, path: target, source: { kind: 'upload', size_bytes: metadata.size_bytes, part_size: PART_SIZE, checksum: digests.checksum } },
        local_file: metadata,
      };
    }
    const { file, record } = await fileRecord(ctx, id, request, 'input_id', signal);
    const inputBase = `${API}/sessions/${sessionId}/inputs`;
    const markStaged = () => { record.upload_stage = 'staged'; writeInputRecord(file, record); };
    if (record.upload_stage !== 'staged') {
      const init = await ctx.client.post(inputBase, { body: request.body, signal });
      if (init.data?.input_id !== undefined && init.data.input_id !== id) throw new NetworkError('Forge input staging returned a mismatched input_id.');
      const upload = init.data?.upload;
      if (!upload) {
        if (['queued', 'staged', 'downloading', 'materializing', 'ready'].includes(init.data?.state)) markStaged();
        else if (init.data?.state === 'failed') { saveResult(file, record, init.data); return init; }
        else throw new Error('Forge input staging returned an incompatible upload response.');
      } else if (upload.mode === 'single') {
        if (digests.parts.length !== 1 || metadata.size_bytes > PART_SIZE) throw new Error('Forge returned single-part upload for a multipart input.');
        await putUpload(upload, readVerifiedPart(fd, localFile, metadata, 0, digests.parts[0]), digests.parts[0], signal);
        if (!isDeepStrictEqual(fileSnapshot(fd, localFile), metadata)) throw new Error('Local input changed during upload; use a new input ID for the completed file.');
        markStaged();
      } else if (upload.mode === 'multipart') {
        if (typeof upload.upload_id !== 'string' || !upload.upload_id
            || (upload.part_size !== undefined && upload.part_size !== PART_SIZE)
            || (upload.part_count !== undefined && upload.part_count !== digests.parts.length)) {
          throw new Error('Forge returned an invalid multipart upload plan.');
        }
        if (record.upload_id !== upload.upload_id) {
          record.upload_id = upload.upload_id;
          record.uploaded_parts = {};
          record.upload_stage = 'uploading';
          writeInputRecord(file, record);
        }
        record.uploaded_parts ??= {};
        for (let index = 0; index < digests.parts.length; index++) {
          const partNumber = index + 1;
          if (!isDeepStrictEqual(fileSnapshot(fd, localFile), metadata)) throw new Error('Local input changed during upload; use a new input ID for the completed file.');
          if (typeof record.uploaded_parts[partNumber] === 'string' && record.uploaded_parts[partNumber]) continue;
          const bytes = readVerifiedPart(fd, localFile, metadata, index, digests.parts[index]);
          const partRes = await ctx.client.post(`${inputBase}/${id}/parts`, { body: { number: partNumber, md5: digests.parts[index] }, signal });
          if (!partRes.data?.url && ['queued', 'staged', 'downloading', 'materializing', 'ready'].includes(partRes.data?.state)) { markStaged(); break; }
          if (partRes.data?.number !== undefined && partRes.data.number !== partNumber) throw new Error('Forge returned an invalid part upload grant.');
          const { etag } = await putUpload(partRes.data, bytes, digests.parts[index], signal);
          if (typeof etag !== 'string' || !etag.trim()) throw new NetworkError('Upload did not return a part ETag; retry with the same input ID.');
          record.uploaded_parts[partNumber] = etag.trim();
          writeInputRecord(file, record);
        }
        if (record.upload_stage !== 'staged') {
          if (!isDeepStrictEqual(fileSnapshot(fd, localFile), metadata)) throw new Error('Local input changed during upload; use a new input ID for the completed file.');
          const parts = digests.parts.map((_, idx) => ({ number: idx + 1, etag: record.uploaded_parts[idx + 1] }));
          record.upload_stage = 'completing';
          writeInputRecord(file, record);
          const completed = await ctx.client.post(`${inputBase}/${id}/complete`, { body: { parts }, signal });
          if (completed.data?.input_id !== undefined && completed.data.input_id !== id) throw new NetworkError('Forge multipart completion returned a mismatched input_id.');
          markStaged();
        }
      } else {
        throw new Error('Forge returned an unsupported upload mode.');
      }
    }
    return await materializeUpload(ctx, sessionId, sessionPath, file, readRecord(file) ?? record, { signal, knownSessionState: sessionState, waitReady });
  } catch (error) {
    if (error?.code === 'input_exists' || error?.code === 'input_path_exists') error.action = inputExistsAction(target, resolvedProjectId);
    else if (!error.action) error.action = `Inspect ariax forge inputs status ${sessionId} ${id}; retry with --input-id ${id}, the original source, account and root directory.`;
    throw error;
  } finally { fs.closeSync(fd); }
}

async function parallelFiles(files, concurrency, work) {
  const results = new Array(files.length);
  let next = 0;
  await Promise.all(Array.from({length:Math.min(concurrency,files.length)}, async () => {
    while (next < files.length) {
      const index = next++;
      results[index] = await work(files[index], index);
    }
  }));
  return results;
}

function batchPaths(files) {
  const paths = files.map(file => safePath(file?.path)), destinations = new Set(paths);
  if (destinations.size !== paths.length) throw usageError('Batch destinations must be unique.');
  for (const target of paths) {
    const parts = target.split('/');
    if (parts.slice(0,-1).some((_,index) => destinations.has(parts.slice(0,index+1).join('/')))) {
      throw usageError('Batch destinations must be unique and cannot contain file/directory collisions.');
    }
  }
}

async function batchManifest(filename, signal) {
  const manifest = path.resolve(filename);
  let value;
  try {
    const fd = openRegularFile(manifest);
    try {
      if (fs.fstatSync(fd).size > 1024 * 1024) throw usageError('Input manifest must be at most 1 MiB.');
      value = JSON.parse(fs.readFileSync(fd, 'utf8'));
    } finally { fs.closeSync(fd); }
  }
  catch { throw usageError('Input manifest must be a readable JSON object with a files array.'); }
  if (!value || !Array.isArray(value.files) || !value.files.length || value.files.length > 100) {
    throw usageError('Input manifest requires 1–100 explicitly listed local files.');
  }
  batchPaths(value.files);
  const files = [];
  for (const entry of value.files) {
    if (typeof entry.file !== 'string' || !entry.file || (entry.purpose !== undefined && typeof entry.purpose !== 'string')) {
      throw usageError('Each manifest entry requires file and path strings, with an optional purpose string.');
    }
    const local = path.resolve(path.dirname(manifest), entry.file);
    const fd = openRegularFile(local);
    try {
      const metadata = fileSnapshot(fd,local), digests = await checksums(fd,metadata,signal);
      files.push({path:entry.path,local_file:metadata,checksum:digests.checksum,...(entry.purpose === undefined ? {} : {purpose:entry.purpose})});
    } finally { fs.closeSync(fd); }
  }
  return files;
}

async function recoverInputBatch(ctx, record, {signal, account, wait = false, concurrency = 4} = {}) {
  const {request,id} = record, files = request.body.files;
  const session = uuid(request.session_id,'session ID'), project = uuid(request.project_id,'project ID');
  if (request.path !== '/v1/input-batches' || request.body.batch_id !== id || !Array.isArray(files)
      || !files.length || files.length > 100 || new Set(files.map(file => file.input_id)).size !== files.length) {
    throw usageError('Saved input batch is malformed; no upload was sent.');
  }
  batchPaths(files);
  for (const file of files) {
    uuid(file.input_id,'input ID');
    if (!file.local_file || !path.isAbsolute(file.local_file.path) || typeof file.checksum !== 'string') {
      throw usageError('Saved batch source is malformed; no upload was sent.');
    }
  }
  account ??= await accountIdentity(ctx,{signal});
  if (Object.keys(account).some(field => record[field] !== account[field])) throw usageError('Input batch belongs to another account or API origin.');
  let paused, retryAt = 0;
  const throttle = error => {
    if (error === paused) return;
    retryAt = Math.max(retryAt,Date.now()+Math.max(1,error.retryAfterMs ?? 1000));
    paused ??= Object.assign(new Error('Input batch is waiting for the API rate limit.'),{status:429});
  };
  // Stop the whole batch at the first 429. This transport never replays a POST.
  const original = ctx.client;
  const batchRequest = method => async (route,options = {}) => {
    signal?.throwIfAborted();
    if (paused) throw paused;
    try { return await original[method](route,{...options,...(method === 'get' ? {attempts:1} : {})}); }
    catch (error) { if (error.status === 429) { throttle(error); throw paused; } throw error; }
  };
  ctx = {...ctx,client:{...original,get:batchRequest('get'),post:batchRequest('post')}};
  const failure = (file,error) => {
    const limited = error.status === 429;
    if (limited) throttle(error);
    const uncertain = !limited && transient(error);
    return {input_id:file.input_id,path:file.path,size_bytes:file.local_file.size_bytes,
      state:limited ? 'pending' : uncertain ? 'unknown' : 'failed',
      error:{code:limited ? 'rate_limited' : uncertain ? 'input_unconfirmed' : 'input_staging_failed',
        message:'Inspect this input ID and recover the same batch.'}};
  };
  const rows = files.map(file => ({input_id:file.input_id,path:file.path,size_bytes:file.local_file.size_bytes,state:'pending'}));
  const summary = () => {
    const ready = rows.filter(row => row.state === 'ready').length, failedCount = rows.filter(row => row.state === 'failed').length;
    const unknown = rows.filter(row => row.state === 'unknown').length;
    const result = {data:{batch_id:id,session_id:session,project_id:project,state:failedCount === files.length ? 'failed' : failedCount || unknown ? 'partial' : ready === files.length ? 'ready' : 'pending',
      total_bytes:files.reduce((sum,file) => sum+file.local_file.size_bytes,0),ready_count:ready,pending_count:files.length-ready-failedCount-unknown,
      failed_count:failedCount,unknown_count:unknown,input_ids:files.map(file => file.input_id),files:rows}};
    saveResult(recordPath(ctx,id),record,result.data);
    return result;
  };
  const outcome = () => {
    const result = summary();
    if (result.data.failed_count || result.data.unknown_count) {
      const error = new ApiError({status:409,code:'input_batch_failed',message:'Some batch inputs did not finish; successful inputs were preserved.',details:result.data});
      error.action = `Recover with ariax forge recover ${id} --wait using the original root, account and source files.`;
      throw error;
    }
    return result;
  };
  // Preserve completed work within a phase across read or mutation cooldowns.
  // Otherwise a large reconciliation can spend every window rereading its prefix.
  const phase = async work => {
    const done = new Set(), values = new Array(files.length);
    do {
      await parallelFiles(files,concurrency,async (file,index) => {
        if (done.has(index)) return;
        try { values[index] = await work(file,index); done.add(index); }
        catch (error) {
          if (signal?.aborted || error.status !== 429) throw error;
          throttle(error);
        }
      });
      summary();
      if (!paused) return values;
      printProgress('API rate limit reached; waiting before reconciling unfinished inputs.');
      await delay(Math.max(1,retryAt-Date.now()),undefined,{signal});
      paused = undefined;
    } while (true);
  };
  const observe = async file => {
      signal?.throwIfAborted();
      const child = readRecord(recordPath(ctx,file.input_id));
      if (child) {
        if (child.id !== file.input_id || child.request.type !== SESSION_INPUT_UPLOAD || child.request.session_id !== session
            || (child.request.project_id && child.request.project_id !== project)
            || child.request.body?.path !== file.path
            || child.request.body?.source?.checksum !== file.checksum || !isDeepStrictEqual(child.request.local_file,file.local_file)
            || Object.keys(account).some(field => child[field] !== account[field])) {
          throw usageError('Batch child differs from its saved source or account; no upload was sent.');
        }
        try { return {child,current:await observeInput(ctx,session,file.input_id,child,signal)}; }
        catch (error) { if (error.status === 429) throw error; return {child,error}; }
      }
      try {
        await ctx.client.get(`${API}/sessions/${session}/inputs/${file.input_id}`,{signal});
      } catch (error) { if (error.status === 429) throw error; return error.status === 404 ? {} : {error}; }
      throw usageError('A batch input exists without its original child journal; restore the journal before recovery.');
  };
  // Reconcile all IDs once before staging. A retry observes its unfinished ID
  // again, so a lost publication reply can never cause another object transfer.
  const observed = await phase(async (file,index) => {
    const value = await observe(file);
    if (value.current) rows[index] = value.current.data;
    return value;
  });
  await phase(async (file,index) => {
    const previous = observed[index];
    observed[index] = undefined;
    const {child,current,error} = previous ?? await observe(file);
    try {
      if (error) throw error;
      if (current && !current.retained && ['ready','failed'].includes(current.data?.state)) {
        saveResult(recordPath(ctx,file.input_id),child,current.data);
        rows[index] = current.data;
      } else {
        rows[index] = (child ? await recoverFile(ctx,file.input_id,child,{signal,account})
          : await addSessionUploadInput(ctx,session,`${API}/sessions/${session}`,file.input_id,file.path,file.local_file.path,signal,{source:file,knownProjectId:project})).data;
      }
    } catch (error) {
      if (signal?.aborted || error.status === 429) throw error;
      printProgress(`input ${file.input_id}: ${error.code ?? 'upload_failed'}`);
      rows[index] = failure(file,error);
    }
  });
  outcome();
  do {
    // Verify live daemon materialization across all files in the batch.
    await phase(async (file,index) => {
      try { rows[index] = (await inputStatus(ctx,session,file.input_id,{signal,account})).data; }
      catch (error) {
        if (signal?.aborted || error.status === 429) throw error;
        rows[index] = failure(file,error);
      }
    });
    const result = outcome();
    if (!wait || result.data.state === 'ready') return result;
    printProgress(`Inputs ready: ${result.data.ready_count}/${files.length}`);
    await delay(1000,undefined,{signal});
  } while (true);
}

async function addInputBatch(ctx, session, sessionPath) {
  const flags = ctx.flags;
  if (['file','artifact','url','path','input-id'].some(name => flags[name] !== undefined)
      || (flags['dry-run'] && flags.wait)) throw usageError('Manifest staging cannot combine with single-file options or --dry-run with --wait.');
  const id = flags['batch-id'] === undefined ? randomUUID() : uuid(flags['batch-id'],'batch ID');
  const concurrency = flags.concurrency === undefined ? 4 : Number(flags.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw usageError('--concurrency must be 1–4.');
  const seconds = localWaitSeconds(flags['wait-timeout'],1800);
  return controlled(ctx,id,seconds,async signal => {
    const files = await batchManifest(required(flags.manifest,'manifest'),signal);
    const preview = {files:files.map(file => ({file:file.local_file.path,path:file.path,size_bytes:file.local_file.size_bytes,...(file.purpose === undefined ? {} : {purpose:file.purpose})})),total_bytes:files.reduce((sum,file) => sum+file.local_file.size_bytes,0)};
    if (flags['dry-run']) return report(ctx,{data:{state:'dry_run',...preview}});
    const prior = readRecord(recordPath(ctx,id));
    let record;
    if (prior) {
      if (prior.request?.type !== INPUT_BATCH || prior.request.session_id !== session
          || !isDeepStrictEqual(prior.request.body.files.map(({input_id,...file}) => file),files)) {
        throw usageError('Batch differs from its original immutable manifest; use the original batch or a new ID.');
      }
      record = prior;
    } else {
      const project = uuid((await ctx.client.get(sessionPath,{signal})).data.project_id,'project ID');
      const request = {type:INPUT_BATCH,method:'POST',path:'/v1/input-batches',session_id:session,project_id:project,
        body:{batch_id:id,files:files.map(file => ({input_id:randomUUID(),...file}))}};
      record = (await fileRecord(ctx,id,request,'batch_id',signal)).record;
    }
    return report(ctx,await recoverInputBatch(ctx,record,{signal,wait:!!flags.wait,concurrency}));
  });
}

export async function inputStatus(ctx, sessionId, id, {signal} = {}) {
  return forgeRequest(ctx,sessionId,'GET',`/v1/inputs/${id}`,{signal});
}

async function observeInput(ctx, session, id, record, signal) {
  let directError;
  try {
    const identity = await forgeAccountIdentity(ctx,session,{signal});
    if (Object.keys(identity).some(field => record[field] !== identity[field])) {
      throw usageError(`Forge operation ${id} belongs to another account or API origin.`);
    }
    return await forgeRequest(ctx,session,'GET',`/v1/inputs/${id}`,{signal});
  } catch (error) {
    if (error.status === 429 || (error.status !== 404 && error.code !== 'session_unready' && !transient(error))) throw error;
    directError = error;
  }
  let retained;
  try { retained = await ctx.client.get(`${API}/sessions/${session}/inputs/${id}`,{signal}); }
  catch (error) { if (error.status !== 404) throw error; }
  if (retained) return { ...retained, meta:{...retained.meta,source:'retained'}, retained:true };
  if (directError.status !== 404 && !(record.request?.type === SESSION_INPUT_UPLOAD && directError.code === 'session_unready')) throw directError;
  return null;
}

async function copyStatus(ctx, record, signal) {
  const {id,request} = record;
  let result;
  try { result = await ctx.client.get(`${API}/projects/${request.project_id}/files/operations/${id}`,{signal}); }
  catch (error) { if (error.status === 404) return null; throw error; }
  const value = result.data;
  if (value?.operation_id !== id || value.session_id !== request.session_id
      || !['open','published','expired','pending','failed'].includes(value.state) || !['host','offline'].includes(value.source)
      || !['ready','pending','conflict','unknown','not_applicable'].includes(value.local_state)
      || (value.state === 'published' && (!Number.isSafeInteger(value.version) || value.version <= 0))) {
    throw new NetworkError('File recovery response does not match the saved operation.');
  }
  const state = value.state === 'expired' || value.state === 'failed' || value.local_state === 'conflict' ? 'failed'
    : value.state !== 'published' ? 'pending' : value.local_state === 'ready' ? 'ready'
    : value.local_state === 'not_applicable' ? 'saved' : 'pending';
  return {...result,data:{operation_id:id,project_id:request.project_id,session_id:request.session_id,
    path:request.body.path,source:request.body.source,state,storage_state:value.state,
    installation_status:value.local_state,...(value.version == null ? {} : {version:value.version}),
    copy_origin:value.source,...(value.error && typeof value.error.code === 'string' && typeof value.error.message === 'string'
      ? {error:{code:value.error.code,message:value.error.message}} : {})}};
}

async function recoverCopy(ctx, record, signal) {
  const {id,request} = record, project = uuid(request.project_id,'project ID');
  if (request.path !== `${API}/projects/${project}/files/recover` || request.body?.operation_id !== id
      || request.body?.session_id !== request.session_id) throw usageError(`Saved file recovery ${id} is malformed.`);
  let current = await copyStatus(ctx,record,signal);
  if (!current && record.result) throw new ApiError({status:409,code:'file_recovery_unconfirmed',message:`Previously observed file recovery ${id} is absent from project history.`});
  if (current?.data.state === 'failed') return current;
  // Offline copies make bounded progress on each identical POST. Host-backed
  // copies advance in the daemon; repeat once to validate an unconfirmed ID.
  if (!current || !record.result || (current.data.storage_state === 'open' && current.data.copy_origin === 'offline')) {
    const started = await ctx.client.post(request.path,{body:request.body,signal});
    if (!['open','published'].includes(started.data?.state)) throw new NetworkError('File recovery returned an invalid receipt.');
    if (started.data.retry_after !== undefined && (typeof started.data.retry_after !== 'number'
        || !Number.isFinite(started.data.retry_after) || started.data.retry_after < 0 || started.data.retry_after > 120)) {
      throw new NetworkError('File recovery returned an invalid retry interval.');
    }
    current = await copyStatus(ctx,record,signal);
    if (!current) throw new NetworkError('File recovery receipt is not yet observable.');
    if (started.data.retry_after !== undefined) current.data.retry_after = started.data.retry_after;
  }
  return current;
}

// The URL itself is deliberately not journaled. A same-process retry can use
// the original in-memory URL; a later recovery may only observe its outcome.
export async function recoverFile(ctx, id, record, {signal, account, body, retryFailedSync = false, waitReady = false} = {}) {
  const request = record.request, session = uuid(request?.session_id,'session ID');
  if (request.type === INPUT_BATCH) return recoverInputBatch(ctx,record,{signal,account,wait:!!ctx.flags.wait});
  const file = recordPath(ctx,id,true);
  for (let attempt = 0; ; attempt++) {
    try {
      let result;
      if (request.type !== SESSION_INPUT_UPLOAD && request.type !== FILE_COPY && request.type !== FILE_DELETE && request.type !== FILE_DELETE_TREE && request.path !== '/v1/inputs') {
        const identity = await forgeAccountIdentity(ctx,session,{signal});
        if (Object.keys(identity).some(field => record[field] !== identity[field])) {
          throw usageError(`Forge operation ${id} belongs to another account or API origin.`);
        }
      }
      if (request.type === FILE_DELETE || request.type === FILE_DELETE_TREE) {
        const identity = account ?? await accountIdentity(ctx,{signal});
        if (Object.keys(identity).some(field => record[field] !== identity[field])) throw usageError(`Forge operation ${id} belongs to another account or API origin.`);
        result = request.type === FILE_DELETE_TREE ? await recoverDeleteTree(ctx,record,signal) : await recoverDelete(ctx,record,signal);
      } else if (request.type === FILE_COPY) {
        const identity = account ?? await accountIdentity(ctx,{signal});
        if (Object.keys(identity).some(field => record[field] !== identity[field])) throw usageError(`Forge operation ${id} belongs to another account or API origin.`);
        result = await recoverCopy(ctx,record,signal);
      } else if (request.type === SESSION_INPUT_UPLOAD) {
        const identity = account ?? await accountIdentity(ctx,{signal});
        if (Object.keys(identity).some(field => record[field] !== identity[field])) {
          throw usageError(`Forge operation ${id} belongs to another account or API origin.`);
        }
        const target = safePath(request.body?.path);
        if (request.method !== 'POST' || request.path !== '/v1/inputs'
            || request.body?.input_id !== id || request.body?.source?.kind !== 'upload'
            || typeof request.local_file?.path !== 'string' || !path.isAbsolute(request.local_file.path)) {
          throw usageError(`Saved Forge input ${id} is malformed; no request was sent.`);
        }
        const observed = await observeInput(ctx,session,id,record,signal);
        if (observed && (observed.data?.input_id !== id || observed.data?.path !== target)) {
          throw new ApiError({status:409,code:'request_conflict',message:`Forge input ${id} does not match its saved path.`});
        }
        if (observed && !observed.retained) {
          result = observed;
        } else if (observed?.retained && ['ready','failed'].includes(observed.data?.state)) {
          result = observed;
        } else if (record.upload_stage === 'staged' || ['queued','staged'].includes(observed?.data?.state)) {
          if (record.upload_stage !== 'staged') {
            record.upload_stage = 'staged';
            writeInputRecord(file, record);
          }
          result = await materializeUpload(ctx,session,`${API}/sessions/${session}`,file,record,{signal,waitReady});
        } else if (!observed && record.result?.state === 'ready') {
          throw new ApiError({status:409,code:'input_unconfirmed',message:`Previously observed input ${id} is absent from session history. Inspect the project before another upload.`});
        } else {
          try {
            result = await addSessionUploadInput(ctx,session,`${API}/sessions/${session}`,id,target,request.local_file.path,signal,{waitReady});
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            throw usageError(`Input ${id} is not yet staged. Restore its original unchanged source file before recovery.`);
          }
        }
      } else if (request.path === '/v1/sync' && request.body?.sync_id === id) {
        try { result = await readSync(ctx,session,id,{signal}); }
        catch (error) { if (error.status !== 404) throw error; }
        if (!result && record.result) throw new ApiError({status:409,code:'sync_unconfirmed',message:`Previously observed sync ${id} is absent from session history. Inspect saved files before another flush.`});
        if (result?.data.state === 'failed' && retryFailedSync && result.data.error?.code !== 'final_sync_incomplete') {
          result = await startSync(ctx,session,id,{signal});
        }
        if (!result) result = await startSync(ctx,session,id,{signal});
      } else if (request.path === '/v1/inputs' && request.body?.input_id === id) {
        result = await observeInput(ctx,session,id,record,signal);
        if (result && (result.data?.input_id !== id || result.data?.path !== request.body.path)) {
          throw new ApiError({status:409,code:'request_conflict',message:`Forge input ${id} does not match its saved path.`});
        }
        if (result && (!record.result || body)) {
          // The public input record omits its source. An existing ID can have
          // the right path but different bytes; let the server compare the
          // original source before attributing it to this saved request.
          if (result.retained || (request.body.source?.kind === 'url' && !body)) {
            const error = new ApiError({status:409,code:'input_unconfirmed',message:`Input ${id} exists, but its original source cannot be confirmed from this saved record.`});
            error.action = request.body.source?.kind === 'url'
              ? `Repeat the original inputs add with its URL and --input-id ${id} while the session is active, or inspect retained history.`
              : `Inspect input ${id} and its retained history before another action.`;
            throw error;
          }
          result = await authorizeAndDispatchInput(ctx,session,body ?? request.body,signal);
        }
        if (!result) {
          if (record.result) throw new ApiError({status:409,code:'input_unconfirmed',message:`Previously observed input ${id} is absent from session history. Inspect the project before another import.`});
          if (request.body.source?.kind === 'url' && !body) {
            const error = usageError(`The original URL for input ${id} was not saved. Repeat inputs add with the original URL and --input-id ${id}.`);
            error.action = `Use the original URL, root directory, account and API origin for input ${id}.`;
            throw error;
          }
          const source = body ?? request.body;
          if (!['artifact','url'].includes(source.source?.kind)) throw usageError(`Saved Forge input ${id} cannot be replayed.`);
          result = await authorizeAndDispatchInput(ctx,session,source,signal);
        }
      } else throw usageError(`Saved Forge operation ${id} cannot be recovered as a file operation.`);
      if (request.path === '/v1/inputs' && (result.data?.input_id !== id || result.data?.path !== request.body.path)) {
        throw new ApiError({status:409,code:'request_conflict',message:`Forge input ${id} does not match its saved path.`});
      }
      saveResult(file,readRecord(file) ?? record,result.data);
      return result;
    } catch (error) {
      if (signal?.aborted || !transient(error) || attempt >= 2) throw error;
      printProgress(`Temporary error; reconciling saved operation ${id} (retry ${attempt + 1}/2).`);
      await delay(error.retryAfterMs ?? backoffDelay(attempt,500,3000),undefined,{signal});
    }
  }
}

export function failedSync(id, session, data) {
  const final = data.error?.code === 'final_sync_incomplete';
  const error = new ApiError({status:500,code:'sync_failed',
    message:`Sync ${id} failed${data.error?.code ? ` (${data.error.code})` : ''}.`,retryable:!final});
  error.details = {sync_id:id,...(data.diagnostics ? {diagnostics:data.diagnostics} : {})};
  error.action = final ? 'The final-save deadline cannot be reopened. Inspect retained files and session status.'
    : `Inspect the listed files, resolve the cause, then retry this same flush with ariax forge sync ${session} --sync-id ${id} --wait or ariax forge recover ${id} --wait.`;
  for (const item of data.diagnostics?.files ?? []) printProgress(`file: ${item.path ?? '(path unavailable)'} [${item.code}]`);
  if (data.diagnostics?.truncated) printProgress('Additional file diagnostics were truncated.');
  throw error;
}

async function download(grant, destination) {
  const url = validateTransferUrl(grant.download_url, 'Download');
  const requested = path.resolve(destination);
  fs.mkdirSync(path.dirname(requested), { recursive: true, mode: 0o700 });
  // Resolve the user-selected destination root as the existing downloader does.
  // This includes macOS aliases such as /tmp and /var.
  const dest = path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
  if (fs.existsSync(dest)) throw usageError(`Download destination already exists: ${dest}`);
  const temporary = `${dest}.part-${randomUUID()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 900000);
  let bytes = 0, partBytes = 0, partHash = createHash('md5');
  const partDigests = [];
  try {
    const response = await fetch(url,{redirect:'error',signal:controller.signal});
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error('Download failed.');
    }
    const counter = new Transform({transform(chunk,encoding,callback) {
      bytes += chunk.length;
      if (bytes > grant.size_bytes) callback(new Error('Download exceeded its declared size.'));
      else {
        let offset = 0;
        while (offset < chunk.length) {
          const length = Math.min(grant.part_size - partBytes,chunk.length - offset);
          partHash.update(chunk.subarray(offset,offset + length));
          offset += length;
          partBytes += length;
          if (partBytes === grant.part_size) {
            partDigests.push(partHash.digest());
            partHash = createHash('md5');
            partBytes = 0;
          }
        }
        callback(null,chunk);
      }
    }});
    await pipeline(Readable.fromWeb(response.body),counter,fs.createWriteStream(temporary,{flags:'wx',mode:0o600}),{signal:controller.signal});
    if (bytes !== grant.size_bytes) throw new Error('Download size differs from the declared file size.');
    if (partBytes || !partDigests.length) partDigests.push(partHash.digest());
    const checksum = `${createHash('md5').update(Buffer.concat(partDigests)).digest('hex')}-${partDigests.length}`;
    if (checksum !== grant.checksum) throw new Error('Download checksum differs from the declared file checksum.');
    const fd = fs.openSync(temporary,'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.linkSync(temporary,dest);
    return {path:grant.path,destination:dest,size_bytes:bytes};
  } catch (error) {
    throw new Error(controller.signal.aborted ? 'Download exceeded its 900 second limit.' : 'Download failed; the destination was not published.');
  } finally { clearTimeout(timer); fs.rmSync(temporary,{force:true}); }
}

function copySource(flags) {
  const supplied = ['catalog','archive','artifact'].filter(name => flags[name] !== undefined);
  if (supplied.length !== 1) throw usageError('forge files recover: choose one of --catalog, --archive, or --artifact.');
  const kind = supplied[0], raw = required(flags[kind],kind), first = raw.indexOf(':');
  if (first < 0) throw usageError(`forge files recover: --${kind} requires a project ID and path.`);
  const project_id = uuid(raw.slice(0,first),'source project ID');
  let rest = raw.slice(first + 1), checkpoint_id;
  if (kind === 'archive') {
    const second = rest.indexOf(':');
    if (second < 0) throw usageError('forge files recover: --archive requires PROJECT:CHECKPOINT:PATH.');
    checkpoint_id = uuid(rest.slice(0,second),'checkpoint ID');
    rest = rest.slice(second + 1);
  }
  const sourcePath = kind === 'artifact' ? safePath(rest) : workspacePath(rest);
  if (kind !== 'catalog' && flags.version !== undefined) throw usageError('forge files recover: --version applies only to --catalog.');
  let version;
  if (kind === 'catalog') {
    version = Number(required(flags.version,'version'));
    if (!Number.isSafeInteger(version) || version <= 0) throw usageError('forge files recover: --version must be a positive integer.');
  }
  return {kind,project_id,path:sourcePath,...(version === undefined ? {} : {version}),
    ...(checkpoint_id === undefined ? {} : {checkpoint_id})};
}

async function deleteStatus(ctx, record, signal) {
  const {id,request} = record, base = `${API}/projects/${request.project_id}/files`;
  let result;
  try { result = await ctx.client.get(`${base}/operations/${id}`,{signal}); }
  catch (error) { if (error.status === 404) return null; throw error; }
  const value = result.data;
  if (value?.operation_id !== id || value.session_id !== request.session_id
      || !['pending','deleted','failed','expired'].includes(value.state)
      || !['host','offline'].includes(value.source)
      || !['ready','pending','conflict','unknown','not_applicable'].includes(value.local_state)
      || (value.catalog_state !== undefined && !['pending','deleted'].includes(value.catalog_state))
      || (value.deletion_phase !== undefined && !['queued','waiting_for_writers','applying','completed','failed'].includes(value.deletion_phase))
      || (value.cleanup_state !== undefined && !['pending','complete','attention','unknown'].includes(value.cleanup_state))) {
    throw new NetworkError('File deletion response does not match the saved operation.');
  }
  const state = ['failed','expired'].includes(value.state) || value.local_state === 'conflict' ? 'failed'
    : value.state === 'deleted' && ['ready','not_applicable'].includes(value.local_state) ? 'deleted' : 'pending';
  return {...result,data:{operation_id:id,project_id:request.project_id,session_id:request.session_id,
    path:request.body.path,state,local_state:value.local_state,cleanup_state:value.cleanup_state ?? 'unknown',
    ...(value.catalog_state ? {catalog_state:value.catalog_state} : {}),
    ...(value.deletion_phase ? {deletion_phase:value.deletion_phase} : {}),
    ...(value.error ? {error:value.error} : {}),
    ...(value.failure_code ? {failure_code:value.failure_code} : {}),
    ...(value.recovery_path ? {recovery_path:value.recovery_path} : {}),
    ...(value.version == null ? {} : {version:value.version})}};
}

/** Observe the existing native receipt without advancing recursive work. */
export async function observeFileDeletion(ctx, projectId, id, signal) {
  const record = readRecord(recordPath(ctx, id));
  if (!record || record.request?.project_id !== projectId || ![FILE_DELETE, FILE_DELETE_TREE].includes(record.request.type)) {
    throw usageError('Restore the original Forge deletion journal before observing this native operation. Use ariax forge recover for explicit recovery.');
  }
  const account = await accountIdentity(ctx, { signal });
  if (Object.keys(account).some(key => record[key] !== account[key])) throw usageError('Forge deletion belongs to another account or API origin.');
  if (record.request.type === FILE_DELETE) return await deleteStatus(ctx, record, signal) ?? { data: { operation_id: id, project_id: projectId,
    path: record.request.body.path, state: 'unconfirmed', cleanup_state: 'unknown' } };
  const request = record.request;
  const cleanup = (await ctx.client.get(`${API}/projects/${projectId}/files/cleanup`, { query: {
    path: request.body.path, started_at: request.body.operation_started_at, group_id: id,
  }, signal })).data;
  if (!Number.isSafeInteger(cleanup?.pending) || cleanup.pending < 0 || !Number.isSafeInteger(cleanup.attention)
      || cleanup.attention < 0 || cleanup.attention > cleanup.pending) throw new NetworkError('Directory cleanup status is invalid.');
  return { data: { ...(record.result ?? { state: 'unconfirmed' }), operation_id: id, project_id: projectId, path: request.body.path,
    cleanup_state: cleanup.attention ? 'attention' : cleanup.pending ? 'pending' : 'complete', cleanup_remaining: cleanup.pending } };
}

async function recoverDelete(ctx, record, signal) {
  const {id,request} = record, project = uuid(request.project_id,'project ID');
  if (request.method !== 'POST' || request.path !== `${API}/projects/${project}/files/delete`
      || request.body?.operation_id !== id || request.body?.session_id !== request.session_id) {
    throw usageError(`Saved file deletion ${id} is malformed.`);
  }
  let current = await deleteStatus(ctx,record,signal);
  if (!current) {
    const started = await ctx.client.post(request.path,{body:request.body,signal});
    if (!['pending','deleted'].includes(started.data?.state)) throw new NetworkError('File deletion returned an invalid receipt.');
    current = await deleteStatus(ctx,record,signal);
    if (!current) return {...started,data:{operation_id:id,project_id:project,session_id:request.session_id,
      path:request.body.path,state:'pending',local_state:'pending',cleanup_state:'unknown'}};
  }
  return current;
}

function treeChildId(rootId, target) {
  const bytes = createHash('sha256').update(rootId).update('\0').update(target).digest().subarray(0,16);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

// One durable root record retains a bounded batch of exact child requests.
// After interruption the next invocation reconciles that batch before listing
// the remaining paths again. A new file version is never selected implicitly.
async function recoverDeleteTree(ctx, record, signal) {
  const {id,request} = record, project = uuid(request.project_id,'project ID');
  const base = `${API}/projects/${project}/files`, file = recordPath(ctx,id,true);
  if (!readRecord(file)) atomicWrite(file, JSON.stringify(record, null, 2)+'\n');
  const root = workspacePath(request.body.path);
  if (request.path !== `${base}/delete` || request.body.operation_id !== id || request.body.session_id !== request.session_id
      || (request.group_id !== undefined && request.group_id !== id)
      || !Number.isSafeInteger(request.body.expected_project_revision) || request.body.expected_project_revision < 0) {
    throw usageError(`Saved directory deletion ${id} is malformed.`);
  }
  const revision = request.body.expected_project_revision;
  const write = value => atomicWrite(file, JSON.stringify(value, null, 2)+'\n');
  const failedPaths = new Set((record.failures ?? []).map(item => item.path));
  function recordChanged(path) {
    if (failedPaths.has(path)) return;
    const saved = readRecord(file), failures = [...(saved.failures ?? []), {
      operation_id:treeChildId(id,path),path,
      error:{code:'file_revision_conflict',message:'The path changed after recursive deletion started.'},
    }];
    failedPaths.add(path);
    write({...saved,failures,result:{...(saved.result ?? {}),state:'pending',failed_count:failures.length}});
  }
  async function cleanupStatus(data) {
    const cleanup = (await ctx.client.get(`${base}/cleanup`,{query:{path:root,started_at:request.body.operation_started_at,
      ...(request.group_id ? {group_id:request.group_id} : {})},signal})).data;
    if (!Number.isSafeInteger(cleanup?.pending) || !Number.isSafeInteger(cleanup?.attention)
        || cleanup.pending < 0 || cleanup.attention < 0 || cleanup.attention > cleanup.pending) {
      throw new NetworkError('Directory cleanup status is invalid.');
    }
    const progress = cleanup.progress;
    if (progress !== undefined && (!progress || typeof progress !== 'object'
        || ['accepted','queued_or_applying','catalog_deleted_unconfirmed','completed','failed','catalog_deleted']
          .some(key => !Number.isSafeInteger(progress[key]) || progress[key] < 0))) {
      throw new NetworkError('Directory deletion progress is invalid.');
    }
    return {...data,cleanup_state:cleanup.attention ? 'attention' : cleanup.pending ? 'pending' : 'complete',
      cleanup_remaining:cleanup.pending,...(progress ? {progress} : {})};
  }
  if (['deleted','failed'].includes(record.result?.state) && !(record.pending ?? []).length) {
    return {data:await cleanupStatus(record.result)};
  }
  async function settlePending() {
    let lastProgressLine;
    for (;;) {
      const saved = readRecord(file), pending = saved.pending ?? [];
      if (!Array.isArray(pending) || pending.length > 128) throw usageError(`Saved directory deletion ${id} has invalid pending work.`);
      if (!pending.length) return;
      let response;
      try { response = await ctx.client.post(`${base}/delete-batch`,{body:{items:pending},signal}); }
      catch (error) {
        if (error.status !== 429) throw error;
        await delay(error.retryAfterMs ?? 3000,undefined,{signal});
        continue;
      }
      const results = response.data?.items;
      if (!Array.isArray(results) || results.length !== pending.length
          || results.some((value,index) => value.operation_id !== pending[index].operation_id
            || (!['deleted','pending'].includes(value.state) && !value.error))) {
        throw new NetworkError('Directory deletion returned an invalid batch receipt.');
      }
      const failures = [...(saved.failures ?? [])];
      const remaining = [];
      let completed = 0;
      for (let index = 0; index < results.length; index++) {
        const value = results[index], item = pending[index];
        if (value.state === 'deleted') completed++;
        else if (value.error && !['transfer_busy','sync_busy'].includes(value.error.code)) {
          failures.push({operation_id:item.operation_id,path:item.path,error:value.error});
          failedPaths.add(item.path);
        } else remaining.push(item);
      }
      const deleted_count = (saved.result?.deleted_count ?? 0) + completed;
      const rootCompleted = results.some((value,index) => value.state === 'deleted' && pending[index].path === root);
      const result = rootCompleted && !remaining.length && !failures.length
        ? {operation_id:id,project_id:project,session_id:request.session_id,path:root,state:'deleted',deleted_count}
        : {state:'pending',deleted_count,failed_count:failures.length};
      write({...saved,pending:remaining,failures,result});
      if (remaining.length) {
        const line = `Directory deletion ${id}: ${deleted_count} completed, ${failures.length} failed, ${remaining.length} pending`;
        if (line !== lastProgressLine) {
          printProgress(line);
          lastProgressLine = line;
        }
        await delay(3000,undefined,{signal});
        continue;
      }
      return;
    }
  }

  async function removeBatch(items) {
    for (let offset = 0; offset < items.length; offset += 128) {
      const started = request.group_id ? new Date().toISOString() : request.body.operation_started_at;
      const batch = items.slice(offset,offset+128).map(item => ({
        operation_id:treeChildId(id,item.path),session_id:request.session_id,operation_started_at:started,
        path:item.path,control_revision:request.body.control_revision,writer_epoch:request.body.writer_epoch,
        expected_version:item.version,expected_project_revision:item.mutation_revision,
        ...(request.group_id ? {group_id:request.group_id,recursive_root:root} : {}),
      }));
      const saved = readRecord(file);
      write({...saved,pending:batch});
      await settlePending();
    }
  }

  let files = [], directories = [];
  async function flushFiles() { const batch = files; files = []; await removeBatch(batch); }
  async function flushDirectories() { const batch = directories; directories = []; await removeBatch(batch); }
  async function visit(directory, phase) {
    let cursor;
    do {
      let page;
      try { page = (await listProjectFiles(ctx,project,directory,cursor)).data; }
      catch (error) { if (error.status === 404) break; throw error; }
      const items = page.entries;
      for (const item of items) if (item.version > revision) recordChanged(item.path);
      for (const item of items.filter(item => item.kind === 'directory')) await visit(item.path,phase);
      for (const item of items.filter(item => item.kind === 'file')) {
        if (failedPaths.has(item.path)) continue;
        if (phase !== 'files') { recordChanged(item.path); continue; }
        files.push({...item,mutation_revision:page.mutation_revision});
        if (files.length === 128) await flushFiles();
      }
      cursor = page.next_cursor;
    } while (cursor);
    if (phase === 'files') return;
    // A failed child cannot make its ancestors empty. Continue through other
    // branches, but retain those directories for an explicit later decision.
    if ([...failedPaths].some(path => path === directory || path.startsWith(directory + '/'))) return;
    if (directories.some(item => item.path.startsWith(directory + '/'))) await flushDirectories();
    const metadata = (await ctx.client.get(`${base}/metadata`,{query:{path:directory},signal})).data;
    if (metadata.kind === 'file' || (metadata.kind === 'directory' && metadata.version > revision)) {
      recordChanged(directory);
      return;
    }
    if (!['directory','absent','tombstone'].includes(metadata.kind)
        || !Number.isSafeInteger(metadata.version) || !Number.isSafeInteger(metadata.mutation_revision)) {
      throw new NetworkError('Directory metadata is invalid.');
    }
    directories.push({path:directory,version:metadata.version,mutation_revision:metadata.mutation_revision});
    if (directories.length === 128) await flushDirectories();
  }

  await settlePending();
  const settled = readRecord(file);
  if (settled.result?.state === 'deleted') return {data:await cleanupStatus(settled.result)};
  await visit(root,'files');
  await flushFiles();
  await visit(root,'directories');
  await flushDirectories();
  const saved = readRecord(file), failures = saved.failures ?? [];
  const data = {operation_id:id,project_id:project,session_id:request.session_id,
    path:root,state:failures.length ? 'failed' : 'deleted',deleted_count:saved.result?.deleted_count ?? 0,
    ...(failures.length ? {failed_count:failures.length,failures} : {})};
  write({...saved,pending:[],result:data});
  return {data:await cleanupStatus(data)};
}

async function runDelete(ctx, projectId) {
  const flags = ctx.flags, target = workspacePath(required(flags.path,'path'));
  if (flags['wait-timeout'] !== undefined && !flags.wait) throw usageError('forge files delete: --wait-timeout requires --wait.');
  const id = flags['operation-id'] === undefined ? randomUUID() : uuid(flags['operation-id'],'operation ID');
  return controlled(ctx,id,flags.recursive ? localWaitSeconds(flags['wait-timeout'],0,{allowZero:true}) : flags.wait ? localWaitSeconds(flags['wait-timeout'],1800) : 60,async signal => {
    const prior = readRecordFor(ctx,id);
    let request;
    if (prior) {
      request = prior.request;
      if (![FILE_DELETE,FILE_DELETE_TREE].includes(request?.type) || request.project_id !== projectId || request.body?.path !== target
          || (request.type === FILE_DELETE_TREE) !== !!flags.recursive) {
        throw new ApiError({status:409,code:'request_conflict',message:`File deletion ${id} differs from its saved request.`});
      }
    } else {
      const base = `${API}/projects/${projectId}/files`;
      const context = (await ctx.client.get(`${base}/status`,{signal})).data;
      const metadata = (await ctx.client.get(`${base}/metadata`,{query:{path:target},signal})).data;
      if (!isUUID(context.session_id) || !Number.isSafeInteger(context.control_revision) || context.control_revision < 0
          || !Number.isSafeInteger(context.writer_epoch) || context.writer_epoch < 0
          || !Number.isSafeInteger(metadata.version) || metadata.version < 0
          || !Number.isSafeInteger(metadata.mutation_revision) || metadata.mutation_revision < 0) {
        throw new NetworkError('Project file context is unavailable.');
      }
      if (metadata.kind === 'directory' && !flags.recursive) throw usageError('This path is a directory; use --recursive to delete it and its contents.');
      if (!['file','directory','absent','tombstone'].includes(metadata.kind)) throw new NetworkError('File metadata is invalid.');
      request = {type:flags.recursive ? FILE_DELETE_TREE : FILE_DELETE,method:'POST',session_id:context.session_id,project_id:projectId,path:`${base}/delete`,
        ...(flags.recursive ? {group_id:id} : {}),
        body:{operation_id:id,session_id:context.session_id,operation_started_at:new Date().toISOString(),path:target,
          control_revision:context.control_revision,writer_epoch:context.writer_epoch,
          expected_version:metadata.version,expected_project_revision:metadata.mutation_revision}};
    }
    const {file,record} = await fileRecord(ctx,id,request,'operation_id',signal);
    let result = request.type === FILE_DELETE_TREE ? await recoverDeleteTree(ctx,record,signal) : await recoverDelete(ctx,record,signal);
    saveResult(file,readRecord(file) ?? record,result.data);
    let lastDeleteLine;
    while (flags.wait && result.data.state !== 'failed' && result.data.cleanup_state !== 'attention'
        && (result.data.state !== 'deleted' || result.data.cleanup_state === 'pending')) {
      const line = `Deletion ${id}: ${result.data.state}, storage cleanup ${result.data.cleanup_state}`;
      if (line !== lastDeleteLine) {
        printProgress(line);
        lastDeleteLine = line;
      }
      await delay(3000,undefined,{signal});
      result = request.type === FILE_DELETE_TREE ? await recoverDeleteTree(ctx,readRecord(file),signal) : await recoverDelete(ctx,readRecord(file),signal);
      saveResult(file,readRecord(file),result.data);
    }
    if (result.data.state === 'failed' || result.data.cleanup_state === 'attention') {
      const firstError = result.data.error ?? result.data.failures?.[0]?.error;
      if (firstError?.code === 'project_session_active') {
        const conflict = new ApiError({ status: 409, code: 'project_session_active', message: firstError.message || 'Project has an active Forge session.' });
        conflict.action = ACTIVE_SESSION_FILE_MUTATION_ACTION;
        throw conflict;
      }
      failed('file_delete_failed',
        result.data.recovery_path ? `A replacement was preserved at ${result.data.recovery_path}.` : `File deletion ${id} needs attention`,
        firstError ?? (result.data.failure_code ? {message:result.data.failure_code} : undefined),
        'Inspect the file and cleanup status before another action.');
    }
    return report(ctx,result);
  });
}

async function runCopy(ctx, projectId) {
  const flags = ctx.flags, target = workspacePath(required(flags.path,'path'));
  const source = copySource(flags);
  if (flags['wait-timeout'] !== undefined && !flags.wait) throw usageError('forge files recover: --wait-timeout requires --wait.');
  const id = flags['operation-id'] === undefined ? randomUUID() : uuid(flags['operation-id'],'operation ID');
  return controlled(ctx,id,flags.wait ? localWaitSeconds(flags['wait-timeout'],1800) : 60,async signal => {
    let request, prior = readRecordFor(ctx,id);
    if (prior) {
      request = prior.request;
      if (request?.type !== FILE_COPY || request.project_id !== projectId || request.body?.path !== target
          || !isDeepStrictEqual(request.body?.source,source)) {
        throw new ApiError({status:409,code:'request_conflict',message:`File recovery ${id} differs from its saved request.`});
      }
    } else {
      const base = `${API}/projects/${projectId}/files`;
      const context = (await ctx.client.get(`${base}/status`,{signal})).data;
      const metadata = (await ctx.client.get(`${base}/metadata`,{query:{path:target},signal})).data;
      if (!isUUID(context.session_id) || !Number.isSafeInteger(context.control_revision) || context.control_revision < 0
          || !Number.isSafeInteger(context.writer_epoch) || context.writer_epoch < 0
          || !Number.isSafeInteger(metadata.version) || metadata.version < 0
          || !Number.isSafeInteger(metadata.mutation_revision) || metadata.mutation_revision < 0) {
        throw new NetworkError('Project file context is unavailable.');
      }
      if (metadata.kind === 'directory') throw usageError('The destination is a directory; choose a file path.');
      if (metadata.kind === 'file' && !flags.overwrite) throw usageError('The destination exists; use --overwrite to replace that saved file.');
      if (!['file','absent','tombstone'].includes(metadata.kind)) throw new NetworkError('Destination metadata is invalid.');
      request = {type:FILE_COPY,method:'POST',session_id:context.session_id,project_id:projectId,path:`${base}/recover`,
        body:{operation_id:id,session_id:context.session_id,operation_started_at:new Date().toISOString(),path:target,
          control_revision:context.control_revision,writer_epoch:context.writer_epoch,
          expected_version:metadata.version,expected_project_revision:metadata.mutation_revision,source}};
    }
    const {record} = await fileRecord(ctx,id,request,'operation_id',signal);
    let result = await recoverFile(ctx,id,record,{signal});
    let lastCopyLine;
    while (flags.wait && result.data.state === 'pending') {
      const line = `Waiting for file recovery ${id}: ${result.data.storage_state}, installation ${result.data.installation_status}`;
      if (line !== lastCopyLine) {
        printProgress(line);
        lastCopyLine = line;
      }
      await delay(Math.max(1000,(result.data.retry_after ?? 3)*1000),undefined,{signal});
      result = await recoverFile(ctx,id,readRecord(recordPath(ctx,id)),{signal});
    }
    if (result.data.state === 'failed') failed('file_recovery_failed',`File recovery ${id} failed`,result.data.error,
      `Inspect the destination and operation ${id}; resolve any writer or file conflict before a new action.`);
    return report(ctx,result);
  });
}

async function waitForInputsReady(ctx, sessionId, sessionPath, signal) {
  let lastState;
  for (;;) {
    const lifecycle = (await ctx.client.get(sessionPath, { query: { view: 'summary' }, signal })).data;
    const state = lifecycle?.state;
    if (['closing', 'closed', 'failed'].includes(state)) {
      failed('session_unavailable', `Session ${sessionId} is ${state}`, lifecycle?.error);
    }
    let statusText = `session ${state ?? 'unknown'}`;
    if (state === 'available') {
      const baseTool = Array.isArray(lifecycle.tools)
        ? lifecycle.tools.find((t) => t?.tool === 'base')
        : null;
      if (baseTool?.state === 'failed') {
        failed('tool_failed', 'Tool base failed', baseTool.error);
      }
      let baseReady = !baseTool || baseTool.state === 'ready';
      if (baseReady && !baseTool) {
        try {
          const direct = (await forgeRequest(ctx, sessionId, 'GET', '/v1/session', {
            query: { view: 'summary' },
            signal,
          })).data;
          if (['closing', 'closed', 'failed'].includes(direct?.state)) {
            failed('session_unavailable', `Session ${sessionId} is ${direct.state}`, direct.error);
          }
          const directBase = Array.isArray(direct?.tools)
            ? direct.tools.find((t) => t?.tool === 'base')
            : null;
          if (directBase?.state === 'failed') {
            failed('tool_failed', 'Tool base failed', directBase.error);
          }
          baseReady = direct?.state === 'available' && (!directBase || directBase.state === 'ready');
          if (!baseReady) {
            statusText = directBase ? `tool base: ${directBase.state}` : `session ${direct?.state ?? 'starting'}`;
          }
        } catch (err) {
          if (signal?.aborted) throw err;
          if (err?.code === 'session_unready' || transient(err)) {
            baseReady = false;
            statusText = `session ${err.code || 'starting'}`;
          } else {
            throw err;
          }
        }
      } else if (!baseReady) {
        statusText = `tool base: ${baseTool.state}`;
      }
      if (baseReady) return;
    }
    if (statusText !== lastState) {
      printProgress(`Waiting for input readiness (${sessionId}): ${statusText}`);
      lastState = statusText;
    }
    await delay(1000, undefined, { signal });
  }
}

export async function runFiles(ctx, action, sessionId, sessionPath, projectId) {
  const flags = ctx.flags;
  if (action === 'files recover') return runCopy(ctx,projectId);
  if (action === 'files delete') return runDelete(ctx,projectId);
  const direct = '/v1';
  const read = (resource) => flags.retained
    ? ctx.client.get(`${sessionPath}${resource.slice(3)}`)
    : forgeRequest(ctx, sessionId, 'GET', resource);
  if (action === 'inputs add') {
    if (flags.manifest !== undefined || flags['batch-id'] !== undefined || flags['dry-run'] !== undefined || flags.concurrency !== undefined) {
      if (flags['wait-ready']) throw usageError('Manifest staging uses --wait, not --wait-ready.');
      return addInputBatch(ctx,sessionId,sessionPath);
    }
    if (flags.wait) throw usageError('--wait requires --manifest for input staging (use --wait-ready for single-file inputs).');
    if (flags['wait-timeout'] !== undefined && flags['wait-ready'] !== true) {
      throw usageError('forge inputs add: --wait-timeout requires --wait-ready (or --manifest --wait).');
    }
    const waitReady = flags['wait-ready'] === true;
    const waitSeconds = waitReady ? localWaitSeconds(flags['wait-timeout'], 180) : 0;
    const id = flags['input-id'] === undefined ? randomUUID() : uuid(flags['input-id'],'input ID');
    const target = safePath(required(flags.path,'path'));
    if (['file','artifact','url'].filter(key => flags[key] !== undefined).length !== 1) {
      throw usageError('forge inputs add: supply exactly one of --file, --artifact, or --url.');
    }
    const isReadinessRetryable = (error) => (
      ['session_unready', 'hydration_pending', 'tool_unready'].includes(error?.code)
    );
    if (flags.file !== undefined) {
      const localFile = path.resolve(required(flags.file,'file'));
      const info = fs.lstatSync(localFile);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 20*1024**3) throw usageError('Forge upload requires a regular file up to 20 GiB.');
      const runFileUpload = async (signal) => {
        for (;;) {
          try {
            return report(ctx, await addSessionUploadInput(ctx, sessionId, sessionPath, id, target, localFile, signal, { waitReady }));
          } catch (error) {
            if (signal?.aborted) throw error;
            if (waitReady && isReadinessRetryable(error)) {
              printProgress(`Session ${sessionId} not yet ready (${error.code}); waiting to retry with input_id ${id}…`);
              await delay(1000, undefined, { signal });
              continue;
            }
            const record = readRecord(recordPath(ctx,id));
            if (!record || !transient(error)) throw error;
            printProgress(`Temporary error; reconciling saved operation ${id}.`);
            try { return report(ctx,await recoverFile(ctx,id,record,{signal, account:await accountIdentity(ctx, {signal}), waitReady})); }
            catch (recoveryError) {
              recoveryError.action ||= `Recover input ${id} with ariax forge recover ${id} using the original root, account and API origin.`;
              throw recoveryError;
            }
          }
        }
      };
      if (waitReady) {
        return controlled(ctx, id, waitSeconds, runFileUpload, {
          resume: `ariax forge inputs add ${sessionId} --file ${localFile} --path ${target} --input-id ${id} --wait-ready`,
        });
      }
      return runFileUpload(undefined);
    }
    let source;
    if (flags.artifact !== undefined) {
      const value = required(flags.artifact,'artifact');
      const colon = value.indexOf(':');
      if (colon < 0) throw usageError('forge: --artifact requires PROJECT_ID:PATH.');
      source = {kind:'artifact',project_id:uuid(value.slice(0,colon),'source project ID'),path:safePath(value.slice(colon+1))};
    } else {
      const value = required(flags.url,'url');
      let url;
      try { url = new URL(value); } catch { throw usageError('forge: --url requires an individual HTTPS object.'); }
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hash) {
        throw usageError('forge: --url requires an individual HTTPS object.');
      }
      source = {kind:'url',url:value};
    }
    const body = {input_id:id,path:target,source};
    const safe = {...body,source:source.kind === 'url' ? {kind:'url'} : source};
    const request = {method:'POST',session_id:sessionId,path:`${direct}/inputs`,body:safe};
    const runDirectInput = async (signal) => {
      for (;;) {
        if (waitReady) {
          await waitForInputsReady(ctx, sessionId, sessionPath, signal);
        }
        try {
          const {record} = await fileRecord(ctx,id,request,'input_id',signal);
          return report(ctx,await recoverFile(ctx,id,record,{body,signal}));
        } catch (error) {
          if (signal?.aborted) throw error;
          if (waitReady && isReadinessRetryable(error)) {
            printProgress(`Session ${sessionId} not yet ready (${error.code}); waiting to retry with input_id ${id}…`);
            await delay(1000, undefined, { signal });
            continue;
          }
          if (error?.code === 'input_exists' || error?.code === 'input_path_exists') {
            let resolvedPid = null;
            try { resolvedPid = (await ctx.client.get(sessionPath, { attempts: 1 })).data?.project_id ?? null; } catch { /* ignore */ }
            error.action = inputExistsAction(target, resolvedPid);
          } else {
            error.action = `Inspect ariax forge inputs status ${sessionId} ${id}; retry with --input-id ${id} and the original source if no accepted operation exists.`;
          }
          throw error;
        }
      }
    };
    if (waitReady) {
      return controlled(ctx, id, waitSeconds, runDirectInput, {
        resume: `ariax forge inputs status ${sessionId} ${id}`,
      });
    }
    return runDirectInput(undefined);
  }
  if (action === 'inputs list') {
    const result = await read(`${direct}/inputs`);
    if (!Array.isArray(result.data.inputs)) result.data.inputs = [];
    let resolvedProjectId = null;
    let remoteInputsChecked = false;
    try {
      const sess = await ctx.client.get(sessionPath, { query: { view: 'summary' }, attempts: 1 });
      if (isUUID(sess.data?.project_id)) resolvedProjectId = sess.data.project_id;
      if (resolvedProjectId) {
        const remote = await listProjectFilesRecursive(ctx, resolvedProjectId, '/inputs', { maxFiles: 200, maxPages: 40 });
        remoteInputsChecked = true;
        const existingPaths = new Set(
          result.data.inputs
            .map(item => (typeof item?.path === 'string' ? item.path.replace(/^\/inputs\//, '') : ''))
            .filter(Boolean),
        );
        for (const entry of remote.data.entries) {
          const relPath = entry.path.startsWith('/inputs/') ? entry.path.slice('/inputs/'.length) : entry.path;
          if (!relPath || existingPaths.has(relPath)) continue;
          existingPaths.add(relPath);
          result.data.inputs.push({
            input_id: null,
            path: relPath,
            state: 'ready',
            size_bytes: entry.size_bytes,
            version: entry.version,
            project_id: resolvedProjectId,
            source: 'project_inputs',
            visibility: 'remote',
          });
        }
        if (remote.data.truncated) result.data.remote_inputs_truncated = true;
      }
    } catch {
      // Remote /inputs listing is best-effort; retain live/retained items.
    }
    if (remoteInputsChecked) {
      result.data.remote_inputs_checked = true;
      result.data.project_id = resolvedProjectId;
    }
    return report(ctx,result,'inputs');
  }
  if (action === 'inputs status') {
    const id = uuid(ctx.positionals[3],'input ID');
    if (flags.retained) return report(ctx,await read(`${direct}/inputs/${id}`));
    try {
      const live = await forgeRequest(ctx, sessionId, 'GET', `${direct}/inputs/${id}`);
      const found = findRecord(ctx, id);
      if (found.record?.request?.type === SESSION_INPUT_UPLOAD && found.record.request.session_id === sessionId) {
        saveResult(found.legacy ? recordPath(ctx, id, true) : found.file, found.record, live.data);
      }
      return report(ctx, live);
    } catch (error) {
      if (error.status !== 404 && error.code !== 'session_unready') throw error;
      const found = findRecord(ctx, id);
      if (found.record?.request?.type !== SESSION_INPUT_UPLOAD || found.record.request.session_id !== sessionId) throw error;
      const staged = await ctx.client.get(`${sessionPath}/inputs/${id}`);
      saveResult(found.legacy ? recordPath(ctx, id, true) : found.file, found.record, staged.data);
      return report(ctx, staged);
    }
  }
  if (action === 'sync') {
    const id = flags['sync-id'] === undefined ? randomUUID() : uuid(flags['sync-id'], 'sync ID');
    const request = { method:'POST', session_id:sessionId, path:`${direct}/sync`, body:{sync_id:id} };
    const {record} = await fileRecord(ctx,id,request,'sync_id');
    const resource = `${direct}/sync/${id}`;
    const resume = `ariax forge sync ${sessionId} --sync-id ${id} --wait`;
    let result;
    try {
      result = await recoverFile(ctx,id,record,{retryFailedSync:flags['sync-id'] !== undefined});
    } catch (error) {
      error.action = `Inspect or retry the same flush with ${resume}, using the original account, API origin and root directory. The server and session must support the current project workspace.`;
      throw error;
    }
    const syncStartedAt = Date.now();
    let lastTelemetryAt = 0;
    let cachedTelemetry = null;
    const inspect = sync => {
      if (sync.state === 'failed') failedSync(id,sessionId,sync);
      const state = sync.state ?? 'unknown';
      if (state === 'saved') {
        return { state, done: true, progress: 'sync: saved', progressKey: 'saved' };
      }
      const mutRev = sync.mutation_revision ?? cachedTelemetry?.mutation_revision;
      const pending = sync.pending_files ?? sync.pending_count ?? cachedTelemetry?.pending_files;
      const savedCount = sync.saved_count;
      const wsFiles = sync.workspace_file_count ?? cachedTelemetry?.workspace_file_count;
      const parts = [];
      if (Number.isSafeInteger(mutRev)) parts.push(`mutation_revision=${mutRev}`);
      if (Number.isSafeInteger(pending)) parts.push(`pending_files=${pending}`);
      if (Number.isSafeInteger(savedCount)) parts.push(`saved_count=${savedCount}`);
      if (Number.isSafeInteger(wsFiles)) parts.push(`workspace_file_count=${wsFiles}`);
      const elapsedSec = Math.max(0, Math.round((Date.now() - syncStartedAt) / 1000));
      const detail = parts.length ? ` (${parts.join(', ')}, elapsed=${elapsedSec}s)` : ` (elapsed=${elapsedSec}s)`;
      return {
        state,
        done: false,
        progress: `sync: ${state}${detail}`,
        progressKey: `${state}|${mutRev ?? ''}|${pending ?? ''}|${savedCount ?? ''}|${wsFiles ?? ''}`,
      };
    };
    const current = inspect(result.data);
    if (flags.wait && !current.done) {
      const readSyncWithTelemetry = async (options) => {
        const res = await readSync(ctx, sessionId, id, options);
        const s = res.data;
        if ((s.state === 'queued' || s.state === 'pending') && !options?.signal?.aborted) {
          const hasInline = Number.isSafeInteger(s.mutation_revision)
            || Number.isSafeInteger(s.pending_files)
            || Number.isSafeInteger(s.pending_count)
            || Number.isSafeInteger(s.workspace_file_count);
          const now = Date.now();
          if (!hasInline && (lastTelemetryAt === 0 || (now - lastTelemetryAt) >= 15_000)) {
            lastTelemetryAt = now;
            try {
              const hostRes = await forgeRequest(ctx, sessionId, 'GET', '/v1/session', {
                query: { view: 'summary' },
                signal: options?.signal,
              });
              const hostSync = hostRes.data?.synchronization;
              if (hostSync && typeof hostSync === 'object') {
                cachedTelemetry = {
                  ...(Number.isSafeInteger(hostSync.mutation_revision) ? { mutation_revision: hostSync.mutation_revision } : {}),
                  ...(Number.isSafeInteger(hostSync.pending_files) ? { pending_files: hostSync.pending_files } : {}),
                  ...(Number.isSafeInteger(hostSync.workspace_file_count) ? { workspace_file_count: hostSync.workspace_file_count } : {}),
                };
              }
            } catch (err) {
              if (options?.signal?.aborted) throw err;
            }
          }
        }
        return res;
      };
      result = await poll(ctx, resource, id, inspect, resume, sessionId, readSyncWithTelemetry, {
        heartbeatMs: 15_000,
      });
    }
    const syncInfo = await observeSessionSync(ctx, sessionId, sessionPath, result.data, { tryDirect: true });
    if (syncInfo) emitHygieneNotices(ctx, syncInfo, { sessionId, includeScratch: false });
    return report(ctx,result);
  }
  if (action === 'files') {
    const target = workspacePath(flags.path === undefined ? '/workspace' : flags.path, true);
    if (flags.recursive === true) {
      if (flags.cursor !== undefined) throw usageError('forge files: --recursive cannot be combined with --cursor.');
      const result = await listProjectFilesRecursive(ctx, projectId, target, { maxFiles: 500, maxPages: 100 });
      return report(ctx, result, 'files');
    }
    const result = await listProjectFiles(ctx,projectId,target,flags.cursor === undefined ? undefined : required(flags.cursor,'cursor'));
    return report(ctx,result,'files');
  }
  if (action === 'download' || action === 'link') {
    const target = workspacePath(ctx.positionals[2]);
    const result = await projectFileGrant(ctx,projectId,target);
    if (action === 'download') {
      const saved = await download(result.data,required(flags.dest,'dest'));
      return report(ctx,{...result,data:{...saved,version:result.data.version,checksum:result.data.checksum,
        part_size:result.data.part_size,mode:result.data.mode}});
    }
    // The transfer grant is used only to authorize and verify the current file;
    // it is never included in the project-page link or printed result.
    const url = new URL(projectUrl(ctx,projectId));
    url.searchParams.set('path',target);
    return report(ctx,{...result,data:{project_id:projectId,path:target,
      size_bytes:result.data.size_bytes,version:result.data.version,checksum:result.data.checksum,
      part_size:result.data.part_size,mode:result.data.mode,url:url.href}});
  }
}
