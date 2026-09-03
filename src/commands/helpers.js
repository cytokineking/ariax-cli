/**
 * Shared helpers for command modules (thin transport only, no business rules).
 */
import fs from 'node:fs';
import { EXIT } from '../exit-codes.js';
import { usageError } from '../args.js';
import { printData, printJson, printProgress } from '../output.js';

/** Throw a usage error (exit 1) for missing/invalid flags. */
export function requireFlag(flags, name, command) {
  const v = flags[name];
  if (v === undefined || v === null || v === '') {
    throw usageError(`${command}: missing required --${name}`);
  }
  return v;
}

/** Emit data: JSON envelope to stdout in JSON mode, else human rendering. */
export function emit(ctx, data, renderHuman) {
  if (ctx.jsonMode) {
    printJson(data);
    return;
  }
  renderHuman();
}

/** Standard JSON envelope for command results. */
export function result(data, meta, requestId) {
  const out = { data };
  if (meta !== undefined) out.meta = meta;
  if (requestId) out.request_id = requestId;
  return out;
}

/** Read and parse a JSON file flag. Missing file -> usage; bad JSON -> validation. */
export function readJsonFile(fileFlag, command) {
  const file = requireFlag({ file: fileFlag }, 'file', command);
  let raw;
  try {
    raw = fs.readFileSync(String(file), 'utf8');
  } catch (err) {
    throw usageError(`${command}: cannot read file "${file}": ${err.message}`);
  }
  try {
    return { file: String(file), json: JSON.parse(raw) };
  } catch (err) {
    const e = new Error(`${command}: file "${file}" is not valid JSON: ${err.message}`);
    e.exitCode = EXIT.VALIDATION;
    throw e;
  }
}

/** Parse a positive integer flag. */
export function parsePositiveInt(value, name, command) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw usageError(`${command}: --${name} must be a positive integer (got "${value}")`);
  }
  return n;
}

/** Progress sink for HTTP retries (stderr only). */
export function retryLogger() {
  return ({ method, path, attempt, waitMs, status }) => {
    printProgress(
      `… retry ${attempt} for ${method} ${path}${status ? ` (HTTP ${status})` : ''} in ${waitMs}ms`,
    );
  };
}

/** Print a short request-id footnote to stderr (never stdout). */
export function requestFootnote(requestId) {
  if (requestId) printProgress(`request-id: ${requestId}`);
}

/** Coerce common list envelopes to an array for human rendering. */
export function toArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const k of ['items', 'projects', 'jobs', 'artifacts', 'logs', 'protocols']) {
      if (Array.isArray(data[k])) return data[k];
    }
  }
  return [];
}

export { printData, printProgress };
