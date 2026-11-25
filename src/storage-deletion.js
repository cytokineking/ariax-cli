/** Selected managed deletion observations; waiting never submits a mutation. */
import { setTimeout as delay } from 'node:timers/promises';
import { usageError } from './args.js';
import { ApiError } from './http.js';
import { EXIT } from './exit-codes.js';
import { isUUID } from './uuid.js';
import { storageStatus, storageWaitOptions } from './storage.js';
import { printJson, printKv, printProgress } from './output.js';

function isRelativeDeletionPath(path, maxCodePoints) {
  if (typeof path !== 'string' || !path || path.length > maxCodePoints * 2 || /[\\%*?]/.test(path)) return false;
  const points = [...path];
  return points.length <= maxCodePoints && !points.some(char => char !== ' ' && /[\p{C}\p{Z}]/u.test(char))
    && !path.split('/').some(part => !part || part === '.' || part === '..');
}

export function deletionTarget(path, recursive = false) {
  if (typeof recursive !== 'boolean' || !isRelativeDeletionPath(path, 512) || path.includes(':')
      || path.split('/').some(part => part !== part.trim() || [...part].length > 255)) {
    throw usageError('storage delete: use an exact relative file/folder path. Root deletion requires ariax delete PROJECT.');
  }
  return { path, recursive };
}
export function sameDeletionTarget(left, right) {
  return typeof left?.path === 'string' && typeof right?.path === 'string'
    && left.recursive === right.recursive && left.path.normalize('NFC') === right.path.normalize('NFC');
}

export function deletionOutcome(value, project, id, target) {
  if (value?.kind === 'project') {
    storageStatus(value.storage, project);
    if (value.storage.status !== 'deleted' || value.storage.cleanup.kind !== 'managed') throw new Error('Whole-project deletion observation is invalid.');
    return value;
  }
  const d = value?.deletion;
  // Existing receipts may retain a path accepted under historical key limits.
  if (value?.kind !== 'selected' || value.project_id !== project || !isUUID(d?.id) || (id && d.id !== id)
      || !Number.isSafeInteger(value.control?.revision) || value.control.revision < 0
      || !['pending', 'verified_empty', 'attention'].includes(d.state)
      || (d.state === 'verified_empty' && !Number.isFinite(Date.parse(d.verified_empty_at)))
      || typeof d.recursive !== 'boolean' || !isRelativeDeletionPath(d.path, 4096)
      || (target && !sameDeletionTarget(d, target))) throw new Error('Storage deletion returned an invalid observation; retain the original request.');
  const deletion = { ...d };
  delete deletion.already_absent; // Ignore a retired field from an older server.
  return { ...value, deletion };
}
export function reportDeletion(ctx, value, id, waitOutcome) {
  if (ctx.json) return printJson({ data: value, meta: { deletion_request_id: id, ...(waitOutcome ? { wait_outcome: waitOutcome } : {}) } });
  const d = value.kind === 'selected' ? value.deletion : value.storage.cleanup;
  printKv({ project_id: value.kind === 'selected' ? value.project_id : value.storage.project_id,
    workflow_status: value.kind === 'selected' ? value.status : value.storage.status, deletion_request_id: id,
    scope: value.kind, ...(value.kind === 'selected' ? { path: d.path, recursive: d.recursive } : {}),
    cleanup: d.state, reason: d.reason ?? '-', object_count: d.object_count ?? 'unknown', multipart_count: d.multipart_count ?? 'unknown',
    last_complete_check_at: d.last_complete_check_at ?? 'unknown', verified_empty_at: d.verified_empty_at ?? 'not verified',
    verification_not_before: d.verification_not_before ?? 'unknown', next_reconcile_at: d.next_reconcile_at ?? 'unknown' });
}
export async function waitForDeletion(ctx, project, id, { initial, target } = {}) {
  const { interval, timeout } = storageWaitOptions(ctx), controller = new AbortController();
  const interrupt = () => controller.abort(); process.once('SIGINT', interrupt);
  let timedOut = false, latest = initial, last = initial;
  const timer = timeout ? setTimeout(() => { timedOut = true; controller.abort(); }, timeout) : null;
  try {
    for (;;) {
      controller.signal.throwIfAborted();
      if (!latest) latest = deletionOutcome((await ctx.client.get(`/api/v1/projects/${project}/storage/deletions/${id}`, { signal: controller.signal })).data, project, id, target);
      last = latest;
      const cleanup = latest.kind === 'selected' ? latest.deletion : latest.storage.cleanup;
      if (cleanup.state === 'verified_empty') return latest;
      if (cleanup.state === 'attention') throw new ApiError({ status: 503, code: 'dependency_failure', retryable: false,
        message: `Deletion ${id} remains accepted and needs attention. Observe with ariax storage status ${project} --deletion-id ${id}; do not make a new request.`,
        details: { project_id: project, deletion_request_id: id, cleanup: { ...cleanup, kind: 'managed' }, wait_outcome: 'attention' } });
      printProgress(`Deletion ${id}: ${cleanup.state}; observing only…`);
      await delay(interval, undefined, { signal: controller.signal }); latest = null;
    }
  } catch (error) {
    if (controller.signal.aborted) {
      const cleanup = last?.kind === 'selected' ? last.deletion : last?.storage.cleanup;
      const failure = new ApiError({ status: timedOut ? 504 : undefined, code: 'dependency_failure', retryable: false,
        message: `${timedOut ? 'Storage verification wait timed out' : 'Interrupted'}; accepted deletion ${id} remains effective. Observe with ariax storage status ${project} --deletion-id ${id}.`,
        details: { project_id: project, deletion_request_id: id, cleanup: cleanup ? { ...cleanup, kind: 'managed' } : undefined, wait_outcome: timedOut ? 'timeout' : 'interrupted' } });
      if (!timedOut) failure.exitCode = EXIT.INTERRUPTED;
      throw failure;
    }
    throw error;
  } finally { if (timer) clearTimeout(timer); process.removeListener('SIGINT', interrupt); }
}
