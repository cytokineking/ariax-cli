/**
 * `ariax logs <job-id> [--list] [--tail N] [--log-ref PATH]`
 * Reads a job-owned log artifact from project object storage. This surface does
 * not expose Ariax application or platform logs.
 */
import { printData, printJson, printProgress, printTable } from '../output.js';
import { usageError } from '../args.js';
import { isUUID } from '../uuid.js';

/** @param {{ client: any, flags: Record<string, any>, positionals: string[], json: boolean }} ctx */
export async function run(ctx) {
  const operand = ctx.positionals[0];
  if (!operand) throw usageError('logs: missing <job-id> (UUID).');
  if (!isUUID(String(operand))) {
    throw usageError(`logs: invalid job id "${operand}": expected a UUID (see: ariax jobs).`);
  }
  if (ctx.flags.list === true) {
    if (ctx.flags.tail !== undefined || ctx.flags['log-ref'] !== undefined) {
      throw usageError('logs: --list cannot be combined with --tail or --log-ref.');
    }
    return listLogs(ctx, String(operand));
  }
  let tail = 200;
  if (ctx.flags.tail !== undefined) {
    tail = Number(ctx.flags.tail);
    if (!Number.isInteger(tail) || tail <= 0 || tail > 5000) {
      throw usageError(`logs: --tail must be an integer 1..5000 (got "${ctx.flags.tail}").`);
    }
  }
  const query = { tail };
  if (ctx.flags['log-ref'] !== undefined) query.log_ref = String(ctx.flags['log-ref']);
  const res = await ctx.client.get(`/api/v1/jobs/${encodeURIComponent(String(operand))}/logs`, { query });
  if (ctx.json) {
    printJson({ data: res.data, meta: res.meta, request_id: res.requestId });
    return;
  }
  if (res.data?.truncated === true) {
    if (tail < 5000) {
      const suggestedTail = Math.min(5000, Math.max(tail + 1, tail * 2));
      printProgress(`Log output is truncated; request a larger bounded tail with --tail ${suggestedTail} (maximum 5000).`);
    } else {
      printProgress('Log output is truncated; the maximum bounded request (--tail 5000) is already in use.');
    }
  }
  const lines = extractLines(res.data);
  if (lines.length === 0) {
    printData('(no log lines)');
    return;
  }
  for (const line of lines) printData(line);
}

function extractLines(data) {
  const raw = Array.isArray(data)
    ? data
    : (data?.content ?? data?.logs ?? data?.lines ?? data?.entries ?? []);
  if (typeof raw === 'string') return raw.split('\n');
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => {
    if (typeof e === 'string') return e;
    if (e && typeof e === 'object') {
      const ts = e.timestamp ?? e.ts ?? e.time;
      const msg = e.message ?? e.text ?? e.line ?? JSON.stringify(e);
      return ts ? `${ts} ${msg}` : String(msg);
    }
    return String(e);
  });
}

async function listLogs(ctx, jobId) {
  const logs = [];
  const seen = new Set();
  let cursor;
  let requestId;
  do {
    const res = await ctx.client.get(`/api/v1/jobs/${encodeURIComponent(jobId)}/logs/list`, {
      query: { limit: 100, cursor }, signal: ctx.signal,
    });
    requestId = res.requestId;
    if (!Array.isArray(res.data) || res.data.some((item) => !item || typeof item.log_ref !== 'string' || !item.log_ref)) {
      throw new Error('Log listing returned an invalid page.');
    }
    logs.push(...res.data);
    cursor = res.meta?.next_cursor;
    if (cursor !== undefined && cursor !== null && (typeof cursor !== 'string' || !cursor || seen.has(cursor))) {
      throw new Error('Log listing returned an invalid or repeated continuation cursor.');
    }
    if (cursor) seen.add(cursor);
  } while (cursor);
  if (ctx.json) printJson({ data: { job_id: jobId, logs }, meta: { next_cursor: null }, request_id: requestId });
  else if (logs.length) printTable(['log_ref', 'label', 'size', 'last_modified'], logs.map((item) => [
    item.log_ref, item.label ?? '-', item.size ?? '-', item.last_modified ?? '-',
  ]));
  else printData('No logs are currently retained for this job.');
  return { logs };
}
