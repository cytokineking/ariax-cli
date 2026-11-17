import { usageError } from '../args.js';
import { resolveProjectId } from '../resolve.js';
import { storageStatus, reportStorage, waitForStorage, storageWaitOptions } from '../storage.js';
import { printJson, printKv, printTable } from '../output.js';
import { listProjectFiles, workspacePath } from '../lib/forge-workspace-client.js';
import { run as deleteSelection, status as selectedStatus } from './storage-delete.js';

const nullableNumber = value => value === null || Number.isSafeInteger(value) && value >= 0;
function usage(data, project) {
  storageStatus(data, project);
  const u = data.usage;
  if (!u || !['managed', 'forge'].includes(u.kind) || u.basis !== (u.kind === 'managed' ? 'object_listing' : 'forge_catalog')
      || !['unknown', 'fresh', 'stale'].includes(u.freshness) || typeof u.complete !== 'boolean'
      || !['bytes', 'object_count', 'browsable_bytes', 'hidden_other_bytes', 'pending_deletion_bytes', 'bound_input_bytes', 'retained_archive_bytes'].every(key => nullableNumber(u[key]))) {
    throw new Error('Storage usage returned an invalid observation.');
  }
  return data;
}
function limit(value, maximum, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw usageError(`storage: --limit must be 1..${maximum}.`);
  return parsed;
}
function reportUsage(ctx, response) {
  if (ctx.json) return printJson({ data: response.data, ...(response.requestId ? { request_id: response.requestId } : {}) });
  const u = response.data.usage;
  printKv({ project_id: response.data.project_id, status: response.data.status, basis: u.basis, complete: u.complete,
    freshness: u.freshness, measured_at: u.measured_at ?? 'unknown', bytes: u.bytes ?? 'unknown',
    object_count: u.object_count ?? 'unknown', browsable_bytes: u.browsable_bytes ?? 'unknown', hidden_other_bytes: u.hidden_other_bytes ?? 'unknown',
    pending_deletion_bytes: u.pending_deletion_bytes ?? 'unknown', bound_input_bytes: u.bound_input_bytes ?? 'unknown',
    bound_input_measured_at: u.bound_input_measured_at ?? 'unknown', retained_archive_bytes: u.retained_archive_bytes ?? 'unknown',
    retained_archive_measured_at: u.retained_archive_measured_at ?? 'unknown', refresh: u.refresh.state,
    summaries_truncated: u.summaries_truncated });
  if (u.largest_files.length) printTable(['largest_file', 'bytes'], u.largest_files.map(item => [item.path, item.bytes]));
  if (u.directories.length) printTable(['directory', 'bytes', 'object_count'], u.directories.map(item => [item.path, item.bytes, item.object_count ?? 'unknown']));
}

async function runUsage(ctx) {
  const operand = ctx.positionals[1];
  if (!operand) {
    if (ctx.flags.refresh) throw usageError('storage usage --refresh requires a project.');
    const query = { limit: limit(ctx.flags.limit, 50, 25) };
    for (const key of ['cursor', 'q', 'protocol', 'status', 'sort']) if (ctx.flags[key] !== undefined) {
      if (typeof ctx.flags[key] !== 'string' || !ctx.flags[key]) throw usageError(`storage usage: --${key} requires a value.`);
      query[key] = ctx.flags[key];
    }
    if (query.sort && !['updated_at', 'name', 'bytes_desc'].includes(query.sort)) throw usageError('storage usage: --sort is updated_at, name or bytes_desc.');
    const response = await ctx.client.get('/api/v1/storage/projects', { query });
    if (!Array.isArray(response.data?.projects) || response.data.projects.length > query.limit
        || !(response.data.next_cursor === null || typeof response.data.next_cursor === 'string')) throw new Error('Storage overview returned an invalid page.');
    for (const row of response.data.projects) usage(row.storage, row.project_id);
    if (ctx.json) return printJson({ data: response.data, ...(response.requestId ? { request_id: response.requestId } : {}) });
    printTable(['project_id', 'name', 'protocol', 'status', 'bytes', 'basis', 'freshness'], response.data.projects.map(row => [
      row.project_id, row.name, row.protocol, row.status, row.storage.usage.bytes ?? 'unknown', row.storage.usage.basis, row.storage.usage.freshness,
    ]));
    if (response.data.next_cursor) printKv({ next_cursor: response.data.next_cursor });
    return;
  }
  for (const flag of ['cursor', 'limit', 'q', 'protocol', 'status', 'sort']) if (ctx.flags[flag] !== undefined) throw usageError(`storage usage PROJECT does not accept --${flag}.`);
  const id = (await resolveProjectId(ctx.client, operand)).toLowerCase();
  const response = ctx.flags.refresh ? await ctx.client.post(`/api/v1/projects/${id}/storage/refresh`, { body: {} })
    : await ctx.client.get(`/api/v1/projects/${id}/storage`);
  usage(response.data, id);
  reportUsage(ctx, response);
}

