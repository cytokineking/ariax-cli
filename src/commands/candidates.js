/** Retrieve engine-specific candidate evidence without starting compute. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { usageError } from '../args.js';
import { EXIT } from '../exit-codes.js';
import { printData, printJson, printProgress, printTable } from '../output.js';
import { resolveProjectId } from '../resolve.js';
import { compactCandidateResult, usesCompactCandidatePresentation } from '../campaign-presentation.js';

function serverError(message) { const error = new Error(message); error.exitCode = EXIT.SERVER; return error; }

export async function run(ctx) {
  if (ctx.positionals.length !== 1) throw usageError('candidates: expected one project UUID or exact unique name.');
  const allowed = new Set(['view', 'limit', 'cursor', 'all', 'eligible', 'output', 'overwrite', 'details']);
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
    const eligibilityFilter = ctx.flags.eligible
      ? { mode: 'explicit_true_only', excluded_false: excludedFalse, excluded_unknown: excludedUnknown, reasons: [...exclusionReasons] }
      : null;
    const result = { data, meta: { ...meta, returned: data.length, fetched: seenIds.size, ...(eligibilityFilter ? { eligibility_filter: eligibilityFilter } : {}) }, ...(requestId ? { request_id: requestId } : {}) };
    const compact = ctx.flags.details !== true && usesCompactCandidatePresentation(data, result.meta);
    const presented = compact ? compactCandidateResult(data, result.meta, eligibilityFilter) : result;
    if (destination) {
      writeAtomic(destination, JSON.stringify(presented, null, 2) + '\n', ctx.flags.overwrite);
      printProgress(`Saved ${data.length} candidates to ${destination}`);
    }
    if (ctx.json) printJson(presented);
    else {
      if (!compact) {
        if (data.some((candidate) => candidate?.engine === 'bindcraft2')) emitBindCraft2Table(data);
        else emitStandardTable(data);
      } else emitCompactTable(presented.data);
      if (compact) for (const candidate of presented.data) {
        for (const reason of candidate.ranking.reasons) printData(`Note [${candidate.native_id ?? candidate.id ?? 'candidate'}]: ${reason}`);
      }
      printProgress(`Candidate state: ${presented.meta?.state ?? meta.state ?? 'unknown'}; ${data.length} returned (${seenIds.size} fetched).`);
      if (compact && presented.meta?.explanation) printProgress(presented.meta.explanation);
      if (compact) for (const note of presented.meta?.notes || []) printData(`Note: ${note}`);
      if (ctx.flags.eligible) printProgress(`Explicit eligibility filter excluded ${excludedFalse} false and ${excludedUnknown} unknown rows. ${[...exclusionReasons].join(' ')}`);
      if (!compact) for (const warning of meta.warnings || []) printProgress(String(warning));
      if (meta.next_cursor) printProgress('More rows are available; use --all or --cursor with the JSON next_cursor.');
    }
    return presented;
  } finally { process.removeListener('SIGINT', interrupt); }
}

function emitCompactTable(data) {
  if (!data.length) {
    printData('No candidate rows in this view.');
    return;
  }
  const priority = new Map([
    ['i_pTM', 0], ['pLDDT', 1], ['i_pDAE', 2], ['i_pAE', 3], ['pTM', 4],
    ['Binder_RMSD', 5], ['Target_RMSD', 6], ['Hotspot_Contact_Fraction', 7],
    ['Off_Epitope_Contact_Fraction', 8], ['Interface_Residues', 9],
  ]);
  const headers = ['candidate', 'rank', 'selected', 'outcome', 'native_pass', 'eligible', 'optimization', 'key_scores', 'target_scores', 'recorded_rejection', 'sequences', 'structures'];
  const rows = data.map((candidate) => {
    const scores = candidate.metrics
      .map((metric, index) => ({ metric, index }))
      .filter(({ metric }) => metric.value !== null)
      .sort((left, right) => (priority.get(left.metric.name) ?? 1000) - (priority.get(right.metric.name) ?? 1000) || left.index - right.index)
      .slice(0, 4)
      .map(({ metric }) => `${metric.name}=${metric.value}`)
      .join(', ');
    const targetScores = candidate.target_scores.targets
      .map((target) => `${target.name ?? 'unnamed'}(weight=${target.weight ?? 'unknown'},i_pDAE=${target.i_pDAE ?? 'unknown'})`);
    if (candidate.target_scores.aligned_positive_target_mean_i_pDAE !== null) {
      targetScores.unshift(`aligned_positive_mean=${candidate.target_scores.aligned_positive_target_mean_i_pDAE}`);
    }
    const rejection = candidate.rejection.terminated_stage
      ? `terminated:${candidate.rejection.terminated_stage}`
      : (candidate.rejection.failed_filters.length ? candidate.rejection.failed_filters.join(',') : '-');
    return [
      candidate.native_id ?? candidate.id ?? '-', candidate.rank, candidate.selected, candidate.native_outcome, candidate.native_filter_pass, candidate.ranking.eligible,
      candidate.optimization.state === 'unknown' ? null : candidate.optimization.state,
      scores || null, targetScores.join(', ') || null, rejection === '-' ? null : rejection, candidate.binder_sequences.length, candidate.structures.length,
    ];
  });
  // Human tables need not repeat whole columns of unknown values. State the
  // unavailable fields once, preserving mixed known/unknown and false/zero.
  // JSON remains the stable, complete scientific record.
  const visible = headers.map((_, index) => index).filter((index) => rows.some((row) => row[index] !== null));
  const absent = headers.filter((_, index) => !visible.includes(index));
  printTable(visible.map((index) => headers[index]), rows.map((row) => visible.map((index) => row[index] ?? 'unknown')));
  if (absent.length) printData(`Not reported in these rows: ${absent.join(', ')}.`);
}

function emitStandardTable(data) {
  printTable(['native_id', 'rank', 'selected', 'pass_filters', 'ranking_eligible', 'structures'], data.map((c) => [
    c.native_id, c.rank ?? '-', c.selection?.selected ?? 'unknown',
    nativeFilterPass(c),
    c.ranking_eligible ?? 'unknown', c.structures?.length ?? 0,
  ]));
}

function emitBindCraft2Table(data) {
  printTable(['native_id', 'rank', 'selected', 'outcome', 'binder_chains', 'ranking_eligible', 'structures'], data.map((candidate) => {
    const sequences = Array.isArray(candidate?.bindcraft2?.binder_sequences)
      ? candidate.bindcraft2.binder_sequences.filter((sequence) => typeof sequence === 'string' && sequence.length)
      : [];
    const selected = candidate.selection?.selected ?? 'unknown';
    const outcome = candidate.bindcraft2?.outcome ?? candidate.outcome ?? 'unknown';
    return [candidate.native_id, candidate.rank ?? '-', selected, outcome, sequences.length || '-', candidate.ranking_eligible ?? 'unknown', candidate.structures?.length ?? 0];
  }));
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
