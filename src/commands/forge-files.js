import fs from 'node:fs';
import { forgeRequest, forgeAccountIdentity } from '../lib/forge-client.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { usageError } from '../args.js';
import { accountIdentity, atomicWrite } from '../operations.js';
import { ApiError, validateTransferUrl } from '../http.js';
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

async function putFile(grant, file, size) {
  const url = validateTransferUrl(grant.upload_url, 'Upload');
  if (grant.upload_method !== 'PUT') throw new Error('Forge upload requires PUT.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 900000);
  const body = fs.createReadStream(file, { flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW });
  try {
    const response = await fetch(url, {method:'PUT',headers:{...grant.upload_headers,'Content-Length':String(size)},
      body,duplex:'half',redirect:'error',signal:controller.signal});
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Upload failed (HTTP ${response.status}); retry with the same input ID.`);
  } catch (error) {
    // fetch errors can carry a credentialed URL through their nested cause.
    throw new Error(controller.signal.aborted ? 'Upload exceeded its 900 second limit; retry with the same input ID.' : 'Upload did not complete; retry with the same input ID.');
  } finally { clearTimeout(timer); body.destroy(); }
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
  let bytes = 0;
  try {
    const response = await fetch(url,{redirect:'error',signal:controller.signal});
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error('Download failed.');
    }
    const counter = new Transform({transform(chunk,encoding,callback) {
      bytes += chunk.length;
      if (bytes > grant.size_bytes) callback(new Error('Download exceeded its declared size.'));
      else callback(null,chunk);
    }});
    await pipeline(Readable.fromWeb(response.body),counter,fs.createWriteStream(temporary,{flags:'wx',mode:0o600}),{signal:controller.signal});
    if (bytes !== grant.size_bytes) throw new Error('Download size differs from the declared file size.');
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
    let source, localFile, localMetadata;
    if (flags.file !== undefined) {
      localFile = path.resolve(required(flags.file,'file'));
      const info = fs.lstatSync(localFile);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 20*1024**3) throw usageError('Forge upload requires a regular file up to 20 GiB.');
      localMetadata = {path:localFile,size_bytes:info.size,mtime_ms:info.mtimeMs,ctime_ms:info.ctimeMs};
      source = {kind:'upload'};
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
    const request = {method:'POST',session_id:sessionId,path:`${direct}/inputs`,body:safe,...(localMetadata ? {local_file:localMetadata} : {})};
    const {file,record} = await fileRecord(ctx,id,request,'input_id');
    const resource = `${direct}/inputs/${id}`;
    try {
      const accepted = await observe(ctx,resource,sessionId);
      if (accepted) { saveResult(file,record,accepted.data); return report(ctx,accepted); }
      if (localFile) {
        const upload = await forgeRequest(ctx,sessionId,'POST',`${direct}/uploads`,{body:{input_id:id,path:target,size_bytes:localMetadata.size_bytes}});
        await putFile(upload.data,localFile,localMetadata.size_bytes);
        const info = fs.lstatSync(localFile);
        if (info.size !== localMetadata.size_bytes || info.mtimeMs !== localMetadata.mtime_ms || info.ctimeMs !== localMetadata.ctime_ms) {
          throw new Error('Local input changed during upload; submit the completed file with a new input ID.');
        }
      }
      const result = await forgeRequest(ctx,sessionId,'POST',`${direct}/inputs`,{body});
      saveResult(file,record,result.data);
      return report(ctx,result);
    } catch (error) { error.action = `Inspect ariax forge inputs status ${sessionId} ${id}; retry with --input-id ${id} and the original source if no accepted operation exists.`; throw error; }
  }
  if (action === 'inputs list') return report(ctx,await read(`${direct}/inputs`),'inputs');
  if (action === 'inputs status') return report(ctx,await read(`${direct}/inputs/${uuid(ctx.positionals[3],'input ID')}`));
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
      return report(ctx,{...result,data:await download(result.data,required(flags.dest,'dest'))});
    }
    // The transfer grant is used only to authorize and verify the current file;
    // it is never included in the project-page link or printed result.
    const url = new URL(projectUrl(ctx,projectId));
    url.searchParams.set('path',target);
    return report(ctx,{...result,data:{project_id:projectId,path:target,
      size_bytes:result.data.size_bytes,url:url.href}});
  }
}
