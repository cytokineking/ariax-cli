/** `ariax projects` — list/filter projects (GET /api/v1/projects). */
import { printData, printJson, printTable, printProgress } from '../output.js';
import { usageError } from '../args.js';
import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectId } from '../resolve.js';

/** @param {{ client: any, flags: Record<string, any>, json: boolean }} ctx */
export async function run(ctx) {
  const { flags } = ctx;
  if (ctx.positionals?.[0] === 'export') {
    if (ctx.positionals.length !== 2) throw usageError('projects export: provide one project ID or exact unique name.');
    for (const key of Object.keys(flags)) if (key !== 'output') throw usageError(`projects export: unknown flag --${key}.`);
    const id = await resolveProjectId(ctx.client, ctx.positionals[1]);
    const response = await ctx.client.get(`/api/v1/projects/${id}/config`);
    const spec = response.data?.job_spec;
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('Configuration export returned no valid job spec.');
    if (flags.output !== undefined) {
      const output = path.resolve(String(flags.output));
      try { fs.writeFileSync(output, JSON.stringify(spec, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code === 'EEXIST') throw usageError('projects export: output exists; choose a new path.'); throw error; }
      if (ctx.json) printJson({ data: { ...response.data, output }, request_id: response.requestId });
      else printData(`Exported configuration: ${output}`);
    } else printJson({ data: response.data, request_id: response.requestId });
    return;
  }
  if (ctx.positionals?.length) throw usageError('projects: unknown subcommand. Use projects export <project-id> or projects with list filters.');
  for (const key of Object.keys(flags)) if (!['status', 'protocol', 'name', 'limit', 'cursor', 'all'].includes(key)) throw usageError(`projects: unknown flag --${key}.`);
  let limit;
  if (flags.limit !== undefined) {
    limit = Number(flags.limit);
    if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
      throw usageError(`projects: --limit must be an integer 1..100 (got "${flags.limit}").`);
    }
  }
  const baseQuery = {
    status: flags.status,
    protocol: flags.protocol,
    name: flags.name,
    limit,
    cursor: flags.cursor,
  };
  const items = [];
  let cursor = flags.cursor;
  let requestId;
  let meta;
  const maxPages = flags.all === true ? 20 : 1;
  for (let page = 0; page < maxPages; page++) {
    const res = await ctx.client.get('/api/v1/projects', { query: { ...baseQuery, cursor } });
    requestId = res.requestId;
    const batch = Array.isArray(res.data) ? res.data : (res.data?.items ?? res.data?.projects ?? []);
    if (Array.isArray(batch)) items.push(...batch);
    meta = res.meta ?? res.data?.meta;
    const next = res.data?.next_cursor ?? res.data?.cursor ?? meta?.next_cursor ?? meta?.cursor;
    cursor = typeof next === 'string' && next ? next : undefined;
    if (flags.all !== true || !cursor) break;
  }
  if (ctx.json) {
    printJson({ data: { projects: items }, meta: cursor ? { next_cursor: cursor } : meta, request_id: requestId });
    return;
  }
  if (items.length === 0) {
    printData('No projects found.');
    return;
  }
  printTable(
    ['id', 'name', 'protocol', 'status'],
    items.map((p) => [p.id ?? '-', p.name ?? '-', p.protocol ?? p.protocol_id ?? '-', p.status ?? p.state ?? '-']),
  );
  if (cursor) printProgress(`More results available — re-run with --cursor ${cursor} (or --all).`);
}
