/** OS-appropriate state directory for CLI journals and best-effort TTL pruning. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isUUID } from './uuid.js';

export const DEFAULT_RECORD_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Resolve the platform-standard state directory for durable CLI journals.
 * @param {{ env?: NodeJS.ProcessEnv, platform?: string, home?: string }} [options]
 */
export function defaultStateDir({
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
} = {}) {
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'ariax-cli', 'state');
  }
  if (platform === 'win32') {
    return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'ariax-cli', 'state');
  }
  return path.join(env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'ariax-cli');
}

/** Conservative terminal predicate for managed operation journals. */
export function isManagedOperationTerminal(record) {
  if (!record || typeof record !== 'object') return false;
  return record.state === 'completed' || record.state === 'failed';
}

/** Conservative terminal predicate for Forge operation journals. Never treats unconfirmed records as terminal. */
export function isForgeOperationTerminal(record) {
  if (!record || typeof record !== 'object' || !record.result || typeof record.result !== 'object') {
    return false;
  }
  const result = record.result;
  const state = typeof result.state === 'string' ? result.state : null;
  const req = record.request;
  if (!req || typeof req !== 'object') return false;
  if (req.type === 'project-file-delete-v1' || req.type === 'project-file-delete-tree-v1') {
    if (Array.isArray(record.pending) && record.pending.length > 0) return false;
    return state === 'failed'
      || (state === 'deleted' && (result.cleanup_state === 'complete' || result.cleanup_state === 'unknown'));
  }
  if (req.type === 'project-file-copy-v1') {
    return state === 'ready' || state === 'saved' || state === 'failed';
  }
  if (req.type === 'project-file-input-v2' || req.path === '/v1/inputs') {
    return state === 'ready' || state === 'failed';
  }
  if (req.path === '/v1/sync') {
    return state === 'saved' || state === 'failed';
  }
  if (req.path === '/v1/files/hydrate') {
    return state === 'ready' || state === 'failed';
  }
  if (req.path === '/v1/commands' || /\/cancel$/.test(req.path ?? '')) {
    return ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(state);
  }
  if (req.path === '/v1/tools') {
    if (state === 'ready' || state === 'failed') return true;
    return Array.isArray(result.tools) && result.tools.length > 0
      && result.tools.every((item) => item?.state === 'ready' || item?.state === 'failed');
  }
  if (/\/finish$/.test(req.path ?? '')) {
    return result.phase === 'completed' && result.release === 'released';
  }
  if (/\/limit$/.test(req.path ?? '')) {
    return ['closed', 'failed'].includes(state)
      || (Number.isSafeInteger(result.limit_revision) && result.applied_limit_revision === result.limit_revision);
  }
  if (/\/close$/.test(req.path ?? '') || /\/sessions$/.test(req.path ?? '')) {
    return state === 'closed' || state === 'failed';
  }
  return false;
}

function recordTimestampMs(record, stat) {
  const candidates = [stat.mtimeMs];
  for (const field of ['updated_at', 'updatedAt', 'created_at', 'createdAt']) {
    const raw = record?.[field];
    if (typeof raw === 'string') {
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) candidates.push(parsed);
    }
  }
  return Math.max(...candidates);
}

/**
 * Best-effort silent cleanup of terminal journal files older than maxAgeMs.
 * Never removes non-terminal, in_progress, pending, unconfirmed, or unreadable records.
 * @param {string} dir
 * @param {{ maxAgeMs?: number, now?: number, isTerminal?: (record: any) => boolean }} [options]
 * @returns {{ pruned: number }}
 */
export function pruneExpiredRecords(dir, {
  maxAgeMs = DEFAULT_RECORD_TTL_MS,
  now = Date.now(),
  isTerminal = isManagedOperationTerminal,
} = {}) {
  let pruned = 0;
  try {
    if (!dir || typeof dir !== 'string' || typeof isTerminal !== 'function') return { pruned };
    const dirStat = fs.lstatSync(dir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) return { pruned };
    const entries = fs.readdirSync(dir);
    const jsonFiles = entries.filter((name) => name.endsWith('.json') && isUUID(name.slice(0, -5)));
    for (const name of jsonFiles) {
      try {
        const file = path.join(dir, name);
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        if (now - stat.mtimeMs < maxAgeMs) continue;
        const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        let raw;
        try {
          if (!fs.fstatSync(fd).isFile()) continue;
          raw = fs.readFileSync(fd, 'utf8');
        } finally {
          fs.closeSync(fd);
        }
        const record = JSON.parse(raw);
        if (now - recordTimestampMs(record, stat) < maxAgeMs) continue;
        if (isTerminal(record) !== true) continue;
        fs.rmSync(file, { force: true });
        pruned += 1;
        // Clean up any sidecar prepared-input snapshots belonging to this expired terminal operation.
        const id = name.slice(0, -5);
        for (const extra of entries) {
          if (extra === `${id}.input` || extra.startsWith(`${id}.input.`)) {
            try { fs.rmSync(path.join(dir, extra), { force: true }); } catch { /* ignore */ }
          }
        }
      } catch {
        // Leave unreadable or unexpected files untouched.
      }
    }
  } catch {
    // Best-effort silent cleanup must never fail a CLI command.
  }
  return { pruned };
}
