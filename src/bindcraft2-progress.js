/** Human-readable BindCraft2 progress without confusing campaign phase and project lifecycle. */
import { compactCampaign } from './campaign-presentation.js';

const PHASES = Object.freeze({
  planning: 'Preparing campaign',
  provisioning: 'Starting GPU',
  designing: 'Designing',
  finalizing: 'Saving results',
  completed: 'Completed',
  paused: 'Paused',
  failed: 'Failed',
  aborted: 'Aborted',
});

const NOTES = Object.freeze({
  target_reached: 'The requested number of accepted designs was reached.',
  attempt_limit_reached: 'The trajectory limit was reached before every requested design was accepted.',
  unexpected_early_exit: 'The campaign stopped unexpectedly; inspect logs and saved results.',
  incomplete_outputs: 'The campaign stopped before every result was ready; inspect logs and saved results.',
  execution_failed: 'The campaign failed; available results can still be downloaded.',
  user_pause: 'The campaign was paused after saving available progress.',
  user_abort: 'The campaign was stopped; available results can still be downloaded.',
  credit_stop: 'Add credits before restarting this campaign.',
  sync_failed: 'Some final results could not be saved; previously saved results remain available.',
  infrastructure_failure: 'The GPU became unavailable; saved progress is retained for restart.',
  preference_mismatch: 'Current GPU preferences cannot satisfy this campaign.',
  qualified_capacity_unavailable: 'No suitable GPU is currently available.',
  runtime_unavailable: 'No verified BindCraft2 runtime is currently available.',
  invalid_configuration: 'The campaign configuration is not valid for the native BindCraft2 engine.',
  output_sync_failed: 'The latest results are taking longer to save; previously saved results remain available.',
  final_sync_failed: 'Some final results could not be saved; previously saved results remain available.',
});

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function isBindCraft2Project(project) {
  return String(project?.protocol ?? project?.protocol_id ?? '').toLowerCase() === 'bindcraft2';
}

/** Values appended to the normal `ariax status` human key/value block. */
export function bindCraft2ProgressFields(project) {
  if (!isBindCraft2Project(project)) return {};
  const config = project?.protocol_config && typeof project.protocol_config === 'object'
    ? project.protocol_config
    : {};
  const fields = {
    settings_source: 'protocol_config (authoritative; top-level legacy fields are compatibility mirrors)',
    protocol_config: config,
  };
  if (!project?.bindcraft2_progress || typeof project.bindcraft2_progress !== 'object') return fields;
  const progress = project.bindcraft2_progress;
  const counts = progress.counts && typeof progress.counts === 'object' ? progress.counts : {};
  const requested = count(progress.requested ?? project.num_designs);
  const accepted = count(counts.accepted ?? project.accepted_designs);
  Object.assign(fields, {
    campaign_phase: PHASES[progress.stage] ?? String(progress.stage || 'Unknown'),
    accepted_designs: `${accepted}/${requested}`,
    attempted: count(counts.attempted),
    trajectories: count(counts.trajectories),
    refolded: count(counts.refolded),
    ranked: count(counts.ranked),
  });
  const active = count(progress.workers?.active);
  const processes = count(progress.workers?.processes);
  if (active || processes) fields.workers = `${active}/${processes} active`;
  fields.checkpoint_resumable = progress.checkpoint_resumable === true;
  if (progress.stop_reason) fields.stop_reason = progress.stop_reason;
  if (progress.scheduling_reason) fields.scheduling_reason = progress.scheduling_reason;
  if (progress.sync_error) fields.sync_error = progress.sync_error;
  const note = NOTES[progress.sync_error] ?? NOTES[progress.scheduling_reason] ?? NOTES[progress.stop_reason];
  if (note) fields.status_note = note;
  return fields;
}

/** Compact text suitable for submit/status wait-loop progress diagnostics. */
export function bindCraft2ProgressSummary(project) {
  if (!isBindCraft2Project(project) || !project?.bindcraft2_progress || typeof project.bindcraft2_progress !== 'object') return null;
  const campaign = compactCampaign(project);
  const lifecycle = campaign.lifecycle.state;
  const lifecycleLabel = lifecycle ? lifecycle[0].toUpperCase() + lifecycle.slice(1) : 'Unknown';
  const phaseLabel = campaign.lifecycle.phase_label;
  const phase = ['paused', 'failed', 'aborted', 'cancelled', 'completed'].includes(lifecycle)
    ? `${lifecycleLabel}${phaseLabel && phaseLabel.toLowerCase() !== lifecycle ? ` (${phaseLabel})` : ''}`
    : (phaseLabel ?? lifecycleLabel);
  const parts = [
    `${phase}: ${campaign.designs.accepted ?? 'unknown'}/${campaign.designs.requested ?? 'unknown'} accepted`,
    `attempts ${campaign.budget.attempts_used ?? 'unknown'}/${campaign.budget.attempt_limit ?? 'unknown'}`,
  ];
  if (campaign.records.trajectories !== null) parts.push(`${campaign.records.trajectories} trajectory records`);
  if (campaign.records.refolded !== null) parts.push(`${campaign.records.refolded} refolded`);
  if (campaign.stop.code) parts.push(`stop: ${campaign.stop.code}`);
  if (campaign.warnings[0]) parts.push(campaign.warnings[0]);
  return parts.join('; ');
}
