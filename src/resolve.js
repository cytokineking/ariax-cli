/** Project operand resolution: UUIDs only, unless an exact name is safely unique. */
import { isUUID } from './uuid.js';
import { EXIT } from './exit-codes.js';

export class ResolutionError extends Error {
  constructor(message, exitCode = EXIT.NOT_FOUND) {
    super(message);
    this.name = 'ResolutionError';
    this.exitCode = exitCode;
  }
}

/**
 * Resolve a project operand to a UUID.
 * - UUIDs pass through untouched (no network call).
 * - Anything else is treated as an exact project name: it resolves only
 *   when the API returns exactly one project with that exact name.
 *   Zero matches -> not-found; more than one -> usage error (ambiguous).
 * @param {object} client from createClient()
 * @param {string} operand
 */
export async function resolveProjectId(client, operand) {
  const value = String(operand ?? '').trim();
  if (!value) throw new ResolutionError('Missing project id or name.', EXIT.USAGE);
  if (isUUID(value)) return value;
  let resp;
  try {
    resp = await client.get('/api/v1/projects', { query: { name: value, limit: 10 } });
  } catch (err) {
    throw err;
  }
  const items = extractItems(resp?.data);
  const exact = items.filter((p) => p && p.name === value);
  if (exact.length === 1 && exact[0].id) return String(exact[0].id);
  if (exact.length === 0) {
    throw new ResolutionError(
      `No project found with exact name "${value}". Use a project UUID (see: ariax projects).`,
      EXIT.NOT_FOUND,
    );
  }
  throw new ResolutionError(
    `Ambiguous project name "${value}": ${exact.length} projects share it. Re-run with an explicit UUID.`,
    EXIT.USAGE,
  );
}

function extractItems(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const k of ['items', 'projects']) {
      if (Array.isArray(data[k])) return data[k];
    }
  }
  return [];
}
