/**
 * `--wait` polling: follow a project until a terminal state.
 * Terminal states: completed, failed, paused, aborted (case-insensitive).
 * Honors Retry-After on 429/503; otherwise bounded exponential backoff
 * with jitter. SIGINT handling lives in the caller.
 */
import { ApiError, backoffDelay } from './http.js';

export const TERMINAL_STATES = Object.freeze(['completed', 'failed', 'paused', 'aborted']);

export function isTerminalState(status) {
  return typeof status === 'string' && TERMINAL_STATES.includes(status.toLowerCase());
}

export function projectStatusOf(payload) {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload;
  for (const key of ['status', 'state', 'lifecycle_state']) {
    if (typeof p[key] === 'string') return p[key];
  }
  const nested = p.project && typeof p.project === 'object' ? p.project : null;
  if (nested) {
    for (const key of ['status', 'state']) {
      if (typeof nested[key] === 'string') return nested[key];
    }
  }
  return undefined;
}

export async function waitForProject(client, projectId, opts = {}) {
  const baseInterval = Math.max(250, opts.pollIntervalMs ?? 3000);
  const maxInterval = opts.maxIntervalMs ?? 30000;
  const timeoutMs = opts.timeoutMs ?? 0;
  const sleepImpl = opts.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const nowImpl = opts.nowImpl ?? Date.now;
  const started = nowImpl();
  let attempt = 0;
  for (;;) {
    if (opts.shouldStop && opts.shouldStop()) {
      const project = await fetchProject(client, projectId).catch(() => null);
      return { project, status: projectStatusOf(project), timedOut: false, stopped: true };
    }
    let project = null;
    let status;
    let waitOverride;
    try {
      project = await fetchProject(client, projectId);
      status = projectStatusOf(project);
      attempt = 0;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 429 || err.status === 503) && err.retryAfterMs != null) {
        waitOverride = Math.min(err.retryAfterMs, maxInterval);
      } else {
        throw err;
      }
    }
    const elapsedMs = nowImpl() - started;
    if (status !== undefined && isTerminalState(status)) {
      return { project, status, timedOut: false, stopped: false };
    }
    if (opts.onTick) opts.onTick({ status, elapsedMs });
    if (timeoutMs > 0 && elapsedMs >= timeoutMs) {
      return { project, status, timedOut: true, stopped: false };
    }
    const span = Math.max(500, maxInterval - baseInterval);
    const waitMs = waitOverride ?? Math.min(baseInterval + backoffDelay(attempt, 500, span), maxInterval);
    attempt += 1;
    await sleepImpl(waitMs);
  }
}

async function fetchProject(client, projectId) {
  const res = await client.get(`/api/v1/projects/${encodeURIComponent(projectId)}`);
  return res.data;
}
