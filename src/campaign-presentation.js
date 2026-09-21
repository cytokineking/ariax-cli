/** Stable compact views for campaign and candidate commands. */

const TERMINAL = new Set(['completed', 'failed', 'aborted', 'cancelled']);

const PHASE_LABELS = Object.freeze({
  planning: 'Preparing campaign',
  provisioning: 'Starting compute',
  designing: 'Designing',
  finalizing: 'Saving results',
  completed: 'Completed',
  paused: 'Paused',
  failed: 'Failed',
  aborted: 'Aborted',
});

const LIFECYCLE_LABELS = Object.freeze({
  pending: 'Pending',
  queued: 'Queued',
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  aborted: 'Aborted',
  cancelled: 'Cancelled',
});

const STOP_LABELS = Object.freeze({
  target_reached: 'The requested number of accepted designs was reached.',
  attempt_limit_reached: 'The attempt limit was reached before the requested number of designs was accepted.',
  unexpected_early_exit: 'Execution stopped unexpectedly; inspect the logs and saved results.',
  incomplete_outputs: 'Execution stopped before all result publication completed.',
  execution_failed: 'Execution failed; inspect the logs and any saved results.',
  user_pause: 'The campaign was paused.',
  user_abort: 'The campaign was stopped by the user.',
  credit_stop: 'The campaign stopped because additional credits are required.',
  sync_failed: 'Some final results could not be published.',
  output_sync_failed: 'The latest results could not be published.',
  final_sync_failed: 'Some final results could not be published.',
  infrastructure_failure: 'Compute became unavailable before execution completed.',
  preference_mismatch: 'The current compute preferences cannot be satisfied.',
  qualified_capacity_unavailable: 'Suitable compute capacity is currently unavailable.',
  runtime_unavailable: 'The requested runtime is currently unavailable.',
  invalid_configuration: 'The campaign configuration is invalid for the native engine.',
});

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function amount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function firstKnown(...values) {
  for (const value of values) if (value !== undefined && value !== null) return value;
  return null;
}

function compactTargets(config) {
  if (!Array.isArray(config.targets)) return [];
  return config.targets.map((target) => ({
    name: typeof target?.name === 'string' ? target.name : null,
    objective: typeof target?.objective === 'string' ? target.objective : null,
    chains: Array.isArray(target?.chains) ? target.chains.filter((chain) => typeof chain === 'string') : [],
  }));
}

export function compactScientificSettings(value) {
  const source = object(value);
  const config = object(source.protocol_config);
  const campaign = object(config.campaign);
  const modality = Array.isArray(config.modality) && typeof config.modality[0] === 'string'
    ? config.modality[0]
    : null;
  return {
    protocol: firstKnown(source.protocol, source.protocol_id),
    binder_format: firstKnown(source.project_type, modality),
    targets: compactTargets(config),
    requested_designs: count(firstKnown(campaign.num_designs, source.num_designs)),
    attempt_limit: count(firstKnown(campaign.max_trajectories, source.max_trajectories)),
    compute: {
      priority_mode: firstKnown(source.priority_mode, config.priority_mode),
      turbo_mode: firstKnown(source.turbo_mode, config.turbo_mode),
      allowed_gpus: Array.isArray(source.allowed_gpus) ? source.allowed_gpus : null,
    },
  };
}

export function usesCompactCampaignPresentation(value) {
  const source = object(value?.project ?? value);
  return String(firstKnown(source.protocol, source.protocol_id, '')).toLowerCase() === 'bindcraft2';
}

/** Compact candidate semantics are currently defined only for BindCraft2. */
export function usesCompactCandidatePresentation(data, meta = {}) {
  if (String(meta?.engine ?? '').toLowerCase() === 'bindcraft2') return true;
  return Array.isArray(data) && data.length > 0
    && data.every((candidate) => String(candidate?.engine ?? '').toLowerCase() === 'bindcraft2');
}

function scientificOutcome(lifecycle, accepted, requested) {
  if (accepted !== null && accepted > 0) {
    return {
      code: 'accepted_designs_available',
      summary: `${accepted}${requested === null ? '' : ` of ${requested} requested`} accepted design${accepted === 1 ? '' : 's'} available.`,
    };
  }
  if (lifecycle === 'completed' && accepted === 0) {
    return {
      code: 'completed_no_accepted_designs',
      summary: 'Execution completed with no accepted designs. This does not establish that the target is undesignable or that more compute will help.',
    };
  }
  if (lifecycle === 'failed') {
    return { code: 'execution_failed', summary: 'Execution failed before a scientific outcome was established.' };
  }
  if (lifecycle === 'aborted' || lifecycle === 'cancelled') {
    return { code: 'execution_stopped', summary: 'Execution stopped before a scientific outcome was established.' };
  }
  if (lifecycle === 'paused') {
    return { code: 'paused', summary: 'Execution is paused; accepted-design outcome may be incomplete.' };
  }
  if (!TERMINAL.has(lifecycle)) {
    return { code: 'in_progress', summary: 'Execution is still in progress; accepted-design outcome is not final.' };
  }
  return { code: 'unknown', summary: 'Scientific outcome is unavailable.' };
}

