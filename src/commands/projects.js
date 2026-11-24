/** `ariax projects` — list/filter projects (GET /api/v1/projects). */
import { printData, printJson, printTable, printProgress } from '../output.js';
import { usageError } from '../args.js';
import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectId } from '../resolve.js';

const PROJECT_SUMMARY_KEYS = [
  'id',
  'name',
  'protocol',
  'status',
  'created_at',
  'updated_at',
  'completed_at',
  'latest_job_id',
  'job_count',
  'design_count_source',
  'tested_designs',
  'accepted_designs',
  'total_runtime_seconds',
  'total_cost_usd',
  'project_url',
];

function compactProjectRow(p) {
  if (!p || typeof p !== 'object') return p;
  const out = {};
  for (const key of PROJECT_SUMMARY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(p, key)) out[key] = p[key];
  }
  if (out.protocol === undefined && p.protocol_id !== undefined) out.protocol = p.protocol_id;
  if (out.status === undefined && p.state !== undefined) out.status = p.state;
  if (out.job_count === undefined && Array.isArray(p.jobs)) out.job_count = p.jobs.length;
  if (out.latest_job_id === undefined && Array.isArray(p.jobs) && p.jobs.length) {
    out.latest_job_id = p.jobs[0]?.id ?? null;
  }
  return out;
}

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
  for (const key of Object.keys(flags)) if (!['status', 'protocol', 'name', 'limit', 'cursor', 'all', 'details'].includes(key)) throw usageError(`projects: unknown flag --${key}.`);
  let limit;
  if (flags.limit !== undefined) {
    limit = Number(flags.limit);
    if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
      throw usageError(`projects: --limit must be an integer 1..100 (got "${flags.limit}").`);
    }
  }
  const view = flags.details === true ? 'full' : 'summary';
  const baseQuery = {
    status: flags.status,
    protocol: flags.protocol,
    name: flags.name,
    limit,
    cursor: flags.cursor,
    view,
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
  const presented = view === 'summary' ? items.map(compactProjectRow) : items;
  if (ctx.json) {
    printJson({ data: { projects: presented }, meta: cursor ? { ...meta, view, next_cursor: cursor } : { ...meta, view }, request_id: requestId });
    return;
  }
  if (presented.length === 0) {
    printData('No projects found.');
    return;
  }
  printTable(
    ['id', 'name', 'protocol', 'status'],
    presented.map((p) => [p.id ?? '-', p.name ?? '-', p.protocol ?? p.protocol_id ?? '-', p.status ?? p.state ?? '-']),
  );
  if (cursor) printProgress(`More results available — re-run with --cursor ${cursor} (or --all).`);
}
