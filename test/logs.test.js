import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { run as logs } from '../src/commands/logs.js';

const job = '11111111-1111-4111-8111-111111111111';

async function capture(fn) {
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  let stdout = '', stderr = '';
  process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
  process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
  try { await fn(); return { stdout, stderr }; }
  finally { process.stdout.write = originalOut; process.stderr.write = originalErr; }
}

function context(data, { json = false, tail } = {}) {
  return {
    positionals: [job], flags: tail === undefined ? {} : { tail: String(tail) }, json,
    client: { get: async () => ({ data, meta: { source: 'job' }, requestId: 'request-1' }) },
  };
}

describe('logs output', () => {
  it('warns on stderr when human log output is truncated and suggests a bounded larger tail', async () => {
    const out = await capture(() => logs(context({ content: 'last line', truncated: true }, { tail: 200 })));
    assert.equal(out.stdout, 'last line\n');
    assert.equal(out.stderr, 'Log output is truncated; request a larger bounded tail with --tail 400 (maximum 5000).\n');

    const capped = await capture(() => logs(context({ content: [], truncated: true }, { tail: 5000 })));
    assert.equal(capped.stdout, '(no log lines)\n');
    assert.equal(capped.stderr, 'Log output is truncated; the maximum bounded request (--tail 5000) is already in use.\n');
  });

  it('stays silent when complete and preserves clean JSON with the truncation flag', async () => {
    const complete = await capture(() => logs(context({ content: 'complete', truncated: false })));
    assert.equal(complete.stdout, 'complete\n');
    assert.equal(complete.stderr, '');

    const json = await capture(() => logs(context({ content: 'last line', truncated: true }, { json: true })));
    assert.equal(json.stderr, '');
    assert.deepEqual(JSON.parse(json.stdout), {
      data: { content: 'last line', truncated: true },
      meta: { source: 'job' },
      request_id: 'request-1',
    });
  });
});


describe('log discovery', () => {
  it('follows empty filtered pages and exposes usable worker references in JSON', async () => {
    const requests = [];
    const reference = 'logs/design_workers/local-gpu-gpu0-run.log';
    const pages = [
      { data: [], meta: { next_cursor: 'next' } },
      { data: [{ log_ref: reference, label: 'Design worker', size: 1896 }], meta: { next_cursor: null }, requestId: 'listed' },
    ];
    const ctx = { positionals: [job], flags: { list: true }, json: true, client: { get: async (path, options) => {
      requests.push({ path, options }); return pages.shift();
    } } };
    const out = await capture(() => logs(ctx));
    assert.equal(requests.length, 2);
    assert.equal(requests[0].path, `/api/v1/jobs/${job}/logs/list`);
    assert.deepEqual(requests[1].options.query, { limit: 100, cursor: 'next' });
    const data = JSON.parse(out.stdout);
    assert.equal(data.data.logs[0].log_ref, reference);
    assert.equal(data.request_id, 'listed');
    let query;
    ctx.flags = { 'log-ref': reference };
    ctx.client.get = async (_path, options) => { query = options.query; return { data: { content: 'StructureTargetError: chain B has missing sequence metadata' } }; };
    assert.match((await capture(() => logs(ctx))).stdout, /StructureTargetError/);
    assert.equal(query.log_ref, reference);
  });

  it('rejects listing combined with a read selector before making a request', async () => {
    for (const extra of [{ tail: '200' }, { 'log-ref': 'output/run.log' }]) {
      await assert.rejects(logs({ positionals: [job], flags: { list: true, ...extra }, client: { get: () => assert.fail('unexpected request') } }), /cannot be combined/);
    }
  });

  it('stops on repeated cursors instead of looping', async () => {
    const ctx = { positionals: [job], flags: { list: true }, client: { get: async () => ({ data: [], meta: { next_cursor: 'same' } }) } };
    await assert.rejects(logs(ctx), /repeated continuation cursor/);
  });
});
