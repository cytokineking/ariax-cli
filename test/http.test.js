import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitize,
  ApiError,
  NetworkError,
  parseRetryAfter,
  backoffDelay,
  createClient,
  envelopeData,
  envelopeList,
  validateTransferUrl,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  MAX_GET_ATTEMPTS,
} from '../src/http.js';
import { EXIT } from '../src/exit-codes.js';

function headersOf(obj = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(obj)) lower[String(k).toLowerCase()] = v;
  return { get: (k) => lower[String(k).toLowerCase()] ?? null };
}

function jsonRes({ status = 200, body = {}, headers = {} }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headersOf(headers),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('sanitize: credential redaction', () => {
  it('redacts arx_ keys', () => {
    const out = sanitize('key arx_abcDEF123456 more');
    assert.ok(!out.includes('arx_abcDEF123456'));
    assert.ok(out.includes('arx_[REDACTED]'));
  });
  it('redacts Bearer tokens', () => {
    const out = sanitize('Authorization: Bearer abc.def-123');
    assert.ok(!out.includes('abc.def-123'));
    assert.ok(out.includes('Bearer [REDACTED]'));
  });
  it('passes through non-strings', () => {
    assert.equal(sanitize(123), 123);
    assert.equal(sanitize(null), null);
    assert.equal(sanitize(undefined), undefined);
  });
});

describe('parseRetryAfter', () => {
  it('returns undefined for missing or empty values', () => {
    assert.equal(parseRetryAfter(null), undefined);
    assert.equal(parseRetryAfter(undefined), undefined);
    assert.equal(parseRetryAfter(''), undefined);
  });
  it('parses seconds and caps at 120s', () => {
    assert.equal(parseRetryAfter('0'), 0);
    assert.equal(parseRetryAfter('2'), 2000);
    assert.equal(parseRetryAfter('120'), 120000);
    assert.equal(parseRetryAfter('9999'), 120000);
  });
  it('parses HTTP dates relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    const future = new Date(now + 5000).toUTCString();
    assert.equal(parseRetryAfter(future, now), 5000);
  });
  it('clamps past HTTP dates to 0 and far futures to 120s', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    const past = new Date(now - 5000).toUTCString();
    assert.equal(parseRetryAfter(past, now), 0);
    const far = new Date(now + 9999 * 1000).toUTCString();
    assert.equal(parseRetryAfter(far, now), 120000);
  });
  it('returns undefined for garbage', () => {
    assert.equal(parseRetryAfter('not-a-date-or-number'), undefined);
  });
});

describe('validateTransferUrl', () => {
  it('accepts HTTPS and loopback development URLs', () => {
    assert.equal(validateTransferUrl('https://storage.example/file?token=x'), 'https://storage.example/file?token=x');
    assert.equal(validateTransferUrl('http://localhost:54321/file'), 'http://localhost:54321/file');
  });

  it('rejects insecure remote and credential-bearing URLs', () => {
    assert.throws(() => validateTransferUrl('http://storage.example/file'), /HTTPS/);
    assert.throws(() => validateTransferUrl('https://user:pass@storage.example/file'), /credentials/);
  });
});

describe('backoffDelay: bounded exponential backoff with jitter', () => {
  it('grows exponentially with deterministic rand', () => {
    const rand = () => 0.5; // jitter factor 1.0
    assert.equal(backoffDelay(0, 500, 15000, rand), 500);
    assert.equal(backoffDelay(1, 500, 15000, rand), 1000);
    assert.equal(backoffDelay(2, 500, 15000, rand), 2000);
  });
  it('applies +/-50% jitter bounds', () => {
    assert.equal(backoffDelay(0, 500, 15000, () => 0), 250);
    const hi = backoffDelay(0, 500, 15000, () => 0.999999);
    assert.ok(hi <= 15000 && hi >= 500);
  });
  it('caps at maxMs', () => {
    const rand = () => 0.99;
    assert.ok(backoffDelay(20, 500, 15000, rand) <= 15000);
    assert.equal(backoffDelay(0, 500, 100, () => 0.5), 100);
  });
  it('uses documented defaults', () => {
    assert.equal(BACKOFF_BASE_MS, 500);
    assert.equal(BACKOFF_MAX_MS, 15000);
    assert.equal(MAX_GET_ATTEMPTS, 4);
  });
});

