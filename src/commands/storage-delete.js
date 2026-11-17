import fs from 'node:fs';
import { usageError } from '../args.js';
import { isUUID } from '../uuid.js';
import { resolveProjectId } from '../resolve.js';
import { promptConfirm } from '../prompt.js';
import { printJson, printKv } from '../output.js';
import { accountIdentity, createOperation, listOperations, loadOperation, lookupOperation, operationFailure, operationPath, sendOperation, verifyAccount } from '../operations.js';
import { deletionTarget, deletionOutcome, reportDeletion, sameDeletionTarget, waitForDeletion } from '../storage-deletion.js';
import { storageStatus, storageWaitOptions } from '../storage.js';
import { runFiles, observeFileDeletion } from './forge-files.js';
import { workspacePath, redactForgeOutput } from '../lib/forge-workspace-client.js';
import { controlled, localWaitSeconds, report, readRecord, recordPath } from './forge.js';
import { setTimeout as delay } from 'node:timers/promises';

function requestId(value) {
  if (value === undefined) return undefined;
  if (!isUUID(value)) throw usageError('storage: deletion/request ID must be a UUID.');
  return value.trim().toLowerCase();
}
async function confirm(ctx, message) {
  if (ctx.flags.yes) return;
  if (!ctx.interactive || !ctx.input?.isTTY || !ctx.errorOutput?.isTTY) throw usageError('storage delete: pass --yes to confirm in noninteractive use.');
  if (!await promptConfirm(`${message} [y/N] `, { input: ctx.input, output: ctx.errorOutput })) throw usageError('Deletion cancelled; no mutation was sent.');
}
function preview(value, project, target) {
  if (value?.project_id !== project || value.path !== target.path || value.recursive !== target.recursive
      || !Number.isSafeInteger(value.control?.revision) || value.control.revision < 0 || typeof value.capability?.allowed !== 'boolean'
      || typeof value.observation?.complete !== 'boolean') throw new Error('Storage preview returned an invalid observation.');
  const observation = { ...value.observation };
  delete observation.already_absent; // Ignore a retired field from an older server.
  return { ...value, observation };
}
export async function run(ctx) {
  if (!ctx.positionals[1]) throw usageError('storage delete: provide a project UUID or exact unique name.');
  if (ctx.flags['dry-run'] && (ctx.flags.wait || ctx.flags['request-id'] !== undefined)) throw usageError('storage delete: --dry-run cannot combine with --wait or --request-id.');
  if (ctx.flags.wait) storageWaitOptions(ctx);
  const id = requestId(ctx.flags['request-id']);
  const project = (await resolveProjectId(ctx.client, ctx.positionals[1])).toLowerCase();
  if (ctx.flags['dry-run']) {
    if (typeof ctx.flags.path === 'string' && /^\/(workspace|inputs)\//.test(ctx.flags.path)) {
      const path = workspacePath(ctx.flags.path);
      const metadata = (await ctx.client.get(`/api/v1/forge/projects/${project}/files/metadata`, { query: { path } })).data;
      const data = redactForgeOutput({ kind: 'forge', project_id: project, path, recursive: !!ctx.flags.recursive, metadata,
        scope: 'Current Forge files only; separately retained archives are excluded. Folder aggregate size is unknown.' });
      if (ctx.json) printJson({ data }); else printKv(data);
      return;
    }
    const target = deletionTarget(ctx.flags.path, !!ctx.flags.recursive);
    const data = preview((await ctx.client.get(`/api/v1/projects/${project}/storage/deletions/preview`, { query: target })).data, project, target);
    if (ctx.json) printJson({ data }); else printKv({ path: data.path, recursive: data.recursive, allowed: data.capability.allowed,
      reason: data.capability.reason ?? '-', bytes: data.observation.bytes ?? 'unknown', object_count: data.observation.object_count ?? 'unknown',
      measured_at: data.observation.measured_at ?? 'unknown', complete: data.observation.complete });
    return;
  }
  const target = typeof ctx.flags.path === 'string' && /^\/(workspace|inputs)\//.test(ctx.flags.path)
    ? null : deletionTarget(ctx.flags.path, !!ctx.flags.recursive);
  const route = `/api/v1/projects/${project}/storage/deletions`;
  const account = target ? await accountIdentity(ctx) : null;
  let operation;
  if (target && id && fs.existsSync(operationPath(ctx.config.rootDir, id))) operation = loadOperation(ctx.config.rootDir, id);
  if (target && !id) {
    const matching = listOperations(ctx.config.rootDir).filter(item => item.action === 'storage:delete' && item.request.path === route
      && item.state !== 'failed' && sameDeletionTarget(item.request.body, target)
      && item.actor_user_id === account.actor_user_id && item.api_origin === account.api_origin
      && item.billing_account_type === account.billing_account_type && item.billing_account_id === account.billing_account_id);
    if (matching.length > 1) throw usageError('Multiple saved deletions match this target. Select the original --request-id UUID.');
    operation = matching[0];
  }
  let data;
  if (operation) {
    if (operation.action !== 'storage:delete' || operation.request.path !== route
        || !sameDeletionTarget(operation.request.body, target)) throw usageError('The saved identity belongs to a different target or action.');
    await verifyAccount(ctx, operation);
    if (operation.state === 'failed') throw operationFailure(operation);
    const remote = await lookupOperation(ctx, operation);
    data = remote ? operation.result : (await sendOperation(ctx, operation)).data;
  } else if (target && id) {
    try { data = deletionOutcome((await ctx.client.get(`/api/v1/projects/${project}/storage/deletions/${id}`)).data, project, id, target); }
    catch (error) { if (error.status !== 404) throw error; }
  }
  if (!data) {
    const storage = storageStatus((await ctx.client.get(`/api/v1/projects/${project}/storage`)).data, project);
    if (storage.cleanup.kind !== 'managed') {
      const path = workspacePath(ctx.flags.path);
      await confirm(ctx, `Permanently delete ${path} in Forge project ${project}${ctx.flags.recursive ? ' and all descendants' : ''}? Separately retained archives are excluded.`);
      return runFiles({ ...ctx, flags: { ...ctx.flags, ...(id ? { 'operation-id': id } : {}) } }, 'files delete', undefined, undefined, project);
    }
    if (!target) deletionTarget(ctx.flags.path, !!ctx.flags.recursive);
    if (storage.status === 'deleted') return reportDeletion(ctx, { kind: 'project', storage });
    const estimate = preview((await ctx.client.get(`/api/v1/projects/${project}/storage/deletions/preview`, { query: target })).data, project, target);
    if (!estimate.capability.allowed) throw usageError(`Selected deletion is unavailable (${estimate.capability.reason ?? 'unknown'}). Paused projects must retain files for resume; abort or use whole-project deletion.`);
    await confirm(ctx, `Permanently delete ${target.path}${target.recursive ? ' and every descendant, including hidden files' : ''} in project ${project}? Other copies and unselected archives remain.`);
    operation = createOperation(ctx, { action: 'storage:delete', account, ...(id ? { id } : {}),
      request: { method: 'POST', path: route, body: { ...target, expected_control_revision: estimate.control.revision } } });
    data = (await sendOperation(ctx, operation)).data;
  }
  const deletionId = operation?.id ?? id;
  data = deletionOutcome(data, project, deletionId, target);
  if (ctx.flags.wait) data = await waitForDeletion(ctx, project, deletionId, { initial: data, target });
  reportDeletion(ctx, data, deletionId, ctx.flags.wait ? 'complete' : undefined);
}

