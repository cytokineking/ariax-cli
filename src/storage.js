/** Read-only cleanup observation; accepted deletion never depends on this client. */
import { setTimeout as delay } from 'node:timers/promises';
import { ApiError } from './http.js';
import { EXIT } from './exit-codes.js';
import { usageError } from './args.js';
import { printJson, printKv, printProgress } from './output.js';

export function storageStatus(value, projectId) {
  if (value?.project_id !== projectId || typeof value.status !== 'string' || !value.cleanup
      || ![undefined, 'managed', 'forge'].includes(value.cleanup.kind)
      || !Number.isSafeInteger(value.control?.revision) || value.control.revision < 0) {
    throw new Error('Storage status returned an invalid project or control observation.');
  }
  const states = value.cleanup.kind === 'managed' ? [null, 'pending', 'verified_empty', 'attention'] : [null, 'pending', 'completed'];
  if (!states.includes(value.cleanup.state)) throw new Error('Storage status returned an invalid cleanup observation.');
  if (value.cleanup.kind === 'managed' && value.cleanup.state === 'verified_empty'
      && !Number.isFinite(Date.parse(value.cleanup.verified_empty_at))) {
    throw new Error('Verified storage status has no valid observation timestamp.');
  }
  return value;
}

export function reportStorage(ctx, value, { requestId, operationId, waitOutcome } = {}) {
  if (ctx.json) {
    printJson({ data: value, meta: { ...(operationId ? { local_operation_id: operationId, deletion_request_id: operationId } : {}),
      ...(waitOutcome ? { wait_outcome: waitOutcome } : {}) }, ...(requestId ? { request_id: requestId } : {}) });
    return;
  }
  const c = value.cleanup;
  printKv({ project_id: value.project_id, status: value.status, cleanup: c.state ?? 'unknown',
    ...(operationId ? { deletion_request_id: operationId } : {}),
    ...(c.kind === 'managed' ? {
      reason: c.reason ?? '-', object_count: c.object_count ?? 'unknown', multipart_count: c.multipart_count ?? 'unknown',
      last_complete_check_at: c.last_complete_check_at ?? 'unknown', last_checked_at: c.last_checked_at ?? 'unknown',
      verified_empty_at: c.verified_empty_at ?? 'not verified', verification_not_before: c.verification_not_before ?? 'unknown',
      next_reconcile_at: c.next_reconcile_at ?? 'unknown',
    } : { compute_released: c.compute_released, artifacts_deleted: c.artifacts_deleted,
      retained_archives: 'excluded from current-project deletion', error: c.error?.message ?? '-' }),
  });
}

function finished(value) {
  return value.cleanup.kind === 'managed' ? value.cleanup.state === 'verified_empty' : value.cleanup.state === 'completed';
}

export function storageWaitOptions(ctx) {
  const interval = Number(ctx.flags['poll-interval'] ?? 3) * 1000;
  const timeout = Number(ctx.flags['wait-timeout'] ?? 300) * 1000;
  if (!Number.isFinite(interval) || interval < 250 || !Number.isFinite(timeout) || timeout < 0 || timeout > 86400000) {
    throw usageError('Storage wait requires --poll-interval >= 0.25 and --wait-timeout 0..86400 seconds (0 waits indefinitely).');
  }
  return { interval, timeout };
}

export async function waitForStorage(ctx, projectId, { initial, operationId } = {}) {
  const { interval, timeout } = storageWaitOptions(ctx);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  let timedOut = false, latest = initial, last = initial;
  const timer = timeout ? setTimeout(() => { timedOut = true; controller.abort(); }, timeout) : null;
  try {
    for (;;) {
      controller.signal.throwIfAborted();
      if (!latest) latest = storageStatus((await ctx.client.get(`/api/v1/projects/${projectId}/storage`, { signal: controller.signal })).data, projectId);
      last = latest;
      if (latest.status !== 'deleted') throw usageError('Project has not been deleted. Storage status --wait only observes an accepted deletion.');
      if (finished(latest)) return latest;
      if (latest.cleanup.kind === 'managed' && latest.cleanup.state === 'attention' || latest.cleanup.kind !== 'managed' && latest.cleanup.error) {
        throw new ApiError({ status: 503, code: 'dependency_failure', retryable: false,
          message: `Deletion remains accepted for ${projectId}; cleanup needs attention. Observe with ariax storage status ${projectId}; do not submit another deletion.`,
          details: { project_id: projectId, deletion_request_id: operationId, cleanup: latest.cleanup, wait_outcome: 'attention' } });
      }
      printProgress(`Storage cleanup ${latest.cleanup.state ?? 'unknown'} for ${projectId}; observing only…`);
      await delay(interval, undefined, { signal: controller.signal });
      latest = null;
    }
  } catch (error) {
    if (controller.signal.aborted) {
      const failure = new ApiError({ status: timedOut ? 504 : undefined, code: 'dependency_failure', retryable: false,
        message: `${timedOut ? 'Storage verification wait timed out' : 'Interrupted'}; accepted deletion continues in the backend. Observe with ariax storage status ${projectId}.`,
        details: { project_id: projectId, deletion_request_id: operationId, cleanup: last?.cleanup, wait_outcome: timedOut ? 'timeout' : 'interrupted' } });
      if (!timedOut) failure.exitCode = EXIT.INTERRUPTED;
      throw failure;
    }
    throw error;
  } finally { if (timer) clearTimeout(timer); process.removeListener('SIGINT', interrupt); }
}
