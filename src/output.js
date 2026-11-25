/**
 * Output helpers: data -> stdout, diagnostics/progress -> stderr.
 * JSON mode when stdout is piped or --json is passed. Human mode otherwise.
 */
import { usageError } from './args.js';

const FORBIDDEN_FIELD_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const PRIMARY_ARRAY_KEYS = [
  'projects',
  'tools',
  'candidates',
  'artifacts',
  'jobs',
  'sessions',
  'commands',
  'entries',
  'operations',
  'events',
  'rates',
];

let activeOutputFields = null;
let epipeInstalled = false;

/** Exit cleanly when downstream pipes (e.g. `| head`) close stdout early. */
export function installStdoutEpipeHandler() {
  if (epipeInstalled) return;
  epipeInstalled = true;
  process.stdout.on('error', (err) => {
    if (err?.code === 'EPIPE') process.exit(0);
    throw err;
  });
}

installStdoutEpipeHandler();

function stripLeadingDataPrefix(selector) {
  return typeof selector === 'string' && selector.startsWith('data.')
    ? selector.slice('data.'.length)
    : selector;
}

/**
 * Parse and validate a comma-separated list of dot-path field selectors.
 * Accepts an optional leading `data.` envelope prefix (e.g. `data.project_id` == `project_id`).
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseFieldsOption(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw usageError('--fields requires a comma-separated list of field paths (e.g. --fields id,name,status).');
  }
  const seen = new Set();
  const fields = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) {
      throw usageError(`--fields contains an empty field selector (got "${raw}").`);
    }
    const normalized = stripLeadingDataPrefix(trimmed);
    if (!normalized) {
      throw usageError(`--fields contains an invalid field path "${trimmed}".`);
    }
    const segments = normalized.split('.');
    for (const seg of segments) {
      if (!seg || !/^[A-Za-z0-9_-]+$/.test(seg) || FORBIDDEN_FIELD_SEGMENTS.has(seg)) {
        throw usageError(`--fields contains an invalid field path "${trimmed}".`);
      }
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      fields.push(normalized);
    }
  }
  if (!fields.length) {
    throw usageError('--fields requires at least one field path.');
  }
  return fields;
}

/** Configure global field projection applied by printJson. Pass null to clear. */
export function setOutputFields(fields) {
  if (fields === null || fields === undefined) {
    activeOutputFields = null;
    return;
  }
  activeOutputFields = Array.isArray(fields) ? fields : parseFieldsOption(fields);
}

function getDotPath(obj, segments) {
  let cur = obj;
  for (const seg of segments) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || Array.isArray(cur)) {
      return { found: false, value: undefined };
    }
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) {
      return { found: false, value: undefined };
    }
    cur = cur[seg];
  }
  return { found: true, value: cur };
}

function setDotPath(target, segments, value) {
  let cur = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (!Object.prototype.hasOwnProperty.call(cur, seg) || typeof cur[seg] !== 'object' || cur[seg] === null || Array.isArray(cur[seg])) {
      cur[seg] = {};
    }
    cur = cur[seg];
  }
  cur[segments[segments.length - 1]] = value;
}

function pickObjectFields(item, parsedPaths) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const out = {};
  for (const segments of parsedPaths) {
    const { found, value } = getDotPath(item, segments);
    if (found && value !== undefined) {
      setDotPath(out, segments, value);
    }
  }
  return out;
}

/**
 * Non-destructively project an envelope or value using dot-path field selectors.
 * Preserves top-level `meta` and `request_id`; never alters error envelopes.
 * @param {unknown} obj
 * @param {string[]|string|null|undefined} fields
 */
export function projectFields(obj, fields) {
  if (!fields || (Array.isArray(fields) && fields.length === 0)) return obj;
  const rawList = Array.isArray(fields) ? fields : parseFieldsOption(fields);
  const list = rawList.map((f) => stripLeadingDataPrefix(f)).filter(Boolean);
  if (!list.length) return obj;
  const parsedPaths = list.map((f) => f.split('.'));
  const topLevelRequested = new Set(parsedPaths.map((segs) => segs[0]));

  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => pickObjectFields(item, parsedPaths));
  }
  if (Object.prototype.hasOwnProperty.call(obj, 'error') && !Object.prototype.hasOwnProperty.call(obj, 'data')) {
    return obj;
  }
  if (Object.prototype.hasOwnProperty.call(obj, 'data')) {
    const data = obj.data;
    if (Array.isArray(data)) {
      return { ...obj, data: data.map((item) => pickObjectFields(item, parsedPaths)) };
    }
    if (data && typeof data === 'object') {
      const arrayKey = PRIMARY_ARRAY_KEYS.find(
        (key) => Object.prototype.hasOwnProperty.call(data, key) && Array.isArray(data[key]),
      );
      if (arrayKey && !topLevelRequested.has(arrayKey)) {
        return {
          ...obj,
          data: {
            ...data,
            [arrayKey]: data[arrayKey].map((item) => pickObjectFields(item, parsedPaths)),
          },
        };
      }
      return { ...obj, data: pickObjectFields(data, parsedPaths) };
    }
    return obj;
  }
  return pickObjectFields(obj, parsedPaths);
}

export function isJsonMode(flags) {
  if (flags.json === true) return true;
  if (flags.json === false) return false;
  return !process.stdout.isTTY;
}

/** Write data payload to stdout (JSON line or human text). */
export function printData(text) {
  process.stdout.write(text.endsWith('\n') ? text : text + '\n');
}

/** Write diagnostics/progress to stderr. Never carries secrets. */
export function printProgress(text) {
  process.stderr.write(text.endsWith('\n') ? text : text + '\n');
}

/** Emit an object as JSON to stdout (applying any active --fields projection). */
export function printJson(obj) {
  const payload = activeOutputFields ? projectFields(obj, activeOutputFields) : obj;
  printData(JSON.stringify(payload));
}

/**
 * Render a simple aligned table for human output.
 * @param {string[]} headers
 * @param {Array<Array<unknown>>} rows
 */
export function printTable(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length))
  );
  const line = (cells) =>
    cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ').trimEnd();
  printData(line(headers));
  printData(widths.map((w) => '-'.repeat(Math.min(w, 40))).join('  '));
  for (const r of rows) printData(line(r));
}

/** Human "key: value" block. */
export function printKv(obj) {
  for (const [k, v] of Object.entries(obj)) {
    printData(`${k}: ${formatScalar(v)}`);
  }
}

function formatScalar(v) {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