function recordState(value) {
  return value === null ? 'unknown' : (value > 0 ? 'available' : 'none');
}

function nextAction(projectId, lifecycle, counts, accepted, syncError) {
  if (syncError) return {
    code: 'inspect_results_and_logs',
    command: `ariax results ${projectId}`,
    reason: 'Result publication reported an error; inspect available files and logs.',
  };
  if (!TERMINAL.has(lifecycle) && lifecycle !== 'paused') return {
    code: 'wait', command: `ariax status ${projectId} --wait`, reason: 'Wait for a terminal lifecycle state.',
  };
  if (lifecycle === 'failed' || lifecycle === 'aborted' || lifecycle === 'cancelled') return {
    code: 'inspect_results_and_logs', command: `ariax results ${projectId}`, reason: 'Inspect saved results and logs from the stopped execution.',
  };
  if (accepted !== null && accepted > 0) return {
    code: 'review_final_candidates', command: `ariax candidates ${projectId} --view final`, reason: 'Review the accepted ranked designs.',
  };
  if (counts.refolded !== null && counts.refolded > 0) return {
    code: 'review_refolded_candidates', command: `ariax candidates ${projectId} --view all`, reason: 'Review recorded refolded candidates and native rejection reasons.',
  };
  if (counts.trajectories !== null && counts.trajectories > 0) return {
    code: 'review_trajectory_records', command: `ariax candidates ${projectId} --view diagnostics`, reason: 'Review the saved trajectory records and native termination stages.',
  };
  return {
    code: 'find_job_logs', command: `ariax jobs --project ${projectId}`, reason: 'No candidate records are known; find the relevant job, then inspect its logs.',
  };
}

function rejectionSummary(progress) {
  const rejections = object(progress.rejections);
  const candidatesScored = count(rejections.candidates_scored);
  const candidatesRejected = count(rejections.candidates_rejected);
  const terminated = Object.entries(object(rejections.terminated))
    .filter(([stage, value]) => stage !== 'completed' && count(value) !== null && value > 0)
    .map(([stage, value]) => ({ stage, count: value }));
  const failedFilters = candidatesScored === 0 ? [] : Object.entries(object(rejections.failed_filters))
    .filter(([, value]) => count(value) !== null && value > 0)
    .map(([filter, value]) => ({ filter, count: value }));
  let finalFilterState = 'unknown';
  if (candidatesScored === 0) finalFilterState = 'not_evaluated';
  else if (candidatesScored !== null) finalFilterState = 'evaluated';
  return {
    candidates_scored: candidatesScored,
    candidates_rejected: candidatesRejected,
    native_stage_terminations: terminated,
    final_filter_state: finalFilterState,
    final_filter_failures: failedFilters,
  };
}

