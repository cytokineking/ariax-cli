/** UUID helpers. Operands must be UUIDs unless exact-name resolution applies. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {unknown} s @returns {boolean} */
export function isUUID(s) {
  return typeof s === 'string' && UUID_RE.test(s.trim());
}
