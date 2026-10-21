import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/main.js';
import { validateInput } from '../src/commands/feedback.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const feedbackId = '33333333-3333-4333-8333-333333333333';
const receipt = {
  feedback_id: feedbackId,
  project_id: projectId,
  category: 'technical-support',
  created_at: '2026-09-28T12:34:56Z',
};

async function capture(argv, fetchImpl, env = { ARIAX_API_KEY: 'arx_testcredential' }, runtime = {}) {
  const oldOut = process.stdout.write;
  const oldErr = process.stderr.write;
  let stdout = '';
  let stderr = '';
  process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
  process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
  try {
    const code = await main(['feedback', ...argv], env, { fetchImpl, ...runtime });
    return { code, stdout, stderr };
  } finally {
    process.stdout.write = oldOut;
    process.stderr.write = oldErr;
  }
}

function response(data = receipt, status = 201) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'request-feedback-1' },
  });
}

describe('feedback command', () => {
  it('submits one UUID-scoped message and prints only the server receipt in JSON', async () => {
    const calls = [];
    const message = '  GPU froze after step 2  ';
    const result = await capture([
      projectId, '--category', 'technical-support', '--message', message, '--job', jobId, '--json',
    ], async (url, options) => {
      calls.push({ url, options });
      return response({ ...receipt, message: 'server accidentally echoed private content' });
    });
    assert.equal(result.code, 0);
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0].url).pathname, `/api/v1/projects/${projectId}/feedback`);
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer arx_testcredential');
    assert.equal(calls[0].options.headers['Idempotency-Key'], undefined);
    const body = JSON.parse(calls[0].options.body);
    assert.deepEqual(Object.keys(body).sort(), ['category', 'context', 'job_id', 'message']);
    assert.equal(body.category, 'technical-support');
    assert.equal(body.message, 'GPU froze after step 2');
    assert.equal(body.job_id, jobId);
    assert.match(body.context.cli_version, /\S/);
    assert.ok(body.context.cli_version.length <= 128);
    assert.match(body.context.cli_revision, /^[a-f0-9]{40}$/);
    assert.ok(Buffer.byteLength(JSON.stringify(body.context), 'utf8') <= 2048);
    assert.deepEqual(JSON.parse(result.stdout), { data: receipt, request_id: 'request-feedback-1' });
    assert.doesNotMatch(result.stdout + result.stderr, /GPU froze|private content/);
    assert.equal(result.stderr, '');
  });

  it('resolves an exact unique project name, then shows a human receipt and support guidance', async () => {
    const calls = [];
    const result = await capture([
      'pilot', '--category=technical-support', '--message=Sensitive details', '--no-json',
    ], async (url, options) => {
      calls.push({ url: new URL(url), method: options.method, body: options.body });
      if (options.method === 'GET') return Response.json({ data: [{ id: projectId, name: 'pilot' }] });
      return response();
    });
    assert.equal(result.code, 0);
    assert.deepEqual(calls.map((c) => c.method), ['GET', 'POST']);
    assert.equal(calls[0].url.pathname, '/api/v1/projects');
    assert.equal(calls[0].url.searchParams.get('name'), 'pilot');
    assert.equal(calls[1].url.pathname, `/api/v1/projects/${projectId}/feedback`);
    assert.equal(JSON.parse(calls[1].body).job_id, undefined);
    assert.match(result.stdout, new RegExp(`Feedback recorded: ${feedbackId}`));
    assert.match(result.stdout, /support@ariax\.bio/);
    assert.match(result.stdout, new RegExp(feedbackId));
    assert.doesNotMatch(result.stdout + result.stderr, /Sensitive details/);
    assert.equal(result.stderr, '');
  });

  it('rejects all invalid input before credentials, requests, or automatic login', async () => {
    let effects = 0;
    const forbidden = async () => { effects++; throw new Error('unexpected side effect'); };
    const runtime = {
      interactive: true, fetchImpl: forbidden,
      credentialStore: { read: forbidden, storeSecure: forbidden },
      promptApiKey: forbidden,
    };
    const valid = [projectId, '--category', 'other', '--message', 'hello', '--json'];
    const cases = [
      ['--category', 'other', '--message', 'hello', '--json'],
      [...valid, 'extra'],
      [projectId, '--message', 'hello', '--json'],
      [projectId, '--category', 'bad', '--message', 'hello', '--json'],
      [projectId, '--category', 'other', '--json'],
      [projectId, '--category', 'other', '--message', ' \t\n ', '--json'],
      [projectId, '--category', 'other', '--message', ` ${'é'.repeat(4096)}`, '--json'],
      [...valid, '--job', 'not-a-uuid'],
      [...valid, '--context', '{}'],
      [...valid, '--dry-run'],
    ];
    for (const argv of cases) {
      const result = await capture(argv, forbidden, {}, runtime);
      assert.equal(result.code, 1, `${argv}: ${result.stdout}${result.stderr}`);
      if (result.stdout) assert.equal(JSON.parse(result.stdout).error.code, 'ARIAX_USAGE');
      else assert.match(result.stderr, /requires a value/);
      assert.equal(effects, 0);
    }
  });

  it('accepts the 8192-byte original message boundary and omits an unknown revision', async () => {
    const input = validateInput({
      positionals: [projectId],
      flags: { category: 'other', message: 'é'.repeat(4096) },
      currentBuild: { version: '0.1.0', source_revision: null },
    });
    assert.equal(Buffer.byteLength(input.message), 8192);
    assert.deepEqual(input.context, { cli_version: '0.1.0' });
    assert.throws(() => validateInput({
      positionals: [projectId],
      flags: { category: 'other', message: 'hello' },
      currentBuild: { version: '0.1.0', source_revision: 'ABC' },
    }), /revision is invalid/);
  });

  it('does not retry a failed or timed-out POST and never prints a success claim', async () => {
    for (const outcome of ['503', 'timeout']) {
      let calls = 0;
      const result = await capture([
        projectId, '--category', 'other', '--message', 'details', '--json',
      ], async (_url, options) => {
        calls++;
        assert.equal(options.method, 'POST');
        if (outcome === 'timeout') throw new DOMException('Aborted', 'AbortError');
        return Response.json({ error: { code: 'unavailable', message: 'Try later', retryable: true } }, { status: 503 });
      });
      assert.equal(calls, 1);
      assert.equal(result.code, outcome === 'timeout' ? 9 : 10);
      assert.ok(JSON.parse(result.stdout).error);
      assert.doesNotMatch(result.stdout + result.stderr, /Feedback recorded/);
    }
  });

  it('rejects incomplete or inconsistent 201 receipts without claiming success', async () => {
    for (const data of [
      {},
      { ...receipt, feedback_id: '' },
      { ...receipt, project_id: jobId },
      { ...receipt, category: 'other' },
      { ...receipt, created_at: 'not-a-date' },
    ]) {
      const result = await capture([
        projectId, '--category', 'technical-support', '--message', 'secret text', '--json',
      ], async () => response(data));
      assert.equal(result.code, 10);
      const error = JSON.parse(result.stdout);
      assert.equal(error.error.code, 'invalid_feedback_response');
      assert.equal(error.request_id, 'request-feedback-1');
      assert.doesNotMatch(result.stdout + result.stderr, /Feedback recorded|secret text/);
    }
  });
});
