/**
 * `ariax summary <PROJECT> [--top N] [--include-sequences]` and
 * `ariax forge summary <PROJECT_UUID> [--top N]`.
 *
 * Composes existing authenticated read endpoints into one canonical,
 * compact scientific handoff payload without fabricating missing values.
 */
import { usageError } from '../args.js';
import { compactCampaign, compactCandidate } from '../campaign-presentation.js';
import { printData, printJson, printTable } from '../output.js';
import { resolveProjectId } from '../resolve.js';
import { isUUID } from '../uuid.js';
import { redactForgeOutput, redactForgeText } from '../lib/forge-workspace-client.js';

const FORGE_API = '/api/v1/forge';
const DEFAULT_TOP = 5;
const MAX_TOP = 25;

export const MANAGED_CAVEAT =
  'Computational acceptance supports experimental prioritization only; it does not establish binding, affinity, stability, or activity.';
export const FORGE_CAVEAT =
  'Computational outputs from Forge tools support experimental prioritization; verify native tool metrics, provenance, and experimental controls before acting on results.';

const PROTOCOL_URL_SEGMENT = Object.freeze({
  bindcraft: 'bindcraft',
  'bindcraft-v1.5': 'bindcraft',
  bindcraft2: 'bindcraft2',
  boltzgen: 'boltzgen',
  pxdesign: 'pxdesign',
  'esmfold2-pipeline': 'esmfold2-pipeline',
  esmfold2: 'esmfold2-pipeline',
});

const METRIC_PRIORITY = new Map([
  ['i_pTM', 0],
  ['ipTM', 1],
  ['iptm', 2],
  ['pLDDT', 3],
  ['plddt', 4],
  ['i_pDAE', 5],
  ['i_pAE', 6],
  ['ipSAE', 7],
  ['ipsae', 8],
  ['pTM', 9],
  ['ptm', 10],
  ['Binder_RMSD', 11],
  ['Target_RMSD', 12],
  ['Hotspot_Contact_Fraction', 13],
  ['Off_Epitope_Contact_Fraction', 14],
  ['Interface_Residues', 15],
]);

const ZERO_TO_ONE_METRICS = new Set([
  'i_ptm',
  'iptm',
  'ptm',
  'i_pdae',
  'ipsae',
  'hotspot_contact_fraction',
  'off_epitope_contact_fraction',
]);

function parseTop(raw, label) {
  if (raw === undefined) return DEFAULT_TOP;
  const str = String(raw).trim();
  const num = Number(str);
  if (!/^\d+$/.test(str) || !Number.isSafeInteger(num) || num < 1 || num > MAX_TOP) {
    throw usageError(`${label}: --top must be an integer 1..${MAX_TOP}.`);
  }
  return num;
}

function nonNegInt(...values) {
  for (const v of values) {
    if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return v;
  }
  return null;
}

function nonNegNum(...values) {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  }
  return null;
}

function firstString(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return 'unknown';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let val = bytes / 1024;
  let unit = 0;
  while (val >= 1024 && unit < units.length - 1) {
    val /= 1024;
    unit += 1;
  }
  return `${val >= 10 ? val.toFixed(1) : val.toFixed(2)} ${units[unit]}`;
}

function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return 'unknown';
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded}s`;
  const mins = Math.floor(rounded / 60);
  const rem = rounded % 60;
  if (mins < 60) return rem ? `${mins}m ${rem}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

function shown(value) {
  return value === null || value === undefined ? 'unknown' : String(value);
}

function managedProjectUrl(ctx, protocol, projectId) {
  const norm = String(protocol ?? '').trim().toLowerCase();
  const seg = PROTOCOL_URL_SEGMENT[norm] ?? (norm || 'projects');
  try {
    return new URL(`/projects/${encodeURIComponent(seg)}/${encodeURIComponent(projectId)}`, ctx.config.baseUrl).href;
  } catch {
    return null;
  }
}

function forgeProjectUrl(ctx, projectId) {
  try {
    return new URL(`/projects/forge/${encodeURIComponent(projectId)}`, ctx.config.baseUrl).href;
  } catch {
    return null;
  }
}

