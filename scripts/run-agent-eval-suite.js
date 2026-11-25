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
  forgeProject: '44444444-4444-4444-8444-444444444444',
  forgeSessionPack: '55555555-5555-4555-8555-555555555555',
  forgeSessionClose: '66666666-6666-4666-8666-666666666666',
  forgeSessionFail: '77777777-7777-4777-8777-777777777777',
  serverErrorProject: '88888888-8888-4888-8888-888888888888',
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
        const visible = includeAll
          ? state.catalog
          : state.catalog.filter((t) => !['experimental', 'legacy'].includes(t.tier));
        return reply(res, 200, { tools: visible }, {
          view: url.searchParams.get('view') || 'summary',
          hidden_experimental_count: 0,
          hidden_legacy_count: state.catalog.filter((t) => t.tier === 'legacy').length,
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
        return reply(res, 200, {
          sync_state: 'saved',
          durability_gap: false,
          last_synced_at: '2026-11-25T05:00:00Z',
          entries: [{ path: '/workspace/boltz2-raw', kind: 'directory', size_bytes: null }],
          next_cursor: null,
        });
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

      // Forge files/status (used by close guard and finish pre-check)
      if (req.method === 'GET' && p === `/api/v1/forge/projects/${IDS.forgeProject}/files/status`) {
        return reply(res, 200, {
          project_id: IDS.forgeProject,
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
            output_tail: '{"status":"ok","archive":"/workspace/archives/boltz2-batch.tar.zst"}\n',
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

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ariax-eval-suite-'));
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

  if (failures > 0) {
    console.error(`\nFAILED: ${failures} of ${v2Cases.length} automated evaluation cases failed.`);
    process.exit(1);
  }
  console.log(`\nPASS: all ${v1Cases.length} v1 schemas validated and all ${v2Cases.length}/${v2Cases.length} v2 benchmark cases passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
