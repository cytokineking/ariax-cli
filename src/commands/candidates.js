/** Retrieve engine-specific candidate evidence without starting compute. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { usageError } from '../args.js';
import { EXIT } from '../exit-codes.js';
import { printJson, printProgress, printTable } from '../output.js';
import { resolveProjectId } from '../resolve.js';

function serverError(message) { const error = new Error(message); error.exitCode = EXIT.SERVER; return error; }

export async function run(ctx) {
  if (ctx.positionals.length !== 1) throw usageError('candidates: expected one project UUID or exact unique name.');
  const allowed = new Set(['view', 'limit', 'cursor', 'all', 'eligible', 'output', 'overwrite']);
  for (const flag of Object.keys(ctx.flags)) if (!allowed.has(flag)) throw usageError(`candidates: unknown flag --${flag}`);
  const view = ctx.flags.view ?? 'final';
  if (!['final', 'all', 'diagnostics'].includes(view)) throw usageError('candidates: --view must be final, all, or diagnostics.');
  const rawLimit = ctx.flags.limit ?? '25';
  const limit = Number(rawLimit);
  if (!/^\d+$/.test(String(rawLimit)) || !Number.isInteger(limit) || limit < 1 || limit > 50) throw usageError('candidates: --limit must be an integer 1..50.');
  for (const flag of ['cursor', 'output']) if (ctx.flags[flag] !== undefined && (typeof ctx.flags[flag] !== 'string' || !ctx.flags[flag])) throw usageError(`candidates: --${flag} requires a value.`);
  if (ctx.flags.overwrite && !ctx.flags.output) throw usageError('candidates: --overwrite requires --output.');
  const destination = ctx.flags.output ? path.resolve(ctx.flags.output) : null;
  if (destination) checkDestination(destination, ctx.flags.overwrite);
  const projectId = await resolveProjectId(ctx.client, ctx.positionals[0]);
  const controller = new AbortController();
  const interrupt = () => { const error = new Error('Candidate retrieval interrupted.'); error.exitCode = EXIT.INTERRUPTED; controller.abort(error); };
  process.once('SIGINT', interrupt);
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, controller.signal]) : controller.signal;
  const data = [], seenCursors = new Set(), seenIds = new Set();
  let cursor = ctx.flags.cursor, meta = {}, requestId;
  let excludedFalse = 0, excludedUnknown = 0;
  const exclusionReasons = new Set();
  try {
    do {
      signal.throwIfAborted();
      const res = await ctx.client.get(`/api/v1/projects/${encodeURIComponent(projectId)}/candidates`, { query: { view, limit, cursor }, signal });
      signal.throwIfAborted();
      if (!Array.isArray(res.data)) throw serverError('Candidate endpoint returned an invalid page.');
      meta = res.meta || {};
      requestId = res.requestId;
      for (const candidate of res.data) {
        if (!candidate || typeof candidate.id !== 'string' || !candidate.id || seenIds.has(candidate.id)) throw serverError('Candidate page contains missing or repeated IDs; restart retrieval.');
        seenIds.add(candidate.id);
        if (ctx.flags.eligible && candidate.ranking_eligible !== true) {
          if (candidate.ranking_eligible === false) excludedFalse++; else excludedUnknown++;
          for (const reason of candidate.ranking_reasons || []) if (typeof reason === 'string') exclusionReasons.add(reason);
        } else data.push(candidate);
      }
      const next = meta.next_cursor;
      if (next !== undefined && next !== null && (typeof next !== 'string' || !next)) throw serverError('Candidate endpoint returned an invalid cursor.');
      if (next && seenCursors.has(next)) throw serverError('Candidate endpoint repeated a cursor; restart retrieval.');
      if (next) seenCursors.add(next);
      cursor = next;
    } while (ctx.flags.all && cursor);
    const result = { data, meta: { ...meta, returned: data.length, fetched: seenIds.size, ...(ctx.flags.eligible ? { eligibility_filter: { mode: 'explicit_true_only', excluded_false: excludedFalse, excluded_unknown: excludedUnknown, reasons: [...exclusionReasons] } } : {}) }, ...(requestId ? { request_id: requestId } : {}) };
    if (destination) {
      writeAtomic(destination, JSON.stringify(result, null, 2) + '\n', ctx.flags.overwrite);
      printProgress(`Saved ${data.length} candidates to ${destination}`);
    }
    if (ctx.json) printJson(result);
    else {
      printTable(['native_id', 'rank', 'selected', 'pass_filters', 'ranking_eligible', 'structures'], data.map((c) => [
        c.native_id, c.rank ?? '-', c.selection?.selected ?? 'unknown',
        nativeFilterPass(c),
        c.ranking_eligible ?? 'unknown', c.structures?.length ?? 0,
      ]));
      printProgress(`Candidate state: ${meta.state ?? 'unknown'}; ${data.length} returned (${seenIds.size} fetched).`);
      if (ctx.flags.eligible) printProgress(`Explicit eligibility filter excluded ${excludedFalse} false and ${excludedUnknown} unknown rows. ${[...exclusionReasons].join(' ')}`);
      for (const warning of meta.warnings || []) printProgress(String(warning));
      if (meta.next_cursor) printProgress('More rows are available; use --all or --cursor with the JSON next_cursor.');
    }
    return result;
  } finally { process.removeListener('SIGINT', interrupt); }
}

function nativeFilterPass(candidate) {
  const overall = Array.isArray(candidate?.filters)
    ? candidate.filters.find((filter) => filter?.name === 'pass_filters')
    : undefined;
  return overall?.passed === true ? true : (overall?.passed === false ? false : 'unknown');
}

function checkDestination(destination, overwrite) {
  let stat;
  try { stat = fs.lstatSync(destination); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw usageError('candidates: output destination must be a regular file, not a symlink or directory.');
  if (stat && !overwrite) throw usageError('candidates: output exists; pass --overwrite to replace it.');
}
function writeAtomic(destination, content, overwrite) {
  checkDestination(destination, overwrite);
  const temp = path.join(path.dirname(destination), `.ariax-candidates-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, content, { flag: 'wx', mode: 0o600 });
    if (overwrite) fs.renameSync(temp, destination);
    else fs.linkSync(temp, destination); // Atomic no-clobber publication, even under a race.
  } finally { fs.rmSync(temp, { force: true }); }
}