function inferMetricScale(name, value, unit, explicitScale) {
  if (typeof explicitScale === 'string' && explicitScale.trim()) return explicitScale.trim();
  const lower = String(name ?? '').trim().toLowerCase();
  const normUnit = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
  if (ZERO_TO_ONE_METRICS.has(lower)) return '0..1';
  if (lower === 'i_pae' || lower === 'ipae') {
    if (normUnit === 'å' || normUnit === 'a' || normUnit === 'angstrom') return null;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) return '0..1';
    return null;
  }
  if (lower === 'plddt' || lower.endsWith('_plddt')) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value > 1 && value <= 100) return '0..100';
      if (value >= 0 && value <= 1) return '0..1';
    }
    return null;
  }
  return null;
}

function extractKeyMetrics(rawCandidate, compact) {
  const rawMetricsByName = new Map();
  if (Array.isArray(rawCandidate?.metrics)) {
    for (const m of rawCandidate.metrics) {
      if (typeof m?.name === 'string' && !rawMetricsByName.has(m.name)) {
        rawMetricsByName.set(m.name, m);
      }
    }
  }
  const list = Array.isArray(compact.metrics) ? compact.metrics : [];
  return list
    .map((metric, index) => ({ metric, index }))
    .filter(({ metric }) => metric.value !== null && metric.value !== undefined)
    .sort((a, b) => (
      (METRIC_PRIORITY.get(a.metric.name) ?? 1000) - (METRIC_PRIORITY.get(b.metric.name) ?? 1000)
      || a.index - b.index
    ))
    .slice(0, 6)
    .map(({ metric }) => {
      const rawMetric = rawMetricsByName.get(metric.name);
      const unit = metric.unit ?? rawMetric?.unit ?? null;
      return {
        name: metric.name,
        value: metric.value,
        scale: inferMetricScale(metric.name, metric.value, unit, rawMetric?.scale),
        unit,
      };
    });
}

function summarizeCandidate(rawCandidate, includeSequences) {
  const compact = compactCandidate(rawCandidate);
  const sequences = Array.isArray(compact.binder_sequences)
    ? compact.binder_sequences.filter((s) => typeof s === 'string' && s.length > 0)
    : [];
  const structurePaths = Array.isArray(compact.structures)
    ? compact.structures.map((s) => s?.path).filter((p) => typeof p === 'string' && p.length > 0)
    : [];
  return {
    id: compact.id ?? null,
    native_id: compact.native_id ?? null,
    rank: typeof compact.rank === 'number' && Number.isFinite(compact.rank) ? compact.rank : null,
    selected: typeof compact.selected === 'boolean' ? compact.selected : null,
    native_filter_pass: typeof compact.native_filter_pass === 'boolean' ? compact.native_filter_pass : null,
    ranking_eligible: typeof compact.ranking?.eligible === 'boolean' ? compact.ranking.eligible : null,
    key_metrics: extractKeyMetrics(rawCandidate, compact),
    structure_paths: structurePaths,
    sequence_lengths: sequences.map((seq) => seq.length),
    ...(includeSequences ? { sequences } : {}),
  };
}

function collectManagedGpus(project, compact) {
  const seen = new Set();
  const add = (val) => {
    if (typeof val === 'string' && val.trim()) seen.add(val.trim());
  };
  if (Array.isArray(project.gpus)) for (const g of project.gpus) add(g);
  add(project.gpu_type);
  if (Array.isArray(project.jobs)) {
    for (const job of project.jobs) {
      add(job?.gpu_type);
      add(job?.gpu);
    }
  }
  if (!seen.size && Array.isArray(compact.compute?.allowed_gpus)) {
    for (const g of compact.compute.allowed_gpus) add(g);
  }
  return [...seen];
}

function addUniqueWarning(warnings, seen, code, message) {
  const cleanCode = String(code || 'warning').trim();
  const cleanMsg = redactForgeText(String(message || cleanCode).trim());
  const key = `${cleanCode}:${cleanMsg}`;
  if (seen.has(key)) return;
  seen.add(key);
  warnings.push({ code: cleanCode, message: cleanMsg });
}

function addUniqueAction(actions, seen, command, reason) {
  const cleanCmd = redactForgeText(String(command || '').trim());
  if (!cleanCmd || seen.has(cleanCmd)) return;
  seen.add(cleanCmd);
  actions.push({ command: cleanCmd, reason: redactForgeText(String(reason || '').trim()) });
}

async function bestEffortGet(client, routePath, query) {
  try {
    const res = await client.get(routePath, { ...(query ? { query } : {}), attempts: 1 });
    return { ok: true, data: res.data, meta: res.meta, status: res.status };
  } catch (error) {
    return { ok: false, error };
  }
}

