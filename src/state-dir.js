/** OS-appropriate state directory for CLI journals and best-effort TTL pruning. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isUUID } from './uuid.js';

export const DEFAULT_RECORD_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const READ_ONLY_FS_CODES = new Set(['EPERM', 'EACCES', 'EROFS']);

/** Whether a filesystem error indicates a read-only or sandbox-blocked path. */
export function isReadOnlyFsError(err) {
  return Boolean(err && typeof err === 'object' && READ_ONLY_FS_CODES.has(err.code));
}

function defaultHomeFor(env, platform) {
  if (platform === 'win32') {
    if (env && env !== process.env && env.USERPROFILE && env.USERPROFILE !== process.env.USERPROFILE) {
      return env.USERPROFILE;
    }
    return os.homedir();
  }
  if (env && env !== process.env && env.HOME && env.HOME !== process.env.HOME) {
    return env.HOME;
  }
  return os.homedir();
}

/**
 * Resolve the platform-standard state directory for durable CLI journals.
 * @param {{ env?: NodeJS.ProcessEnv, platform?: string, home?: string }} [options]
 */
export function defaultStateDir({
  env = process.env,
  platform = process.platform,
  home = defaultHomeFor(env, platform),
} = {}) {
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'ariax-cli', 'state');
  }
  if (platform === 'win32') {
    return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'ariax-cli', 'state');
  }
  return path.join(env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'ariax-cli');
}

/** Per-user private temp fallback directory used when the OS state dir is read-only/sandboxed. */
export function fallbackStateDir({
  uid = process.getuid?.(),
  tmpdir = os.tmpdir(),
} = {}) {
  let resolvedTmp = tmpdir;
  try {
    resolvedTmp = fs.realpathSync(tmpdir);
  } catch {
    // Keep raw tmpdir if realpath fails.
  }
  return path.join(resolvedTmp, `ariax-cli-state-${uid ?? 'user'}`);
}

/**
 * Probe whether `dir` is creatable, non-symlink, owned by current uid, 0700, and writable.
 * @param {string} dir
 * @returns {{ ok: boolean, reason?: string, readOnly?: boolean, error?: Error }}
 */
export function probeWritablePrivateDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return { ok: false, reason: 'unsafe_dir', readOnly: false };
    }
    if (process.getuid && stat.uid !== process.getuid()) {
      return { ok: false, reason: 'wrong_owner', readOnly: false };
    }
    if (process.platform !== 'win32') {
      fs.chmodSync(dir, 0o700);
    }
    const probe = path.join(dir, `.ariax-probe-${process.pid}-${randomUUID()}`);
    let fd;
    try {
      fd = fs.openSync(probe, 'wx', 0o600);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.rmSync(probe, { force: true }); } catch { /* ignore */ }
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error, readOnly: isReadOnlyFsError(error) };
  }
}

/**
 * Resolve the default state directory, transparently falling back to a private per-user
 * temp directory when the OS default state dir fails with EPERM, EACCES, or EROFS.
 * @param {{ env?: NodeJS.ProcessEnv, platform?: string, home?: string, tmpdir?: string }} [options]
 */
export function resolveWritableStateDir({
  env = process.env,
  platform = process.platform,
  home = defaultHomeFor(env, platform),
  tmpdir = os.tmpdir(),
} = {}) {
  const primary = path.resolve(defaultStateDir({ env, platform, home }));
  const primaryCheck = probeWritablePrivateDir(primary);
  if (primaryCheck.ok) return primary;
  if (!primaryCheck.readOnly) return primary;

  const fallback = path.resolve(fallbackStateDir({ tmpdir }));
  const fallbackCheck = probeWritablePrivateDir(fallback);
  if (fallbackCheck.ok) return fallback;
  if (fallbackCheck.reason === 'unsafe_dir' || fallbackCheck.reason === 'wrong_owner') {
    const err = new Error('Fallback state directory must be a private non-symlink directory owned by the current user.');
    err.code = 'ARIAX_USAGE';
    err.exitCode = 1;
    throw err;
  }
  return fallback;
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