describe('ApiError and NetworkError', () => {
  it('ApiError prefers HTTP status', () => {
    assert.equal(new ApiError({ status: 404, code: 'validation_error', message: 'nf' }).exitCode, EXIT.NOT_FOUND);
    assert.equal(new ApiError({ status: 401, message: 'no' }).exitCode, EXIT.AUTH);
    assert.equal(new ApiError({ status: 429, message: 'rl' }).exitCode, EXIT.RATE_LIMIT);
  });
  it('ApiError refines generic 5xx with error code', () => {
    assert.equal(new ApiError({ status: 500, code: 'credit_insufficient', message: 'credit' }).exitCode, EXIT.PAYMENT);
  });
  it('ApiError falls back to code without status', () => {
    assert.equal(new ApiError({ code: 'not_found', message: 'x' }).exitCode, EXIT.NOT_FOUND);
    assert.equal(new ApiError({ message: 'boom' }).exitCode, EXIT.SERVER);
  });
  it('ApiError sanitizes secrets in message', () => {
    const err = new ApiError({ status: 500, message: 'failed with arx_secretkey12345678' });
    assert.ok(!err.message.includes('arx_secretkey12345678'));
  });
  it('NetworkError always maps to exit 9', () => {
    const err = new NetworkError('dns failed');
    assert.equal(err.exitCode, EXIT.NETWORK);
    assert.equal(err.retryable, true);
  });
});

describe('createClient: success envelope handling', () => {
  it('unwraps {data,meta,request_id}', async () => {
    const fetchImpl = async () => jsonRes({ status: 200, body: { data: { a: 1 }, meta: { m: 1 }, request_id: 'r-1' } });
    const client = createClient({ baseUrl: 'https://api.example.com', fetchImpl, sleepImpl: async () => {} });
    const res = await client.get('/api/v1/me');
    assert.deepEqual(res.data, { a: 1 });
    assert.deepEqual(res.meta, { m: 1 });
    assert.equal(res.requestId, 'r-1');
  });
  it('passes through bare bodies and propagates X-Request-Id header', async () => {
    const fetchImpl = async () =>
      jsonRes({ status: 200, body: { hello: 'world' }, headers: { 'x-request-id': 'hdr-1' } });
    const client = createClient({ baseUrl: 'https://api.example.com', fetchImpl, sleepImpl: async () => {} });
    const res = await client.get('/api/v1/me');
    assert.deepEqual(res.data, { hello: 'world' });
    assert.equal(res.requestId, 'hdr-1');
  });
  it('sends Authorization and Idempotency-Key headers', async () => {
    let seen = null;
    const fetchImpl = async (url, opts) => {
      seen = { url, opts };
      return jsonRes({ status: 200, body: { data: { ok: true } } });
    };
    const client = createClient({ baseUrl: 'https://api.example.com', apiKey: 'arx_testkey123', fetchImpl, sleepImpl: async () => {} });
    await client.post('/api/v1/projects', { body: { name: 'n' }, idempotencyKey: 'k-1' });
    assert.ok(seen.url.includes('/api/v1/projects'));
    assert.equal(seen.opts.headers.Authorization, 'Bearer arx_testkey123');
    assert.equal(seen.opts.headers['Idempotency-Key'], 'k-1');
    assert.equal(seen.opts.headers['Content-Type'], 'application/json');
    assert.ok(seen.opts.headers['X-Request-Id']);
    assert.equal(seen.opts.redirect, 'error');
  });
  it('parses error envelopes into ApiError with exit codes', async () => {
    const fetchImpl = async () =>
      jsonRes({ status: 404, body: { error: { code: 'not_found', message: 'gone' }, request_id: 'r-9' } });
    const client = createClient({ baseUrl: 'https://api.example.com', fetchImpl, sleepImpl: async () => {}, attempts: 1 });
    await assert.rejects(client.get('/api/v1/projects/x', { attempts: 1 }), (e) => {
      assert.equal(e instanceof ApiError, true);
      assert.equal(e.exitCode, EXIT.NOT_FOUND);
      assert.equal(e.requestId, 'r-9');
      return true;
    });
  });
  it('handles non-JSON error bodies with a default message', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, headers: headersOf({}), text: async () => '<html>oops' });
    const client = createClient({ baseUrl: 'https://api.example.com', fetchImpl, sleepImpl: async () => {} });
    await assert.rejects(client.post('/api/v1/projects', { body: {} }), (e) => {
      assert.equal(e.exitCode, EXIT.SERVER);
      assert.ok(e.message.includes('500'));
      return true;
    });
  });
});