export async function buildManagedSummary(ctx, projectId, project, { top = DEFAULT_TOP, includeSequences = false } = {}) {
  const compact = compactCampaign(project, projectId);
  const status = compact.lifecycle?.state ?? String(project.status ?? project.state ?? 'unknown').toLowerCase();
  const protocol = compact.protocol ?? project.protocol ?? project.protocol_id ?? null;
  const projectUrlValue = firstString(project.project_url) ?? managedProjectUrl(ctx, protocol, projectId);

  const [candidatesRes, storageRes, cleanupRes] = await Promise.all([
    bestEffortGet(ctx.client, `/api/v1/projects/${encodeURIComponent(projectId)}/candidates`, { view: 'final', limit: top }),
    bestEffortGet(ctx.client, `/api/v1/projects/${encodeURIComponent(projectId)}/storage`),
    status === 'completed'
      ? bestEffortGet(ctx.client, `/api/v1/projects/${encodeURIComponent(projectId)}/storage/cleanup-suggestions`)
      : Promise.resolve({ ok: false, skipped: true }),
  ]);

  const isBc2 = Boolean(compact.records && compact.budget);
  const funnel = isBc2
    ? {
      planned: nonNegInt(compact.designs?.requested),
      attempted: nonNegInt(compact.budget?.attempts_used),
      evaluated: nonNegInt(compact.records?.refolded, compact.rejections?.candidates_scored),
      passed_filters: nonNegInt(project.passed_filters, project.passed_designs, compact.designs?.accepted),
      accepted: nonNegInt(compact.designs?.accepted),
      count_source: firstString(project.design_count_source) ?? (project.bindcraft2_progress ? 'bindcraft2_progress' : 'project_record'),
      stop_reason: firstString(compact.stop?.code, project.stop_reason),
    }
    : {
      planned: nonNegInt(compact.designs?.requested),
      attempted: nonNegInt(project.attempted_designs, project.total_designs, compact.designs?.tested),
      evaluated: nonNegInt(project.evaluated_designs, compact.designs?.tested),
      passed_filters: nonNegInt(project.passed_filters, project.passed_designs, compact.designs?.accepted),
      accepted: nonNegInt(compact.designs?.accepted),
      count_source: firstString(compact.designs?.source, project.design_count_source) ?? 'project_record',
      stop_reason: firstString(project.stop_reason),
    };

  const storageUsage = storageRes.ok ? (storageRes.data?.usage ?? null) : null;
  const jobsList = Array.isArray(project.jobs) ? project.jobs : [];
  const resources = {
    gpus: collectManagedGpus(project, compact),
    job_count: nonNegInt(project.job_count, compact.jobs?.count, jobsList.length > 0 ? jobsList.length : null),
    total_runtime_seconds: nonNegNum(project.total_runtime_seconds, project.elapsed_seconds, compact.compute?.elapsed_seconds),
    total_cost_usd: nonNegNum(project.total_cost_usd, compact.cost?.recorded_spend_usd),
    storage_bytes: nonNegInt(storageUsage?.bytes),
    storage_files: nonNegInt(storageUsage?.object_count, storageUsage?.file_count),
  };

  let topCandidates = [];
  let candidateMetaState = null;
  let candidatesFailed = false;
  if (candidatesRes.ok && Array.isArray(candidatesRes.data)) {
    candidateMetaState = typeof candidatesRes.meta?.state === 'string' ? candidatesRes.meta.state : null;
    topCandidates = candidatesRes.data.slice(0, top).map((row) => summarizeCandidate(row, includeSequences));
  } else if (!candidatesRes.ok) {
    candidatesFailed = true;
  }

  const warnings = [];
  const seenWarnings = new Set();
  const nextActions = [];
  const seenActions = new Set();

  if (status === 'completed' && funnel.accepted === 0) {
    addUniqueWarning(
      warnings,
      seenWarnings,
      'zero_accepted_pilot',
      'Completed with 0 accepted designs. Inspect diagnostic/all candidates before deciding whether to adjust inputs or stop.',
    );
  }
  if (
    compact.publication?.error
    || funnel.stop_reason === 'incomplete_outputs'
    || (typeof funnel.stop_reason === 'string' && funnel.stop_reason.includes('sync_failed'))
    || candidateMetaState === 'incomplete'
  ) {
    addUniqueWarning(
      warnings,
      seenWarnings,
      'incomplete_outputs',
      'Output publication reported incomplete or failed sync; inspect saved artifacts and job logs.',
    );
  }
  if (candidatesFailed && ['completed', 'failed', 'aborted', 'cancelled'].includes(status)) {
    addUniqueWarning(
      warnings,
      seenWarnings,
      'candidate_evidence_unavailable',
      'Candidate summary table could not be retrieved; inspect results or logs directly.',
    );
  } else if (candidateMetaState === 'missing' && status === 'completed' && (funnel.accepted ?? 0) > 0) {
    addUniqueWarning(
      warnings,
      seenWarnings,
      'candidate_evidence_unavailable',
      'Final candidate table was not published despite accepted design count; inspect all views and artifacts.',
    );
  }
  if (project.control?.human_resume_required === true) {
    addUniqueWarning(
      warnings,
      seenWarnings,
      'human_resume_required',
      `Project requires human approval at ${projectUrlValue ?? 'the project page'} before resuming.`,
    );
  }
  const cleanupItems = cleanupRes.ok && Array.isArray(cleanupRes.data?.items) ? cleanupRes.data.items : [];
  if (cleanupItems.length > 0) {
    addUniqueWarning(
      warnings,
      seenWarnings,
      'smart_cleanup_available',
      `${cleanupItems.length} storage cleanup suggestion(s) available for completed project outputs.`,
    );
  }
  for (const w of compact.warnings ?? []) {
    if (typeof w === 'string' && w.trim()) {
      addUniqueWarning(warnings, seenWarnings, 'campaign_warning', w.trim());
    }
  }

  if (!['completed', 'failed', 'aborted', 'cancelled', 'paused'].includes(status)) {
    addUniqueAction(nextActions, seenActions, `ariax status ${projectId} --wait`, 'Wait for the project to reach a terminal state.');
  } else if (status === 'paused') {
    addUniqueAction(nextActions, seenActions, `ariax status ${projectId} --json`, 'Inspect paused project status before deciding whether to resume.');
  } else if (funnel.accepted !== null && funnel.accepted > 0) {
    addUniqueAction(nextActions, seenActions, `ariax candidates ${projectId} --view final --json`, 'Inspect full accepted candidate metrics and rankings.');
    addUniqueAction(nextActions, seenActions, `ariax results ${projectId} --download ./results`, 'Download selected structures and output tables.');
  } else if (status === 'completed' && funnel.accepted === 0) {
    addUniqueAction(nextActions, seenActions, `ariax candidates ${projectId} --view all --json`, 'Review rejected/refolded candidates and native filter failure reasons.');
    addUniqueAction(nextActions, seenActions, `ariax candidates ${projectId} --view diagnostics --json`, 'Inspect trajectory diagnostics if no refolded candidates exist.');
  } else {
    addUniqueAction(nextActions, seenActions, `ariax results ${projectId}`, 'Inspect any saved artifacts from the stopped execution.');
    addUniqueAction(nextActions, seenActions, `ariax jobs --project ${projectId}`, 'Find job IDs to inspect native execution logs.');
  }
  if (cleanupItems.length > 0) {
    addUniqueAction(nextActions, seenActions, `ariax storage suggest ${projectId} --json`, 'Review suggested cleanup targets for completed project storage.');
  }

  return {
    kind: 'managed',
    project: {
      id: projectId,
      name: firstString(project.name),
      protocol,
      status,
      project_url: projectUrlValue,
    },
    funnel,
    resources,
    top_candidates: topCandidates,
    warnings,
    next_actions: nextActions,
    caveat: MANAGED_CAVEAT,
  };
}

