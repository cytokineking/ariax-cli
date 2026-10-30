import fs from 'node:fs';
import { forgeRequest, forgeAccountIdentity } from '../lib/forge-client.js';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { usageError } from '../args.js';
import { accountIdentity, atomicWrite } from '../operations.js';
import { ApiError, NetworkError, validateTransferUrl } from '../http.js';
import { printProgress } from '../output.js';
import { workspacePath, listProjectFiles, projectFileGrant, readSync, startSync } from '../lib/forge-workspace-client.js';
import { uuid, required, recordPath, readRecord, saveResult, report, poll, failed, projectUrl } from './forge.js';

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

async function fileRecord(ctx, id, request, label) {
  const account = request.session_id
    ? await forgeAccountIdentity(ctx, request.session_id)
    : await accountIdentity(ctx);
  fs.mkdirSync(ctx.config.rootDir, { recursive: true, mode: 0o700 });
  const file = recordPath(ctx, id, true);
  const candidate = { id, ...account, request, result: null };
  let record = readRecord(file);
  if (!record) {
    try { atomicWrite(file, JSON.stringify(candidate, null, 2)+'\n', true); record = candidate; }
    catch (error) { if (error.code !== 'EEXIST') throw error; record = readRecord(file); }
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

async function observe(ctx, resource, sessionId) {
  try { return await forgeRequest(ctx, sessionId, 'GET', resource); }
  catch (error) { if (error.status === 404) return null; throw error; }
}

const PART_SIZE = 16 * 1024 * 1024;
const PROJECT_INPUT = 'project-file-input-v2';
const API = '/api/v1/forge';

function fileSnapshot(fd, file) {
  const info = fs.fstatSync(fd);
  if (!info.isFile() || info.size > 20 * 1024 ** 3) throw usageError('Forge upload requires a regular file up to 20 GiB.');
  return {path:file,size_bytes:info.size,mtime_ms:info.mtimeMs,ctime_ms:info.ctimeMs,dev:info.dev,ino:info.ino};
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

function checksums(fd, metadata) {
  const digests = [];
  const count = Math.max(1, Math.ceil(metadata.size_bytes / PART_SIZE));
  for (let i = 0; i < count; i++) {
    const size = Math.min(PART_SIZE, metadata.size_bytes - i * PART_SIZE);
    digests.push(createHash('md5').update(readPart(fd, size, i * PART_SIZE)).digest());
  }
  if (!isDeepStrictEqual(fileSnapshot(fd, metadata.path), metadata)) throw new Error('Local input changed while preparing the upload.');
  return {parts:digests.map(value => value.toString('base64')),
    checksum:`${createHash('md5').update(Buffer.concat(digests)).digest('hex')}-${count}`};
}

async function putPart(grant, body, md5) {
  const url = validateTransferUrl(grant.upload_url, 'Upload');
  if (grant.upload_method !== 'PUT' || !grant.upload_headers
      || grant.upload_headers['Content-Length'] !== String(body.length)
      || grant.upload_headers['Content-MD5'] !== md5
      || Object.keys(grant.upload_headers).some(key => !['Content-Length', 'Content-MD5'].includes(key))) {
    throw new Error('Forge returned an invalid upload grant.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 900000);
  try {
    const response = await fetch(url, {method:'PUT',headers:grant.upload_headers,body,redirect:'error',signal:controller.signal});
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Upload failed (HTTP ${response.status}); retry with the same input ID.`);
  } catch (error) {
    // fetch errors can carry a credentialed URL through their nested cause.
    throw new NetworkError(controller.signal.aborted ? 'Upload exceeded its 900 second limit; retry with the same input ID.' : 'Upload did not complete; retry with the same input ID.');
  } finally { clearTimeout(timer); }
}

function projectInputResult(record, operation, applied = false) {
  const storage = operation?.state ?? 'unconfirmed';
  const conflict = storage === 'published' && operation?.local_state === 'conflict';
  const installing = storage === 'published' && operation?.local_state === 'pending';
  return {input_id:record.id,path:record.request.body.path.slice('/inputs/'.length),
    size_bytes:record.request.body.size_bytes,project_id:record.request.project_id,
    state:applied ? 'ready' : storage === 'expired' || conflict ? 'failed' : 'pending',storage_state:storage,
    installation_status:applied ? 'applied' : conflict ? 'conflict' : installing ? 'pending'
      : storage === 'published' ? 'unconfirmed' : 'pending',
    ...(operation?.version !== undefined && operation.version !== null ? {version:operation.version} : {}),
    ...(!applied ? {action:conflict ? 'The project file could not be installed in the active workspace. Inspect the operation before continuing.'
      : installing ? 'The file is saved and workspace installation is still pending. Inspect the same input ID.'
      : storage === 'published'
      ? 'Project storage is saved, but this server does not confirm installation in the running workspace. Do not dispatch a command until the server exposes that confirmation.'
      : storage === 'expired' ? 'The input operation expired. Inspect the project path and use a new input ID if the file is absent.'
      : 'Retry the original input request with the same input ID and source file.'} : {})};
}

function writeInputRecord(file, record) {
  atomicWrite(file, JSON.stringify(record, null, 2) + '\n');
}

async function projectInputStatus(ctx, record, knownAccount) {
  const account = knownAccount ?? await accountIdentity(ctx);
  if (Object.keys(account).some(field => record[field] !== account[field])) {
    throw new ApiError({status:404,code:'not_found',message:'Forge input not found.'});
  }
  let operation;
  try { operation = (await ctx.client.get(`${API}/projects/${record.request.project_id}/files/operations/${record.id}`)).data; }
  catch (error) { if (error.status !== 404) throw error; }
  if (operation && (operation.operation_id !== record.id || operation.session_id !== record.request.session_id
      || !['open', 'published', 'expired'].includes(operation.state)
      || (operation.local_state !== undefined && !['ready','pending','conflict','unknown','not_applicable'].includes(operation.local_state)))) {
    throw new Error('Project input operation response does not match the retained request.');
  }
  // A host-backed local_state is an installation observation, not merely the
  // SQL publication receipt. Older servers omit it and remain unconfirmed.
  let applied = false;
  if (operation?.state === 'published' && operation.source === 'host' && operation.local_state === 'ready'
      && Number.isSafeInteger(operation.version) && operation.version > 0) {
    const context = (await ctx.client.get(`${API}/projects/${record.request.project_id}/files/status`)).data;
    applied = context.session_id === record.request.session_id && context.writer_session_id === record.request.session_id
      && context.writer_epoch === record.request.body.writer_epoch && context.control_revision === record.request.body.control_revision
      && context.session_state === 'available' && context.hydration_state === 'ready';
  }
  return projectInputResult(record, operation, applied);
}

async function addProjectInput(ctx, sessionId, sessionPath, id, target, localFile) {
  const fd = fs.openSync(localFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const metadata = fileSnapshot(fd, localFile);
    const digests = checksums(fd, metadata);
    const prior = readRecord(recordPath(ctx, id));
    let request;
    if (prior) {
      request = prior.request;
      const savedProject = uuid(request?.project_id, 'project ID');
      if (request?.type !== PROJECT_INPUT || request.session_id !== sessionId
          || request.body?.operation_id !== id || request.body?.path !== `/inputs/${target}`
          || request.path !== `${API}/projects/${savedProject}/files/intents`
          || request.body?.session_id !== sessionId || request.body?.part_size !== PART_SIZE
          || request.body?.checksum !== digests.checksum || !isDeepStrictEqual(request.local_file, metadata)) {
        throw new ApiError({status:409,code:'request_conflict',message:`Forge request ${id} differs from its saved input. Use the original request to retry.`});
      }
    } else {
      const session = (await ctx.client.get(sessionPath)).data;
      const projectId = uuid(session.project_id, 'project ID');
      const base = `${API}/projects/${projectId}/files`;
      const context = (await ctx.client.get(`${base}/status`)).data;
      if (context.session_id !== sessionId || context.writer_session_id !== sessionId
          || context.session_state !== 'available' || context.hydration_state !== 'ready'
          || !Number.isSafeInteger(context.control_revision) || context.control_revision < 0
          || !Number.isSafeInteger(context.writer_epoch) || context.writer_epoch < 0) {
        throw new ApiError({status:409,code:'session_unready',message:'The original project workspace is not ready for input installation.'});
      }
      const remote = (await ctx.client.get(`${base}/metadata`,{query:{path:`/inputs/${target}`}})).data;
      if (remote.kind !== 'absent' || remote.version !== 0 || !Number.isSafeInteger(remote.mutation_revision) || remote.mutation_revision < 0) {
        throw new ApiError({status:409,code:'input_exists',message:'This project input path already exists; choose a new path.'});
      }
      request = {type:PROJECT_INPUT,method:'POST',session_id:sessionId,project_id:projectId,path:`${base}/intents`,
        body:{operation_id:id,session_id:sessionId,path:`/inputs/${target}`,operation_started_at:new Date().toISOString(),
          control_revision:context.control_revision,writer_epoch:context.writer_epoch,expected_version:remote.version,
          expected_project_revision:remote.mutation_revision,size_bytes:metadata.size_bytes,part_size:PART_SIZE,
          checksum:digests.checksum,mode:0o644},local_file:metadata};
    }
    const {file,record} = await fileRecord(ctx,id,request,'input_id');
    const base = request.path;
    let result = await ctx.client.post(base,{body:request.body});
    if (!['open','published'].includes(result.data?.state)) throw new Error('Project input intent returned an incompatible state.');
    if (result.data.state === 'open') {
      let attemptId = record.attempt_id ? uuid(record.attempt_id, 'upload attempt ID') : undefined;
      if (record.upload_stage !== 'completing' || !attemptId) {
        const attempt = await ctx.client.post(`${base}/${id}/attempts`);
        if (attempt.data?.state === 'published') result = attempt;
        else {
          attemptId = uuid(attempt.data?.attempt_id, 'upload attempt ID');
          record.attempt_id = attemptId;
          record.upload_stage = attempt.data.state;
          writeInputRecord(file, record);
          if (!['creating','uploading','completing','completed'].includes(record.upload_stage)) throw new Error('Project upload attempt returned an incompatible state.');
          if (record.upload_stage === 'creating') {
            const data = projectInputResult(record,{state:'open'});
            saveResult(file,record,data);
            return {...attempt,data};
          }
        }
      }
      if (result.data.state !== 'published') {
        if (record.upload_stage === 'uploading') {
          for (let index = 0; index < digests.parts.length; index++) {
            if (!isDeepStrictEqual(fileSnapshot(fd,localFile),metadata)) throw new Error('Local input changed during upload; use a new input ID for the completed file.');
            const bytes = readPart(fd,Math.min(PART_SIZE,metadata.size_bytes-index*PART_SIZE),index*PART_SIZE);
            if (createHash('md5').update(bytes).digest('base64') !== digests.parts[index]) throw new Error('Local input changed during upload; use a new input ID for the completed file.');
            const grant = await ctx.client.post(`${base}/${id}/attempts/${attemptId}/parts`,{body:{number:index+1,md5:digests.parts[index]}});
            if (grant.data?.state === 'published') { result = grant; break; }
            await putPart(grant.data,bytes,digests.parts[index]);
          }
        }
        if (result.data.state !== 'published') {
          if (!isDeepStrictEqual(fileSnapshot(fd,localFile),metadata)) throw new Error('Local input changed during upload; use a new input ID for the completed file.');
          record.upload_stage = 'completing';
          writeInputRecord(file,record);
          try { result = await ctx.client.post(`${base}/${id}/attempts/${attemptId}/complete`); }
          catch (error) {
            // The backend decides when an uncertain completion is old enough
            // to abandon. A later retry asks for the current attempt again.
            if (error.code === 'upload_unconfirmed') {
              record.upload_stage = 'completion_unconfirmed';
              writeInputRecord(file,record);
            }
            throw error;
          }
          if (result.data?.state !== 'published') throw new Error('Project upload completion returned an incompatible state.');
        }
      }
    }
    const data = await projectInputStatus(ctx,record);
    saveResult(file,record,data);
    return {...result,data};
  } catch (error) {
    error.action = `Inspect ariax forge inputs status ${sessionId} ${id}; retry with --input-id ${id}, the original source, account and root directory.`;
    throw error;
  } finally { fs.closeSync(fd); }
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

export async function runFiles(ctx, action, sessionId, sessionPath, projectId) {
  const flags = ctx.flags;
  const direct = '/v1';
  const read = (resource) => flags.retained
    ? ctx.client.get(`${sessionPath}${resource.slice(3)}`)
    : forgeRequest(ctx, sessionId, 'GET', resource);
  if (action === 'inputs add') {
    const id = flags['input-id'] === undefined ? randomUUID() : uuid(flags['input-id'],'input ID');
    const target = safePath(required(flags.path,'path'));
    if (['file','artifact','url'].filter(key => flags[key] !== undefined).length !== 1) {
      throw usageError('forge inputs add: supply exactly one of --file, --artifact, or --url.');
    }
    let source;
    if (flags.file !== undefined) {
      const localFile = path.resolve(required(flags.file,'file'));
      const info = fs.lstatSync(localFile);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 20*1024**3) throw usageError('Forge upload requires a regular file up to 20 GiB.');
      return report(ctx,await addProjectInput(ctx,sessionId,sessionPath,id,target,localFile));
    } else if (flags.artifact !== undefined) {
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
    const {file,record} = await fileRecord(ctx,id,request,'input_id');
    const resource = `${direct}/inputs/${id}`;
    try {
      const accepted = await observe(ctx,resource,sessionId);
      if (accepted) { saveResult(file,record,accepted.data); return report(ctx,accepted); }
      const result = await forgeRequest(ctx,sessionId,'POST',`${direct}/inputs`,{body});
      saveResult(file,record,result.data);
      return report(ctx,result);
    } catch (error) { error.action = `Inspect ariax forge inputs status ${sessionId} ${id}; retry with --input-id ${id} and the original source if no accepted operation exists.`; throw error; }
  }
  if (action === 'inputs list') {
    const result = await read(`${direct}/inputs`);
    const sample = recordPath(ctx, '00000000-0000-4000-8000-000000000000');
    if (sample) {
      const account = await accountIdentity(ctx);
      const names = fs.readdirSync(path.dirname(sample)).filter(name => /^[0-9a-f-]{36}\.json$/.test(name)).sort();
      const records = names.slice(0,10000);
      const local = [];
      for (const name of records) {
        const record = readRecord(path.join(path.dirname(sample),name));
        if (record?.request?.type !== PROJECT_INPUT || record.request.session_id !== sessionId
            || Object.keys(account).some(field => record[field] !== account[field])) continue;
        local.push(record);
      }
      for (let offset = 0; offset < local.length; offset += 8) {
        const observed = await Promise.all(local.slice(offset,offset + 8)
          .map(record => projectInputStatus(ctx,record,account)));
        result.data.inputs.push(...observed.map(item => ({...item,visibility:'local_journal'})));
      }
      result.data.local_input_journals_only = true;
      if (names.length > records.length) result.data.local_input_journals_truncated = true;
    }
    return report(ctx,result,'inputs');
  }
  if (action === 'inputs status') {
    const id = uuid(ctx.positionals[3],'input ID');
    const file = recordPath(ctx,id), record = readRecord(file);
    if (record?.request?.type === PROJECT_INPUT && record.request.session_id === sessionId) {
      const data = await projectInputStatus(ctx,record);
      saveResult(file,record,data);
      return report(ctx,{data});
    }
    return report(ctx,await read(`${direct}/inputs/${id}`));
  }
  if (action === 'sync') {
    const id = flags['sync-id'] === undefined ? randomUUID() : uuid(flags['sync-id'], 'sync ID');
    const request = { method:'POST', session_id:sessionId, path:`${direct}/sync`, body:{sync_id:id} };
    const {file,record} = await fileRecord(ctx,id,request,'sync_id');
    const resource = `${direct}/sync/${id}`;
    const resume = `ariax forge sync ${sessionId} --sync-id ${id} --wait`;
    let result;
    try {
      try { result = await readSync(ctx,sessionId,id); }
      catch (error) { if (error.status !== 404) throw error; }
      if (!result) result = await startSync(ctx,sessionId,id);
      saveResult(file,record,result.data);
    } catch (error) {
      error.action = `Inspect or retry the same flush with ${resume}, using the original account, API origin and root directory. The server and session must support the current project workspace.`;
      throw error;
    }
    const inspect = sync => {
      if (sync.state === 'failed') failed('sync_failed', `Sync ${id} failed${sync.error?.code ? ` (${sync.error.code})` : ''}`, undefined,
        `Inspect session status and retry a new flush only after resolving the failure. ${resume} observes this flush.`);
      return { state:sync.state, done:sync.state === 'saved' };
    };
    const current = inspect(result.data);
    if (flags.wait && !current.done) {
      result = await poll(ctx,resource,id,inspect,resume,sessionId,
        options => readSync(ctx,sessionId,id,options));
    }
    return report(ctx,result);
  }
  if (action === 'files') {
    const target = workspacePath(flags.path === undefined ? '/workspace' : flags.path, true);
    const result = await listProjectFiles(ctx,projectId,target);
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