export function compactCampaign(project, fallbackId = null) {
  const source = object(project?.project ?? project);
  const progress = object(source.bindcraft2_progress);
  const rawCounts = object(progress.counts);
  const settings = compactScientificSettings(source);
  const lifecycle = String(firstKnown(source.status, source.state, 'unknown')).toLowerCase();
  const projectId = String(firstKnown(source.id, source.project_id, fallbackId, 'unknown'));
  const counts = {
    attempted: count(rawCounts.attempted),
    trajectories: count(rawCounts.trajectories),
    refolded: count(rawCounts.refolded),
    ranked: count(rawCounts.ranked),
  };
  const accepted = count(firstKnown(rawCounts.accepted, source.accepted_designs));
  const requested = count(firstKnown(progress.requested, settings.requested_designs));
  const attemptLimit = count(settings.attempt_limit);
  const warnings = [];
  if (counts.attempted !== null && counts.trajectories !== null && counts.attempted > counts.trajectories) {
    const missing = counts.attempted - counts.trajectories;
    warnings.push(`${counts.attempted} attempts; ${counts.trajectories} saved trajectory records. ${missing} attempt${missing === 1 ? '' : 's'} ${missing === 1 ? 'has' : 'have'} no published trajectory record; reason unavailable.`);
  }
  const syncError = typeof progress.sync_error === 'string' && progress.sync_error ? progress.sync_error : null;
  if (syncError) warnings.push(STOP_LABELS[syncError] ?? `Result publication reported: ${syncError}.`);
  const stopCode = typeof progress.stop_reason === 'string' && progress.stop_reason ? progress.stop_reason : null;
  const schedulingCode = typeof progress.scheduling_reason === 'string' && progress.scheduling_reason
    ? progress.scheduling_reason
    : null;
  const rejections = rejectionSummary(progress);
  return {
    schema_version: 1,
    kind: 'ariax_campaign_status',
    project_id: projectId,
    name: typeof source.name === 'string' ? source.name : null,
    protocol: settings.protocol,
    binder_format: settings.binder_format,
    targets: settings.targets,
    lifecycle: {
      state: lifecycle,
      terminal: TERMINAL.has(lifecycle),
      phase: typeof progress.stage === 'string' ? progress.stage : null,
      phase_label: PHASE_LABELS[progress.stage] ?? (progress.stage ?? null),
    },
    budget: { attempts_used: counts.attempted, attempt_limit: attemptLimit },
    designs: { accepted, requested },
    records: {
      trajectories: counts.trajectories,
      refolded: counts.refolded,
      ranked: counts.ranked,
    },
    stop: {
      code: stopCode,
      summary: stopCode ? (STOP_LABELS[stopCode] ?? `Campaign reported ${stopCode}.`) : null,
    },
    scheduling: {
      code: schedulingCode,
      summary: schedulingCode ? (STOP_LABELS[schedulingCode] ?? `Campaign scheduling reported ${schedulingCode}.`) : null,
    },
    publication: {
      error: syncError,
    },
    scientific_outcome: scientificOutcome(lifecycle, accepted, requested),
    rejections,
    results: {
      final_candidates: recordState(accepted),
      refolded_candidates: recordState(counts.refolded),
      trajectory_records: recordState(counts.trajectories),
      command: `ariax results ${projectId}`,
    },
    compute: {
      ...settings.compute,
      elapsed_seconds: amount(firstKnown(source.elapsed_seconds, progress.elapsed_seconds)),
    },
    cost: {
      estimate_usd: amount(firstKnown(source.cost_estimate_usd, source.estimated_cost_usd, source.cost_estimate)),
      recorded_spend_usd: amount(firstKnown(source.recorded_spend_usd, source.cost_usd, source.cost)),
      spend_limit_usd: amount(firstKnown(source.spend_limit_usd, source.spend_limit)),
    },
    warnings,
    action: nextAction(projectId, lifecycle, counts, accepted, syncError),
  };
}

function shown(value) {
  return value === null || value === undefined ? 'unknown' : String(value);
}