function extractForgeSyncWarnings(filesStatus) {
  const sync = filesStatus?.runtime_observation?.synchronization ?? filesStatus?.synchronization ?? null;
  if (!sync || !Array.isArray(sync.warnings)) return [];
  const out = [];
  for (const w of sync.warnings) {
    if (!w || typeof w !== 'object' || typeof w.code !== 'string' || !w.code.trim()) continue;
    out.push(redactForgeOutput({
      code: w.code.trim(),
      message: typeof w.message === 'string' && w.message.trim() ? w.message.trim() : w.code.trim(),
      ...(typeof w.action === 'string' && w.action.trim() ? { action: w.action.trim() } : {}),
    }));
  }
  return out;
}

function collectForgeTools(sessionsList) {
  const scientific = new Set();
  let sawBase = false;
  for (const session of sessionsList) {
    const tools = Array.isArray(session?.tools) ? session.tools : [];
    for (const item of tools) {
      const name = typeof item === 'string' ? item.trim() : (typeof item?.tool === 'string' ? item.tool.trim() : '');
      if (!name) continue;
      if (name === 'base') sawBase = true;
      else scientific.add(name);
    }
  }
  if (scientific.size > 0) return [...scientific];
  return sawBase ? ['base'] : [];
}

function sumKnownNumbers(values) {
  let found = false;
  let total = 0;
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      total += v;
      found = true;
    }
  }
  return found ? total : null;
}

