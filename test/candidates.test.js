import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../src/main.js';
const id = '11111111-1111-4111-8111-111111111111';
const candidate = (id, eligible = true) => ({ id, native_id: id, ranking_eligible: eligible, ranking_reasons: eligible === true ? [] : ['Producer did not report eligibility'], structures: [], provenance_scope: 'project_outputs' });
let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-candidates-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
async function invoke(args, fetchImpl, json = true) {
  const out = process.stdout.write, err = process.stderr.write; let stdout = '', stderr = '';
  process.stdout.write = (s) => { stdout += s; return true; }; process.stderr.write = (s) => { stderr += s; return true; };
  try { return { code: await main(['candidates', ...args, json ? '--json' : '--no-json'], { ARIAX_API_KEY: 'arx_testcredential' }, { fetchImpl }), stdout, stderr }; }
  finally { process.stdout.write = out; process.stderr.write = err; }
}
describe('typed candidates command', () => {
  it('uses read-only endpoint and defaults to one page with resumable cursor', async () => {
    let calls = 0;
    const result = await invoke([id], async (url, options) => {
      calls++; assert.equal(options.method, 'GET'); assert.equal(new URL(url).pathname, `/api/v1/projects/${id}/candidates`);
      assert.equal(new URL(url).searchParams.get('view'), 'final'); assert.equal(new URL(url).searchParams.get('limit'), '25');
      return Response.json({ data: [candidate('one')], meta: { next_cursor: 'two', state: 'incomplete', total: 2 } });
    });
    assert.equal(result.code, 0); assert.equal(calls, 1); assert.equal(JSON.parse(result.stdout).meta.next_cursor, 'two');
  });
  it('shows only the native overall filter result in the human table', async () => {
    const rows = [
      { ...candidate('passed'), filters: [{ name: 'pass_filters', passed: true }, { name: 'clash', passed: false }] },
      { ...candidate('failed'), filters: [{ name: 'pass_filters', passed: false }, { name: 'clash', passed: true }] },
      { ...candidate('unknown'), filters: [{ name: 'clash', passed: false }] },
    ];
    const result = await invoke([id, '--details'], async () => Response.json({ data: rows, meta: { state: 'available' } }), false);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /^native_id\s+rank\s+selected\s+pass_filters\s+ranking_eligible\s+structures/m);
    assert.match(result.stdout, /^passed\s+-\s+unknown\s+true\s+true\s+0$/m);
    assert.match(result.stdout, /^failed\s+-\s+unknown\s+false\s+true\s+0$/m);
    assert.match(result.stdout, /^unknown\s+-\s+unknown\s+unknown\s+true\s+0$/m);
  });
  it('shows BindCraft2 outcomes and multi-chain sequence counts without inventing a scalar sequence', async () => {
    const rows = [{
      ...candidate('bc2'), engine: 'bindcraft2', sequence: null, rank: 1,
      selection: { stage: 'final', selected: true },
      bindcraft2: { outcome: 'accepted', binder_sequences: ['EVQLVESGG', 'DIQMTQSPSS'] },
    }];
    const result = await invoke([id, '--details'], async () => Response.json({ data: rows, meta: { state: 'available', engine: 'bindcraft2' } }), false);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /^native_id\s+rank\s+selected\s+outcome\s+binder_chains\s+ranking_eligible\s+structures/m);
    assert.match(result.stdout, /^bc2\s+1\s+true\s+accepted\s+2\s+true\s+0$/m);
    assert.ok(!result.stdout.includes('EVQLVESGG'));
  });
  it('keeps selection separate from an unavailable native outcome in detailed human output', async () => {
    const rows = [{
      ...candidate('bc2-selected'), engine: 'bindcraft2', sequence: null,
      selection: { stage: 'bindcraft2:all', selected: true },
      bindcraft2: { outcome: null, binder_sequences: ['AAAA'] },
    }];
    const result = await invoke([id, '--details'], async () => Response.json({
      data: rows, meta: { state: 'available', engine: 'bindcraft2' },
    }), false);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /^bc2-selected\s+-\s+true\s+unknown\s+1\s+true\s+0$/m);
    assert.doesNotMatch(result.stdout, /accepted/);
  });
  it('preserves non-BindCraft2 human warnings in the released default presentation', async () => {
    const rows = [{
      ...candidate('px-warning'), engine: 'pxdesign',
      selection: { stage: 'pxdesign:final', selected: true },
    }];
    const result = await invoke([id], async () => Response.json({
      data: rows,
      meta: { state: 'available', engine: 'pxdesign', warnings: ['Native table warning remains visible.'] },
    }), false);
    assert.equal(result.code, 0);
    assert.match(result.stderr, /Native table warning remains visible\./);
  });
  it('defaults to compact JSON and promotes recorded native rejection evidence', async () => {
    const rows = [{
      ...candidate('bc2-rejected'), engine: 'bindcraft2',
      selection: { stage: 'bindcraft2:diagnostics', selected: null },
      metrics: [
        { name: 'i_pTM', value: 0.42, unit: 'dimensionless', direction: 'higher' },
        { name: 'Binder_pLDDT', value: 0.88, unit: 'fraction', direction: 'higher' },
      ],
      bindcraft2: {
        outcome: 'rejected', binder_sequences: ['AAAA'],
        recorded_fields: { terminated: 'anneal', hash: 'secret-mechanics' },
      },
    }];
    const result = await invoke([id, '--view', 'diagnostics'], async () => Response.json({
      data: rows,
      meta: { state: 'available', view: 'diagnostics', next_cursor: 'next', sources: [{ path: 'private.csv', sha256: 'abc' }] },
      request_id: 'internal-request',
    }));
    assert.equal(result.code, 0);
    const body = JSON.parse(result.stdout);
    assert.equal(body.data[0].rejection.terminated_stage, 'anneal');
    assert.equal(body.data[0].rejection.explanation, 'Native optimization terminated at stage anneal.');
    assert.deepEqual(body.data[0].metrics.map(metric => metric.name), ['i_pTM', 'Binder_pLDDT']);
    assert.equal(body.meta.next_cursor, 'next');
    assert.equal(body.request_id, undefined);
    assert.equal(body.meta.sources, undefined);
    assert.doesNotMatch(result.stdout, /secret-mechanics|private\.csv|sha256/);
  });
  it('keeps selection, native filter pass, ranking eligibility and scientific outcome distinct', async () => {
    const row = {
      ...candidate('native-rejected'), engine: 'bindcraft2',
      selection: { stage: 'bindcraft2:all', selected: true },
      filters: [{ name: 'pass_filters', passed: false }, { name: 'clash', passed: true }],
      bindcraft2: { outcome: null, binder_sequences: ['AAAA'], recorded_fields: {} },
    };
    const result = await invoke([id], async () => Response.json({ data: [row], meta: { state: 'available', engine: 'bindcraft2' } }));
    const body = JSON.parse(result.stdout);
    assert.equal(body.data[0].selected, true);
    assert.equal(body.data[0].native_filter_pass, false);
    assert.equal(body.data[0].ranking.eligible, true);
    assert.equal(body.data[0].native_outcome, null);
    assert.deepEqual(body.data[0].rejection.failed_filters, []);
    assert.equal(body.data[0].rejection.explanation, null);
  });
  it('preserves released non-BC2 metrics and selected-but-failed semantics in JSON exports', async () => {
    const file = path.join(dir, 'pxdesign.json');
    const row = {
      ...candidate('px-failed'), engine: 'pxdesign',
      selection: { stage: 'pxdesign:final', selected: true },
      filters: [{ name: 'pass_af2', passed: false }, { name: 'Protenix-success', passed: false }],
      metrics: [
        { name: 'af2_iptm', value: 0.2, unit: 'dimensionless', direction: 'higher' },
        { name: 'ptx_iptm', value: null, unit: 'dimensionless', direction: 'higher' },
        { name: 'ptx_mini_pred_design_rmsd', value: 4.1, unit: 'angstrom', direction: 'lower' },
      ],
    };
    const result = await invoke([id, '--output', file], async () => Response.json({
      data: [row], meta: { state: 'available', engine: 'pxdesign' }, request_id: 'px-request',
    }));
    assert.equal(result.code, 0);
    const body = JSON.parse(result.stdout);
    const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(body, exported);
    assert.equal(body.data[0].selection.selected, true);
    assert.equal(body.data[0].filters[0].passed, false);
    assert.equal(body.data[0].native_outcome, undefined);
    assert.deepEqual(body.data[0].metrics.map(metric => metric.name), ['af2_iptm', 'ptx_iptm', 'ptx_mini_pred_design_rmsd']);
    assert.equal(body.request_id, 'px-request');
  });
  it('preserves meaningful metric contracts for every non-BC2 engine', async () => {
    const cases = [
      ['bindcraft-v1.5', ['Average_pLDDT', 'Average_i_pTM', 'Average_i_pAE', 'MPNN_score']],
      ['pxdesign', ['af2_iptm', 'ptx_iptm', 'ptx_mini_iptm', 'ptx_mini_pred_design_rmsd']],
      ['boltzgen', ['design_to_target_iptm', 'quality_score', 'filter_rmsd', 'num_filters_passed']],
      ['esmfold2-pipeline', ['consensus_score', 'esmfold2_iptm', 'validator_iptm', 'binder_rmsd_angstrom']],
    ];
    for (const [engine, names] of cases) {
      const row = {
        ...candidate(engine), engine,
        metrics: names.map((name, index) => ({ name, value: index + 0.1, unit: 'recorded', direction: null })),
      };
      const result = await invoke([id], async () => Response.json({
        data: [row], meta: { state: 'available', engine },
      }));
      assert.deepEqual(JSON.parse(result.stdout).data[0].metrics.map((metric) => metric.name), names, engine);
    }
  });
  it('retains ordered multi-target BindCraft2 evidence and treats completed optimization as non-rejection', async () => {
    const row = {
      ...candidate('bc2-multitarget'), engine: 'bindcraft2',
      selection: { stage: 'bindcraft2:all', selected: null },
      metrics: [{ name: 'i_pTM', value: 0.81, unit: 'dimensionless', direction: 'higher' }],
      bindcraft2: {
        outcome: 'refolded', binder_sequences: ['AAAA'], aligned_positive_target_mean_i_pDAE: 0.73,
        target_metrics: [
          { name: 'receptor', weight: 1, i_pDAE: 0.82 },
          { name: 'off_target', weight: -1, i_pDAE: 0.19 },
        ],
        recorded_fields: { terminated: 'completed' },
      },
    };
    const result = await invoke([id, '--view', 'all'], async () => Response.json({
      data: [row], meta: { state: 'available', view: 'all', engine: 'bindcraft2' },
    }));
    const compact = JSON.parse(result.stdout).data[0];
    assert.deepEqual(compact.target_scores, {
      aligned_positive_target_mean_i_pDAE: 0.73,
      targets: [
        { name: 'receptor', weight: 1, i_pDAE: 0.82 },
        { name: 'off_target', weight: -1, i_pDAE: 0.19 },
      ],
    });
    assert.deepEqual(compact.optimization, { state: 'completed', terminated_stage: null });
    assert.equal(compact.rejection.terminated_stage, null);
    assert.doesNotMatch(compact.rejection.explanation ?? '', /terminated/);
    const human = await invoke([id, '--view', 'all'], async () => Response.json({
      data: [row], meta: { state: 'available', view: 'all', engine: 'bindcraft2' },
    }), false);
    assert.match(human.stdout, /aligned_positive_mean=0\.73, receptor\(weight=1,i_pDAE=0\.82\), off_target\(weight=-1,i_pDAE=0\.19\)/);
  });
  it('restores the released raw candidate envelope with --details', async () => {
    const row = { ...candidate('raw'), source_path: 'output/native.csv' };
    const result = await invoke([id, '--details'], async () => Response.json({
      data: [row], meta: { state: 'available', sources: [{ path: 'output/native.csv' }] }, request_id: 'req-1',
    }));
    const body = JSON.parse(result.stdout);
    assert.equal(body.data[0].source_path, 'output/native.csv');
    assert.equal(body.meta.sources[0].path, 'output/native.csv');
    assert.equal(body.request_id, 'req-1');
  });
  it('emits shared ranking guidance once instead of repeating it on every row', async () => {
    const reason = 'Retained trajectory records do not establish final acceptance.';
    const rows = [candidate('one'), candidate('two')].map((row) => ({
      ...row, engine: 'bindcraft2', ranking_reasons: [reason], metrics: [],
      selection: { stage: 'bindcraft2:diagnostics', selected: null },
      bindcraft2: { outcome: null, binder_sequences: [], recorded_fields: {} },
    }));
    const result = await invoke([id, '--view', 'diagnostics'], async () => Response.json({
      data: rows, meta: { state: 'available', view: 'diagnostics', engine: 'bindcraft2' },
    }));
    const body = JSON.parse(result.stdout);
    assert.deepEqual(body.meta.notes, [reason]);
    assert.deepEqual(body.data.map(row => row.ranking.reasons), [[], []]);
    assert.equal((result.stdout.match(/Retained trajectory/g) || []).length, 1);
  });
  it('renders shared caveats once and prioritizes decision scores in human output', async () => {
    const reason = 'Selection does not by itself establish scientific acceptance.';
    const rows = ['one', 'two'].map((name) => ({
      ...candidate(name), engine: 'bindcraft2', ranking_reasons: [reason],
      selection: { stage: 'bindcraft2:all', selected: true },
      metrics: [
        { name: 'Binder_RMSD', value: 1.2 },
        { name: 'length', value: 80 },
        { name: 'pLDDT', value: 0.91 },
        { name: 'i_pTM', value: 0.86 },
        { name: 'i_pAE', value: 0.13 },
      ],
      bindcraft2: { outcome: null, binder_sequences: ['AAAA'], recorded_fields: {} },
    }));
    rows[0].ranking_reasons.push('Candidate-specific eligibility evidence is incomplete.');
    const result = await invoke([id, '--view', 'all'], async () => Response.json({
      data: rows, meta: { state: 'available', view: 'all', engine: 'bindcraft2' },
    }), false);
    assert.match(result.stdout, /i_pTM=0\.86, pLDDT=0\.91, i_pAE=0\.13, Binder_RMSD=1\.2/);
    assert.equal((result.stdout.match(/Selection does not/g) || []).length, 1);
    assert.equal((result.stdout.match(/Candidate-specific eligibility/g) || []).length, 1);
    assert.match(result.stdout, /^candidate\s+selected\s+eligible\s+key_scores/m);
    assert.match(result.stdout, /Not reported in these rows: rank, outcome, native_pass/);
  });
  it('collapses entirely unavailable human columns without hiding false, zero, or mixed unknown evidence', async () => {
    const rows = [
      {
        ...candidate('known', false), engine: 'bindcraft2', rank: 0,
        selection: { selected: false }, filters: [{ name: 'pass_filters', passed: false }],
        metrics: [{ name: 'i_pTM', value: 0 }],
        bindcraft2: { recorded_fields: { terminated: 'completed' } },
      },
      { ...candidate('unknown', null), engine: 'bindcraft2' },
    ];
    const response = () => Response.json({ data: rows, meta: { state: 'available', engine: 'bindcraft2' } });
    const human = await invoke([id], response, false);
    assert.equal(human.code, 0);
    assert.match(human.stdout, /^candidate\s+rank\s+selected\s+native_pass\s+eligible\s+optimization\s+key_scores/m);
    assert.match(human.stdout, /^known\s+0\s+false\s+false\s+false\s+completed\s+i_pTM=0\s+0\s+0$/m);
    assert.match(human.stdout, /^unknown\s+unknown\s+unknown\s+unknown\s+unknown\s+unknown\s+unknown\s+0\s+0$/m);
    assert.match(human.stdout, /Not reported in these rows: outcome, target_scores, recorded_rejection/);
    assert.doesNotMatch(human.stdout, /terminated:completed|accepted/);
    const json = JSON.parse((await invoke([id], response)).stdout);
    assert.equal(json.data[0].native_outcome, null);
    assert.equal(json.data[0].native_filter_pass, false);
    assert.equal(json.data[1].rank, null);
    assert.deepEqual(json.data[1].target_scores.targets, []);
  });
  it('keeps an empty human page distinct from completed publication', async () => {
    const result = await invoke([id], () => Response.json({ data: [], meta: { state: 'incomplete', next_cursor: null, engine: 'bindcraft2' } }), false);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /No candidate rows in this view/);
    assert.match(result.stderr, /publication is not complete/);
    assert.doesNotMatch(result.stdout + result.stderr, /Not reported|More rows|accepted designs|--all/);
  });
  it('keeps incomplete publication independent from pagination', async () => {
    const result = await invoke([id], async () => Response.json({
      data: [], meta: { state: 'incomplete', next_cursor: null, engine: 'bindcraft2', view: 'final' },
    }));
    const body = JSON.parse(result.stdout);
    assert.equal(body.meta.availability, 'partial');
    assert.equal(body.meta.has_more, false);
    assert.equal(body.meta.next_cursor, null);
    assert.match(body.meta.explanation, /publication is not complete/);
    assert.doesNotMatch(body.meta.explanation, /more candidate rows|--all|next_cursor/i);
  });
  it('traverses more than 2000 candidates including empty pages with cursors', async () => {
    let calls = 0;
    const result = await invoke([id, '--all', '--limit', '50'], async () => {
      const page = calls++;
      return Response.json({ data: page === 10 ? [] : Array.from({ length: 50 }, (_, i) => candidate(`${page}-${i}`)), meta: { next_cursor: page < 42 ? String(page+1) : null } });
    });
    assert.equal(result.code, 0); assert.equal(calls, 43); assert.equal(JSON.parse(result.stdout).data.length, 2100);
  });
  it('explains unknown and false eligibility exclusions in empty exports', async () => {
    const file = path.join(dir, 'shortlist.json');
    const result = await invoke([id, '--eligible', '--output', file], async () => Response.json({ data: [candidate('unknown', null), candidate('failed', false)], meta: { state: 'available', next_cursor: null, total: 2 } }));
    assert.equal(result.code, 0);
    const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(exported.data, []); assert.deepEqual(exported.meta.eligibility_filter, { mode: 'explicit_true_only', excluded_false: 1, excluded_unknown: 1, reasons: ['Producer did not report eligibility'] });
    assert.equal(exported.meta.state, 'available'); assert.equal(exported.meta.fetched, 2);
  });
  it('does not publish partial output when a cursor becomes stale', async () => {
    let calls = 0; const file = path.join(dir, 'shortlist.json');
    const result = await invoke([id, '--all', '-o', file], async () => calls++ === 0 ? Response.json({ data: [candidate('one')], meta: { next_cursor: 'two' } }) : Response.json({ error: { code: 'cursor_stale', message: 'Restart pagination', retryable: false } }, { status: 409 }));
    assert.equal(result.code, 7); assert.equal(fs.existsSync(file), false); assert.equal(calls, 2);
  });
  it('rejects repeated cursors and duplicate candidate IDs', async () => {
    for (const repeatIds of [false, true]) {
      let calls = 0;
      const result = await invoke([id, '--all'], async () => Response.json({ data: [candidate(repeatIds ? 'one' : String(calls++))], meta: { next_cursor: 'same' } }));
      assert.equal(result.code, 10);
    }
  });
  it('safely replaces exports only on explicit overwrite and rejects symlinks', async () => {
    const file = path.join(dir, 'shortlist.json'), link = path.join(dir, 'link.json'); fs.writeFileSync(file, 'original'); fs.symlinkSync(file, link);
    const fetchImpl = async () => Response.json({ data: [candidate('one')], meta: { next_cursor: null } });
    assert.equal((await invoke([id, '-o', file], fetchImpl)).code, 1); assert.equal(fs.readFileSync(file, 'utf8'), 'original');
    assert.equal((await invoke([id, '-o', link, '--overwrite'], fetchImpl)).code, 1);
    assert.equal((await invoke([id, '-o', file, '--overwrite'], fetchImpl)).code, 0);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).data[0].id, 'one'); assert.deepEqual(fs.readdirSync(dir).sort(), ['link.json', 'shortlist.json']);
  });
  it('resolves exact project names and forwards the selected view and cursor', async () => {
    const result = await invoke(['pilot', '--view', 'diagnostics', '--cursor', 'next'], async (url) => {
      const parsed = new URL(url);
      if (!parsed.pathname.endsWith('candidates')) return Response.json({ data: [{ id, name: 'pilot' }] });
      assert.equal(parsed.searchParams.get('view'), 'diagnostics'); assert.equal(parsed.searchParams.get('cursor'), 'next');
      return Response.json({ data: [], meta: { state: 'completed_empty', next_cursor: null } });
    });
    assert.equal(result.code, 0);
  });
  it('validates inputs before requests', async () => {
    let calls = 0;
    for (const args of [[], [id, 'extra'], [id, '--limit', '51'], [id, '--limit', '0'], [id, '--view', 'bad'], [id, '--unknown', 'x'], [id, '--overwrite']]) {
      assert.equal((await invoke(args, async () => { calls++; throw new Error('Unexpected'); })).code, 1);
    }
    assert.equal(calls, 0);
  });
});
