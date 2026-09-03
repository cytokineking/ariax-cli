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
    const result = await invoke([id], async () => Response.json({ data: rows, meta: { state: 'available' } }), false);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /^native_id\s+rank\s+selected\s+pass_filters\s+ranking_eligible\s+structures/m);
    assert.match(result.stdout, /^passed\s+-\s+unknown\s+true\s+true\s+0$/m);
    assert.match(result.stdout, /^failed\s+-\s+unknown\s+false\s+true\s+0$/m);
    assert.match(result.stdout, /^unknown\s+-\s+unknown\s+unknown\s+true\s+0$/m);
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
