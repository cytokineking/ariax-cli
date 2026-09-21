import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../src/main.js';
import {
  campaignStatusLines,
  compactCampaign,
  compactSubmission,
} from '../src/campaign-presentation.js';

const id = '11111111-1111-4111-8111-111111111111';

function campaign(overrides = {}) {
  return {
    id,
    name: 'peptide-mhc-fab',
    protocol: 'bindcraft2',
    project_type: 'fab',
    status: 'completed',
    protocol_config: {
      modality: ['Fab'],
      targets: [{ name: 'target', objective: 'target', chains: ['A', 'B', 'C'] }],
      campaign: { num_designs: 1, max_trajectories: 10 },
    },
    bindcraft2_progress: {
      stage: 'completed', requested: 1,
      counts: { attempted: 10, accepted: 0, trajectories: 9, refolded: 0, ranked: 0 },
      stop_reason: 'attempt_limit_reached', checkpoint_resumable: true,
      workers: { active: 0, processes: 2 },
      rejections: {
        candidates_scored: 0, candidates_rejected: 0,
        terminated: { final: 1, anneal: 7, mutate: 1 }, failed_filters: {},
      },
      checkpoint_at: '2026-09-20T19:34:43Z',
      output_synced_at: '2026-09-20T19:34:49Z',
    },
    ...overrides,
  };
}