async function runList(ctx) {
  if (!ctx.positionals[1]) throw usageError('storage ls: provide a project UUID or exact unique name.');
  const id = (await resolveProjectId(ctx.client, ctx.positionals[1])).toLowerCase();
  const observation = usage((await ctx.client.get(`/api/v1/projects/${id}/storage`)).data, id);
  if (observation.usage.kind === 'forge') {
    if (ctx.flags.limit !== undefined) throw usageError('Forge Files uses its existing bounded page size; omit --limit.');
    const result = await listProjectFiles(ctx, id, workspacePath(ctx.flags.path ?? '/workspace', true), ctx.flags.cursor);
    if (ctx.json) printJson({ data: result.data, ...(result.requestId ? { request_id: result.requestId } : {}) });
    else { printTable(['path', 'kind', 'bytes'], result.data.entries.map(row => [row.path, row.kind, row.size_bytes ?? 'unknown'])); if (result.data.next_cursor) printKv({ next_cursor: result.data.next_cursor }); }
    return;
  }
  const query = { path: ctx.flags.path ?? '', limit: limit(ctx.flags.limit, 100, 50), cursor: ctx.flags.cursor };
  if (typeof query.path !== 'string' || (query.cursor !== undefined && (typeof query.cursor !== 'string' || !query.cursor))) throw usageError('storage ls requires valid --path and --cursor values.');
  const response = await ctx.client.get(`/api/v1/projects/${id}/storage/entries`, { query });
  const page = response.data;
  if (page?.project_id !== id || page.path !== query.path || !Array.isArray(page.entries) || page.entries.length > query.limit
      || !(page.next_cursor === null || typeof page.next_cursor === 'string')) throw new Error('Storage entries returned an invalid page.');
  if (ctx.json) printJson({ data: page, ...(response.requestId ? { request_id: response.requestId } : {}) });
  else { printTable(['path', 'kind', 'bytes', 'downloadable'], page.entries.map(row => [row.path, row.kind, row.bytes ?? 'unknown', row.downloadable])); if (page.next_cursor) printKv({ next_cursor: page.next_cursor }); }
}

export async function run(ctx) {
  if (ctx.positionals[0] === 'delete') return deleteSelection(ctx);
  if (ctx.positionals[0] === 'usage') return runUsage(ctx);
  if (ctx.positionals[0] === 'ls') return runList(ctx);
  if (ctx.flags.wait) storageWaitOptions(ctx);
  if (ctx.positionals[0] !== 'status' || !ctx.positionals[1]) throw usageError('storage: use ariax storage status <project-id> [--wait].');
  const projectId = (await resolveProjectId(ctx.client, ctx.positionals[1])).toLowerCase();
  if (ctx.flags['deletion-id'] !== undefined) return selectedStatus(ctx, projectId, ctx.flags['deletion-id']);
  const response = await ctx.client.get(`/api/v1/projects/${projectId}/storage`);
  let data = storageStatus(response.data, projectId);
  if (ctx.flags.wait) data = await waitForStorage(ctx, projectId, { initial: data });
  reportStorage(ctx, data, { requestId: response.requestId, ...(ctx.flags.wait ? { waitOutcome: 'complete' } : {}) });
}
