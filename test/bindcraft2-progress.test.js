import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bindCraft2ProgressFields, bindCraft2ProgressSummary } from '../src/bindcraft2-progress.js';
import { waitProgressLine } from '../src/commands/submit.js';

const project = {
  protocol: 'bindcraft2', status: 'completed',
  hotspots: null,
  protocol_config: {
    schema_version: 1,
    targets: [{ name: 'target', chains: ['A'], hotspots: 'A42-45' }],
    binder: { lengths: [80, 100] },
    campaign: { num_designs: 10, max_trajectories: 40 },
  },
  bindcraft2_progress: {
    stage: 'completed', requested: 10,
    counts: { attempted: 40, accepted: 6, trajectories: 40, refolded: 12, ranked: 6 },
    stop_reason: 'attempt_limit_reached', checkpoint_resumable: true,
    workers: { active: 0, processes: 2 },
  },
};

describe('BindCraft2 progress formatting', () => {
  it('keeps lifecycle status separate from campaign phase and reports exhausted pilots', () => {
    assert.deepEqual(bindCraft2ProgressFields(project), {
      settings_source: 'protocol_config (authoritative; top-level legacy fields are compatibility mirrors)',
      protocol_config: project.protocol_config,
      campaign_phase: 'Completed', accepted_designs: '6/10', attempted: 40,
      trajectories: 40, refolded: 12, ranked: 6, workers: '0/2 active',
      checkpoint_resumable: true, stop_reason: 'attempt_limit_reached',
      status_note: 'The trajectory limit was reached before every requested design was accepted.',
    });
  });

  it('provides a compact standalone wait-loop summary', () => {
    assert.equal(bindCraft2ProgressSummary(project), 'Completed: 6/10 accepted; attempts 40/40; 40 trajectory records; 12 refolded; stop: attempt_limit_reached');
    assert.match(bindCraft2ProgressSummary({
      ...project,
      status: 'paused',
      bindcraft2_progress: { ...project.bindcraft2_progress, stage: 'designing', stop_reason: 'user_pause' },
    }), /^Paused \(Designing\):/);
    assert.equal(bindCraft2ProgressSummary({ protocol: 'boltzgen' }), null);
  });

  it('uses BindCraft2 counts in submit waits and preserves generic ticks', () => {
    assert.equal(waitProgressLine({ project }, 'running', 2400),
      '… Completed: 6/10 accepted; attempts 40/40; 40 trajectory records; 12 refolded; stop: attempt_limit_reached elapsed=2s');
    assert.equal(waitProgressLine({ protocol: 'boltzgen' }, 'running', 2400), '… status=running elapsed=2s');
  });

  it('prefers actionable scheduling and sync notes', () => {
    const fields = bindCraft2ProgressFields({
      protocol: 'bindcraft2',
      bindcraft2_progress: {
        stage: 'planning', requested: 2, counts: {}, checkpoint_resumable: false,
        scheduling_reason: 'preference_mismatch', sync_error: 'output_sync_failed',
      },
    });
    assert.equal(fields.campaign_phase, 'Preparing campaign');
    assert.match(fields.status_note, /taking longer to save/);
  });

  it('shows authoritative nested settings even before progress exists', () => {
    assert.deepEqual(bindCraft2ProgressFields({
      protocol: 'bindcraft2', hotspots: null,
      protocol_config: { targets: [{ hotspots: 'B58' }] },
    }), {
      settings_source: 'protocol_config (authoritative; top-level legacy fields are compatibility mirrors)',
      protocol_config: { targets: [{ hotspots: 'B58' }] },
    });
  });
});
