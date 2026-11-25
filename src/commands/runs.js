/** Read optional recorded run settings without starting compute. */
import { usageError } from '../args.js';
import { EXIT } from '../exit-codes.js';
import { printData, printJson, printKv, printProgress, printTable } from '../output.js';
import { resolveProjectId } from '../resolve.js';
import { isUUID } from '../uuid.js';

function presentRun({ provenance_status, ariax_build, ...run }) {
  return { ...run, settings_status: provenance_status };
}

export async function run(ctx) {
  const { flags } = ctx;
  if (ctx.positionals.length !== 1) throw usageError('runs: expected one project UUID or exact unique name.');
  for (const key of Object.keys(flags)) if (!['job', 'limit', 'cursor', 'all'].includes(key)) throw usageError(`runs: unknown flag --${key}.`);
  if (flags.job !== undefined && !isUUID(flags.job)) throw usageError('runs: --job must be a UUID.');
  if (flags.job && ['limit', 'cursor', 'all'].some(key => flags[key] !== undefined)) throw usageError('runs: --job cannot be combined with pagination flags.');
  const limit = Number(flags.limit ?? 50);
  if (!/^\d+$/.test(String(flags.limit ?? 50)) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw usageError('runs: --limit must be an integer 1..100.');
  if (flags.cursor !== undefined && (typeof flags.cursor !== 'string' || !flags.cursor)) throw usageError('runs: --cursor requires a value.');
  const projectId = await resolveProjectId(ctx.client, ctx.positionals[0]);
  const base = `/api/v1/projects/${encodeURIComponent(projectId)}/runs`;
  if (flags.job) {
    const result = await ctx.client.get(`${base}/${encodeURIComponent(flags.job.trim())}`, { signal: ctx.signal });
    const presented = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? presentRun(result.data)
      : result.data;
    if (ctx.json) printJson({ data: presented, request_id: result.requestId });
    else if (presented && typeof presented === 'object' && !Array.isArray(presented)) printKv(presented);
    else printData(typeof presented === 'string' ? presented : JSON.stringify(presented, null, 2));
    return;
  }
  const data = [], seen = new Set(flags.cursor ? [flags.cursor] : []);
  const maxPages = flags.all === true ? 20 : 1;
  let cursor = flags.cursor, result, pages = 0;
  do {
    result = await ctx.client.get(base, { query: { limit, cursor }, signal: ctx.signal });
    pages += 1;
    const next = result.meta?.next_cursor;
    if (!Array.isArray(result.data) || (next != null && (typeof next !== 'string' || !next || seen.has(next)))) {
      const error = new Error('Run endpoint returned an invalid page or repeated cursor.');
      error.exitCode = EXIT.SERVER;
      throw error;
    }
    data.push(...result.data.map(presentRun));
    cursor = next;
    if (cursor) seen.add(cursor);
  } while (flags.all && cursor && pages < maxPages);
  const capped = Boolean(flags.all && cursor && pages >= maxPages);
  if (ctx.json) {
    printJson({
      data,
      meta: {
        ...result.meta,
        next_cursor: cursor ?? null,
        ...(capped ? { truncated_by_page_limit: true, max_pages: maxPages } : {}),
      },
      request_id: result.requestId,
    });
  } else {
    printTable(['job_id', 'status', 'settings_status'], data.map(row => [row.job_id, row.status, row.settings_status]));
    if (capped) printProgress(`Stopped after ${maxPages} pages; pass --cursor ${cursor} to continue.`);
    else if (cursor) printProgress('More runs are available; use --all or --cursor with the JSON next_cursor.');
  }
}
