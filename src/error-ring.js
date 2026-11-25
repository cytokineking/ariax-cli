/**
 * Best-effort local sanitized last-error ring buffer and runtime feedback advisory.
 *
 * Stores at most 20 strictly sanitized error summaries at `<rootDir>/.ariax/last-errors.json`
 * (mode 0o600, O_NOFOLLOW, atomic writes). Never stores raw error messages, file paths,
 * user arguments, URLs, biological sequences, or credentials, and never throws.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { detectAgentShell } from './agent-env.js';
import { EXIT } from './exit-codes.js';

export const MAX_ERROR_ENTRIES = 20;
export const REPEATED_VALIDATION_WINDOW_MS = 5 * 60 * 1000;
export const REPEATED_VALIDATION_THRESHOLD = 3;
export const ADVISORY_COOLDOWN_MS = 10 * 60 * 1000;
export const ADVISORY_RETENTION_MS = 24 * 60 * 60 * 1000;

const MAX_RING_FILE_BYTES = 64 * 1024;
const COMMAND_TEMPLATE_RE = /^[a-z0-9._-]{1,64}$/;
const ERROR_CODE_RE = /^[A-Za-z0-9._-]{1,64}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

const TOP_LEVEL_COMMANDS = new Set([
  'discover',
  'me',
  'protocols',
  'pricing',
  'schema',
  'skills',
  'validate',
  'submit',
  'projects',
  'jobs',
  'status',
  'logs',
  'pause',
  'restart',
  'abort',
  'results',
  'summary',
  'storage',
  'upgrade',
  'login',
  'logout',
  'operations',
  'recover',
  'inputs',
  'candidates',
  'runs',
  'feedback',
  'forge',
  'gpu-preferences',
  'help',
]);

const STORAGE_SUBCOMMANDS = new Set([
  'usage',
  'projects',
  'project',
  'entries',
  'suggest',
  'delete',
  'deletion',
]);

const FORGE_SUBCOMMANDS = new Set([
  'create',
  'resume',
  'project',
  'summary',
  'activity',
  'limit',
  'catalog',
  'list',
  'status',
  'tools',
  'run',
  'pack',
  'operations',
  'recover',
  'finish',
  'commands',
  'command',
  'watch',
  'inputs',
  'sync',
  'files',
  'download',
  'link',
  'logs',
  'cancel',
  'close',
]);

const FORGE_NESTED_SUBCOMMANDS = Object.freeze({
  tools: new Set(['add', 'wait']),
  inputs: new Set(['add', 'list', 'status']),
  files: new Set(['delete', 'hydrate', 'recover']),
});

const ANOMALY_ERROR_CODES = new Set([
  'finish_incomplete',
  'invalid_feedback_response',
  'invalid_storage_response',
  'invalid_host_response',
  'file_scan_failed',
  'dependency_failure',
  'internal_error',
]);

const FEEDBACK_POLICY =
  'Ask the user with a 1-line redacted summary before submitting unless ARIAX_AUTO_FEEDBACK=friction is set.';

/**
 * Derive a strictly low-cardinality command template from command + subcommand verbs only.
 * Never includes user arguments, paths, filenames, project names, or UUIDs.
 */
export function commandTemplateFor(command, positionals = []) {
  if (typeof command !== 'string') return 'unknown';
  const cmd = command.trim().toLowerCase();
  if (!TOP_LEVEL_COMMANDS.has(cmd)) return 'unknown';
  const p0 = typeof positionals?.[0] === 'string' ? positionals[0].trim().toLowerCase() : '';
  const p1 = typeof positionals?.[1] === 'string' ? positionals[1].trim().toLowerCase() : '';

  if (cmd === 'projects') {
    return p0 === 'export' ? 'projects.export' : 'projects';
  }
  if (cmd === 'skills') {
    return p0 === 'install' || p0 === 'status' ? `skills.${p0}` : 'skills';
  }
  if (cmd === 'inputs') {
    return p0 === 'inspect' || p0 === 'prepare' ? `inputs.${p0}` : 'inputs';
  }
  if (cmd === 'storage') {
    return STORAGE_SUBCOMMANDS.has(p0) ? `storage.${p0}` : 'storage';
  }
  if (cmd === 'forge') {
    if (!FORGE_SUBCOMMANDS.has(p0)) return 'forge';
    const nested = FORGE_NESTED_SUBCOMMANDS[p0];
    if (nested && nested.has(p1)) return `forge.${p0}.${p1}`;
    return `forge.${p0}`;
  }
  return cmd;
}