export async function buildForgeSummary(ctx, projectId, { top = DEFAULT_TOP, fallbackProject = null } = {}) {
  const projRes = await ctx.client.get(`${FORGE_API}/projects/${encodeURIComponent(projectId)}`, {
    query: { view: 'summary' },
  });
  const proj = projRes.data ?? {};

  const [filesStatusRes, filesListRes, storageRes, cleanupRes] = await Promise.all([
    bestEffortGet(ctx.client, `${FORGE_API}/projects/${encodeURIComponent(projectId)}/files/status`),
    bestEffortGet(ctx.client, `${FORGE_API}/projects/${encodeURIComponent(projectId)}/files`, { path: '/workspace' }),
    bestEffortGet(ctx.client, `/api/v1/projects/${encodeURIComponent(projectId)}/storage`),
    bestEffortGet(ctx.client, `/api/v1/projects/${encodeURIComponent(projectId)}/storage/cleanup-suggestions`),
  ]);

  const filesStatus = filesStatusRes.ok ? (filesStatusRes.data ?? null) : null;
  const filesList = filesListRes.ok ? (filesListRes.data ?? null) : null;
  const storageUsage = storageRes.ok ? (storageRes.data?.usage ?? null) : null;
  const rawCleanupItems = cleanupRes.ok && Array.isArray(cleanupRes.data?.items) ? cleanupRes.data.items : [];

  const sessionsList = Array.isArray(proj.sessions) ? proj.sessions : [];
  const activeSessionId = firstString(proj.active_session_id) ?? null;
  const latestSessionId = firstString(proj.latest_session_id, sessionsList[0]?.session_id) ?? null;
  const activeSession = activeSessionId
    ? sessionsList.find((s) => s?.session_id === activeSessionId) ?? null
    : null;
  const activeSessionState = activeSessionId
    ? firstString(activeSession?.state, filesStatus?.session_state)
    : null;

  const gpusUsed = [...new Set(
    sessionsList.map((s) => (typeof s?.gpu_type === 'string' && s.gpu_type.trim() ? s.gpu_type.trim() : null)).filter(Boolean),
  )];
  const toolsUsed = collectForgeTools(sessionsList);
  const totalRuntimeSeconds = nonNegNum(
    proj.total_runtime_seconds,
    fallbackProject?.total_runtime_seconds,
    sumKnownNumbers(sessionsList.map((s) => nonNegNum(s?.runtime_seconds, s?.elapsed_seconds))),
  );
  const totalCostUsd = nonNegNum(
    proj.total_cost_usd,
    fallbackProject?.total_cost_usd,
    sumKnownNumbers(sessionsList.map((s) => nonNegNum(s?.total_cost_usd, s?.cost_usd, s?.recorded_spend_usd))),
  );

  const rawEntries = Array.isArray(filesList?.entries) ? filesList.entries : [];
  const topEntries = rawEntries.slice(0, top).map((entry) => redactForgeOutput({
    path: entry?.path ?? null,
    kind: entry?.kind ?? null,
    size_bytes: nonNegInt(entry?.size_bytes),
  }));

  const exactListBytes = filesList && !filesList.next_cursor && rawEntries.length > 0
    && rawEntries.every((e) => e?.kind === 'file' && typeof e?.size_bytes === 'number' && Number.isSafeInteger(e.size_bytes) && e.size_bytes >= 0)
    ? rawEntries.reduce((sum, e) => sum + e.size_bytes, 0)
    : null;

  const syncState = firstString(filesStatus?.sync_state, filesList?.sync_state);
  const durabilityGap = typeof filesStatus?.durability_gap === 'boolean'
    ? filesStatus.durability_gap
    : (typeof filesList?.durability_gap === 'boolean' ? filesList.durability_gap : false);
  const lastSyncedAt = firstString(filesStatus?.last_synced_at, filesList?.last_synced_at);
  const hygieneWarnings = extractForgeSyncWarnings(filesStatus);

  const cleanupSuggestions = rawCleanupItems.slice(0, top).map((item) => redactForgeOutput({
    path: item?.path ?? null,
    kind: item?.kind ?? null,
    ...(item?.file_count !== undefined ? { file_count: nonNegInt(item.file_count) } : {}),
    ...(item?.bytes !== undefined ? { bytes: nonNegInt(item.bytes) } : {}),
    ...(typeof item?.suggestion === 'string' ? { suggestion: item.suggestion } : {}),
    ...(typeof item?.reason === 'string' ? { reason: item.reason } : {}),
  }));

  const projectUrlValue = firstString(proj.project_url, fallbackProject?.project_url) ?? forgeProjectUrl(ctx, projectId);
  const controlRevision = nonNegInt(proj.control?.revision, filesStatus?.control_revision);
  const humanResumeRequired = proj.control?.human_resume_required === true;

  const warnings = [];
  const seenWarnings = new Set();
  const nextActions = [];
  const seenActions = new Set();

  const sessionPlaceholder = activeSessionId ?? 'SESSION';

  if (activeSessionId && !['closed', 'failed'].includes(String(activeSessionState ?? '').toLowerCase())) {
    addUniqueWarning(
      warnings,
      seenWarnings,
      'active_session_running',
      `Active Forge session ${activeSessionId} (${activeSessionState ?? 'running'}) is still consuming compute.`,
    );
    addUniqueAction(
      nextActions,
      seenActions,
      `ariax forge finish ${activeSessionId} --wait --json`,
      'Drain active commands, flush workspace files, and release the GPU cleanly.',
    );
  }

  if (durabilityGap || syncState === 'failed' || syncState === 'pending') {
    addUniqueWarning(
      warnings,
      seenWarnings,
      'durability_gap',
      `Workspace sync state is ${syncState ?? 'unknown'} (durability_gap=${durabilityGap}); saved files may lag the active host.`,
    );
    if (activeSessionId) {
      addUniqueAction(
        nextActions,
        seenActions,
        `ariax forge sync ${activeSessionId} --wait --wait-timeout 1800 --json`,
        'Flush pending workspace files to durable project storage.',
      );
    }
  }

  const packHygieneCodes = new Set([
    'high_file_count',
    'high_pending_files',
    'low_disk_space',
    'file_near_20gib_limit',
    'scratch_data_not_saved',
  ]);
  let needsPackAction = false;
  for (const hw of hygieneWarnings) {
    addUniqueWarning(warnings, seenWarnings, hw.code, hw.message);
    if (packHygieneCodes.has(hw.code)) needsPackAction = true;
  }

  if (humanResumeRequired) {
    addUniqueWarning(
      warnings,
      seenWarnings,
      'human_resume_required',
      `Project is held; human approval at ${projectUrlValue ?? 'the project page'} is required before resuming.`,
    );
    addUniqueAction(
      nextActions,
      seenActions,
      `ariax forge project ${projectId} --json`,
      `Ask the user to review ${projectUrlValue ?? 'the project page'} before resuming compute.`,
    );
  }

  if (cleanupSuggestions.length > 0) {
    addUniqueWarning(
      warnings,
      seenWarnings,
      'cleanup_suggestions_available',
      `${cleanupSuggestions.length} Forge workspace cleanup suggestion(s) available.`,
    );
    const packCandidate = cleanupSuggestions.find((item) => (
      typeof item?.suggestion === 'string' && /pack/i.test(item.suggestion)
    )) ?? cleanupSuggestions[0];
    const rawPackPath = typeof packCandidate?.path === 'string' ? packCandidate.path.trim() : '';
    const normalizedPackPath = rawPackPath.startsWith('/workspace/')
      ? rawPackPath.replace(/\/+$/, '')
      : (rawPackPath.startsWith('workspace/') ? `/${rawPackPath.replace(/\/+$/, '')}` : null);
    if (normalizedPackPath && normalizedPackPath.length > '/workspace/'.length) {
      const archiveName = normalizedPackPath.split('/').filter(Boolean).pop() || 'archive';
      addUniqueAction(
        nextActions,
        seenActions,
        `ariax forge pack ${sessionPlaceholder} --src ${normalizedPackPath} --dest /workspace/archives/${archiveName}.tar.zst --wait --json`,
        `Archive high-file-count or large directory ${normalizedPackPath} before syncing or cleanup.`,
      );
      needsPackAction = false;
    }
    addUniqueAction(
      nextActions,
      seenActions,
      `ariax storage suggest ${projectId} --json`,
      'Inspect all Forge storage cleanup recommendations.',
    );
  }

  if (needsPackAction) {
    addUniqueAction(
      nextActions,
      seenActions,
      `ariax forge pack ${sessionPlaceholder} --src /scratch/<run> --dest /workspace/archives/<name>.tar.zst --wait --json`,
      'Pack bulk outputs into a compressed, sharded archive before finishing.',
    );
  }

  addUniqueAction(
    nextActions,
    seenActions,
    `ariax forge files ${projectId} --path /workspace --json`,
    'Browse saved workspace files or generate download links.',
  );

  return {
    kind: 'forge',
    project: {
      id: projectId,
      name: firstString(proj.name, fallbackProject?.name),
      protocol: 'forge',
      status: firstString(proj.status, fallbackProject?.status) ?? 'unknown',
      project_url: projectUrlValue,
      active_session_id: activeSessionId,
      latest_session_id: latestSessionId,
      control_revision: controlRevision,
      human_resume_required: humanResumeRequired,
    },
    sessions: {
      total_sessions: nonNegInt(proj.total_sessions, proj.session_count, sessionsList.length),
      active_session_state: activeSessionState,
      gpus_used: gpusUsed,
      tools_used: toolsUsed,
      total_runtime_seconds: totalRuntimeSeconds,
      total_cost_usd: totalCostUsd,
    },
    workspace: {
      sync_state: syncState,
      durability_gap: durabilityGap,
      last_synced_at: lastSyncedAt,
      file_count: nonNegInt(storageUsage?.object_count, storageUsage?.file_count, filesList ? rawEntries.length : null),
      total_bytes: nonNegInt(storageUsage?.bytes, exactListBytes),
      top_entries: topEntries,
      hygiene_warnings: hygieneWarnings,
    },
    cleanup_suggestions: cleanupSuggestions,
    warnings,
    next_actions: nextActions,
    caveat: FORGE_CAVEAT,
  };
}

