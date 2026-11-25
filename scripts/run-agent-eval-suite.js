/**
 * Deterministic Agent Evaluation Suite runner for Ariax CLI.
 *
 * - Validates schema of ALL evaluation/cases/*.json (both schema_version 1 and 2).
 * - Executes all schema_version 2 benchmark cases against real CLI subprocesses
 *   and an isolated in-process loopback HTTP server (zero network, zero external LLMs).
 * - Prints a summary table and exits 0 iff 100% pass.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { AGENT_SHELL_ENV_VARS } from '../src/agent-env.js';
import { EXIT } from '../src/exit-codes.js';
import { tunnelEnvironment } from '../test/helpers/forge-http.js';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN_PATH = path.join(REPO_ROOT, 'bin', 'ariax.js');
const CASES_DIR = path.join(REPO_ROOT, 'evaluation', 'cases');

const V1_OUTCOMES = new Set(['completed', 'needs_input', 'unsupported', 'refused', 'interrupted', 'failed']);
const V1_CHECK_OPS = new Set(['equals', 'absent', 'contains_residue']);
const V2_CATEGORIES = new Set(['routing', 'context_budget', 'forge_hygiene', 'recovery_feedback']);
const V2_RUNNERS = new Set([
  'discover_routing',
  'budget_discover_skill',
  'budget_forge_catalog',
  'budget_summary_handoff',
  'forge_hygiene_pack_finish',
  'forge_hygiene_close_guard',
  'forge_hygiene_storage_suggest',
  'recovery_remote_exit_11',
  'feedback_redacted_dry_run',
  'feedback_opportunity_advisory',
]);

const IDS = Object.freeze({
  actor: '11111111-1111-4111-8111-111111111111',
  billing: '22222222-2222-4222-8222-222222222222',
  managedProject: '33333333-3333-4333-8333-333333333333',
  boltzgenProject: '33333333-3333-4333-8333-333333333334',
  boltzgenPassProject: '33333333-3333-4333-8333-333333333335',
  pausedRestartProject: '33333333-3333-4333-8333-333333333336',
  forgeProject: '44444444-4444-4444-8444-444444444444',
  forgeClosedProject: '44444444-4444-4444-8444-444444444445',
  forgeSyncPendingProject: '44444444-4444-4444-8444-444444444446',
  forgeSessionPack: '55555555-5555-4555-8555-555555555555',
  forgeSessionClosed: '55555555-5555-4555-8555-555555555556',
  forgeSessionClose: '66666666-6666-4666-8666-666666666666',
  forgeSessionFail: '77777777-7777-4777-8777-777777777777',
  forgeSessionPhase7: '77777777-7777-4777-8777-777777777778',
  forgeCancelCmd: 'cccccccc-1111-4111-8111-111111111111',
  serverErrorProject: '88888888-8888-4888-8888-888888888888',
  timeoutProject: '99999999-9999-4999-8999-999999999999',
  apiKey: 'arx_eval_fixture_token_only',
});

const CLEARED_AGENT_ENV = Object.fromEntries(AGENT_SHELL_ENV_VARS.map((k) => [k, '']));

function validateV1Case(file, def) {
  assert.equal(def.schema_version, 1, `${file}: expected schema_version 1`);
  assert.equal(typeof def.id, 'string', `${file}: id must be a string`);
  assert.ok(def.id.trim().length > 0, `${file}: id must be nonempty`);
  assert.equal(typeof def.prompt, 'string', `${file}: prompt must be a string`);
  assert.ok(def.prompt.trim().length > 0, `${file}: prompt must be nonempty`);
  assert.ok(V1_OUTCOMES.has(def.expected_completion), `${file}: invalid expected_completion "${def.expected_completion}"`);
  assert.ok(Array.isArray(def.checks), `${file}: checks must be an array`);
  for (const [idx, rule] of def.checks.entries()) {
    assert.equal(typeof rule?.pointer, 'string', `${file}: checks[${idx}].pointer must be string`);
    assert.ok(rule.pointer === '' || rule.pointer.startsWith('/'), `${file}: checks[${idx}].pointer must be a JSON Pointer`);
    assert.ok(V1_CHECK_OPS.has(rule?.op), `${file}: checks[${idx}].op "${rule?.op}" is invalid`);
  }
}

function validateV2Case(file, def) {
  assert.equal(def.schema_version, 2, `${file}: expected schema_version 2`);
  assert.equal(typeof def.id, 'string', `${file}: id must be a string`);
  assert.equal(`${def.id}.json`, file, `${file}: v2 case id "${def.id}" must match filename`);
  assert.ok(V2_CATEGORIES.has(def.category), `${file}: invalid category "${def.category}"`);
  assert.ok(V2_RUNNERS.has(def.runner), `${file}: invalid runner "${def.runner}"`);
  assert.equal(typeof def.description, 'string', `${file}: description must be a string`);
  assert.ok(def.description.trim().length > 0, `${file}: description must be nonempty`);
  assert.ok(def.input && typeof def.input === 'object' && !Array.isArray(def.input), `${file}: input must be an object`);
  assert.ok(def.assertions && typeof def.assertions === 'object' && !Array.isArray(def.assertions), `${file}: assertions must be an object`);
}

async function runCli(args, { env = {}, allowNonZero = false } = {}) {
  const mergedEnv = {
    ...process.env,
    NO_UPDATE_NOTIFIER: '1',
    CI: 'false',
    ...CLEARED_AGENT_ENV,
    ...env,
  };
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [BIN_PATH, ...args], {
      cwd: REPO_ROOT,
      env: mergedEnv,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr, bytes: Buffer.byteLength(stdout, 'utf8') };
  } catch (err) {
    const code = typeof err.code === 'number' ? err.code : 1;
    const stdout = typeof err.stdout === 'string' ? err.stdout : '';
    const stderr = typeof err.stderr === 'string' ? err.stderr : '';
    if (!allowNonZero) {
      throw new Error(`CLI failed (exit ${code}): ariax ${args.join(' ')}\nstdout: ${stdout}\nstderr: ${stderr}`);
    }
    return { code, stdout, stderr, bytes: Buffer.byteLength(stdout, 'utf8') };
  }
}

function buildCatalogFixture() {
  return [
    {
      tool: 'boltz2',
      name: 'Boltz-2',
      tier: 'recommended',
      summary: 'All-atom biomolecular complex prediction and small-molecule affinity estimation.',
      gpu: true,
      modalities: ['protein', 'ligand', 'small-molecule', 'affinity'],
      resources: { min_gpu_count: 1, min_vram_gib_per_gpu: 24, min_ram_gib: 32, min_cpu_count: 4, min_disk_gib: 80 },
      models: [{ id: 'boltz2-default', assets: ['boltz2'], modes: ['complex', 'affinity'], resources: { min_gpu_count: 1, min_vram_gib_per_gpu: 24 } }],
      capabilities: { tasks: ['molecular-prediction', 'validation-search'], guide: 'boltz2', tier: 'recommended', qualification: [] },
    },
    {
      tool: 'protenix-models',
      name: 'Protenix',
      tier: 'recommended',
      summary: 'Multi-checkpoint AF3-class structure predictor for proteins, ligands, DNA/RNA, and constraints.',
      gpu: true,
      modalities: ['protein', 'ligand', 'nucleic-acid'],
      resources: { min_gpu_count: 1, min_vram_gib_per_gpu: 48, min_ram_gib: 64, min_cpu_count: 8, min_disk_gib: 150 },
      models: [{ id: 'protenix-v1', assets: ['protenix'], modes: ['default'], resources: { min_gpu_count: 1, min_vram_gib_per_gpu: 48 } }],
      capabilities: { tasks: ['molecular-prediction'], guide: 'protenix-models', tier: 'recommended', qualification: [] },
    },
    {
      tool: 'interface-scores',
      name: 'Interface Scores',
      tier: 'recommended',
      summary: 'Unified CPU multi-predictor interface confidence scorer (ipSAE, pDockQ, pDockQ2, LIS).',
      gpu: false,
      modalities: ['protein', 'antibody', 'vhh'],
      resources: { min_gpu_count: 0, min_vram_gib_per_gpu: 0, min_ram_gib: 8, min_cpu_count: 2, min_disk_gib: 20 },
      models: [],
      capabilities: { tasks: ['validation-search'], guide: 'interface-scores', tier: 'recommended', qualification: [] },
    },
    {
      tool: 'ipsae',
      name: 'ipSAE (legacy)',
      tier: 'legacy',
      superseded_by: 'interface-scores',
      summary: 'Legacy standalone AF2 ipSAE scorer; superseded by interface-scores.',
      gpu: false,
      modalities: ['protein'],
      resources: { min_gpu_count: 0, min_vram_gib_per_gpu: 0, min_ram_gib: 4, min_cpu_count: 1, min_disk_gib: 10 },
      models: [],
      capabilities: { tasks: ['validation-search'], guide: 'ipsae', tier: 'legacy', qualification: [] },
    },
  ];
}

async function startEvalServer() {
  const state = {
    catalog: buildCatalogFixture(),
    capturedPackCommands: [],
    closePostCount: 0,
    pendingFiles: 240,
    pendingBytes: 12_582_912,
    storageSuggestions: [],
    remoteExitCode: 2,
    remoteLog: 'Traceback (most recent call last):\nValueError: invalid ligand atom index\n',
    finishOps: new Map(),
    commands: new Map(),
    phase7Queries: [],
    phase7ScratchBytes: 0,
    phase7SyncPolls: 0,
    phase7CancelPolls: 0,
    phase7RefreshPolls: 0,
    phase7InputReadyPolls: 0,
    phase7InputUnreadyOnce: true,
    phase7InputSeenIds: [],
  };

  const reply = (res, status, data, meta = undefined, extraHeaders = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': 'req-eval-suite', ...extraHeaders });
    res.end(JSON.stringify({ data, ...(meta ? { meta } : {}) }));
  };
  const replyError = (res, status, code, message, extraHeaders = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': 'req-eval-err-500', ...extraHeaders });
    res.end(JSON.stringify({ error: { code, message, retryable: false } }));
  };

  const readJsonBody = async (req) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : {};
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const p = url.pathname;

      if (req.method === 'GET' && p === '/api/v1/me') {
        return reply(res, 200, {
          actor: { user_id: IDS.actor },
          billing: { account_type: 'user', account_id: IDS.billing },
        });
      }

      if (req.method === 'GET' && p === '/api/v1/forge/catalog') {
        const includeAll = url.searchParams.get('include_all') === 'true';
        const taskFilter = url.searchParams.get('task');
        let visible = includeAll
          ? state.catalog
          : state.catalog.filter((t) => !['experimental', 'legacy'].includes(t.tier));
        if (taskFilter) {
          visible = visible.filter((t) => Array.isArray(t.capabilities?.tasks) && t.capabilities.tasks.includes(taskFilter));
        }
        return reply(res, 200, { tools: visible }, {
          view: url.searchParams.get('view') || 'summary',
          hidden_experimental_count: 0,
          hidden_legacy_count: state.catalog.filter((t) => t.tier === 'legacy').length,
        });
      }

      if (req.method === 'GET' && p === '/api/v1/pricing') {
        return reply(res, 200, {
          source: 'database',
          billing_unit: 'allocation_hour',
          preview_channel: 'cli',
          rates: [
            { gpu_id: 'L40S', gpu_count: 1, currency: 'USD', hourly_rate: '1.800000' },
            { gpu_id: 'H100', gpu_count: 1, currency: 'USD', hourly_rate: '3.900000' },
            { gpu_id: 'H100', gpu_count: 2, currency: 'USD', hourly_rate: '7.800000' },
          ],
          promotion: {
            active: false,
            label: 'Ended launch promo',
            rates: [
              { gpu_id: 'L40S', gpu_count: 1, currency: 'USD', hourly_rate: '0.900000' },
            ],
          },
        });
      }

      if (req.method === 'POST' && p === '/api/v1/validate') {
        const body = await readJsonBody(req);
        return reply(res, 200, {
          valid: true,
          protocol: body.protocol || 'boltzgen',
          normalized_job_spec: body,
          warnings: [],
        });
      }

      if (req.method === 'GET' && p === '/api/v1/projects') {
        const name = url.searchParams.get('name');
        const allProjects = [
          { id: IDS.forgeProject, name: 'eval-forge-project', protocol: 'forge', status: 'running' },
          { id: IDS.managedProject, name: 'pdl1-miniprotein-pilot', protocol: 'bindcraft2', status: 'completed' },
        ];
        const filtered = name ? allProjects.filter((item) => item.name === name) : allProjects;
        return reply(res, 200, { projects: filtered });
      }

      if (req.method === 'GET' && p === '/api/v1/jobs') {
        const pid = url.searchParams.get('project_id');
        if (pid === IDS.boltzgenProject) {
          return reply(res, 200, {
            jobs: [
              {
                id: 'aaaaaaaa-1111-4111-8111-111111111111',
                project_id: IDS.boltzgenProject,
                status: 'completed',
                allocations: [
                  { gpu_type: 'H100', total_runtime: 420, total_cost: 1.35 },
                ],
              },
            ],
          });
        }
        if (pid === IDS.forgeClosedProject) {
          return reply(res, 200, {
            jobs: [
              {
                id: 'bbbbbbbb-1111-4111-8111-111111111111',
                project_id: IDS.forgeClosedProject,
                status: 'completed',
                allocations: [
                  { gpu_type: 'L40S', total_runtime: 600, total_cost: 0.75 },
                ],
              },
            ],
          });
        }
        if (pid === IDS.pausedRestartProject) {
          return reply(res, 200, {
            jobs: [
              {
                id: 'dddddddd-1111-4111-8111-111111111111',
                project_id: IDS.pausedRestartProject,
                status: 'paused',
                failure: { code: 'gpu_provisioning_delayed', message: 'GPU provisioning delayed on selected GPUs' },
                allocations: [],
              },
            ],
          });
        }
        return reply(res, 200, { jobs: [] });
      }

      // Phase 7: BoltzGen project with passing candidates, null eligibility, control metadata, and retained storage
      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.boltzgenPassProject}`) {
        return reply(res, 200, {
          id: IDS.boltzgenPassProject,
          name: 'boltzgen-pass-eval',
          protocol: 'boltzgen',
          project_type: 'vhh',
          status: 'completed',
          design_count_source: 'candidate_evidence',
          allowed_gpus: ['H100', 'L40S'],
          tested_designs: 0,
          accepted_designs: 0,
          num_designs: 10,
          total_runtime_seconds: 300,
          total_cost_usd: 0.95,
          control: {
            revision: 3,
            human_resume_required: false,
            stop_origin: 'system',
            stop_reason: 'target_reached',
            stopped_by: null,
            stopped_at: '2026-11-25T05:00:00Z',
          },
        });
      }
      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.boltzgenPassProject}/candidates`) {
        return reply(res, 200, [
          {
            id: 'bg-pass-1',
            native_id: 'vhh_pass_001',
            engine: 'boltzgen',
            rank: 1,
            selection: { selected: true, stage: 'final' },
            ranking_eligible: null,
            filters: [{ name: 'pass_filters', passed: true }],
            metrics: [
              { name: 'design_to_target_iptm', value: 0.78, unit: null },
              { name: 'design_plddt', value: 0.91, unit: null },
              { name: 'plddt', value: 89.5, unit: null },
              { name: 'filter_rmsd', value: 1.4, unit: null },
              { name: 'i_pae', value: 4.2, unit: null },
              { name: 'complex_ipde', value: 1.8, unit: null },
              { name: 'affinity_probability_binary', value: 0.64, unit: null },
            ],
            binder_sequences: ['QVQLVESGGGLVQAGGSLRLSCAAS'],
            structures: [{ path: 'final_designs/rank1_vhh_pass_001.cif', role: 'diversity_selected_complex' }],
          },
          {
            id: 'bg-pass-2',
            native_id: 'vhh_pass_002',
            engine: 'boltzgen',
            rank: 2,
            selection: { selected: true, stage: 'final' },
            ranking_eligible: null,
            filters: [{ name: 'pass_filters', passed: true }],
            metrics: [{ name: 'design_iptm', value: 0.72, unit: null }],
            binder_sequences: ['EVQLVESGGGLVQAGGSLRLSCAAS'],
            structures: [{ path: 'final_designs/rank2_vhh_pass_002.cif', role: 'diversity_selected_complex' }],
          },
        ], { engine: 'boltzgen', view: 'final', state: 'available', total: 2, next_cursor: null });
      }
      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.boltzgenPassProject}/storage`) {
        const isIdle = state.phase7RefreshPolls === 0 || state.phase7RefreshPolls >= 2;
        if (state.phase7RefreshPolls > 0 && state.phase7RefreshPolls < 2) state.phase7RefreshPolls += 1;
        return reply(res, 200, {
          project_id: IDS.boltzgenPassProject,
          name: 'boltzgen-pass-eval',
          status: 'completed',
          control: { revision: 3, human_resume_required: false },
          cleanup: { state: 'write_grants_pending', kind: 'managed', verification_not_before: '2026-11-25T06:00:00Z' },
          usage: {
            kind: 'managed',
            bytes: isIdle ? 512000 : 716800,
            object_count: 14,
            freshness: isIdle ? 'fresh' : 'stale',
            measured_at: '2026-11-25T05:10:00Z',
            pending_deletion_bytes: 204800,
            retained: { bytes: '512000', as_of: '2026-11-25T05:10:00Z', quality: 'measured' },
            refresh: { state: isIdle ? 'idle' : 'running', requested_at: '2026-11-25T05:09:58Z', reason: null },
          },
        });
      }
      if (req.method === 'POST' && p === `/api/v1/projects/${IDS.boltzgenPassProject}/storage/refresh`) {
        state.phase7RefreshPolls = 1;
        return reply(res, 202, {
          project_id: IDS.boltzgenPassProject,
          usage: {
            kind: 'managed',
            bytes: 716800,
            object_count: 14,
            freshness: 'stale',
            refresh: { state: 'pending', requested_at: '2026-11-25T05:09:58Z', reason: null },
          },
        });
      }
      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.boltzgenPassProject}/storage/cleanup-suggestions`) {
        return reply(res, 200, { project_id: IDS.boltzgenPassProject, state: 'ready', items: [] });
      }

      // Phase 7: Restart --wait falling back to paused
      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.pausedRestartProject}`) {
        return reply(res, 200, {
          id: IDS.pausedRestartProject,
          name: 'paused-restart-eval',
          protocol: 'boltzgen',
          project_type: 'vhh',
          status: 'paused',
          allowed_gpus: ['H100', 'L40S'],
          tested_designs: 0,
          accepted_designs: 0,
        });
      }
      if (req.method === 'POST' && p === `/api/v1/projects/${IDS.pausedRestartProject}/restart`) {
        return reply(res, 200, {
          project_id: IDS.pausedRestartProject,
          status: 'queued',
          job_id: 'dddddddd-1111-4111-8111-111111111111',
        });
      }

      // Phase 7: Forge project with sync_state=pending, durability_gap=false
      if (req.method === 'GET' && p === `/api/v1/forge/projects/${IDS.forgeSyncPendingProject}`) {
        return reply(res, 200, {
          project_id: IDS.forgeSyncPendingProject,
          name: 'eval-forge-sync-pending',
          status: 'running',
          active_session_id: IDS.forgeSessionPhase7,
          latest_session_id: IDS.forgeSessionPhase7,
          control: { revision: 1, human_resume_required: false },
          sessions: [{ session_id: IDS.forgeSessionPhase7, state: 'available', gpu_type: 'L40S', tools: [{ tool: 'base' }] }],
        });
      }
      if (req.method === 'GET' && p === `/api/v1/forge/projects/${IDS.forgeSyncPendingProject}/files/status`) {
        return reply(res, 200, {
          project_id: IDS.forgeSyncPendingProject,
          session_id: IDS.forgeSessionPhase7,
          writer_session_id: IDS.forgeSessionPhase7,
          session_state: 'available',
          hydration_state: 'ready',
          control_revision: 1,
          writer_epoch: 1,
          sync_state: 'pending',
          durability_gap: false,
          last_synced_at: '2026-11-25T05:00:00Z',
          runtime_observation: {
            synchronization: {
              pending_files: 3,
              pending_bytes: 1024,
              scratch_bytes: state.phase7ScratchBytes,
              warnings: state.phase7ScratchBytes === 0
                ? [{ code: 'scratch_data_not_saved', message: 'Stale scratch warning with zero bytes' }]
                : [],
            },
          },
        });
      }
      if (req.method === 'GET' && p === `/api/v1/forge/projects/${IDS.forgeSyncPendingProject}/files`) {
        return reply(res, 200, {
          mutation_revision: 1, sync_state: 'pending', durability_gap: false, last_synced_at: null, next_cursor: null, entries: [],
        });
      }
      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.forgeSyncPendingProject}/storage`) {
        return reply(res, 200, { project_id: IDS.forgeSyncPendingProject, usage: { bytes: 0, object_count: 0, freshness: 'fresh' } });
      }
      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.forgeSyncPendingProject}/storage/cleanup-suggestions`) {
        return reply(res, 200, { project_id: IDS.forgeSyncPendingProject, state: 'ready', items: [] });
      }

      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.timeoutProject}`) {
        // Hold open until client times out (never reply).
        res.setTimeout(60_000);
        return;
      }

      // BoltzGen project fixture for Phase 6 summary accounting & diagnostics gating
      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.boltzgenProject}`) {
        return reply(res, 200, {
          id: IDS.boltzgenProject,
          name: 'boltzgen-vhh-eval',
          protocol: 'boltzgen',
          project_type: 'vhh',
          status: 'completed',
          allowed_gpus: ['H100', 'L40S'],
          tested_designs: 0,
          accepted_designs: 0,
          num_designs: 10,
          total_runtime_seconds: null,
          total_cost_usd: null,
        });
      }
      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.boltzgenProject}/candidates`) {
        return reply(res, 200, [
          {
            id: 'bg-cand-1',
            native_id: 'vhh_001',
            engine: 'boltzgen',
            rank: 1,
            selection: { selected: true, stage: 'final' },
            ranking_eligible: null,
            filters: [{ name: 'pass_filters', passed: false }],
            metrics: [{ name: 'i_pTM', value: 0.62, unit: null }],
            binder_sequences: ['QVQLVESGGGLVQAGGSLRLSCAAS'],
            structures: [{ path: 'final_designs/rank1_vhh_001.cif', role: 'diversity_selected_complex' }],
          },
          {
            id: 'bg-cand-2',
            native_id: 'vhh_002',
            engine: 'boltzgen',
            rank: 2,
            selection: { selected: true, stage: 'final' },
            ranking_eligible: null,
            filters: [{ name: 'pass_filters', passed: false }],
            metrics: [{ name: 'i_pTM', value: 0.58, unit: null }],
            binder_sequences: ['EVQLVESGGGLVQAGGSLRLSCAAS'],
            structures: [{ path: 'final_designs/rank2_vhh_002.cif', role: 'diversity_selected_complex' }],
          },
        ], { engine: 'boltzgen', view: 'final', state: 'available', total: 2, next_cursor: null });
      }
      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.boltzgenProject}/storage`) {
        return reply(res, 200, {
          project_id: IDS.boltzgenProject,
          usage: { bytes: 1024, object_count: 1, freshness: 'stale' },
        });
      }
      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.boltzgenProject}/storage/cleanup-suggestions`) {
        return reply(res, 200, { project_id: IDS.boltzgenProject, state: 'ready', items: [] });
      }

      // Closed Forge project fixture for Phase 6 forge summary + recursive files
      if (req.method === 'GET' && p === `/api/v1/forge/projects/${IDS.forgeClosedProject}`) {
        return reply(res, 200, {
          project_id: IDS.forgeClosedProject,
          name: 'eval-forge-closed',
          status: 'completed',
          active_session_id: null,
          latest_session_id: IDS.forgeSessionClosed,
          control: { revision: 2, human_resume_required: false },
          sessions: [
            {
              session_id: IDS.forgeSessionClosed,
              state: 'closed',
              gpu_type: 'L40S',
              allocated_at: '2026-11-25T04:00:00Z',
              stopped_at: '2026-11-25T04:10:00Z',
              tools: [{ tool: 'base' }, { tool: 'boltz2' }],
            },
          ],
        });
      }
      if (req.method === 'GET' && p === `/api/v1/forge/projects/${IDS.forgeClosedProject}/files/status`) {
        return reply(res, 200, {
          project_id: IDS.forgeClosedProject,
          session_state: 'closed',
          sync_state: 'saved',
          durability_gap: false,
          last_synced_at: '2026-11-25T04:10:00Z',
        });
      }
      if (req.method === 'GET' && p === `/api/v1/forge/projects/${IDS.forgeClosedProject}/files`) {
        const dir = url.searchParams.get('path') || '/workspace';
        const baseMeta = { mutation_revision: 4, sync_state: 'saved', last_synced_at: '2026-11-25T04:10:00Z', durability_gap: false, next_cursor: null };
        if (dir === '/workspace') {
          return reply(res, 200, {
            ...baseMeta,
            entries: [
              { path: '/workspace/results', kind: 'directory', size_bytes: null, version: 1, mode: null },
              { path: '/workspace/summary.json', kind: 'file', size_bytes: 100, version: 1, mode: 0o644 },
            ],
          });
        }
        if (dir === '/workspace/results') {
          return reply(res, 200, {
            ...baseMeta,
            entries: [
              { path: '/workspace/results/top1.cif', kind: 'file', size_bytes: 250, version: 1, mode: 0o644 },
            ],
          });
        }
        if (dir === '/inputs') {
          return reply(res, 200, {
            ...baseMeta,
            entries: [
              { path: '/inputs/scripts', kind: 'directory', size_bytes: null, version: 1, mode: null },
            ],
          });
        }
        if (dir === '/inputs/scripts') {
          return reply(res, 200, {
            ...baseMeta,
            entries: [
              { path: '/inputs/scripts/run.py', kind: 'file', size_bytes: 900, version: 1, mode: 0o644 },
            ],
          });
        }
        return reply(res, 200, { ...baseMeta, entries: [] });
      }
      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.forgeClosedProject}/storage`) {
        return reply(res, 200, {
          project_id: IDS.forgeClosedProject,
          usage: { bytes: 1250, object_count: 3, freshness: 'fresh' },
        });
      }
      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.forgeClosedProject}/storage/cleanup-suggestions`) {
        return reply(res, 200, { project_id: IDS.forgeClosedProject, state: 'ready', items: [] });
      }

      // Forge sessions list with verbose tools[].capabilities to test client-side filters & compaction
      if (req.method === 'GET' && p === '/api/v1/forge/sessions') {
        return reply(res, 200, {
          sessions: [
            {
              session_id: IDS.forgeSessionPack,
              project_id: IDS.forgeProject,
              name: 'eval-forge-project',
              state: 'available',
              gpu_type: 'L40S',
              gpu_count: 1,
              tools: [
                { tool: 'base', state: 'ready', capabilities: { huge: 'blob' }, sources: [{ repo: 'x' }] },
                { tool: 'boltz2', state: 'ready', capabilities: { huge: 'blob' }, models: [{ id: 'm' }] },
              ],
            },
            {
              session_id: IDS.forgeSessionClosed,
              project_id: IDS.forgeClosedProject,
              name: 'other-closed-session',
              state: 'closed',
              gpu_type: 'H100',
              gpu_count: 1,
              tools: [{ tool: 'base', state: 'ready', capabilities: { huge: 'blob' } }],
            },
          ],
        });
      }

      // Storage deletions preview endpoint for Phase 6 multi-path & --suggested preview
      const previewMatch = /^\/api\/v1\/projects\/([0-9a-f-]{36})\/storage\/deletions\/preview$/.exec(p);
      if (req.method === 'GET' && previewMatch) {
        const targetPath = url.searchParams.get('path') || '';
        const rec = url.searchParams.get('recursive') === 'true';
        return reply(res, 200, {
          project_id: previewMatch[1],
          path: targetPath,
          recursive: rec,
          capability: { allowed: true, reason: null },
          observation: { bytes: 1024, object_count: 4, complete: true },
          control: { revision: 1 },
        });
      }

      const catTool = /^\/api\/v1\/forge\/catalog\/([^/]+)$/.exec(p);
      if (req.method === 'GET' && catTool) {
        const name = decodeURIComponent(catTool[1]);
        const found = state.catalog.find((t) => t.tool === name);
        if (!found) return replyError(res, 404, 'unknown_tool', `Unknown tool ${name}`);
        return reply(res, 200, { tool: found });
      }

      // Trigger deterministic exit-10 server error for feedback advisory eval
      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.serverErrorProject}`) {
        return replyError(res, 500, 'internal_error', 'Synthetic upstream failure for eval suite');
      }

      // Managed project fixture for summary handoff eval
      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.managedProject}`) {
        return reply(res, 200, {
          id: IDS.managedProject,
          name: 'pdl1-miniprotein-pilot',
          protocol: 'bindcraft2',
          status: 'completed',
          gpu_type: 'L40S',
          job_count: 1,
          total_runtime_seconds: 1420,
          total_cost_usd: 1.85,
          protocol_config: {
            modality: ['binder'],
            targets: [{ name: 'PD-L1', objective: 'bind', chains: ['A'] }],
            campaign: { num_designs: 5, max_trajectories: 40 },
          },
          bindcraft2_progress: {
            stage: 'completed',
            requested: 5,
            stop_reason: 'attempt_limit_reached',
            counts: { attempted: 40, trajectories: 38, refolded: 12, ranked: 3, accepted: 3 },
            rejections: { candidates_scored: 12, candidates_rejected: 9, terminated: {}, failed_filters: {} },
          },
        });
      }

      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.managedProject}/candidates`) {
        const seq1 = 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVVHSLAKWKRQQIAAALE';
        const seq2 = 'GSVLQLKQVAEELRKRGVEADKLVLELVDKTGKPVTVKVEGKEIEVTGDKLTLEELKAAIKKAGVEVTVKVDGKEITVEGLKAA';
        return reply(res, 200, [
          {
            id: 'cand-1',
            native_id: 'design_001',
            engine: 'bindcraft2',
            rank: 1,
            selection: { selected: true, stage: 'final' },
            ranking_eligible: true,
            ranking_reasons: [],
            filters: [{ name: 'pass_filters', passed: true }],
            metrics: [
              { name: 'i_pTM', value: 0.87, unit: null },
              { name: 'pLDDT', value: 0.92, unit: null },
              { name: 'i_pDAE', value: 0.84, unit: null },
            ],
            bindcraft2: { outcome: 'accepted', binder_sequences: [seq1], recorded_fields: { terminated: 'completed' } },
            structures: [{ path: 'accepted/design_001.cif', role: 'complex' }],
          },
          {
            id: 'cand-2',
            native_id: 'design_002',
            engine: 'bindcraft2',
            rank: 2,
            selection: { selected: true, stage: 'final' },
            ranking_eligible: true,
            ranking_reasons: [],
            filters: [{ name: 'pass_filters', passed: true }],
            metrics: [
              { name: 'i_pTM', value: 0.81, unit: null },
              { name: 'pLDDT', value: 0.89, unit: null },
            ],
            bindcraft2: { outcome: 'accepted', binder_sequences: [seq2], recorded_fields: { terminated: 'completed' } },
            structures: [{ path: 'accepted/design_002.cif', role: 'complex' }],
          },
        ], { engine: 'bindcraft2', view: 'final', state: 'available', total: 2, next_cursor: null });
      }

      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.managedProject}/storage`) {
        return reply(res, 200, {
          project_id: IDS.managedProject,
          usage: { bytes: 48_234_496, object_count: 34, freshness: 'fresh' },
        });
      }

      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.managedProject}/storage/cleanup-suggestions`) {
        return reply(res, 200, { project_id: IDS.managedProject, state: 'ready', items: [] });
      }

      // Forge storage suggest & summary fixtures
      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.forgeProject}/storage/cleanup-suggestions`) {
        return reply(res, 200, {
          project_id: IDS.forgeProject,
          state: 'ready',
          items: state.storageSuggestions,
        });
      }

      if (req.method === 'GET' && p === `/api/v1/projects/${IDS.forgeProject}/storage`) {
        return reply(res, 200, {
          project_id: IDS.forgeProject,
          usage: { bytes: 1_610_612_736, object_count: 4200, freshness: 'fresh' },
        });
      }

      if (req.method === 'GET' && p === `/api/v1/forge/projects/${IDS.forgeProject}`) {
        return reply(res, 200, {
          project_id: IDS.forgeProject,
          name: 'eval-forge-project',
          status: 'running',
          active_session_id: IDS.forgeSessionPack,
          latest_session_id: IDS.forgeSessionPack,
          control: { revision: 1, human_resume_required: false },
          sessions: [
            {
              session_id: IDS.forgeSessionPack,
              state: 'available',
              gpu_type: 'L40S',
              tools: [{ tool: 'base' }, { tool: 'boltz2' }],
            },
          ],
        });
      }

      if (req.method === 'GET' && p === `/api/v1/forge/projects/${IDS.forgeProject}/files`) {
        const dir = url.searchParams.get('path') || '/workspace';
        const baseMeta = { mutation_revision: 2, sync_state: 'saved', durability_gap: false, last_synced_at: '2026-11-25T05:00:00Z', next_cursor: null };
        if (dir === '/inputs') {
          return reply(res, 200, {
            ...baseMeta,
            entries: [
              { path: '/inputs/existing.py', kind: 'file', size_bytes: 128, version: 1, mode: 0o644 },
            ],
          });
        }
        if (dir === '/workspace') {
          return reply(res, 200, {
            ...baseMeta,
            entries: [{ path: '/workspace/boltz2-raw', kind: 'directory', size_bytes: null, version: 1, mode: null }],
          });
        }
        return reply(res, 200, { ...baseMeta, entries: [] });
      }
      if (req.method === 'GET' && p === `/api/v1/forge/projects/${IDS.forgeProject}/files/metadata`) {
        const target = url.searchParams.get('path') || '';
        if (target === '/inputs/existing.py') {
          return reply(res, 200, { kind: 'file', version: 1, mutation_revision: 2, size_bytes: 128 });
        }
        return reply(res, 200, { kind: 'absent', version: 0, mutation_revision: 2 });
      }

      // Forge sessions connect
      const connectMatch = /^\/api\/v1\/forge\/sessions\/([0-9a-f-]{36})\/connect$/.exec(p);
      if (req.method === 'POST' && connectMatch) {
        const sid = connectMatch[1];
        return reply(res, 200, {
          session_id: sid,
          project_id: IDS.forgeProject,
          endpoint: `https://${sid.replaceAll('-', '')}.forge.test`,
          access_token: 'eval-session-token',
          expires_at: new Date(Date.now() + 300_000).toISOString(),
          api_version: 1,
        });
      }

      // Forge session GET
      const sessMatch = /^\/api\/v1\/forge\/sessions\/([0-9a-f-]{36})$/.exec(p);
      if (req.method === 'GET' && sessMatch) {
        const sid = sessMatch[1];
        if (sid === IDS.forgeSessionPhase7) {
          state.phase7Queries.push(`GET ${p}${url.search}`);
          const ready = state.phase7InputReadyPolls === 0 || state.phase7InputReadyPolls >= 2;
          if (state.phase7InputReadyPolls > 0 && state.phase7InputReadyPolls < 2) state.phase7InputReadyPolls += 1;
          return reply(res, 200, {
            session_id: sid,
            project_id: IDS.forgeSyncPendingProject,
            name: 'eval-forge-phase7',
            state: ready ? 'available' : 'starting',
            gpu_type: 'L40S',
            gpu_count: 1,
            limit_revision: 1,
            applied_limit_revision: 1,
            tools: [
              { tool: 'base', state: ready ? 'ready' : 'installing', error: null, capabilities: { huge: 'strip-me' }, terms: ['x'], citations: ['y'], models: [{ id: 'm' }] },
              { tool: 'boltz2', state: 'ready', error: null, capabilities: { huge: 'strip-me' }, resources: { min_ram_gib: 32 } },
            ],
          });
        }
        return reply(res, 200, {
          session_id: sid,
          project_id: IDS.forgeProject,
          name: 'eval-forge-project',
          state: 'available',
          gpu_type: 'L40S',
          gpu_count: 1,
          tools: [{ tool: 'base', state: 'ready' }, { tool: 'boltz2', state: 'ready' }],
        });
      }

      // Phase 7: Forge session limit
      const limitMatch = /^\/api\/v1\/forge\/sessions\/([0-9a-f-]{36})\/limit$/.exec(p);
      if (req.method === 'POST' && limitMatch) {
        const sid = limitMatch[1];
        const body = await readJsonBody(req);
        state.phase7Queries.push(`POST ${p}${url.search}`);
        return reply(res, 200, {
          session_id: sid,
          project_id: IDS.forgeSyncPendingProject,
          state: 'available',
          max_gpu_hours: body.max_gpu_hours,
          limit_revision: (body.expected_limit_revision ?? 0) + 1,
          applied_limit_revision: (body.expected_limit_revision ?? 0) + 1,
          tools: [
            { tool: 'base', state: 'ready', error: null, capabilities: { huge: 'strip-me' }, terms: ['t'], citations: ['c'], models: [] },
          ],
        });
      }

      // Phase 7: Direct tools, commands, cancel, sync, inputs for forgeSessionPhase7
      const directTools = /^\/__direct\/([0-9a-f-]{36})\/v1\/tools$/.exec(p);
      if (directTools) {
        state.phase7Queries.push(`${req.method} /v1/tools${url.search}`);
        const verboseTools = [
          { tool: 'base', state: 'ready', error: null, capabilities: { huge: 'strip-me' }, terms: ['t'], citations: ['c'], sources: [], resources: {}, models: [] },
          { tool: 'boltz2', state: 'queued', error: null, capabilities: { huge: 'strip-me' }, qualification: [{ note: 'big' }] },
        ];
        if (req.method === 'GET') return reply(res, 200, { tools: verboseTools });
        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          return reply(res, 202, { selection_id: body.selection_id, tools: verboseTools });
        }
      }

      const directCmdList = /^\/__direct\/([0-9a-f-]{36})\/v1\/commands$/.exec(p);
      if (req.method === 'GET' && directCmdList) {
        state.phase7Queries.push(`GET /v1/commands${url.search}`);
        const longScript = `set -euo pipefail\n${'# padding '.repeat(700)}`;
        return reply(res, 200, {
          commands: [
            { command_id: IDS.forgeCancelCmd, tool: 'base', argv: ['bash', '-c', longScript], state: 'succeeded', exit_code: 0 },
          ],
        });
      }

      const directCmdCancel = /^\/__direct\/([0-9a-f-]{36})\/v1\/commands\/([0-9a-f-]{36})\/cancel$/.exec(p);
      if (req.method === 'POST' && directCmdCancel) {
        state.phase7CancelPolls = 1;
        return reply(res, 202, { command_id: directCmdCancel[2], tool: 'base', state: 'running', cancel_requested: true });
      }

      const directCmdGet = /^\/__direct\/([0-9a-f-]{36})\/v1\/commands\/([0-9a-f-]{36})$/.exec(p);
      if (req.method === 'GET' && directCmdGet) {
        const cid = directCmdGet[2];
        if (cid === IDS.forgeCancelCmd) {
          state.phase7CancelPolls += 1;
          const done = state.phase7CancelPolls >= 3;
          return reply(res, 200, { command_id: cid, tool: 'base', state: done ? 'cancelled' : 'running', cancel_requested: true });
        }
        const cmd = state.commands.get(cid);
        if (!cmd) return replyError(res, 404, 'not_found', 'Command not found');
        return reply(res, 200, cmd);
      }

      const directSyncPost = /^\/__direct\/([0-9a-f-]{36})\/v1\/sync$/.exec(p);
      if (req.method === 'POST' && directSyncPost) {
        const body = await readJsonBody(req);
        state.phase7SyncPolls = 1;
        return reply(res, 202, {
          sync_id: body.sync_id,
          state: 'pending',
          mutation_revision: 5,
          pending_files: 120,
          workspace_file_count: 250,
        });
      }

      const directSyncGet = /^\/__direct\/([0-9a-f-]{36})\/v1\/sync\/([0-9a-f-]{36})$/.exec(p);
      if (req.method === 'GET' && directSyncGet) {
        if (state.phase7SyncPolls === 0) {
          return replyError(res, 404, 'sync_not_found', 'Sync not yet created');
        }
        state.phase7SyncPolls += 1;
        if (state.phase7SyncPolls === 2) {
          return reply(res, 200, {
            sync_id: directSyncGet[2],
            state: 'pending',
            mutation_revision: 6,
            pending_files: 40,
            workspace_file_count: 250,
          });
        }
        return reply(res, 200, {
          sync_id: directSyncGet[2],
          state: 'saved',
          mutation_revision: 7,
          pending_files: 0,
          workspace_file_count: 250,
        });
      }

      const directInputsPost = /^\/__direct\/([0-9a-f-]{36})\/v1\/inputs$/.exec(p);
      if (req.method === 'POST' && directInputsPost) {
        const body = await readJsonBody(req);
        state.phase7InputSeenIds.push(body.input_id);
        if (state.phase7InputUnreadyOnce) {
          state.phase7InputUnreadyOnce = false;
          return replyError(res, 409, 'session_unready', 'Session base tool is still preparing');
        }
        return reply(res, 202, { input_id: body.input_id, path: body.path, state: 'ready', size_bytes: 12 });
      }

      const directInputsGetOne = /^\/__direct\/([0-9a-f-]{36})\/v1\/inputs\/([0-9a-f-]{36})$/.exec(p);
      if (req.method === 'GET' && directInputsGetOne) {
        return replyError(res, 404, 'not_found', 'Not yet created');
      }

      const directSessionGet = /^\/__direct\/([0-9a-f-]{36})\/v1\/session$/.exec(p);
      if (req.method === 'GET' && directSessionGet) {
        return reply(res, 200, {
          session_id: directSessionGet[1],
          project_id: IDS.forgeSyncPendingProject,
          state: 'available',
          tools: [{ tool: 'base', state: 'ready' }],
          synchronization: { mutation_revision: 5, pending_files: 120, workspace_file_count: 250, scratch_bytes: state.phase7ScratchBytes, warnings: [] },
        });
      }

      // Forge files/status (used by close guard, inputs add, and finish pre-check)
      if (req.method === 'GET' && p === `/api/v1/forge/projects/${IDS.forgeProject}/files/status`) {
        return reply(res, 200, {
          project_id: IDS.forgeProject,
          session_id: IDS.forgeSessionPack,
          writer_session_id: IDS.forgeSessionPack,
          session_state: 'available',
          hydration_state: 'ready',
          control_revision: 1,
          writer_epoch: 1,
          sync_state: 'pending',
          durability_gap: true,
          last_synced_at: null,
          runtime_observation: {
            synchronization: {
              pending_files: state.pendingFiles,
              pending_bytes: state.pendingBytes,
              warnings: [],
            },
          },
        });
      }

      // Forge session close (must NOT be called when close guard rejects!)
      const closeMatch = /^\/api\/v1\/forge\/sessions\/([0-9a-f-]{36})\/close$/.exec(p);
      if (req.method === 'POST' && closeMatch) {
        state.closePostCount += 1;
        return reply(res, 200, { session_id: closeMatch[1], state: 'closed' });
      }

      // Forge session finish
      const finishMatch = /^\/api\/v1\/forge\/sessions\/([0-9a-f-]{36})\/finish$/.exec(p);
      if (finishMatch) {
        const sid = finishMatch[1];
        if (req.method === 'GET') {
          const existing = state.finishOps.get(sid);
          if (!existing) return replyError(res, 404, 'finish_not_found', 'No finish op');
          return reply(res, 200, existing);
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          const op = {
            operation_id: body.operation_id,
            session_id: sid,
            phase: 'completed',
            execution: 'succeeded',
            drain: 'saved',
            durability: 'saved',
            release: 'released',
            termination: 'finished',
            selected_command_ids: [],
          };
          state.finishOps.set(sid, op);
          return reply(res, 200, op);
        }
      }

      // Direct session inputs list (empty live list to test remote /inputs merge)
      const directInputs = /^\/__direct\/([0-9a-f-]{36})\/v1\/inputs$/.exec(p);
      if (req.method === 'GET' && directInputs) {
        return reply(res, 200, { inputs: [] });
      }

      // Direct session commands (pack & remote exit 11)
      const directCmds = /^\/__direct\/([0-9a-f-]{36})\/v1\/commands$/.exec(p);
      if (req.method === 'POST' && directCmds) {
        const sid = directCmds[1];
        const body = await readJsonBody(req);
        const echoed = {
          command_id: body.command_id,
          session_id: sid,
          tool: body.tool,
          argv: body.argv,
          cwd: body.cwd,
          timeout_seconds: body.timeout_seconds,
          ...(body.gpu_ids !== undefined ? { gpu_ids: body.gpu_ids } : {}),
        };
        if (sid === IDS.forgeSessionPack) {
          state.capturedPackCommands.push(body);
          const cmd = {
            ...echoed,
            state: 'succeeded',
            exit_code: 0,
            output_tail: 'pack notice: zstd not found; falling back to tar.gz\n{"src":"/scratch/boltz2-batch","dest":"/workspace/archives/boltz2-batch.tar.gz","format":"tar.gz","sharded":false,"shards":[],"file_count":42,"uncompressed_bytes":1048576,"compressed_bytes":262144,"manifest_path":"/workspace/archives/boltz2-batch.tar.gz.manifest.json","removed_src":false}\n',
          };
          state.commands.set(body.command_id, cmd);
          return reply(res, 200, cmd);
        }
        if (sid === IDS.forgeSessionFail) {
          const cmd = {
            ...echoed,
            state: 'failed',
            exit_code: state.remoteExitCode,
          };
          state.commands.set(body.command_id, cmd);
          return reply(res, 200, cmd);
        }
      }

      const directLogs = /^\/__direct\/([0-9a-f-]{36})\/v1\/commands\/([0-9a-f-]{36})\/logs$/.exec(p);
      if (req.method === 'GET' && directLogs) {
        const sid = directLogs[1];
        const cid = directLogs[2];
        const cmd = state.commands.get(cid) ?? { command_id: cid, state: 'failed', exit_code: state.remoteExitCode };
        const text = sid === IDS.forgeSessionFail ? state.remoteLog : 'packed ok\n';
        return reply(res, 200, { command: cmd, text, next_cursor: 'end', gap: false });
      }

      return replyError(res, 404, 'not_found', `Unhandled eval route: ${req.method} ${p}`);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'fixture_error', message: err.message } }));
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    state,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function runV2Case(def, envCtx) {
  const { input, assertions, runner } = def;
  const { origin, serverState, tunnelEnv, tempRoot } = envCtx;
  const authBase = [
    '--base-url', origin,
    '--allow-custom-origin',
    '--root-dir', path.join(tempRoot, `root-${def.id}`),
  ];
  const authEnv = { ...tunnelEnv, ARIAX_API_KEY: IDS.apiKey };

  if (runner === 'discover_routing') {
    const res = await runCli([
      'discover',
      '--query', input.query,
      '--json',
      '--base-url', 'http://127.0.0.1:1',
      '--allow-custom-origin',
      '--timeout', '1000',
    ]);
    const payload = JSON.parse(res.stdout).data;
    assert.ok(
      assertions.recommended_execution_in.includes(payload.recommended_execution),
      `expected recommended_execution in ${JSON.stringify(assertions.recommended_execution_in)}, got "${payload.recommended_execution}"`,
    );
    if (assertions.top_managed_protocol) {
      assert.equal(
        payload.managed_protocols?.[0]?.id,
        assertions.top_managed_protocol,
        `expected top managed protocol "${assertions.top_managed_protocol}", got "${payload.managed_protocols?.[0]?.id}"`,
      );
    }
    if (assertions.top_forge_tool_in) {
      const topForge = payload.forge_tools?.[0]?.tool;
      assert.ok(
        assertions.top_forge_tool_in.includes(topForge),
        `expected top Forge tool in ${JSON.stringify(assertions.top_forge_tool_in)}, got "${topForge}"`,
      );
    }
    if (assertions.forge_tools_include_any) {
      const listed = new Set((payload.forge_tools || []).map((t) => t.tool));
      assert.ok(
        assertions.forge_tools_include_any.some((t) => listed.has(t)),
        `expected forge_tools to include one of ${JSON.stringify(assertions.forge_tools_include_any)}, got ${JSON.stringify([...listed])}`,
      );
    }
    assert.ok(res.bytes <= assertions.max_stdout_bytes, `stdout ${res.bytes} > ${assertions.max_stdout_bytes}`);
    return { measuredBytes: res.bytes, budgetBytes: assertions.max_stdout_bytes, detail: `exec=${payload.recommended_execution}` };
  }

  if (runner === 'budget_discover_skill') {
    const disc = await runCli([
      'discover',
      '--query', input.query,
      '--json',
      '--base-url', 'http://127.0.0.1:1',
      '--allow-custom-origin',
      '--timeout', '1000',
    ]);
    const skill = await runCli(['skills', input.skill_protocol, '--read', '--json']);
    const total = disc.bytes + skill.bytes;
    assert.ok(disc.bytes <= assertions.max_discover_bytes, `discover ${disc.bytes} > ${assertions.max_discover_bytes}`);
    assert.ok(skill.bytes <= assertions.max_skill_bytes, `skill ${skill.bytes} > ${assertions.max_skill_bytes}`);
    assert.ok(total <= assertions.max_total_bytes, `total ${total} > ${assertions.max_total_bytes}`);
    assert.ok(JSON.parse(skill.stdout).data.content.length > 0);
    return { measuredBytes: total, budgetBytes: assertions.max_total_bytes, detail: `discover=${disc.bytes}B + skill=${skill.bytes}B` };
  }

  if (runner === 'budget_forge_catalog') {
    const compact = await runCli(['forge', 'catalog', '--json', '--base-url', origin, '--allow-custom-origin']);
    assert.ok(compact.bytes <= assertions.max_compact_bytes, `compact catalog ${compact.bytes} > ${assertions.max_compact_bytes}`);
    const compactData = JSON.parse(compact.stdout).data;
    assert.ok(Array.isArray(compactData.tools) && compactData.tools.length >= 2);
    assert.ok(!compactData.tools.some((t) => t.tool === 'ipsae'), 'legacy tool should be hidden by default');

    const withGuide = await runCli([
      'forge', 'catalog', '--tool', input.tool, '--with-guide', '--json',
      '--base-url', origin, '--allow-custom-origin',
    ]);
    const wgData = JSON.parse(withGuide.stdout).data;
    assert.equal(wgData.tools?.length, 1, 'expected exactly 1 tool record');
    assert.equal(wgData.tools[0].tool, input.tool);
    assert.equal(wgData.guide_id, assertions.expected_guide_id);
    assert.ok(typeof wgData.guide_content === 'string' && wgData.guide_content.length > 200);
    return { measuredBytes: compact.bytes, budgetBytes: assertions.max_compact_bytes, detail: `compact=${compact.bytes}B, guide=${wgData.guide_size_bytes}B` };
  }

  if (runner === 'budget_summary_handoff') {
    const defRes = await runCli(['summary', IDS.managedProject, '--top', String(input.top), '--json', ...authBase], { env: authEnv });
    assert.ok(defRes.bytes <= assertions.max_default_summary_bytes, `summary ${defRes.bytes} > ${assertions.max_default_summary_bytes}`);
    const data = JSON.parse(defRes.stdout).data;
    assert.equal(data.kind, 'managed');
    assert.equal(data.project.id, IDS.managedProject);
    assert.equal(data.funnel.accepted, 3);
    assert.equal(data.top_candidates.length, 2);
    assert.equal(Object.hasOwn(data.top_candidates[0], 'sequences'), false, 'sequences must be omitted by default');
    assert.ok(Array.isArray(data.top_candidates[0].sequence_lengths) && data.top_candidates[0].sequence_lengths[0] > 60);
    assert.ok(typeof data.caveat === 'string' && data.caveat.includes('prioritization'));

    const seqRes = await runCli(['summary', IDS.managedProject, '--top', String(input.top), '--include-sequences', '--json', ...authBase], { env: authEnv });
    const seqData = JSON.parse(seqRes.stdout).data;
    assert.ok(Array.isArray(seqData.top_candidates[0].sequences) && seqData.top_candidates[0].sequences.length === 1);
    return { measuredBytes: defRes.bytes, budgetBytes: assertions.max_default_summary_bytes, detail: `default=${defRes.bytes}B, with_seq=${seqRes.bytes}B` };
  }

  if (runner === 'forge_hygiene_pack_finish') {
    serverState.capturedPackCommands.length = 0;
    serverState.pendingFiles = 0;
    serverState.pendingBytes = 0;
    const packRes = await runCli([
      'forge', 'pack', IDS.forgeSessionPack,
      '--src', input.src,
      '--dest', input.dest,
      '--wait', '--json',
      ...authBase,
    ], { env: authEnv });
    assert.equal(serverState.capturedPackCommands.length, 1, 'expected one pack command dispatched');
    const packPayload = JSON.parse(packRes.stdout).data;
    assert.equal(Object.hasOwn(packPayload, 'argv'), false, 'forge pack default --json should omit verbose inline argv');
    assert.equal(Object.hasOwn(packPayload, 'output_tail'), false, 'forge pack default --json should omit duplicate output_tail when pack parsed');
    assert.equal(packPayload.pack?.src, input.src);
    assert.equal(packPayload.pack?.requested_dest, input.dest);
    assert.equal(packPayload.pack?.actual_dest, '/workspace/archives/boltz2-batch.tar.gz');
    assert.equal(packPayload.pack?.format, 'tar.gz');
    assert.equal(packPayload.pack?.file_count, 42);
    assert.equal(packPayload.pack?.compressed_bytes, 262144);
    assert.match(packPayload.pack?.fallback_notice || '', /zstd not found/i);
    const argv = serverState.capturedPackCommands[0].argv;
    assert.equal(argv[0], 'bash');
    const script = argv[argv.length - 1];
    assert.match(script, /\/scratch\/\.ariax-pack-/);
    assert.match(script, /\/workspace\/archives\/boltz2-batch\.tar\.zst/);
    // Verify generated bash script syntax with `bash -n`
    const scriptFile = path.join(tempRoot, 'pack-check.sh');
    await fs.writeFile(scriptFile, script, 'utf8');
    await execFileAsync('bash', ['-n', scriptFile]);

    const finishRes = await runCli([
      'forge', 'finish', IDS.forgeSessionPack, '--wait', '--json',
      ...authBase,
    ], { env: authEnv });
    const finishData = JSON.parse(finishRes.stdout).data;
    assert.equal(finishData.phase, 'completed');
    assert.equal(finishData.release, 'released');
    assert.equal(finishData.durability, 'saved');
    return { measuredBytes: packRes.bytes + finishRes.bytes, budgetBytes: null, detail: 'bash -n ok, finish released+saved' };
  }

  if (runner === 'forge_hygiene_close_guard') {
    serverState.pendingFiles = input.pending_files;
    serverState.pendingBytes = input.pending_bytes;
    serverState.closePostCount = 0;
    const res = await runCli([
      'forge', 'close', IDS.forgeSessionClose, '--json',
      ...authBase,
    ], { env: authEnv, allowNonZero: true });
    assert.equal(res.code, assertions.expected_exit_code, `expected exit ${assertions.expected_exit_code}, got ${res.code}`);
    const errObj = JSON.parse(res.stdout).error;
    assert.equal(errObj.code, assertions.expected_error_code);
    assert.ok(errObj.action.includes(assertions.action_must_mention), `action missing "${assertions.action_must_mention}"`);
    assert.equal(serverState.closePostCount, 0, 'close guard must abort before POST /close');
    return { measuredBytes: res.bytes, budgetBytes: null, detail: `exit=${res.code} (${errObj.code})` };
  }

  if (runner === 'forge_hygiene_storage_suggest') {
    serverState.storageSuggestions = input.suggestions;
    const res = await runCli([
      'storage', 'suggest', IDS.forgeProject, '--json',
      ...authBase,
    ], { env: authEnv });
    const data = JSON.parse(res.stdout).data;
    assert.ok(Array.isArray(data.items) && data.items.length === 1);
    assert.equal(data.items[0].path, assertions.expected_path);
    assert.equal(data.items[0].suggestion, assertions.expected_suggestion);
    assert.equal(data.items[0].reason, assertions.expected_reason);
    assert.ok(res.bytes <= assertions.max_stdout_bytes);

    const summaryRes = await runCli([
      'forge', 'summary', IDS.forgeProject, '--json',
      ...authBase,
    ], { env: authEnv });
    const summaryData = JSON.parse(summaryRes.stdout).data;
    assert.equal(summaryData.kind, 'forge');
    assert.equal(summaryData.cleanup_suggestions[0]?.path, assertions.expected_path);
    const expectedSrcFlag = `--src ${assertions.expected_forge_summary_pack_src}`;
    const packAction = summaryData.next_actions.find((a) => (
      typeof a.command === 'string'
      && a.command.includes('ariax forge pack')
      && a.command.includes(expectedSrcFlag)
    ));
    assert.ok(
      packAction,
      `expected forge summary next_actions to normalize "${assertions.expected_path}" to "${expectedSrcFlag}", got: ${JSON.stringify(summaryData.next_actions)}`,
    );
    return {
      measuredBytes: res.bytes,
      budgetBytes: assertions.max_stdout_bytes,
      detail: `${data.items[0].suggestion}/${data.items[0].reason} -> ${expectedSrcFlag}`,
    };
  }

  if (runner === 'recovery_remote_exit_11') {
    serverState.remoteExitCode = input.remote_exit_code;
    serverState.remoteLog = input.remote_log;
    const res = await runCli([
      'forge', 'run', IDS.forgeSessionFail,
      '--tool', 'boltz2', '--wait', '--json',
      ...authBase,
      '--', 'python3', '-c', 'raise ValueError("invalid ligand atom index")',
    ], { env: authEnv, allowNonZero: true });
    assert.equal(res.code, assertions.expected_cli_exit_code, `expected exit ${assertions.expected_cli_exit_code}, got ${res.code}`);
    assert.notEqual(res.code, assertions.distinct_from_server_exit_code);
    assert.equal(EXIT.REMOTE_COMMAND, 11);
    assert.equal(EXIT.SERVER, 10);
    const errObj = JSON.parse(res.stdout).error;
    assert.equal(errObj.code, assertions.expected_error_code);
    assert.equal(errObj.details.exit_code, assertions.expected_remote_exit_code);
    assert.ok(String(errObj.details.output_tail).includes(assertions.output_tail_must_contain));
    return { measuredBytes: res.bytes, budgetBytes: null, detail: `cli_exit=11 remote_exit=${errObj.details.exit_code}` };
  }

  if (runner === 'feedback_redacted_dry_run') {
    const t = input.sensitive_tokens;
    const message = [
      `Key: ${t.api_key}`,
      `Token: ${t.jwt}`,
      `URL: ${t.signed_url}`,
      `Seq: ${t.sequence}`,
      t.pdb_block,
    ].join('\n');
    const res = await runCli([
      'feedback',
      '--type', input.type,
      '--summary', input.summary,
      '--message', message,
      '--dry-run',
      '--json',
    ], { env: { ARIAX_AUTO_FEEDBACK: '' } });
    const data = JSON.parse(res.stdout).data;
    assert.equal(data.dry_run, true);
    assert.equal(data.consent_mode, assertions.expected_consent_mode);
    assert.ok(data.redactions_applied >= assertions.min_redactions_applied, `expected >=${assertions.min_redactions_applied} redactions, got ${data.redactions_applied}`);
    const serialized = JSON.stringify(data.payload);
    for (const [label, secret] of Object.entries(t)) {
      const needle = label === 'pdb_block' ? 'ATOM      1  N   MET' : secret;
      assert.ok(!serialized.includes(needle), `dry-run payload leaked sensitive ${label}`);
    }
    return { measuredBytes: res.bytes, budgetBytes: null, detail: `consent=${data.consent_mode}, redactions=${data.redactions_applied}` };
  }

  if (runner === 'feedback_opportunity_advisory') {
    const agentRoot = path.join(tempRoot, 'root-advisory-agent');
    const humanRoot = path.join(tempRoot, 'root-advisory-human');
    const agentEnv = {
      ...authEnv,
      ARIAX_AUTO_FEEDBACK: '',
      [input.agent_env_var]: input.agent_env_val,
    };

    const parseNotices = (stderr) => stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{'))
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter((obj) => obj?.notice?.code === assertions.expected_notice_code);

    const run1 = await runCli(
      ['status', IDS.serverErrorProject, '--json', '--base-url', origin, '--allow-custom-origin', '--root-dir', agentRoot],
      { env: agentEnv, allowNonZero: true },
    );
    assert.equal(run1.code, assertions.expected_exit_code);
    const notices1 = parseNotices(run1.stderr);
    assert.equal(notices1.length, 1, `expected 1 feedback_opportunity notice on first exit-10, got ${notices1.length}`);
    assert.equal(notices1[0].notice.reason, assertions.expected_notice_reason);

    const run2 = await runCli(
      ['status', IDS.serverErrorProject, '--json', '--base-url', origin, '--allow-custom-origin', '--root-dir', agentRoot],
      { env: agentEnv, allowNonZero: true },
    );
    assert.equal(run2.code, assertions.expected_exit_code);
    const notices2 = parseNotices(run2.stderr);
    assert.equal(notices2.length, 0, 'duplicate feedback_opportunity must be suppressed within cooldown');

    const humanRun = await runCli(
      ['status', IDS.serverErrorProject, '--json', '--base-url', origin, '--allow-custom-origin', '--root-dir', humanRoot],
      { env: { ...authEnv, ...CLEARED_AGENT_ENV, ARIAX_AUTO_FEEDBACK: '' }, allowNonZero: true },
    );
    assert.equal(humanRun.code, assertions.expected_exit_code);
    const humanNotices = parseNotices(humanRun.stderr);
    assert.equal(humanNotices.length, 0, 'human shell must not emit feedback_opportunity notice');

    return { measuredBytes: run1.bytes, budgetBytes: null, detail: 'emitted=1, cooldown=suppressed, human=silent' };
  }

  throw new Error(`Unsupported runner: ${runner}`);
}

async function runPhase6Checks(envCtx) {
  const { origin, serverState, tunnelEnv, tempRoot } = envCtx;
  const authBase = ['--base-url', origin, '--allow-custom-origin', '--root-dir', path.join(tempRoot, 'root-phase6')];
  const authEnv = { ...tunnelEnv, ARIAX_API_KEY: IDS.apiKey };
  const checks = [];

  const runCheck = async (name, fn) => {
    try {
      const detail = await fn();
      checks.push({ id: name, category: 'phase6_polish', status: 'PASS', measured: '-', budget: '-', detail: detail || 'ok' });
    } catch (err) {
      checks.push({ id: name, category: 'phase6_polish', status: 'FAIL', measured: '-', budget: '-', detail: err.message });
    }
  };

  // 1. Sandbox EPERM/EACCES fallback for state dir & Forge connection cache + explicit --connection-cache-dir
  await runCheck('phase6-sandbox-eperm-fallback', async () => {
    const roHome = path.join(tempRoot, 'readonly-home');
    await fs.mkdir(roHome, { recursive: true, mode: 0o700 });
    if (process.platform === 'darwin') {
      await fs.mkdir(path.join(roHome, 'Library', 'Application Support'), { recursive: true, mode: 0o700 });
      await fs.chmod(path.join(roHome, 'Library', 'Application Support'), 0o555);
    } else {
      await fs.chmod(roHome, 0o555);
    }
    try {
      const sandboxEnv = {
        ...authEnv,
        HOME: roHome,
        ARIAX_FIXTURE_USER_DIR: roHome,
        XDG_STATE_HOME: path.join(roHome, 'state'),
        XDG_CONFIG_HOME: path.join(roHome, 'config'),
      };
      // Trigger both default state dir fallback (no --root-dir) AND Forge connection cache fallback!
      const res = await runCli([
        'forge', 'inputs', 'list', IDS.forgeSessionPack, '--json',
        '--base-url', origin, '--allow-custom-origin',
      ], { env: sandboxEnv });
      const data = JSON.parse(res.stdout).data;
      assert.ok(Array.isArray(data.inputs) && data.inputs.some((i) => i.path === 'existing.py'));

      // Explicit --connection-cache-dir works outside rootDir and rejects inside rootDir
      const explicitRoot = path.join(tempRoot, 'explicit-root');
      const explicitCache = path.join(tempRoot, 'explicit-conn-cache');
      await runCli([
        'forge', 'inputs', 'list', IDS.forgeSessionPack, '--json',
        '--base-url', origin, '--allow-custom-origin',
        '--root-dir', explicitRoot,
        '--connection-cache-dir', explicitCache,
      ], { env: authEnv });
      const badCache = await runCli([
        'forge', 'inputs', 'list', IDS.forgeSessionPack, '--json',
        '--base-url', origin, '--allow-custom-origin',
        '--root-dir', explicitRoot,
        '--connection-cache-dir', path.join(explicitRoot, 'nested-cache'),
      ], { env: authEnv, allowNonZero: true });
      assert.equal(badCache.code, EXIT.USAGE, 'connection-cache-dir inside rootDir must be rejected');
      return 'state+conn fallback ok, explicit cache validated';
    } finally {
      if (process.platform === 'darwin') {
        await fs.chmod(path.join(roHome, 'Library', 'Application Support'), 0o700).catch(() => {});
      } else {
        await fs.chmod(roHome, 0o700).catch(() => {});
      }
    }
  });

  // 2. validate --json stdout purity, preparation_notes, resolved_binding_rules, and --details valid boolean
  await runCheck('phase6-validate-json-purity', async () => {
    const offsetPdb = path.join(tempRoot, 'offset-target.pdb');
    const lines = [
      'ATOM      1  CA  ALA A  17       0.000   0.000   0.000  1.00 20.00           C',
      'ATOM      2  CA  CYS A  18       3.800   0.000   0.000  1.00 20.00           C',
      'ATOM      3  CA  ASP A  19       7.600   0.000   0.000  1.00 20.00           C',
      'END',
    ].join('\n') + '\n';
    await fs.writeFile(offsetPdb, lines, 'utf8');
    const jobFile = path.join(tempRoot, 'boltzgen-offset.json');
    await fs.writeFile(jobFile, JSON.stringify({
      protocol: 'boltzgen',
      project_type: 'vhh',
      num_designs: 2,
      budget: 2,
      chains: 'A',
      allowed_gpus: ['H100', 'L40S'],
      binding_rules: [{ id: 'A', binding: '1,3' }],
    }), 'utf8');

    const compactRes = await runCli(['validate', '-f', jobFile, '--input', offsetPdb, '--json', ...authBase], { env: authEnv });
    assert.ok(!compactRes.stderr.includes('author residue 17 maps to canonical 1'), `validate --json leaked note to stderr: ${compactRes.stderr}`);
    const compactData = JSON.parse(compactRes.stdout).data;
    assert.equal(compactData.valid, true);
    assert.ok(compactData.preparation_notes.some((m) => m.includes('author residue 17 maps to canonical 1')));
    assert.deepEqual(compactData.resolved_binding_rules, [
      { chain: 'A', canonical_position: 1, author_residue: 17, amino_acid: 'A' },
      { chain: 'A', canonical_position: 3, author_residue: 19, amino_acid: 'D' },
    ]);

    const detailsRes = await runCli(['validate', '-f', jobFile, '--input', offsetPdb, '--details', '--json', ...authBase], { env: authEnv });
    const detailsData = JSON.parse(detailsRes.stdout).data;
    assert.equal(detailsData.valid, true);
    assert.ok(detailsData.preparation_notes.some((m) => m.includes('author residue 17 maps to canonical 1')));
    assert.equal(detailsData.resolved_binding_rules?.length, 2);
    return 'stderr clean, preparation_notes + resolved_binding_rules verified';
  });

  // 3. Managed BoltzGen summary accounting, funnel fix, storage_stale_hint, and diagnostics gating + Forge summary separation
  await runCheck('phase6-summary-accounting', async () => {
    const bgRes = await runCli(['summary', IDS.boltzgenProject, '--json', ...authBase], { env: authEnv });
    const bg = JSON.parse(bgRes.stdout).data;
    assert.deepEqual(bg.resources.gpus, ['H100'], 'must report executed GPU from jobs allocations, not allowed_gpus');
    assert.equal(bg.resources.total_runtime_seconds, 420);
    assert.equal(bg.resources.total_cost_usd, 1.35);
    assert.equal(bg.funnel.attempted, 2);
    assert.equal(bg.funnel.evaluated, 2);
    assert.equal(bg.funnel.count_source, 'candidate_evidence');
    assert.ok(bg.warnings.some((w) => w.code === 'storage_stale_hint'), 'must emit storage_stale_hint when completed object_count<=1');
    assert.ok(!bg.next_actions.some((a) => a.command.includes('--view diagnostics')), 'BoltzGen must never emit --view diagnostics');

    const fgRes = await runCli(['forge', 'summary', IDS.forgeClosedProject, '--json', ...authBase], { env: authEnv });
    const fg = JSON.parse(fgRes.stdout).data;
    assert.equal(fg.compute_active, false);
    assert.equal(fg.sessions.compute_active, false);
    assert.equal(fg.sessions.total_runtime_seconds, 600);
    assert.equal(fg.sessions.total_cost_usd, 0.75);
    assert.equal(fg.workspace.file_count, 2);
    assert.equal(fg.workspace.total_bytes, 350);
    assert.equal(fg.workspace.inputs_file_count, 1);
    assert.equal(fg.workspace.inputs_bytes, 900);
    assert.equal(fg.workspace.catalog_object_count, 3);
    assert.equal(fg.workspace.catalog_bytes, 1250);
    return 'managed BoltzGen + Forge workspace/inputs/accounting verified';
  });

  // 4. Forge list filters + compact projection, forge project by name, recursive files, inputs list remote merge, input_exists guidance, catalog unknown task hint
  await runCheck('phase6-forge-ergonomics', async () => {
    const listRes = await runCli([
      'forge', 'list', '--active', '--state', 'available', '--name', 'eval',
      '--project', IDS.forgeProject, '--limit', '1', '--json', ...authBase,
    ], { env: authEnv });
    const sessions = JSON.parse(listRes.stdout).data.sessions;
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].session_id, IDS.forgeSessionPack);
    assert.equal(Object.hasOwn(sessions[0].tools[0], 'capabilities'), false, 'default forge list must compact tools[]');

    const projByName = await runCli(['forge', 'project', 'eval-forge-project', '--json', ...authBase], { env: authEnv });
    assert.equal(JSON.parse(projByName.stdout).data.project_id, IDS.forgeProject);

    const recFiles = await runCli(['forge', 'files', IDS.forgeClosedProject, '--path', '/workspace', '--recursive', '--json', ...authBase], { env: authEnv });
    const rfData = JSON.parse(recFiles.stdout).data;
    assert.equal(rfData.recursive, true);
    assert.equal(rfData.file_count, 2);
    assert.equal(rfData.total_bytes, 350);
    assert.equal(rfData.truncated, false);

    // input_exists conflict guidance on forge inputs add
    const tmpScript = path.join(tempRoot, 'existing.py');
    await fs.writeFile(tmpScript, 'print(1)\n', 'utf8');
    const conflictRes = await runCli([
      'forge', 'inputs', 'add', IDS.forgeSessionPack,
      '--file', tmpScript, '--path', 'existing.py', '--json', ...authBase,
    ], { env: authEnv, allowNonZero: true });
    assert.equal(conflictRes.code, EXIT.CONFLICT);
    const conflictErr = JSON.parse(conflictRes.stdout).error;
    assert.equal(conflictErr.code, 'input_exists');
    assert.match(conflictErr.action, /immutable.*new --path/i);

    const badTask = await runCli(['forge', 'catalog', '--task', 'nonexistent-task', '--json', '--base-url', origin, '--allow-custom-origin']);
    const badTaskBody = JSON.parse(badTask.stdout);
    assert.equal(badTaskBody.data.tools.length, 0);
    assert.ok(Array.isArray(badTaskBody.meta?.available_tasks) && badTaskBody.meta.available_tasks.includes('molecular-prediction'));
    return 'list/project/recursive/input_exists/catalog-task verified';
  });

  // 5. Pricing inactive promo omission + filters; Storage suggest & multi-path/--suggested preview
  await runCheck('phase6-pricing-storage-timeout', async () => {
    const prDef = JSON.parse((await runCli(['pricing', '--json', '--base-url', origin, '--allow-custom-origin'])).stdout).data;
    assert.equal(Object.hasOwn(prDef.promotion, 'rates'), false, 'inactive promotion.rates must be omitted by default');
    const prDet = JSON.parse((await runCli(['pricing', '--details', '--json', '--base-url', origin, '--allow-custom-origin'])).stdout).data;
    assert.ok(Array.isArray(prDet.promotion.rates) && prDet.promotion.rates.length === 1);
    const prFilt = JSON.parse((await runCli(['pricing', '--gpu', 'H100', '--gpu-count', '2', '--json', '--base-url', origin, '--allow-custom-origin'])).stdout).data;
    assert.equal(prFilt.rates.length, 1);
    assert.equal(prFilt.rates[0].gpu_id, 'H100');
    assert.equal(prFilt.rates[0].gpu_count, 2);

    serverState.storageSuggestions = [
      { path: '/workspace/raw-a', kind: 'directory', file_count: 50, bytes: 2048, suggestion: 'pack_archive', reason: 'high_small_file_count' },
      { path: '/workspace/raw-b', kind: 'directory', file_count: 10, bytes: 1024, suggestion: 'delete', reason: 'redundant' },
    ];
    const sug = JSON.parse((await runCli(['storage', 'suggest', IDS.forgeProject, '--json', ...authBase], { env: authEnv })).stdout).data;
    assert.equal(sug.total_reclaimable_bytes, 3072);
    assert.equal(sug.items[0].object_count, 50);
    assert.equal(sug.items[0].recursive, true);

    const prevSug = JSON.parse((await runCli(['storage', 'delete', IDS.forgeProject, '--suggested', '--preview', '--json', ...authBase], { env: authEnv })).stdout).data;
    assert.equal(prevSug.suggested, true);
    assert.equal(prevSug.previews.length, 2);
    assert.equal(prevSug.total_bytes, 2048);

    const prevMulti = JSON.parse((await runCli(['storage', 'delete', IDS.forgeProject, '--path', '/workspace/a', '--path', '/workspace/b', '--preview', '--json', ...authBase], { env: authEnv })).stdout).data;
    assert.equal(prevMulti.previews.length, 2);

    const noBypass = await runCli(['storage', 'delete', IDS.forgeProject, '--suggested', '--json', ...authBase], { env: authEnv, allowNonZero: true });
    assert.equal(noBypass.code, EXIT.USAGE, 'storage delete --suggested without --preview must be rejected');

    // Timeout vs network error differentiation
    const timeoutRes = await runCli(['status', IDS.timeoutProject, '--timeout', '60', '--json', ...authBase], { env: authEnv, allowNonZero: true });
    assert.equal(timeoutRes.code, EXIT.NETWORK);
    assert.equal(JSON.parse(timeoutRes.stdout).error.code, 'server_timeout');
    const refuseRes = await runCli(['me', '--json', '--base-url', 'http://127.0.0.1:1', '--allow-custom-origin', '--timeout', '1000'], { env: authEnv, allowNonZero: true });
    assert.equal(refuseRes.code, EXIT.NETWORK);
    assert.equal(JSON.parse(refuseRes.stdout).error.code, 'network_error');

    return 'pricing, storage suggest/preview, and timeout vs network verified';
  });

  return checks;
}

async function runPhase7Checks(envCtx) {
  const { origin, serverState, tunnelEnv, tempRoot } = envCtx;
  const authBase = ['--base-url', origin, '--allow-custom-origin', '--root-dir', path.join(tempRoot, 'root-phase7')];
  const authEnv = { ...tunnelEnv, ARIAX_API_KEY: IDS.apiKey };
  const checks = [];

  const runCheck = async (name, fn) => {
    try {
      const detail = await fn();
      checks.push({ id: name, category: 'phase7_p0_p1', status: 'PASS', measured: '-', budget: '-', detail: detail || 'ok' });
    } catch (err) {
      checks.push({ id: name, category: 'phase7_p0_p1', status: 'FAIL', measured: '-', budget: '-', detail: err.message });
    }
  };

  // 1. P0 #1 + P1 #9 + P1 #10: BoltzGen funnel, zero_accepted_pilot gating, key_metrics[].scale, retained_bytes, status control
  await runCheck('phase7-boltzgen-funnel-scales-control', async () => {
    const sumRes = await runCli(['summary', IDS.boltzgenPassProject, '--json', ...authBase], { env: authEnv });
    const sum = JSON.parse(sumRes.stdout).data;
    assert.equal(sum.funnel.passed_filters, 2, 'passed_filters must count native_filter_pass===true candidates');
    assert.equal(sum.funnel.accepted, null, 'accepted must remain null when ranking.eligible is null across candidates');
    assert.ok(!sum.warnings.some((w) => w.code === 'zero_accepted_pilot'), 'zero_accepted_pilot must be suppressed when passed_filters>0 and accepted===null');
    assert.equal(sum.resources.retained_bytes, 512000, 'retained_bytes must coerce decimal string');
    assert.equal(sum.resources.pending_deletion_bytes, 204800, 'pending_deletion_bytes must be exposed when > 0');
    const scales = Object.fromEntries(sum.top_candidates[0].key_metrics.map((m) => [m.name, m.scale]));
    assert.equal(scales.design_to_target_iptm, '0..1');
    assert.equal(scales.design_plddt, '0..1');
    assert.equal(scales.plddt, '0..100');
    assert.equal(scales.filter_rmsd, 'Å');
    assert.equal(scales.i_pae, 'Å');

    const failSum = JSON.parse((await runCli(['summary', IDS.boltzgenProject, '--json', ...authBase], { env: authEnv })).stdout).data;
    assert.equal(failSum.funnel.passed_filters, 0);
    assert.ok(failSum.warnings.some((w) => w.code === 'zero_accepted_pilot'), 'zero_accepted_pilot must still fire when all evaluated candidates failed filters');

    const stCompact = JSON.parse((await runCli(['status', IDS.boltzgenPassProject, '--json', ...authBase], { env: authEnv })).stdout).data;
    assert.notEqual(stCompact.scientific_outcome?.code, 'completed_no_accepted_designs');
    assert.equal(stCompact.designs?.accepted, null);
    assert.deepEqual(stCompact.control, { revision: 3, human_resume_required: false, stop_reason: 'target_reached' });

    const stDetails = JSON.parse((await runCli(['status', IDS.boltzgenPassProject, '--details', '--json', ...authBase], { env: authEnv })).stdout).data;
    assert.equal(stDetails.control?.stop_origin, 'system');

    const cand = JSON.parse((await runCli(['candidates', IDS.boltzgenPassProject, '--json', ...authBase], { env: authEnv })).stdout).data;
    const candScales = Object.fromEntries(cand[0].metrics.map((m) => [m.name, m.scale]));
    assert.equal(candScales.complex_ipde, 'Å');
    assert.equal(candScales.affinity_probability_binary, '0..1');
    return 'funnel/scales/retained_bytes/control verified';
  });

  // 2. P0 #2 + P0 #3: restart --wait non-zero on paused fallback + inline job reason; --fields data. prefix
  await runCheck('phase7-restart-wait-and-fields-prefix', async () => {
    const res = await runCli([
      'restart', IDS.pausedRestartProject, '--wait', '--poll-interval', '1', '--json', ...authBase,
    ], { env: authEnv, allowNonZero: true });
    assert.notEqual(res.code, 0, 'restart --wait falling back to paused must exit non-zero');
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.error?.code, 'gpu_provisioning_delayed');
    assert.equal(parsed.error?.details?.failure_reason, 'gpu_provisioning_delayed');
    assert.equal(parsed.error?.details?.latest_job?.error_code, 'gpu_provisioning_delayed');
    assert.equal(parsed.error?.details?.lifecycle?.terminal, false);

    const fWithData = JSON.parse((await runCli([
      'status', IDS.boltzgenPassProject, '--json', '--fields', 'data.project_id,data.control.revision', ...authBase,
    ], { env: authEnv })).stdout);
    const fBare = JSON.parse((await runCli([
      'status', IDS.boltzgenPassProject, '--json', '--fields', 'project_id,control.revision', ...authBase,
    ], { env: authEnv })).stdout);
    assert.deepEqual(fWithData, fBare, '--fields with leading data. must match bare --fields');
    assert.equal(fWithData.data?.project_id, IDS.boltzgenPassProject);
    assert.equal(fWithData.data?.control?.revision, 3);
    return `restart exit=${res.code} (${parsed.error.code}), --fields data. normalized`;
  });

  // 3. P0 #4 + P1 #7 + P1 #8 + P1 #14: lean payloads, scratch hygiene, cancel --wait, pack output_tail, sync_pending
  await runCheck('phase7-forge-lean-cancel-hygiene', async () => {
    serverState.phase7Queries.length = 0;

    const limRes = JSON.parse((await runCli(['forge', 'limit', IDS.forgeSessionPhase7, '--gpu-hours', '2', '--json', ...authBase], { env: authEnv })).stdout).data;
    assert.equal(Object.hasOwn(limRes.tools[0], 'capabilities'), false, 'forge limit default must compact tools');

    const toolsAdd = JSON.parse((await runCli(['forge', 'tools', 'add', IDS.forgeSessionPhase7, '--tools', 'boltz2', '--json', ...authBase], { env: authEnv })).stdout).data;
    assert.equal(Object.hasOwn(toolsAdd.tools[0], 'capabilities'), false, 'forge tools add default must compact tools');

    const toolsList = JSON.parse((await runCli(['forge', 'tools', IDS.forgeSessionPhase7, '--json', ...authBase], { env: authEnv })).stdout).data;
    assert.equal(Object.hasOwn(toolsList.tools[0], 'capabilities'), false, 'forge tools default must compact tools');

    const cmdsSummary = JSON.parse((await runCli(['forge', 'commands', IDS.forgeSessionPhase7, '--json', ...authBase], { env: authEnv })).stdout).data;
    assert.match(cmdsSummary.commands[0].argv[2], /<truncated \d+ chars; pass --details for full argv>/);

    const cmdsFull = JSON.parse((await runCli(['forge', 'commands', IDS.forgeSessionPhase7, '--details', '--json', ...authBase], { env: authEnv })).stdout).data;
    assert.ok(cmdsFull.commands[0].argv[2].length > 5000, 'forge commands --details must retain full argv');

    assert.ok(serverState.phase7Queries.some((q) => q.includes('/limit?view=summary')), 'forge limit must send ?view=summary');
    assert.ok(serverState.phase7Queries.some((q) => q === 'POST /v1/tools?view=summary'), 'forge tools add must send ?view=summary');
    assert.ok(serverState.phase7Queries.some((q) => q === 'GET /v1/tools?view=summary'), 'forge tools must send ?view=summary');
    assert.ok(serverState.phase7Queries.some((q) => q === 'GET /v1/commands?view=summary'), 'forge commands must send ?view=summary');
    assert.ok(serverState.phase7Queries.some((q) => q === 'GET /v1/commands?view=full'), 'forge commands --details must send ?view=full');

    // forge cancel --wait
    const cancelRes = JSON.parse((await runCli([
      'forge', 'cancel', IDS.forgeSessionPhase7, IDS.forgeCancelCmd, '--wait', '--wait-timeout', '15', '--json', ...authBase,
    ], { env: authEnv })).stdout).data;
    assert.equal(cancelRes.state, 'cancelled');

    // forge summary: sync_state=pending + durability_gap=false -> sync_pending (never durability_gap)
    serverState.phase7ScratchBytes = 0;
    const fgSum = JSON.parse((await runCli(['forge', 'summary', IDS.forgeSyncPendingProject, '--json', ...authBase], { env: authEnv })).stdout).data;
    assert.ok(fgSum.warnings.some((w) => w.code === 'sync_pending'), 'must emit sync_pending when durability_gap=false');
    assert.ok(!fgSum.warnings.some((w) => w.code === 'durability_gap'), 'must NOT emit durability_gap when durability_gap=false');
    assert.ok(!fgSum.warnings.some((w) => w.code === 'scratch_data_not_saved'), 'must NOT emit scratch_data_not_saved when scratch_bytes=0');

    // forge finish scratch notice suppression when scratch_bytes=0 vs emission when >0
    const finZero = await runCli(['forge', 'finish', IDS.forgeSessionPhase7, '--wait', '--json', ...authBase], { env: authEnv });
    assert.ok(!finZero.stderr.includes('scratch_data_not_saved'), 'finish must suppress scratch_data_not_saved when scratch_bytes=0');
    serverState.phase7ScratchBytes = 8192;
    serverState.finishOps.delete(IDS.forgeSessionPhase7);
    const finNonZero = await runCli(['forge', 'finish', IDS.forgeSessionPhase7, '--wait', '--json', ...authBase], { env: authEnv });
    assert.ok(finNonZero.stderr.includes('scratch_data_not_saved'), 'finish must emit scratch_data_not_saved when scratch_bytes>0');
    assert.ok(finNonZero.stderr.includes('/workspace/archives/'), 'scratch notice must mention /workspace/archives/');

    // forge pack --details retains output_tail
    const packDet = JSON.parse((await runCli([
      'forge', 'pack', IDS.forgeSessionPack, '--src', '/scratch/boltz2-batch', '--dest', '/workspace/archives/boltz2-batch.tar.zst',
      '--wait', '--details', '--json', ...authBase,
    ], { env: authEnv })).stdout).data;
    assert.ok(typeof packDet.output_tail === 'string' && packDet.output_tail.length > 0, 'forge pack --details must keep output_tail');
    return 'lean views, cancel --wait, scratch hygiene, sync_pending verified';
  });

  // 4. P1 #6 + P1 #13: forge sync --wait live stderr progress + forge inputs add --wait-ready idempotent retry
  await runCheck('phase7-forge-sync-progress-and-inputs-wait-ready', async () => {
    const syncRes = await runCli([
      'forge', 'sync', IDS.forgeSessionPhase7, '--wait', '--wait-timeout', '20', '--json', ...authBase,
    ], { env: authEnv });
    const syncData = JSON.parse(syncRes.stdout).data;
    assert.equal(syncData.state, 'saved');
    assert.match(syncRes.stderr, /mutation_revision=6/, 'sync --wait stderr must report mutation_revision');
    assert.match(syncRes.stderr, /pending_files=40/, 'sync --wait stderr must report pending_files');
    assert.match(syncRes.stderr, /workspace_file_count=250/, 'sync --wait stderr must report workspace_file_count');

    serverState.phase7InputReadyPolls = 1;
    serverState.phase7InputUnreadyOnce = true;
    serverState.phase7InputSeenIds.length = 0;
    const fixedInputId = 'eeeeeeee-1111-4111-8111-111111111111';
    const inputRes = await runCli([
      'forge', 'inputs', 'add', IDS.forgeSessionPhase7,
      '--url', 'https://example.org/target.cif',
      '--path', 'targets/wait-ready.cif',
      '--input-id', fixedInputId,
      '--wait-ready', '--wait-timeout', '20', '--json', ...authBase,
    ], { env: authEnv });
    const inputData = JSON.parse(inputRes.stdout).data;
    assert.equal(inputData.input_id, fixedInputId);
    assert.equal(inputData.state, 'ready');
    assert.deepEqual(serverState.phase7InputSeenIds, [fixedInputId, fixedInputId], 'inputs add --wait-ready must retry with identical input_id');
    return 'sync progress + inputs --wait-ready idempotent retry verified';
  });

  // 5. P1 #9 + P1 #11 + P1 #12: storage --refresh --wait, origin-scoped operations, skills UX
  await runCheck('phase7-storage-wait-operations-skills-ux', async () => {
    const stRefresh = await runCli([
      'storage', 'project', IDS.boltzgenPassProject, '--refresh', '--wait', '--wait-timeout', '15', '--json', ...authBase,
    ], { env: authEnv });
    const stData = JSON.parse(stRefresh.stdout).data;
    assert.equal(stData.usage?.refresh?.state, 'idle');
    assert.equal(stData.usage?.bytes, 512000);
    assert.match(stRefresh.stderr, /Storage refresh/, 'storage --refresh --wait should emit progress to stderr');

    const storageHelp = await runCli(['help', 'storage', '--no-json']);
    assert.match(storageHelp.stdout, /write_grants_pending/);
    assert.match(storageHelp.stdout, /verification_not_before/);
    assert.match(storageHelp.stdout, /retained\.bytes/);

    // Origin-scoped operations journal
    const opsRoot = path.join(tempRoot, 'root-ops-origin');
    const opsDir = path.join(opsRoot, '.ariax', 'operations');
    await fs.mkdir(opsDir, { recursive: true, mode: 0o700 });
    const { createHash } = await import('node:crypto');
    const makeOp = (id, apiOrigin) => {
      const request = { method: 'POST', path: '/api/v1/projects', body: { name: 'demo' } };
      return {
        version: 1,
        id,
        idempotency_key: id,
        action: 'project:create',
        actor_user_id: IDS.actor,
        billing_account_type: 'user',
        billing_account_id: IDS.billing,
        api_origin: apiOrigin,
        created_at: '2026-11-25T05:00:00Z',
        updated_at: '2026-11-25T05:00:00Z',
        replay_not_after: '2026-12-02T05:00:00Z',
        request,
        request_sha256: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
        sources: [],
        prepared_input: null,
        upload_intent_id: null,
        state: 'completed',
        operation_id: null,
        project_id: IDS.boltzgenPassProject,
        job_id: null,
      };
    };
    const opA = '11111111-2222-4333-8444-555555555551';
    const opB = '11111111-2222-4333-8444-555555555552';
    await fs.writeFile(path.join(opsDir, `${opA}.json`), JSON.stringify(makeOp(opA, origin)) + '\n', { mode: 0o600 });
    await fs.writeFile(path.join(opsDir, `${opB}.json`), JSON.stringify(makeOp(opB, 'https://other.ariax.bio')) + '\n', { mode: 0o600 });

    const opsScoped = JSON.parse((await runCli(['operations', '--json', '--base-url', origin, '--allow-custom-origin', '--root-dir', opsRoot], { env: authEnv })).stdout);
    assert.equal(opsScoped.data.length, 1);
    assert.equal(opsScoped.data[0].id, opA);
    assert.equal(opsScoped.meta?.filtered_by_origin, true);
    assert.equal(opsScoped.meta?.hidden_other_origins, 1);

    const opsAll = JSON.parse((await runCli(['operations', '--all-origins', '--json', '--base-url', origin, '--allow-custom-origin', '--root-dir', opsRoot], { env: authEnv })).stdout);
    assert.equal(opsAll.data.length, 2);
    assert.equal(opsAll.meta?.filtered_by_origin, false);

    // Skills P1 #12: piped raw markdown (no --json), relative path aliases, fuzzy error, valid examples
    const rawRead = await runCli(['skills', 'forge', '--reference', 'mpnn', '--read']);
    assert.ok(rawRead.stdout.trimStart().startsWith('#'), `piped skills --read without --json must print raw markdown, got: ${rawRead.stdout.slice(0, 80)}`);
    const rawToolRead = await runCli(['skills', 'forge', '--tool', 'boltz2', '--read']);
    assert.ok(rawToolRead.stdout.trimStart().startsWith('#'));
    const rawDocRead = await runCli(['skills', 'boltzgen', '--doc', 'outputs']);
    assert.ok(rawDocRead.stdout.trimStart().startsWith('#'));

    for (const [args, expectedPathPart] of [
      [['skills', 'forge', '--reference', 'boltz2/modes.md', '--json'], 'tools/boltz2/modes.md'],
      [['skills', 'forge', '--reference', 'tools/boltz2/modes', '--json'], 'tools/boltz2/modes.md'],
      [['skills', 'forge', '--reference', 'references/custom-code', '--json'], 'references/custom-code.md'],
      [['skills', 'forge', '--reference', 'references/custom-code.md', '--json'], 'references/custom-code.md'],
      [['skills', 'forge', '--reference', 'core/interpretation.md', '--json'], 'core/interpretation.md'],
    ]) {
      const r = JSON.parse((await runCli(args)).stdout).data;
      assert.ok(r.path.endsWith(expectedPathPart), `${args.join(' ')} resolved to ${r.path}, expected ${expectedPathPart}`);
    }

    const fuzzyErr = await runCli(['skills', 'forge', '--reference', 'boltz2-modess', '--json'], { allowNonZero: true });
    assert.equal(fuzzyErr.code, EXIT.USAGE);
    const fuzzyMsg = JSON.parse(fuzzyErr.stdout).error?.message || '';
    assert.match(fuzzyMsg, /Closest matches:.*boltz2-modes/);
    assert.match(fuzzyMsg, /ariax skills --list/);
    assert.ok(fuzzyMsg.length < 400, `fuzzy unknown-reference error should stay concise, got ${fuzzyMsg.length} chars`);

    const toolInfo = JSON.parse((await runCli(['skills', 'forge', '--tool', 'boltz2', '--json'])).stdout).data;
    assert.deepEqual(toolInfo.examples, {}, 'boltz2 doc-only examples dir without runnable fixtures should be omitted from examples');
    assert.ok(typeof toolInfo.references['boltz2-fixtures'] === 'string');
    await fs.access(toolInfo.references['boltz2-fixtures']);
    return 'storage --refresh --wait, origin-scoped ops, and skills UX verified';
  });

  return checks;
}

async function main() {
  const files = (await fs.readdir(CASES_DIR)).filter((f) => f.endsWith('.json')).sort();
  const seenIds = new Set();
  const v1Cases = [];
  const v2Cases = [];

  for (const file of files) {
    const raw = await fs.readFile(path.join(CASES_DIR, file), 'utf8');
    const def = JSON.parse(raw);
    if (def.schema_version === 1) {
      validateV1Case(file, def);
      v1Cases.push({ file, def });
    } else if (def.schema_version === 2) {
      validateV2Case(file, def);
      v2Cases.push({ file, def });
    } else {
      throw new Error(`${file}: unsupported schema_version "${def.schema_version}"`);
    }
    assert.ok(!seenIds.has(def.id), `Duplicate case id "${def.id}" in ${file}`);
    seenIds.add(def.id);
  }

  assert.equal(v1Cases.length, 7, `expected 7 v1 cases, found ${v1Cases.length}`);
  assert.equal(v2Cases.length, 17, `expected 17 v2 cases, found ${v2Cases.length}`);

  const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ariax-eval-suite-')));
  const server = await startEvalServer();
  const cleanBaseEnv = { ...process.env, ...CLEARED_AGENT_ENV };
  const tunnel = await tunnelEnvironment(tempRoot, server.origin, cleanBaseEnv);

  const results = [];
  let failures = 0;

  try {
    const envCtx = {
      origin: server.origin,
      serverState: server.state,
      tunnelEnv: tunnel.env,
      tempRoot,
    };

    for (const { def } of v2Cases) {
      try {
        const outcome = await runV2Case(def, envCtx);
        results.push({
          id: def.id,
          category: def.category,
          status: 'PASS',
          measured: outcome.measuredBytes != null ? `${outcome.measuredBytes}B` : '-',
          budget: outcome.budgetBytes != null ? `<=${outcome.budgetBytes}B` : '-',
          detail: outcome.detail || '',
        });
      } catch (err) {
        failures += 1;
        results.push({
          id: def.id,
          category: def.category,
          status: 'FAIL',
          measured: '-',
          budget: '-',
          detail: err.message,
        });
      }
    }
    const phase6Results = await runPhase6Checks(envCtx);
    for (const r of phase6Results) {
      if (r.status !== 'PASS') failures += 1;
      results.push(r);
    }
    const phase7Results = await runPhase7Checks(envCtx);
    for (const r of phase7Results) {
      if (r.status !== 'PASS') failures += 1;
      results.push(r);
    }
  } finally {
    await server.close();
    await fs.rm(tunnel.directory, { recursive: true, force: true });
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  console.log(`Validated ${v1Cases.length} v1 manual-evidence cases + ${v2Cases.length} v2 automated cases (${v1Cases.length + v2Cases.length} total).\n`);
  const headers = ['case_id', 'category', 'status', 'measured', 'budget', 'detail'];
  const rows = results.map((r) => [r.id, r.category, r.status, r.measured, r.budget, r.detail]);
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((row) => String(row[i]).length)));
  const fmt = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd();
  console.log(fmt(headers));
  console.log(widths.map((w) => '-'.repeat(Math.min(w, 48))).join('  '));
  for (const row of rows) console.log(fmt(row));

  const totalAutomated = results.length;
  if (failures > 0) {
    console.error(`\nFAILED: ${failures} of ${totalAutomated} automated checks failed.`);
    process.exit(1);
  }
  console.log(`\nPASS: all ${v1Cases.length} v1 schemas validated, all ${v2Cases.length}/${v2Cases.length} v2 benchmark cases passed, and all ${totalAutomated - v2Cases.length}/${totalAutomated - v2Cases.length} Phase 6 + Phase 7 checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
