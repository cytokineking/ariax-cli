/** `ariax jobs [--project <id>] [--status <s>] [--limit N] [--cursor C] [--all]` */
import { printData, printJson, printTable, printProgress } from '../output.js';
import { usageError } from '../args.js';
import { resolveProjectId } from '../resolve.js';

/** @param {{ client: any, flags: Record<string, any>, json: boolean }} ctx */
export async function run(ctx) {
  const { flags } = ctx;
  let projectId;
  if (flags.project !== undefined) {
    projectId = await resolveProjectId(ctx.client, String(flags.project));
  }
  let limit;
  if (flags.limit !== undefined) {
    limit = Number(flags.limit);
    if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
      throw usageError(`jobs: --limit must be an integer 1..100 (got "${flags.limit}").`);
    }
  }
  const baseQuery = { project_id: projectId, status: flags.status, limit, cursor: flags.cursor };
  const items = [];
  let cursor = flags.cursor;
  let requestId;
  const maxPages = flags.all === true ? 20 : 1;
  for (let page = 0; page < maxPages; page++) {
    const res = await ctx.client.get('/api/v1/jobs', { query: { ...baseQuery, cursor } });
    requestId = res.requestId;
    const batch = Array.isArray(res.data) ? res.data : (res.data?.items ?? res.data?.jobs ?? []);
    if (Array.isArray(batch)) items.push(...batch);
    const next = res.data?.next_cursor ?? res.data?.cursor ?? res.meta?.next_cursor ?? res.meta?.cursor;
    cursor = typeof next === 'string' && next ? next : undefined;
    if (flags.all !== true || !cursor) break;
  }
  if (ctx.json) {
    printJson({ data: { jobs: items }, meta: cursor ? { next_cursor: cursor } : undefined, request_id: requestId });
    return;
  }
  if (items.length === 0) {
    printData('No jobs found.');
    return;
  }
  printTable(
    ['id', 'project_id', 'status'],
    items.map((j) => [
      j.id ?? '-',
      j.project_id ?? j.projectId ?? '-',
      j.status ?? j.state ?? '-',
    ]),
  );
  if (cursor) printProgress(`More results available — re-run with --cursor ${cursor} (or --all).`);
}