function renderManagedHuman(summary) {
  const p = summary.project;
  const f = summary.funnel;
  const r = summary.resources;

  printData(`## 1. Status & link`);
  printData(`${p.name ?? p.id} (${p.id}) · protocol: ${shown(p.protocol)} · status: ${shown(p.status)}`);
  if (p.project_url) printData(`Link: ${p.project_url}`);

  printData('');
  printData(`## 2. Funnel & top candidates`);
  const funnelParts = [
    `planned=${shown(f.planned)}`,
    `attempted=${shown(f.attempted)}`,
    `evaluated=${shown(f.evaluated)}`,
    `passed_filters=${shown(f.passed_filters)}`,
    `accepted=${shown(f.accepted)}`,
    `source=${shown(f.count_source)}`,
  ];
  if (f.stop_reason) funnelParts.push(`stop_reason=${f.stop_reason}`);
  printData(`Funnel: ${funnelParts.join(' · ')}`);
  if (summary.top_candidates.length > 0) {
    printTable(
      ['rank', 'candidate', 'selected', 'pass', 'eligible', 'key_metrics', 'len'],
      summary.top_candidates.map((c) => [
        shown(c.rank),
        c.native_id ?? c.id ?? '-',
        shown(c.selected),
        shown(c.native_filter_pass),
        shown(c.ranking_eligible),
        c.key_metrics.slice(0, 4).map((m) => `${m.name}=${m.value}${m.scale ? ` (${m.scale})` : (m.unit ? ` ${m.unit}` : '')}`).join(', ') || '-',
        c.sequence_lengths.length ? c.sequence_lengths.join('/') : '-',
      ]),
    );
  } else {
    printData('Top candidates: none available in final view.');
  }

  printData('');
  printData(`## 3. Resources & storage`);
  const resParts = [
    `GPUs=${r.gpus.length ? r.gpus.join(',') : 'unknown'}`,
    `jobs=${shown(r.job_count)}`,
    `runtime=${formatDuration(r.total_runtime_seconds)}`,
    `cost=${r.total_cost_usd === null ? 'unknown' : `$${r.total_cost_usd}`}`,
    `storage=${formatBytes(r.storage_bytes)}${r.storage_files === null ? '' : ` (${r.storage_files} files)`}`,
  ];
  printData(resParts.join(' · '));

  printData('');
  printData(`## 4. Warnings & next actions`);
  if (summary.warnings.length > 0) {
    for (const w of summary.warnings) printData(`- Warning [${w.code}]: ${w.message}`);
  } else {
    printData('- Warnings: none.');
  }
  for (const a of summary.next_actions) {
    printData(`- Next: ${a.command}${a.reason ? ` — ${a.reason}` : ''}`);
  }

  printData('');
  printData(`## 5. Caveat`);
  printData(summary.caveat);
}