export function campaignStatusLines(campaign) {
  const lifecycleLabel = LIFECYCLE_LABELS[campaign.lifecycle.state]
    ?? (campaign.lifecycle.state ? String(campaign.lifecycle.state) : 'Unknown');
  const phaseLabel = campaign.lifecycle.phase_label;
  const phase = phaseLabel && phaseLabel.toLowerCase() !== lifecycleLabel.toLowerCase()
    ? ` · phase: ${phaseLabel}`
    : '';
  const title = `${campaign.name ?? campaign.project_id} — ${lifecycleLabel}${phase}`;
  const context = [campaign.protocol, campaign.binder_format].filter(Boolean);
  if (campaign.targets.length) {
    context.push(campaign.targets.map((target) => `${target.name ?? 'unnamed'}${target.chains.length ? ` [${target.chains.join(',')}]` : ''}${target.objective ? ` (${target.objective})` : ''}`).join(' · '));
  }
  // The executable next action already carries the project ID. Keep the
  // scientific context with the title instead of repeating an identity block.
  const lines = [[title, ...context].join(' · ')];
  lines.push(
    `Accepted: ${shown(campaign.designs.accepted)}/${shown(campaign.designs.requested)} · Attempts: ${shown(campaign.budget.attempts_used)}/${shown(campaign.budget.attempt_limit)} · Records: ${shown(campaign.records.trajectories)} trajectories, ${shown(campaign.records.refolded)} refolded, ${shown(campaign.records.ranked)} ranked`,
  );
  const shortStop = {
    attempt_limit_reached: 'Attempt limit reached.',
    target_reached: 'Requested accepted-design count reached.',
  }[campaign.stop.code];
  if (campaign.stop.summary) lines.push(`Stopped: ${shortStop ?? campaign.stop.summary}`);
  else if (campaign.scheduling?.summary) lines.push(`Scheduling: ${campaign.scheduling.summary}`);
  else if (campaign.scientific_outcome.code !== 'completed_no_accepted_designs') lines.push(`Outcome: ${campaign.scientific_outcome.summary}`);
  const terminated = campaign.rejections.native_stage_terminations
    .map(({ stage, count: value }) => `${stage} (${value})`);
  const filters = campaign.rejections.final_filter_failures
    .map(({ filter, count: value }) => `${filter} (${value})`);
  const evidence = [];
  if (terminated.length) evidence.push(`native exits: ${terminated.join(', ')}`);
  if (filters.length) evidence.push(`final-filter failures: ${filters.join(', ')}`);
  else if (campaign.rejections.final_filter_state === 'not_evaluated') evidence.push('final filters: not evaluated (0 candidates scored)');
  if (evidence.length) {
    // A single outcome line keeps native exits and final filters together.
    if (campaign.stop.summary) lines[lines.length - 1] += ` ${evidence.join(' · ')}`;
    else lines.push(`Evidence: ${evidence.join(' · ')}`);
  }
  const recordPrefix = `${campaign.budget.attempts_used} attempts; ${campaign.records.trajectories} saved trajectory records. `;
  for (const warning of campaign.warnings) {
    lines.push(`Warning: ${warning.startsWith(recordPrefix) ? warning.slice(recordPrefix.length) : warning}`);
  }
  const compute = [];
  if (campaign.compute.priority_mode !== null) compute.push(`priority=${shown(campaign.compute.priority_mode)}`);
  if (campaign.compute.turbo_mode !== null) compute.push(`turbo=${shown(campaign.compute.turbo_mode)}`);
  if (Array.isArray(campaign.compute.allowed_gpus)) compute.push(`GPUs=${campaign.compute.allowed_gpus.join(',') || 'none'}`);
  if (campaign.compute.elapsed_seconds !== null) compute.push(`elapsed=${campaign.compute.elapsed_seconds}s`);
  const cost = [];
  if (campaign.cost.estimate_usd !== null) cost.push(`estimate=$${campaign.cost.estimate_usd}`);
  if (campaign.cost.recorded_spend_usd !== null) cost.push(`recorded=$${campaign.cost.recorded_spend_usd}`);
  if (campaign.cost.spend_limit_usd !== null) cost.push(`limit=$${campaign.cost.spend_limit_usd}`);
  if (compute.length || cost.length) lines.push(`Compute/cost: ${[...compute, ...cost].join(' · ')}`);
  lines.push(`Next: ${campaign.action.command}`);
  return lines;
}

function recordedList(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item);
  if (typeof value !== 'string' || !value.trim()) return [];
  return value.split(/[,;|]/).map((item) => item.trim()).filter(Boolean);
}