async function capture(argv, response) {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = '';
  let stderr = '';
  process.stdout.write = chunk => { stdout += String(chunk); return true; };
  process.stderr.write = chunk => { stderr += String(chunk); return true; };
  try {
    const code = await main(argv, { ARIAX_API_KEY: 'arx_testcredential', NO_UPDATE_NOTIFIER: '1' }, {
      fetchImpl: typeof response === 'function' ? response : async () => Response.json(response),
    });
    return { code, stdout, stderr };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

describe('compact campaign presentation', () => {
  it('separates lifecycle, scientific acceptance, attempt budget, and saved records', () => {
    const view = compactCampaign(campaign());
    assert.deepEqual(view.lifecycle, { state: 'completed', terminal: true, phase: 'completed', phase_label: 'Completed' });
    assert.deepEqual(view.budget, { attempts_used: 10, attempt_limit: 10 });
    assert.deepEqual(view.designs, { accepted: 0, requested: 1 });
    assert.deepEqual(view.records, { trajectories: 9, refolded: 0, ranked: 0 });
    assert.equal(view.scientific_outcome.code, 'completed_no_accepted_designs');
    assert.match(view.scientific_outcome.summary, /does not establish.*undesignable.*more compute/i);
    assert.equal(view.rejections.final_filter_state, 'not_evaluated');
    assert.deepEqual(view.rejections.final_filter_failures, []);
    assert.deepEqual(view.rejections.native_stage_terminations, [
      { stage: 'final', count: 1 }, { stage: 'anneal', count: 7 }, { stage: 'mutate', count: 1 },
    ]);
    assert.ok(view.warnings.includes('10 attempts; 9 saved trajectory records. 1 attempt has no published trajectory record; reason unavailable.'));
    assert.doesNotMatch(view.warnings.join(' '), /filters were not evaluated/);
    assert.equal(view.action.code, 'review_trajectory_records');
    assert.equal(JSON.stringify(view).includes('checkpoint'), false);
    assert.equal(JSON.stringify(view).includes('workers'), false);
  });

  it('reports recorded final-filter failures without deriving them from rounded scores', () => {
    const source = campaign();
    source.bindcraft2_progress.counts = { attempted: 10, accepted: 0, trajectories: 10, refolded: 10, ranked: 0 };
    source.bindcraft2_progress.rejections = {
      candidates_scored: 10, candidates_rejected: 10,
      terminated: { screen: 4, completed: 2 }, failed_filters: { i_pTM: 10, pLDDT: 2 },
    };
    const view = compactCampaign(source);
    assert.equal(view.rejections.final_filter_state, 'evaluated');
    assert.deepEqual(view.rejections.final_filter_failures, [
      { filter: 'i_pTM', count: 10 }, { filter: 'pLDDT', count: 2 },
    ]);
    assert.deepEqual(view.rejections.native_stage_terminations, [{ stage: 'screen', count: 4 }]);
    assert.equal(view.action.code, 'review_refolded_candidates');
  });

  it('resolves a job before suggesting log inspection when no result records exist', () => {
    const source = campaign();
    source.bindcraft2_progress.counts = { attempted: 0, accepted: 0, trajectories: 0, refolded: 0, ranked: 0 };
    source.bindcraft2_progress.rejections = {};
    const view = compactCampaign(source);
    assert.equal(view.action.code, 'find_job_logs');
    assert.equal(view.action.command, `ariax jobs --project ${id}`);
    assert.doesNotMatch(view.action.command, /^ariax logs/);
  });

  it('renders a concise human view with the unresolved publication discrepancy once', () => {
    const text = campaignStatusLines(compactCampaign(campaign())).join('\n');
    assert.match(text, /^peptide-mhc-fab — Completed/m);
    assert.match(text, /bindcraft2 · fab · target \[A,B,C\] \(target\)/);
    assert.match(text, /Accepted: 0\/1 · Attempts: 10\/10/);
    assert.match(text, /Records: 9 trajectories, 0 refolded, 0 ranked/);
    assert.match(text, /final filters: not evaluated \(0 candidates scored\)/);
    assert.equal((text.match(/reason unavailable/g) || []).length, 1);
    assert.equal(text.split('\n').length, 5);
    assert.equal((text.match(/9 trajectories/g) || []).length, 1);
    assert.doesNotMatch(text, /10 attempts; 9 saved trajectory records/);
    assert.match(text, /1 attempt has no published trajectory record; reason unavailable/);
    assert.match(text, /Stopped: Attempt limit reached/);
    assert.doesNotMatch(text, /target is undesignable|more compute will help|Results: final=/);
    assert.doesNotMatch(text, /checkpoint|worker|output_synced|protocol_config/);
  });

  it('leads with paused lifecycle despite a stale designing phase and shows known compute and cost', () => {
    const source = campaign({
      status: 'paused', priority_mode: 'priority', turbo_mode: true, allowed_gpus: ['H100'],
      elapsed_seconds: 321, estimated_cost_usd: 4.5, recorded_spend_usd: 1.25, spend_limit_usd: 8,
    });
    source.bindcraft2_progress.stage = 'designing';
    source.bindcraft2_progress.stop_reason = 'user_pause';
    const text = campaignStatusLines(compactCampaign(source)).join('\n');
    assert.match(text, /^peptide-mhc-fab — Paused · phase: Designing/m);
    assert.match(text, /Compute\/cost: priority=priority · turbo=true · GPUs=H100 · elapsed=321s · estimate=\$4\.5 · recorded=\$1\.25 · limit=\$8/);
    assert.doesNotMatch(text, /^peptide-mhc-fab — Designing$/m);
  });

  it('retains publication failures and unavailable counts in the concise human view', () => {
    const source = campaign({ status: 'running' });
    source.bindcraft2_progress.counts = { attempted: 2 };
    source.bindcraft2_progress.stop_reason = null;
    source.bindcraft2_progress.rejections = {};
    source.bindcraft2_progress.sync_error = 'output_sync_failed';
    const text = campaignStatusLines(compactCampaign(source)).join('\n');
    assert.match(text, /Accepted: unknown\/1 · Attempts: 2\/10/);
    assert.match(text, /Records: unknown trajectories, unknown refolded, unknown ranked/);
    assert.match(text, /Warning: The latest results could not be published/);
    assert.doesNotMatch(text, /0 trajectories|no published trajectory record/);
  });

  it('does not present a scheduling condition as a terminal stop reason', () => {
    const source = campaign({ status: 'running' });
    source.bindcraft2_progress.stage = 'provisioning';
    source.bindcraft2_progress.stop_reason = null;
    source.bindcraft2_progress.scheduling_reason = 'qualified_capacity_unavailable';
    const view = compactCampaign(source);
    assert.equal(view.stop.code, null);
    assert.equal(view.scheduling.code, 'qualified_capacity_unavailable');
    const text = campaignStatusLines(view).join('\n');
    assert.match(text, /^peptide-mhc-fab — Running · phase: Starting compute/m);
    assert.match(text, /Scheduling: Suitable compute capacity is currently unavailable/);
    assert.doesNotMatch(text, /Stopped: Suitable compute/);
  });

  it('uses compact JSON by default and restores the full status payload with --details', async () => {
    const raw = campaign();
    const compact = await capture(['status', id, '--json'], { data: raw, meta: { internal: true }, request_id: 'req-1' });
    assert.equal(compact.code, 0);
    const compactBody = JSON.parse(compact.stdout);
    assert.equal(compactBody.data.kind, 'ariax_campaign_status');
    assert.equal(compactBody.data.project_id, id);
    assert.equal(compactBody.request_id, undefined);
    assert.doesNotMatch(compact.stdout, /checkpoint_resumable|output_synced_at|req-1/);

    const detailed = await capture(['status', id, '--details', '--json'], { data: raw, meta: { internal: true }, request_id: 'req-1' });
    const detailedBody = JSON.parse(detailed.stdout);
    assert.equal(detailedBody.data.bindcraft2_progress.checkpoint_resumable, true);
    assert.equal(detailedBody.meta.internal, true);
    assert.equal(detailedBody.request_id, 'req-1');
  });

  it('preserves released status output for protocols without a compact adapter', async () => {
    const raw = { id, name: 'fold', protocol: 'esmfold2-pipeline', status: 'completed', esmfold2_progress: { ranked: 3 } };
    const result = await capture(['status', id, '--json'], { data: raw, meta: { source: 'api' }, request_id: 'req-generic' });
    assert.equal(result.code, 0);
    const body = JSON.parse(result.stdout);
    assert.deepEqual(body.data, raw);
    assert.equal(body.meta.source, 'api');
    assert.equal(body.request_id, 'req-generic');
  });

  it('preserves released validate and submit JSON for protocols without a compact adapter', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-generic-presentation-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const job = path.join(root, 'job.json');
    const spec = { protocol: 'boltzgen', chains: 'A', num_designs: 2 };
    fs.writeFileSync(job, JSON.stringify(spec));
    const validated = await capture(['validate', '-f', job, '--json'], async (url) => {
      assert.match(String(url), /\/api\/v1\/validate$/);
      return Response.json({ data: { valid: true, protocol: 'boltzgen', normalized_job_spec: spec }, request_id: 'validate-generic' });
    });
    assert.deepEqual(JSON.parse(validated.stdout).data.normalized_job_spec, spec);
    assert.equal(JSON.parse(validated.stdout).request_id, 'validate-generic');

    const submitted = await capture(['submit', '-f', job, '--name', 'generic-job', '--root-dir', root, '--json'], async (url) => {
      if (String(url).endsWith('/api/v1/me')) return Response.json({ data: {
        actor: { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        billing: { account_type: 'user', account_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      } });
      if (String(url).endsWith('/api/v1/projects')) return Response.json({
        data: { project_id: id, status: 'pending' }, request_id: 'submit-generic',
      });
      throw new Error(`Unexpected endpoint ${url}`);
    });
    assert.equal(submitted.code, 0, submitted.stderr);
    const submittedBody = JSON.parse(submitted.stdout);
    assert.equal(submittedBody.data.project_id, id);
    assert.equal(submittedBody.data.kind, undefined);
    assert.equal(submittedBody.request_id, 'submit-generic');
    assert.match(submittedBody.meta.local_operation_id, /^[0-9a-f-]{36}$/);
  });

  it('builds a compact submission receipt with accepted settings and next command', () => {
    const receipt = compactSubmission(
      { project_id: id, job_id: 'job-1', status: 'pending' },
      campaign().protocol_config ? { protocol: 'bindcraft2', project_type: 'fab', protocol_config: campaign().protocol_config } : {},
      'operation-1',
    );
    assert.equal(receipt.project_id, id);
    assert.equal(receipt.accepted_settings.binder_format, 'fab');
    assert.equal(receipt.accepted_settings.attempt_limit, 10);
    assert.equal(receipt.next.command, `ariax status ${id} --wait`);
    assert.equal(receipt.local_operation_id, 'operation-1');
  });
});
