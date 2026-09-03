/**
 * Stable exit codes for the Ariax CLI.
 *
 * Documented contract (also in README.md):
 *   0   success
 *   1   usage / config error (bad args, missing file, missing env, ambiguous name)
 *   2   authentication failure (HTTP 401, missing/invalid API key)
 *   3   authorization failure (HTTP 403; foreign project surfaces as 404 per API contract)
 *   4   not found (HTTP 404)
 *   5   validation failure (HTTP 400/413/422, local file/flag validation, ambiguous names)
 *   6   payment / credit rejection (HTTP 402)
 *   7   conflict (HTTP 409, including idempotency_conflict)
 *   8   rate limited (HTTP 429)
 *   9   network / timeout failure (DNS, refused, aborted, HTTP 504)
 *   10  server failure (HTTP 500/502/503, unexpected status)
 *   130 interrupted (SIGINT during --wait; remote work NOT aborted, resume hints printed)
 */

export const EXIT = Object.freeze({
  OK: 0,
  USAGE: 1,
  AUTH: 2,
  FORBIDDEN: 3,
  NOT_FOUND: 4,
  VALIDATION: 5,
  PAYMENT: 6,
  CONFLICT: 7,
  RATE_LIMIT: 8,
  NETWORK: 9,
  SERVER: 10,
  INTERRUPTED: 130,
});

/**
 * Map an HTTP status to a stable CLI exit code.
 * @param {number|undefined} status
 * @returns {number}
 */
export function httpStatusToExit(status) {
  if (typeof status !== 'number' || Number.isNaN(status)) return EXIT.SERVER;
  if (status === 401) return EXIT.AUTH;
  if (status === 403) return EXIT.FORBIDDEN;
  if (status === 404) return EXIT.NOT_FOUND;
  if (status === 400 || status === 413 || status === 422) return EXIT.VALIDATION;
  if (status === 402) return EXIT.PAYMENT;
  if (status === 409) return EXIT.CONFLICT;
  if (status === 429) return EXIT.RATE_LIMIT;
  if (status === 504) return EXIT.NETWORK;
  if (status >= 500) return EXIT.SERVER;
  if (status >= 200 && status < 300) return EXIT.OK;
  return EXIT.SERVER;
}

/**
 * Map a public API error `code` string to an exit code when HTTP status
 * is missing or ambiguous. HTTP status wins when present.
 * @param {string|undefined} code
 * @returns {number|undefined}
 */
export function errorCodeToExit(code) {
  if (!code || typeof code !== 'string') return undefined;
  const c = code.toLowerCase();
  if (c.includes('unauth') || c === 'invalid_api_key' || c === 'expired' || c === 'revoked') return EXIT.AUTH;
  if (c.includes('forbidden') || c.includes('scope') || c.includes('denied')) return EXIT.FORBIDDEN;
  if (c.includes('not_found') || c === 'no_such_project' || c === 'no_such_job') return EXIT.NOT_FOUND;
  if (c.includes('idempotency_conflict') || c === 'conflict' || c === 'cursor_stale' || c.includes('already_exists')) return EXIT.CONFLICT;
  if (c.includes('rate_limit') || c.includes('too_many_requests')) return EXIT.RATE_LIMIT;
  if (c.includes('payment') || c.includes('credit') || c.includes('insufficient')) return EXIT.PAYMENT;
  if (c.includes('validat') || c.includes('schema') || c.includes('ambiguous') || c.includes('bad_request') || c.includes('payload_too_large')) return EXIT.VALIDATION;
  return undefined;
}