export function compactCandidate(candidate) {
  const source = object(candidate);
  const bc2 = object(source.bindcraft2);
  const recorded = object(bc2.recorded_fields);
  const metrics = Array.isArray(source.metrics)
    ? source.metrics.filter((metric) => typeof metric?.name === 'string' && metric.value !== undefined)
      .map((metric) => ({ name: metric.name, value: metric.value ?? null, unit: metric.unit ?? null, direction: metric.direction ?? null }))
    : [];
  const explicitFailedFilters = Array.isArray(source.filters)
    ? source.filters.filter((filter) => filter?.passed === false && typeof filter?.name === 'string' && filter.name !== 'pass_filters')
      .map((filter) => filter.name)
    : [];
  const failedFilters = [...new Set([...recordedList(recorded.failed_filters), ...explicitFailedFilters])];
  const recordedTermination = typeof recorded.terminated === 'string' && recorded.terminated ? recorded.terminated : null;
  const optimizationCompleted = recordedTermination === 'completed';
  const terminatedStage = optimizationCompleted ? null : recordedTermination;
  const overallFilter = Array.isArray(source.filters)
    ? source.filters.find((filter) => filter?.name === 'pass_filters')
    : null;
  const selected = source.selection?.selected ?? null;
  const nativeOutcome = firstKnown(bc2.outcome, source.outcome);
  let explanation = null;
  if (terminatedStage) explanation = `Native optimization terminated at stage ${terminatedStage}.`;
  else if (failedFilters.length) explanation = `Recorded final-filter failures: ${failedFilters.join(', ')}.`;
  else if (nativeOutcome === 'rejected') explanation = 'Native outcome is rejected; no rejection reason was published.';
  return {
    id: source.id ?? null,
    native_id: source.native_id ?? null,
    rank: source.rank ?? null,
    view_stage: source.selection?.stage ?? null,
    selected,
    native_outcome: nativeOutcome,
    native_filter_pass: overallFilter?.passed === true ? true : (overallFilter?.passed === false ? false : null),
    ranking: {
      eligible: source.ranking_eligible ?? null,
      reasons: Array.isArray(source.ranking_reasons) ? source.ranking_reasons.filter((reason) => typeof reason === 'string') : [],
    },
    metrics,
    target_scores: {
      aligned_positive_target_mean_i_pDAE: typeof bc2.aligned_positive_target_mean_i_pDAE === 'number'
        ? bc2.aligned_positive_target_mean_i_pDAE
        : null,
      targets: Array.isArray(bc2.target_metrics)
        ? bc2.target_metrics.map((target) => ({
          name: typeof target?.name === 'string' ? target.name : null,
          weight: typeof target?.weight === 'number' ? target.weight : null,
          i_pDAE: typeof target?.i_pDAE === 'number' ? target.i_pDAE : null,
        }))
        : [],
    },
    optimization: {
      state: optimizationCompleted ? 'completed' : (terminatedStage ? 'terminated' : 'unknown'),
      terminated_stage: terminatedStage,
    },
    rejection: {
      terminated_stage: terminatedStage,
      failed_filters: failedFilters,
      explanation,
    },
    binder_sequences: Array.isArray(bc2.binder_sequences)
      ? bc2.binder_sequences.filter((sequence) => typeof sequence === 'string' && sequence)
      : (typeof source.sequence === 'string' && source.sequence ? [source.sequence] : []),
    structures: Array.isArray(source.structures)
      ? source.structures.map((structure) => ({ path: structure?.path ?? null, role: structure?.role ?? null }))
      : [],
  };
}

export function compactCandidateResult(data, meta = {}, filter = null) {
  const candidates = data.map(compactCandidate);
  const commonReasons = candidates.length > 1
    ? candidates[0].ranking.reasons.filter((reason) => candidates.every((candidate) => candidate.ranking.reasons.includes(reason)))
    : [];
  if (commonReasons.length) {
    for (const candidate of candidates) {
      candidate.ranking.reasons = candidate.ranking.reasons.filter((reason) => !commonReasons.includes(reason));
    }
  }
  const state = typeof meta.state === 'string' ? meta.state : 'unknown';
  let availability = 'unknown';
  let explanation = 'Candidate publication state is unknown.';
  if (state === 'available') {
    availability = 'available';
    explanation = 'Candidate records are available for this view.';
  } else if (state === 'completed_empty') {
    availability = 'empty';
    explanation = 'The terminal publication exists and contains no candidates in this view.';
  } else if (state === 'missing') {
    availability = 'missing';
    explanation = 'No source table was published for this view; use campaign counts and another candidate view to determine whether that absence is expected.';
  } else if (state === 'incomplete') {
    availability = 'partial';
    explanation = 'Candidate publication is not complete; current rows may change while the project continues or results finish publishing.';
  }
  return {
    data: candidates,
    meta: {
      schema_version: 1,
      view: meta.view ?? null,
      state,
      availability,
      explanation,
      returned: data.length,
      fetched: count(meta.fetched),
      total: count(meta.total),
      next_cursor: meta.next_cursor ?? null,
      has_more: typeof meta.next_cursor === 'string' && meta.next_cursor.length > 0,
      ...(commonReasons.length ? { notes: commonReasons } : {}),
      ...(filter ? { eligibility_filter: filter } : {}),
    },
  };
}

export function compactSubmission(project, spec, operationId = null) {
  const source = object(project?.project ?? project);
  const settings = compactScientificSettings(spec);
  const projectId = firstKnown(source.id, source.project_id);
  const jobId = firstKnown(source.job_id, source.jobId);
  return {
    schema_version: 1,
    kind: 'ariax_submission',
    project_id: projectId,
    job_id: jobId,
    lifecycle: firstKnown(source.status, source.state, 'pending'),
    accepted_settings: settings,
    cost: {
      estimate_usd: amount(firstKnown(source.cost_estimate_usd, source.estimated_cost_usd, source.cost_estimate)),
      spend_limit_usd: amount(firstKnown(source.spend_limit_usd, source.spend_limit)),
    },
    next: projectId ? { command: `ariax status ${projectId} --wait` } : null,
    ...(operationId ? { local_operation_id: operationId } : {}),
  };
}