function renderForgeHuman(summary) {
  const p = summary.project;
  const s = summary.sessions;
  const w = summary.workspace;

  printData(`## 1. Status & link`);
  printData(`${p.name ?? p.id} (${p.id}) · protocol: forge · status: ${shown(p.status)} · control_revision: ${shown(p.control_revision)}`);
  if (p.project_url) printData(`Link: ${p.project_url}`);
  printData(`Sessions: active=${p.active_session_id ?? 'none'}${s.active_session_state ? ` (${s.active_session_state})` : ''} · latest=${p.latest_session_id ?? 'none'} · human_resume_required=${p.human_resume_required}`);

  printData('');
  printData(`## 2. Workspace & top entries`);
  printData(`Sync: state=${shown(w.sync_state)} · durability_gap=${w.durability_gap} · last_synced_at=${shown(w.last_synced_at)} · files=${shown(w.file_count)} · bytes=${formatBytes(w.total_bytes)}`);
  if (w.top_entries.length > 0) {
    printTable(
      ['path', 'kind', 'size'],
      w.top_entries.map((entry) => [
        entry.path ?? '-',
        entry.kind ?? '-',
        entry.size_bytes === null ? '-' : formatBytes(entry.size_bytes),
      ]),
    );
  } else {
    printData('Workspace entries: none listed under /workspace.');
  }

  printData('');
  printData(`## 3. Resources & storage`);
  const resParts = [
    `sessions=${shown(s.total_sessions)}`,
    `GPUs=${s.gpus_used.length ? s.gpus_used.join(',') : 'unknown'}`,
    `tools=${s.tools_used.length ? s.tools_used.join(',') : 'unknown'}`,
    `runtime=${formatDuration(s.total_runtime_seconds)}`,
    `cost=${s.total_cost_usd === null ? 'unknown' : `$${s.total_cost_usd}`}`,
    `storage=${formatBytes(w.total_bytes)}${w.file_count === null ? '' : ` (${w.file_count} files)`}`,
  ];
  printData(resParts.join(' · '));

  printData('');
  printData(`## 4. Warnings & next actions`);
  if (summary.warnings.length > 0) {
    for (const warn of summary.warnings) printData(`- Warning [${warn.code}]: ${warn.message}`);
  } else {
    printData('- Warnings: none.');
  }
  for (const a of summary.next_actions) {
    printData(`- Next: ${a.command}${a.reason ? ` — ${a.reason}` : ''}`);
  }

  printData('');
  printData(`## 5. Caveat`);
  printData(summary.caveat);
}

