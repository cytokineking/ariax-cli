/**
 * Thin HTTP transport over built-in fetch (Node 20+).
 *
 * - Bearer auth via the configured API key (never logged; see sanitize()).
 * - Per-request timeout via AbortController.
 * - Robust envelope handling: success `{ data, meta }`, error
 *   `{ error: { code, message, retryable }, request_id }`
 *   plus `X-Request-Id` header propagation.
 * - Retry-After honored for retry-safe GETs with bounded exponential
 *   backoff + jitter. Mutations (POST) are NEVER auto-retried.
 */
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { EXIT, httpStatusToExit, errorCodeToExit } from './exit-codes.js';

export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_GET_ATTEMPTS = 4;
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_MAX_MS = 15_000;

/** Redact anything that looks like a credential. */
export function sanitize(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/arx_[A-Za-z0-9_-]{8,}/g, 'arx_[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]');
}

/** API failure with stable exit mapping. */
export class ApiError extends Error {
  constructor({ status, code, message, details, retryable, requestId, retryAfterMs }) {
    super(sanitize(message || `Request failed${status ? ` (HTTP ${status})` : ''}`));
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.requestId = requestId;
    this.retryAfterMs = retryAfterMs;
    const publicDetails = sanitizeErrorDetails(details);
    if (publicDetails !== undefined) this.details = publicDetails;
    const fromStatus = typeof status === 'number' ? httpStatusToExit(status) : undefined;
    const fromCode = errorCodeToExit(code);
    // HTTP status wins when present; error-code mapping refines unknown statuses.
    this.exitCode = fromStatus !== undefined ? fromStatus : (fromCode ?? EXIT.SERVER);
    if (fromStatus === EXIT.SERVER && fromCode !== undefined) this.exitCode = fromCode;
  }
}

/** Keep public validation/payment details and redact credentials in every string. */
function sanitizeErrorDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const result = {};
  if (Array.isArray(details.issues)) {
    result.issues = details.issues.slice(0, 50).flatMap((issue) => {
      if (!issue || !Array.isArray(issue.field) || typeof issue.rule !== 'string' || typeof issue.message !== 'string') return [];
      const projected = {
        field: issue.field.slice(0, 32).filter((v) => typeof v === 'string' || Number.isSafeInteger(v)).map(sanitize),
        rule: sanitize(issue.rule).slice(0, 128),
        message: sanitize(issue.message).slice(0, 1000),
      };
      if (issue.constraint && typeof issue.constraint === 'object') {
        const constraint = {};
        for (const key of ['minimum', 'maximum', 'minimum_field', 'maximum_field', 'allowed', 'fields', 'expected']) {
          const value = issue.constraint[key];
          if (typeof value === 'number' && Number.isFinite(value)) constraint[key] = value;
          else if (typeof value === 'string') constraint[key] = sanitize(value).slice(0, 1000);
          else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) constraint[key] = value.slice(0, 50).map((v) => sanitize(v).slice(0, 128));
        }
        if (Object.keys(constraint).length) projected.constraint = constraint;
      }
      return [projected];
    });
  }
  for (const key of ['current_balance_usd', 'required_balance_usd', 'deficit_usd']) {
    if (typeof details[key] === 'number' && Number.isFinite(details[key])) result[key] = details[key];
  }
  return Object.keys(result).length ? result : undefined;
}

