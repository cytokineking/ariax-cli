/**
 * Output helpers: data -> stdout, diagnostics/progress -> stderr.
 * JSON mode when stdout is piped or --json is passed. Human mode otherwise.
 */

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

/** Emit an object as JSON to stdout. */
export function printJson(obj) {
  printData(JSON.stringify(obj));
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