/** Parse ARIAX_AUTO_FEEDBACK consent mode: 'friction' | 'off' | 'ask' (default). */
export function feedbackConsentMode(env = process.env) {
  const raw = env?.ARIAX_AUTO_FEEDBACK;
  if (raw === undefined || raw === null) return 'ask';
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === '' || normalized === 'ask') return 'ask';
  if (normalized === 'friction' || normalized === '1' || normalized === 'true') return 'friction';
  if (normalized === 'off' || normalized === '0' || normalized === 'false') return 'off';
  return 'ask';
}

/** Strictly sanitize one error ring entry to the 6-field zero-PII/zero-IP schema. */
export function sanitizeErrorEntry(entry, nowMs = Date.now()) {
  if (!entry || typeof entry !== 'object') {
    return {
      command_template: 'unknown',
      exit_code: EXIT.SERVER,
      error_code: null,
      http_status: null,
      request_id: null,
      timestamp: new Date(nowMs).toISOString(),
    };
  }

  const rawTemplate = typeof entry.command_template === 'string' ? entry.command_template.trim().toLowerCase() : '';
  const command_template = COMMAND_TEMPLATE_RE.test(rawTemplate) ? rawTemplate : 'unknown';

  const rawExit = entry.exit_code;
  const exit_code = Number.isSafeInteger(rawExit) && rawExit >= 1 && rawExit <= 255
    ? rawExit
    : EXIT.SERVER;

  let error_code = null;
  if (typeof entry.error_code === 'string') {
    const trimmed = entry.error_code.trim();
    if (ERROR_CODE_RE.test(trimmed) && !trimmed.startsWith('arx_')) {
      error_code = trimmed;
    }
  }

  const rawStatus = entry.http_status;
  const http_status = Number.isSafeInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599
    ? rawStatus
    : null;

  let request_id = null;
  if (typeof entry.request_id === 'string') {
    const trimmed = entry.request_id.trim();
    if (REQUEST_ID_RE.test(trimmed) && !trimmed.startsWith('arx_')) {
      request_id = trimmed;
    }
  }

  let timestamp;
  if (typeof entry.timestamp === 'string' && Number.isFinite(Date.parse(entry.timestamp))) {
    timestamp = new Date(Date.parse(entry.timestamp)).toISOString();
  } else {
    timestamp = new Date(nowMs).toISOString();
  }

  return {
    command_template,
    exit_code,
    error_code,
    http_status,
    request_id,
    timestamp,
  };
}

function isValidStoredEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  if (typeof entry.command_template !== 'string' || !COMMAND_TEMPLATE_RE.test(entry.command_template)) return false;
  if (!Number.isSafeInteger(entry.exit_code) || entry.exit_code < 1 || entry.exit_code > 255) return false;
  if (entry.error_code !== null && (typeof entry.error_code !== 'string' || !ERROR_CODE_RE.test(entry.error_code) || entry.error_code.startsWith('arx_'))) return false;
  if (entry.http_status !== null && (!Number.isSafeInteger(entry.http_status) || entry.http_status < 100 || entry.http_status > 599)) return false;
  if (entry.request_id !== null && (typeof entry.request_id !== 'string' || !REQUEST_ID_RE.test(entry.request_id) || entry.request_id.startsWith('arx_'))) return false;
  if (typeof entry.timestamp !== 'string' || !Number.isFinite(Date.parse(entry.timestamp))) return false;
  return true;
}

function pruneAdvisories(advisories, nowMs) {
  const cleaned = {};
  if (!advisories || typeof advisories !== 'object' || Array.isArray(advisories)) return cleaned;
  let kept = 0;
  for (const [key, value] of Object.entries(advisories)) {
    if (kept >= 200) break;
    if (typeof key !== 'string' || key.length === 0 || key.length > 140) continue;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (typeof value !== 'string') continue;
    const ts = Date.parse(value);
    if (!Number.isFinite(ts)) continue;
    if (nowMs - ts > ADVISORY_RETENTION_MS) continue;
    cleaned[key] = new Date(ts).toISOString();
    kept += 1;
  }
  return cleaned;
}

function emptyBuffer() {
  return { schema_version: 1, entries: [], advisories: {} };
}

export function errorRingPath(rootDir) {
  if (!rootDir || typeof rootDir !== 'string') return null;
  return path.join(path.resolve(rootDir), '.ariax', 'last-errors.json');
}