/** Local network/timeout failure (no HTTP response). */
export class NetworkError extends Error {
  constructor(message, { cause } = {}) {
    super(sanitize(message));
    this.name = 'NetworkError';
    this.exitCode = EXIT.NETWORK;
    this.retryable = true;
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Parse a Retry-After header value (seconds or HTTP date) to ms.
 * @param {string|null|undefined} value
 * @param {number} [nowMs]
 * @returns {number|undefined} bounded to [0, 120000]
 */
export function parseRetryAfter(value, nowMs = Date.now()) {
  if (value == null || value === '') return undefined;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) {
    return Math.min(Number(s) * 1000, 120_000);
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    return Math.max(0, Math.min(t - nowMs, 120_000));
  }
  return undefined;
}

/**
 * Bounded exponential backoff with +/-50% jitter.
 * @param {number} attempt 0-based
 * @param {( ) => number} [rand] injectable RNG for tests
 */
export function backoffDelay(attempt, baseMs = BACKOFF_BASE_MS, maxMs = BACKOFF_MAX_MS, rand = Math.random) {
  const exp = Math.min(baseMs * 2 ** attempt, maxMs);
  const jitter = exp * (0.5 + rand());
  return Math.min(Math.round(jitter), maxMs);
}

const sleep = (ms, signal) => delay(ms, undefined, { signal });

function interrupted(signal) {
  const error = new Error(signal?.reason?.message || 'Request interrupted.');
  error.exitCode = EXIT.INTERRUPTED;
  return error;
}

async function withCallerSignal(operation, signal) {
  if (!signal) return operation();
  if (signal.aborted) throw interrupted(signal);
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(interrupted(signal));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([operation(), cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

/** Validate a server-issued upload or download URL without exposing it in errors. */
export function validateTransferUrl(value, label = 'Transfer') {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new NetworkError(`${label} URL is invalid.`);
  }
  if (url.username || url.password || url.hash) {
    throw new NetworkError(`${label} URL contains unsupported credentials or a fragment.`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new NetworkError(`${label} URL must use HTTPS.`);
  }
  return url.toString();
}

function buildUrl(baseUrl, path, query) {
  const direct = new URL(baseUrl.replace(/\/+$/, '') + (path.startsWith('/') ? path : `/${path}`));
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      direct.searchParams.append(k, String(v));
    }
  }
  return direct.toString();
}

/**
 * Create a thin API client.
 * @param {{ baseUrl: string, apiKey?: string, timeoutMs?: number, fetchImpl?: typeof fetch, sleepImpl?: (ms:number,signal?:AbortSignal)=>Promise<void>, rand?: ()=>number, onRetry?: (info:{method:string,path:string,attempt:number,waitMs:number,status?:number})=>void }} opts
 */
export function createClient({
  baseUrl,
  apiKey = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
  rand = Math.random,
  onRetry,
} = {}) {
  if (!baseUrl) throw new Error('baseUrl is required');

  async function rawRequest(method, path, { query, body, idempotencyKey, timeout, signal } = {}) {
    if (signal?.aborted) throw interrupted(signal);
    const url = buildUrl(baseUrl, path, query);
    const requestId = randomUUID();
    const headers = {
      Accept: 'application/json',
      'X-Request-Id': requestId,
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey);
    let payload;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const ms = timeout ?? timeoutMs;
    const timer = setTimeout(() => controller.abort(), ms);
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers,
        body: payload,
        signal: controller.signal,
        redirect: 'error',
      });
      const result = await parseResponse(res, { method, path });
      if (signal?.aborted) throw interrupted(signal);
      if (controller.signal.aborted) throw new NetworkError(`Request timed out after ${ms}ms: ${method} ${path}`);
      return result;
    } catch (err) {
      if (signal?.aborted) throw interrupted(signal);
      if (err instanceof ApiError || err instanceof NetworkError) throw err;
      if (err && err.name === 'AbortError') {
        throw new NetworkError(`Request timed out after ${ms}ms: ${method} ${path}`);
      }
      throw new NetworkError(`Network failure: ${method} ${path}: ${err?.message || err}`, { cause: err });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  async function parseResponse(res, { method, path }) {
    const headerRequestId =
      res.headers?.get?.('x-request-id') || res.headers?.get?.('x-requestid') || undefined;
    const retryAfterMs = parseRetryAfter(res.headers?.get?.('retry-after'));
    const status = res.status;
    let text = '';
    try {
      text = await res.text();
    } catch {
      text = '';
    }
    let parsed;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }
    if (res.ok) {
      const data = parsed !== undefined && parsed !== null && typeof parsed === 'object' && 'data' in parsed
        ? parsed.data
        : parsed;
      const meta = parsed && typeof parsed === 'object' ? parsed.meta : undefined;
      const requestId =
        (parsed && typeof parsed === 'object' && (parsed.request_id || parsed.requestId)) ||
        headerRequestId;
      return { status, data, meta, requestId, headers: res.headers, retryAfterMs, raw: parsed ?? text };
    }
    let code;
    let message;
    let retryable;
    let envelopeRequestId;
    let details;
    if (parsed && typeof parsed === 'object') {
      const e = parsed.error && typeof parsed.error === 'object' ? parsed.error : undefined;
      code = e?.code ?? parsed.code;
      message = e?.message ?? parsed.message;
      retryable = e?.retryable ?? parsed.retryable;
      details = e?.details;
      envelopeRequestId = parsed.request_id ?? parsed.requestId;
    }
    if (!message) message = `Request failed: ${method} ${path} (HTTP ${status})`;
    throw new ApiError({
      status,
      code,
      message,
      details,
      retryable,
      requestId: envelopeRequestId || headerRequestId,
      retryAfterMs,
    });
  }

  function isRetryableGetError(err) {
    if (err instanceof NetworkError) return true;
    if (err instanceof ApiError) {
      if (err.status === 429) return true;
      if (err.status === 503 || err.status === 504) return true;
      if (err.status >= 500 && err.retryable === true) return true;
    }
    return false;
  }

  /** GET with bounded retries (honors Retry-After, else backoff+jitter). */
  async function get(path, opts = {}) {
    const attempts = opts.attempts ?? MAX_GET_ATTEMPTS;
    let lastErr;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await rawRequest('GET', path, opts);
      } catch (err) {
        lastErr = err;
        if (opts.signal?.aborted) throw interrupted(opts.signal);
        if (!isRetryableGetError(err) || attempt === attempts - 1) throw err;
        const waitMs = err.retryAfterMs ?? backoffDelay(attempt, BACKOFF_BASE_MS, BACKOFF_MAX_MS, rand);
        onRetry?.({ method: 'GET', path, attempt: attempt + 1, waitMs, status: err.status });
        await withCallerSignal(() => sleepImpl(waitMs, opts.signal), opts.signal);
      }
    }
    throw lastErr;
  }

  /** POST is never auto-retried (no blind mutation retry). */
  async function post(path, opts = {}) {
    return rawRequest('POST', path, opts);
  }

  return { get, post, rawRequest };
}

/** Extract the `data` member of a success envelope (or the body itself). */
export function envelopeData(body) {
  if (body && typeof body === 'object' && 'data' in body) return body.data;
  return body;
}

/** Normalize a list envelope to an array (data | data.items | data.projects | ...). */
export function envelopeList(body, keys = ['items', 'projects', 'jobs', 'artifacts', 'logs', 'protocols']) {
  const data = envelopeData(body);
  if (Array.isArray(data)) return { list: data, meta: body?.meta };
  if (data && typeof data === 'object') {
    for (const k of keys) {
      if (Array.isArray(data[k])) return { list: data[k], meta: data.meta ?? body?.meta, cursor: data.next_cursor ?? data.cursor };
    }
  }
  return { list: [], meta: body?.meta };
}