describe('createClient: retries', () => {
  it('GET retries 429 honoring Retry-After then succeeds', async () => {
    let calls = 0;
    const waits = [];
    const retries = [];
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return jsonRes({ status: 429, body: { error: { code: 'rate_limited', message: 'slow' } }, headers: { 'retry-after': '1' } });
      return jsonRes({ status: 200, body: { data: { ok: true } } });
    };
    const client = createClient({
      baseUrl: 'https://api.example.com',
      fetchImpl,
      sleepImpl: async (ms) => { waits.push(ms); },
      rand: () => 0.5,
      onRetry: (info) => { retries.push(info); },
    });
    const res = await client.get('/api/v1/me');
    assert.deepEqual(res.data, { ok: true });
    assert.equal(calls, 2);
    assert.deepEqual(waits, [1000]);
    assert.equal(retries.length, 1);
    assert.equal(retries[0].status, 429);
  });
  it('GET uses backoff when no Retry-After header is present', async () => {
    let calls = 0;
    const waits = [];
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return jsonRes({ status: 503, body: { error: { message: 'down' } } });
      return jsonRes({ status: 200, body: { data: 1 } });
    };
    const client = createClient({ baseUrl: 'https://api.example.com', fetchImpl, sleepImpl: async (ms) => { waits.push(ms); }, rand: () => 0.5 });
    await client.get('/api/v1/me');
    assert.equal(calls, 2);
    assert.equal(waits.length, 1);
    assert.ok(waits[0] >= 250 && waits[0] <= 15000);
  });
  it('GET retries network failures', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) throw new Error('socket hang up');
      return jsonRes({ status: 200, body: { data: { ok: true } } });
    };
    const client = createClient({ baseUrl: 'https://api.example.com', fetchImpl, sleepImpl: async () => {}, rand: () => 0 });
    const res = await client.get('/api/v1/me');
    assert.deepEqual(res.data, { ok: true });
    assert.equal(calls, 2);
  });
  it('GET gives up after max attempts', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonRes({ status: 503, body: { error: { message: 'down' } } });
    };
    const client = createClient({ baseUrl: 'https://api.example.com', fetchImpl, sleepImpl: async () => {}, rand: () => 0 });
    await assert.rejects(client.get('/api/v1/me', { attempts: 2 }), (e) => e instanceof ApiError);
    assert.equal(calls, 2);
  });
  it('GET does not retry validation errors', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonRes({ status: 400, body: { error: { code: 'bad_request', message: 'bad' } } });
    };
    const client = createClient({ baseUrl: 'https://api.example.com', fetchImpl, sleepImpl: async () => {}, rand: () => 0 });
    await assert.rejects(client.get('/api/v1/me', { attempts: 3 }), (e) => e.exitCode === EXIT.VALIDATION);
    assert.equal(calls, 1);
  });
  it('POST is never retried', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonRes({ status: 500, body: { error: { message: 'boom' } } });
    };
    const client = createClient({ baseUrl: 'https://api.example.com', fetchImpl, sleepImpl: async () => {}, rand: () => 0 });
    await assert.rejects(client.post('/api/v1/projects', { body: {} }), (e) => e instanceof ApiError);
    assert.equal(calls, 1);
  });
  it('AbortError surfaces as NetworkError', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    const client = createClient({ baseUrl: 'https://api.example.com', fetchImpl: async () => { throw abort; }, sleepImpl: async () => {}, rand: () => 0 });
    await assert.rejects(client.get('/api/v1/me', { attempts: 1 }), (e) => e instanceof NetworkError && e.exitCode === EXIT.NETWORK);
  });
});

describe('envelope helpers', () => {
  it('envelopeData extracts data or returns body', () => {
    assert.deepEqual(envelopeData({ data: { a: 1 } }), { a: 1 });
    assert.deepEqual(envelopeData({ a: 1 }), { a: 1 });
    assert.equal(envelopeData(null), null);
  });
  it('envelopeList normalizes arrays and keyed lists', () => {
    assert.deepEqual(envelopeList([1, 2]).list, [1, 2]);
    assert.deepEqual(envelopeList({ data: { items: [1] } }).list, [1]);
    assert.deepEqual(envelopeList({ data: { projects: [{ id: 'x' }] } }).list, [{ id: 'x' }]);
    assert.deepEqual(envelopeList({ data: {} }).list, []);
  });
});


describe('structured validation details', () => {
  it('redacts secrets and drops raw inputs/context', () => {
    const error = new ApiError({ status: 422, message: 'Invalid request', details: {
      issues: [{ field: ['target'], rule: 'field_invalid', message: 'Rejected arx_supersecret123456', input: 'private-body', ctx: { error: 'internal traceback' } }],
      exception: 'internal traceback',
    } });
    assert.doesNotMatch(JSON.stringify(error.details), /supersecret|private-body|traceback/);
    assert.equal(error.details.issues[0].rule, 'field_invalid');
  });
});
