import assert from 'node:assert/strict';
import { it } from 'node:test';
import { main } from '../src/main.js';

async function captureOutput(fn) {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = '', stderr = '';
  process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
  process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
  try { return { code: await fn(), stdout, stderr }; }
  finally { process.stdout.write = stdoutWrite; process.stderr.write = stderrWrite; }
}

it('discovers optional BindCraft2 engine capabilities without filling historical metadata or rewriting the live schema', async () => {
  // Capability shape is the frozen Wave 1 interface. The server owns the
  // authoritative schema and active default; this is not a local validator.
  for (const capabilities of [undefined, { properties: ['initial_guess'] }, { advanced_controls: [] }, {
    engine_version: '1.0.4',
    source_commit: 'd502f19a187a1bc8c05e833ca9cbab7bc1934fe7',
    source_tree_sha256: 'a'.repeat(64), // Synthetic identity, never an artifact selector.
    properties: ['hard_target', 'large_complex'],
    advanced_controls: ['confidence_floor', 'mutate_gate_draws'],
  }]) {
    const jsonSchema = { type: 'object', title: 'Live BindCraft2 job schema' };
    const metadata = { protocol: 'bindcraft2', json_schema: jsonSchema };
    if (capabilities !== undefined) metadata.native_capabilities = capabilities;
    const calls = [];
    const fetchImpl = async (url) => {
      const request = new URL(url);
      calls.push(request);
      const data = request.searchParams.get('format') === 'raw' ? jsonSchema : metadata;
      return new Response(JSON.stringify({ data }), { status: 200 });
    };
    const env = { NO_UPDATE_NOTIFIER: '1' };
    const described = await captureOutput(() => main(['schema', 'bindcraft2', '--json'], env, { fetchImpl }));
    assert.equal(described.code, 0, described.stdout);
    assert.deepEqual(JSON.parse(described.stdout).data, metadata);
    const raw = await captureOutput(() => main(['schema', 'bindcraft2', '--raw', '--json'], env, { fetchImpl }));
    assert.equal(raw.code, 0, raw.stdout);
    assert.deepEqual(JSON.parse(raw.stdout), jsonSchema);
    assert.deepEqual(calls.map((url) => url.pathname), Array(2).fill('/api/v1/protocols/bindcraft2/schema'));
    assert.equal(calls[0].searchParams.has('format'), false);
    assert.equal(calls[1].searchParams.get('format'), 'raw');
    assert.equal(described.stderr, '');
    assert.equal(raw.stderr, '');
  }
});