function readRingBuffer(rootDir, nowMs = Date.now()) {
  const file = errorRingPath(rootDir);
  if (!file) return emptyBuffer();
  try {
    const dir = path.dirname(file);
    const dirStat = fs.lstatSync(dir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) return emptyBuffer();
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let raw;
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_RING_FILE_BYTES) return emptyBuffer();
      if (process.getuid && stat.uid !== process.getuid()) return emptyBuffer();
      raw = fs.readFileSync(fd, 'utf8');
    } finally {
      fs.closeSync(fd);
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyBuffer();
    const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const entries = rawEntries
      .filter(isValidStoredEntry)
      .slice(-MAX_ERROR_ENTRIES)
      .map((item) => sanitizeErrorEntry(item, nowMs));
    const advisories = pruneAdvisories(parsed.advisories, nowMs);
    return { schema_version: 1, entries, advisories };
  } catch {
    return emptyBuffer();
  }
}

function writeRingBuffer(rootDir, buffer) {
  const file = errorRingPath(rootDir);
  if (!file) return false;
  try {
    const resolvedRoot = path.resolve(rootDir);
    fs.mkdirSync(resolvedRoot, { recursive: true, mode: 0o700 });
    const dir = path.dirname(file);
    try {
      fs.mkdirSync(dir, { mode: 0o700 });
    } catch (err) {
      if (err.code !== 'EEXIST') return false;
    }
    const dirStat = fs.lstatSync(dir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) return false;
    if (process.getuid && dirStat.uid !== process.getuid()) return false;
    try { fs.chmodSync(dir, 0o700); } catch { /* ignore on unsupported fs */ }

    try {
      const existing = fs.lstatSync(file);
      if (!existing.isFile() || existing.isSymbolicLink()) return false;
      if (process.getuid && existing.uid !== process.getuid()) return false;
    } catch (err) {
      if (err.code !== 'ENOENT') return false;
    }

    const temp = `${file}.${randomUUID()}.tmp`;
    const payload = `${JSON.stringify({
      schema_version: 1,
      entries: buffer.entries.slice(-MAX_ERROR_ENTRIES),
      advisories: buffer.advisories || {},
    })}\n`;
    try {
      const fd = fs.openSync(temp, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, payload, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temp, file);
      try { fs.chmodSync(file, 0o600); } catch { /* ignore */ }
      try {
        const dirFd = fs.openSync(dir, 'r');
        try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
      } catch { /* ignore */ }
      return true;
    } finally {
      try { fs.rmSync(temp, { force: true }); } catch { /* ignore */ }
    }
  } catch {
    return false;
  }
}

/**
 * Append a strictly sanitized error summary, trim to 20 entries, preserve cooldown map,
 * write atomically (0o600), and return the updated buffer. Best-effort: never throws.
 */
export function recordCliError(rootDir, entry, { now = Date.now() } = {}) {
  const nowMs = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const sanitized = sanitizeErrorEntry(entry, nowMs);
  const buffer = readRingBuffer(rootDir, nowMs);
  buffer.entries = [...buffer.entries, sanitized].slice(-MAX_ERROR_ENTRIES);
  buffer.advisories = pruneAdvisories(buffer.advisories, nowMs);
  writeRingBuffer(rootDir, buffer);
  return buffer;
}

/**
 * Read and return the most recent valid sanitized error entry, or null.
 * Optional `excludeCommands` skips specific command templates (e.g. `['feedback']`).
 */
export function readLastCliError(rootDir, { excludeCommands } = {}) {
  const buffer = readRingBuffer(rootDir);
  const excluded = Array.isArray(excludeCommands) && excludeCommands.length
    ? new Set(excludeCommands)
    : null;
  for (let i = buffer.entries.length - 1; i >= 0; i -= 1) {
    const entry = buffer.entries[i];
    if (excluded && excluded.has(entry.command_template)) continue;
    return entry;
  }
  return null;
}

export function advisoryCooldownKey(entry) {
  const sanitized = sanitizeErrorEntry(entry);
  return `${sanitized.command_template}:${sanitized.error_code ?? sanitized.exit_code}`;
}

/** Best-effort record that a feedback_opportunity advisory was emitted for this entry. */
export function recordFeedbackAdvisory(rootDir, entry, { now = Date.now() } = {}) {
  const nowMs = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const key = advisoryCooldownKey(entry);
  const buffer = readRingBuffer(rootDir, nowMs);
  buffer.advisories = pruneAdvisories(buffer.advisories, nowMs);
  buffer.advisories[key] = new Date(nowMs).toISOString();
  writeRingBuffer(rootDir, buffer);
  return buffer;
}