export async function status(ctx, project, idValue) {
  const id = requestId(idValue);
  const local = readRecord(recordPath(ctx, id));
  if (local?.request?.project_id === project && ['project-file-delete-v1', 'project-file-delete-tree-v1'].includes(local.request.type)) {
    const observe = signal => observeFileDeletion(ctx, project, id, signal);
    if (!ctx.flags.wait) return report(ctx, await observe());
    return controlled(ctx, id, localWaitSeconds(ctx.flags['wait-timeout'], 300, { allowZero: true }), async signal => {
      for (;;) {
        const result = await observe(signal);
        if (result.data.cleanup_state === 'attention' || result.data.state === 'failed') throw usageError('Native Forge deletion needs review. Inspect or explicitly recover the original Forge operation.');
        if (result.data.state === 'deleted' && result.data.cleanup_state === 'complete') return report(ctx, result);
        await delay(storageWaitOptions(ctx).interval, undefined, { signal });
      }
    });
  }
  let data = deletionOutcome((await ctx.client.get(`/api/v1/projects/${project}/storage/deletions/${id}`)).data, project, id);
  if (ctx.flags.wait) data = await waitForDeletion(ctx, project, id, { initial: data });
  reportDeletion(ctx, data, id, ctx.flags.wait ? 'complete' : undefined);
}