/** Run `ariax forge summary <PROJECT_UUID> [--top N]`. */
export async function runForgeSummary(ctx, projectId) {
  if (!isUUID(projectId)) throw usageError('forge summary: project ID must be a UUID.');
  const normalizedId = projectId.trim().toLowerCase();
  const top = parseTop(ctx.flags?.top, 'forge summary');
  const summary = await buildForgeSummary(ctx, normalizedId, { top });
  if (ctx.json) printJson({ data: summary });
  else renderForgeHuman(summary);
  return summary;
}

/** Run `ariax summary <PROJECT> [--top N] [--include-sequences]`. */
export async function run(ctx) {
  if (ctx.positionals.length !== 1) {
    throw usageError('summary: expected one project UUID or exact unique project name.');
  }
  const top = parseTop(ctx.flags?.top, 'summary');
  const includeSequences = ctx.flags?.['include-sequences'] === true;
  const projectId = await resolveProjectId(ctx.client, String(ctx.positionals[0]));

  const res = await ctx.client.get(`/api/v1/projects/${encodeURIComponent(projectId)}`);
  const project = res.data?.project ?? res.data ?? {};
  const protocol = String(project.protocol ?? project.protocol_id ?? '').trim().toLowerCase();

  let summary;
  if (protocol === 'forge') {
    summary = await buildForgeSummary(ctx, projectId, { top, fallbackProject: project });
  } else {
    summary = await buildManagedSummary(ctx, projectId, project, { top, includeSequences });
  }

  if (ctx.json) printJson({ data: summary });
  else if (summary.kind === 'forge') renderForgeHuman(summary);
  else renderManagedHuman(summary);
  return summary;
}