function entriesEqual(a, b) {
  if (!a || !b) return false;
  return a === b || (
    a.command_template === b.command_template
    && a.exit_code === b.exit_code
    && a.error_code === b.error_code
    && a.http_status === b.http_status
    && a.request_id === b.request_id
    && a.timestamp === b.timestamp
  );
}

function hasRepeatedValidationFailures(entries, current, nowMs) {
  if (current.exit_code !== EXIT.USAGE && current.exit_code !== EXIT.VALIDATION) return false;
  let consecutive = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const item = entries[i];
    if (!item || item.command_template !== current.command_template) break;
    if (item.exit_code !== EXIT.USAGE && item.exit_code !== EXIT.VALIDATION) break;
    const ts = Date.parse(item.timestamp);
    if (!Number.isFinite(ts) || nowMs - ts > REPEATED_VALIDATION_WINDOW_MS || ts - nowMs > 60_000) break;
    consecutive += 1;
    if (consecutive >= REPEATED_VALIDATION_THRESHOLD) return true;
  }
  return false;
}

/**
 * Sanitize an attempted unknown top-level command token for feedback summaries.
 * Returns at most 32 safe [A-Za-z0-9_-] chars, or null if empty, secret-like, or path-like.
 */
export function sanitizeCommandToken(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('-') || /^arx_/i.test(trimmed)) return null;
  if (/[\/\\@:]/.test(trimmed)) return null;
  const cleaned = trimmed.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  if (!cleaned || /^arx_/i.test(cleaned)) return null;
  return cleaned;
}

function buildSuggestedCommand(reason, current, consentMode, attemptedToken = null) {
  const dryRunFlag = consentMode === 'friction' ? '' : ' --dry-run';
  if (reason === 'repeated_validation_failures') {
    const summary = current.command_template === 'unknown' && attemptedToken
      ? `Repeated unknown-command errors (ariax ${attemptedToken})`
      : `Repeated validation failures on ${current.command_template}`;
    return `ariax feedback --type agent-friction --attach-last-error --summary "${summary}" --message "Describe expected vs observed behavior"${dryRunFlag}`;
  }
  if (reason === 'anomaly_error') {
    return `ariax feedback --type bug --attach-last-error --summary "${current.command_template} encountered ${current.error_code}" --message "Describe expected vs observed behavior"${dryRunFlag}`;
  }
  return `ariax feedback --type bug --attach-last-error --summary "${current.command_template} failed with server error (exit ${current.exit_code})" --message "Describe expected vs observed behavior"${dryRunFlag}`;
}

/**
 * Evaluate whether the current CLI failure qualifies for a stderr `feedback_opportunity` notice.
 * Returns a notice object or null.
 */
export function evaluateFeedbackOpportunity(
  buffer,
  currentEntry,
  { env = process.env, now = Date.now(), attemptedCommand = undefined } = {},
) {
  const agent = detectAgentShell(env);
  if (!agent) return null;
  const consentMode = feedbackConsentMode(env);
  if (consentMode === 'off') return null;

  const nowMs = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const current = sanitizeErrorEntry(currentEntry, nowMs);
  if (current.command_template === 'feedback') return null;
  const attemptedToken = current.command_template === 'unknown'
    ? sanitizeCommandToken(attemptedCommand ?? currentEntry?.attempted_command)
    : null;

  const storedEntries = Array.isArray(buffer?.entries)
    ? buffer.entries.filter(isValidStoredEntry)
    : [];
  const entries = storedEntries.length > 0 && entriesEqual(storedEntries[storedEntries.length - 1], current)
    ? storedEntries
    : [...storedEntries, current];

  let reason = null;
  if (current.exit_code === EXIT.SERVER) {
    reason = 'server_error';
  } else if (current.error_code && ANOMALY_ERROR_CODES.has(current.error_code)) {
    reason = 'anomaly_error';
  } else if (hasRepeatedValidationFailures(entries, current, nowMs)) {
    reason = 'repeated_validation_failures';
  }
  if (!reason) return null;

  const key = advisoryCooldownKey(current);
  const lastEmittedRaw = buffer?.advisories?.[key];
  if (typeof lastEmittedRaw === 'string') {
    const lastEmittedMs = Date.parse(lastEmittedRaw);
    if (Number.isFinite(lastEmittedMs) && nowMs - lastEmittedMs >= 0 && nowMs - lastEmittedMs < ADVISORY_COOLDOWN_MS) {
      return null;
    }
  }

  return {
    code: 'feedback_opportunity',
    reason,
    suggested_command: buildSuggestedCommand(reason, current, consentMode, attemptedToken),
    consent_mode: consentMode,
    policy: FEEDBACK_POLICY,
  };
}
