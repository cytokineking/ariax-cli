import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/main.js';
import { createClient } from '../src/http.js';
import { run as logs } from '../src/commands/logs.js';
import { run as showMe } from '../src/commands/me.js';
import { run as listJobs } from '../src/commands/jobs.js';
import { run as restartProject } from '../src/commands/restart.js';

async function captureOutput(fn) {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = '';
  let stderr = '';
  process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
  process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
  try {
    return { value: await fn(), stdout, stderr };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

describe('CLI contract', () => {
  it('preserves structured validation and payment errors in CLI JSON', async () => {
    for (const [status, code, details] of [
      [422, 'validation_failed', { issues: [{ field: ['budget'], rule: 'budget_exceeds_design_count', message: 'budget cannot exceed num_designs', constraint: { maximum_field: 'num_designs' } }] }],
      [402, 'payment_required', { current_balance_usd: 0, required_balance_usd: 5, deficit_usd: 5 }],
    ]) {
      const out = await captureOutput(() => main(['me', '--json'], { ARIAX_API_KEY: 'arx_testcredential' }, {
        fetchImpl: async () => new Response(JSON.stringify({
          error: { code, message: 'Request rejected', retryable: false, details: { ...details, input: 'private-body' } },
          request_id: 'validation-request',
        }), { status }),
      }));
      assert.equal(out.value, status === 422 ? 5 : 6);
      assert.deepEqual(JSON.parse(out.stdout).error.details, details);
      assert.equal(JSON.parse(out.stdout).request_id, 'validation-request');
      assert.equal(out.stderr, '');
    }
  });

  it('emits a standalone schema with --raw even in JSON mode', async () => {
    let requested;
    const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', $defs: { Rule: { type: 'string' } }, properties: { rule: { $ref: '#/$defs/Rule' } } };
    const out = await captureOutput(() => main(['schema', '--raw', 'boltzgen', '--kind', 'submission', '--json'], {}, {
      fetchImpl: async (url) => { requested = new URL(url); return new Response(JSON.stringify(schema)); },
    }));
    assert.equal(out.value, 0);
    assert.equal(requested.searchParams.get('format'), 'raw');
    assert.equal(requested.searchParams.get('kind'), 'submission');
    assert.deepEqual(JSON.parse(out.stdout), schema);
  });

  it('prints help successfully without credentials', async () => {
    const out = await captureOutput(() => main(['--help'], {}));
    assert.equal(out.value, 0);
    assert.match(out.stdout, /ariax submit/);
    assert.match(out.stdout, /ariax upgrade/);
    assert.match(out.stdout, /ariax skills/);
    assert.doesNotMatch(out.stdout, /ariax quote/);
    assert.equal(out.stderr, '');
  });

  it('locates bundled agent skills without credentials', async () => {
    const out = await captureOutput(() => main(['skills', 'bindcraft-v1.5', '--json'], {}));
    assert.equal(out.value, 0);
    const data = JSON.parse(out.stdout).data;
    assert.equal(data.protocol, 'bindcraft-v1.5');
    assert.match(data.shared, /agent-skills\/SKILL\.md$/);
    assert.match(data.skill, /ariax-bindcraft\/SKILL\.md$/);
    assert.equal(out.stderr, '');
  });

  it('returns stable auth failure JSON for a missing or malformed key', async () => {
    for (const env of [{}, { ARIAX_API_KEY: 'not-an-api-key' }]) {
      const out = await captureOutput(() => main(['me', '--json'], env, {
        credentialStore: {
          read: async () => null,
        },
      }));
      assert.equal(out.value, 2);
      assert.equal(JSON.parse(out.stdout).error.retryable, false);
      assert.match(out.stderr, /^$/);
    }
  });

  it('rejects API keys passed as command-line arguments', async () => {
    const out = await captureOutput(() => main(
      ['me', '--api-key', 'arx_commandlinecredential', '--json'],
      {},
    ));
    assert.equal(out.value, 1);
    assert.match(JSON.parse(out.stdout).error.message, /ariax login instead/);
    assert.doesNotMatch(out.stdout + out.stderr, /arx_commandlinecredential/);
  });

  it('uses a securely stored key when no environment override exists', async () => {
    let authorization;
    const out = await captureOutput(() => main(['me', '--json'], {}, {
      interactive: false,
      credentialStore: {
        read: async () => ({ apiKey: 'arx_storedcredential', storage: 'keychain' }),
      },
      fetchImpl: async (_url, options) => {
        authorization = options.headers.Authorization;
        return new Response(JSON.stringify({
          data: { actor: { email: 'stored@example.com', authentication: 'api-key' } },
        }), { headers: { 'content-type': 'application/json' } });
      },
    }));
    assert.equal(out.value, 0);
    assert.equal(authorization, 'Bearer arx_storedcredential');
    assert.equal(JSON.parse(out.stdout).data.actor.email, 'stored@example.com');
  });

  it('prompts once on first interactive use, stores the key, and continues', async () => {
    const requests = [];
    let stored;
    const out = await captureOutput(() => main(['me', '--no-json'], {
      NO_UPDATE_NOTIFIER: '1',
    }, {
      interactive: true,
      credentialStore: {
        filePath: '/private/credentials.json',
        read: async () => null,
        storeSecure: async (key) => { stored = key; return true; },
      },
      promptApiKey: async () => 'arx_promptedcredential',
      fetchImpl: async (url, options) => {
        requests.push({ url, authorization: options.headers.Authorization });
        return new Response(JSON.stringify({
          data: { actor: { email: 'prompted@example.com', authentication: 'api-key' } },
        }), { headers: { 'content-type': 'application/json' } });
      },
    }));
    assert.equal(out.value, 0);
    assert.equal(stored, 'arx_promptedcredential');
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.authorization === 'Bearer arx_promptedcredential'));
    assert.match(out.stdout, /prompted@example\.com/);
    assert.match(out.stderr, /Ariax is not connected/);
    assert.doesNotMatch(out.stdout + out.stderr, /arx_promptedcredential/);
  });

  it('logs in from stdin without printing the key', async () => {
    let stored;
    const out = await captureOutput(() => main(
      ['login', '--with-token', '--json'],
      {},
      {
        interactive: false,
        credentialStore: {
          filePath: '/private/credentials.json',
          storeSecure: async (key) => { stored = key; return true; },
        },
        readTokenFromStdin: async () => 'arx_stdincredential',
        fetchImpl: async () => new Response(JSON.stringify({
          data: { actor: { email: 'stdin@example.com' } },
        }), { headers: { 'content-type': 'application/json' } }),
      },
    ));
    assert.equal(out.value, 0);
    assert.equal(stored, 'arx_stdincredential');
    assert.deepEqual(JSON.parse(out.stdout).data, {
      authenticated: true,
      user: 'stdin@example.com',
      storage: 'keychain',
    });
    assert.doesNotMatch(out.stdout + out.stderr, /arx_stdincredential/);
  });

  it('removes stored credentials while warning about an environment override', async () => {
    let removed = false;
    const out = await captureOutput(() => main(
      ['logout', '--no-json'],
      { ARIAX_API_KEY: 'arx_environmentcredential' },
      {
        credentialStore: {
          remove: async () => { removed = true; return { keychain: true, file: false }; },
        },
      },
    ));
    assert.equal(out.value, 0);
    assert.equal(removed, true);
    assert.match(out.stdout, /credentials removed/);
    assert.match(out.stderr, /ARIAX_API_KEY is still set/);
    assert.doesNotMatch(out.stdout + out.stderr, /arx_environmentcredential/);
  });

  it('does not send an ambient API key for public discovery commands', async () => {
    const originalFetch = globalThis.fetch;
    let authorization;
    globalThis.fetch = async (_url, options) => {
      authorization = options.headers.Authorization;
      return new Response(JSON.stringify({ data: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    };
    try {
      const out = await captureOutput(() => main(
        ['protocols', '--json'],
        { ARIAX_API_KEY: 'arx_abcdefghijk' },
      ));
      assert.equal(out.value, 0);
      assert.equal(authorization, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('checks for upgrades without an API key or Authorization header', async () => {
    const originalFetch = globalThis.fetch;
    let authorization;
    globalThis.fetch = async (_url, options) => {
      authorization = options.headers.authorization;
      return new Response(JSON.stringify({ version: '0.2.0' }));
    };
    try {
      const out = await captureOutput(() => main(['upgrade', '--check', '--json'], {}));
      assert.equal(out.value, 0);
      assert.equal(JSON.parse(out.stdout).data.update_available, true);
      assert.equal(authorization, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('refuses to send a key to a custom API origin without explicit opt-in', async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => { called = true; throw new Error('unexpected request'); };
    try {
      const out = await captureOutput(() => main(
        ['me', '--json', '--base-url', 'https://api.example.test'],
        { ARIAX_API_KEY: 'arx_abcdefghijk' },
      ));
      assert.equal(out.value, 1);
      assert.match(JSON.parse(out.stdout).error.message, /Refusing to send/);
      assert.equal(called, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('serializes query parameters through the fetch transport', async () => {
    let seen;
    const client = createClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: async (url) => {
        seen = new URL(url);
        return new Response(JSON.stringify({ data: [] }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    await client.get('/api/v1/projects', { query: { limit: 10, cursor: 'a+b/c=' } });
    assert.equal(seen.searchParams.get('limit'), '10');
    assert.equal(seen.searchParams.get('cursor'), 'a+b/c=');
  });

  it('renders retained job-log content and forwards the bounded log reference', async () => {
    let request;
    const ctx = {
      client: {
        get: async (path, options) => {
          request = { path, options };
          return { data: { content: 'first\nsecond', truncated: false } };
        },
      },
      flags: { tail: '2', 'log-ref': 'output/run.log' },
      positionals: ['123e4567-e89b-12d3-a456-426614174000'],
      json: false,
    };
    const out = await captureOutput(() => logs(ctx));
    assert.equal(out.stdout, 'first\nsecond\n');
    assert.deepEqual(request.options.query, { tail: 2, log_ref: 'output/run.log' });
  });

  it('renders the nested account and billing summary in human mode', async () => {
    const ctx = {
      client: {
        get: async () => ({
          data: {
            actor: {
              user_id: '11111111-1111-4111-8111-111111111111',
              email: 'owner@example.com',
              authentication: 'api-key',
              scopes: ['read', 'write'],
            },
            billing: {
              account_type: 'personal',
              account_id: 'acct-1',
              balance_usd: 25.5,
              required_balance_usd: 1,
              can_start_compute: true,
            },
          },
          requestId: 'request-1',
        }),
      },
      json: false,
    };
    const out = await captureOutput(() => showMe(ctx));
    assert.match(out.stdout, /user: owner@example\.com/);
    assert.match(out.stdout, /authentication: api-key/);
    assert.match(out.stdout, /scopes: read,write/);
    assert.match(out.stdout, /billing_account: personal/);
    assert.match(out.stdout, /balance_usd: 25\.5/);
    assert.match(out.stdout, /required_balance_usd: 1/);
    assert.match(out.stdout, /can_start_compute: true/);
  });

  it('renders only fields supplied by the jobs API', async () => {
    const ctx = {
      client: {
        get: async () => ({
          data: [{
            id: '22222222-2222-4222-8222-222222222222',
            project_id: '11111111-1111-4111-8111-111111111111',
            status: 'running',
          }],
        }),
      },
      flags: {},
      json: false,
    };
    const out = await captureOutput(() => listJobs(ctx));
    assert.match(out.stdout, /^id\s+project_id\s+status/m);
    assert.doesNotMatch(out.stdout, /protocol/);
    assert.match(out.stdout, /running/);
  });

  it('generates restart request identifiers without a user flag', async (t) => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-restart-test-'));
    t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
    let request;
    const projectId = '11111111-1111-4111-8111-111111111111';
    const ctx = {
      client: {
        get: async () => ({ data: { actor: { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, billing: { account_type: 'user', account_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } } }),
        post: async (route, options) => {
          request = { route, options };
          return { data: { project_id: projectId, status: 'pending' } };
        },
      },
      flags: {},
      positionals: [projectId],
      json: false,
      config: { rootDir },
    };
    await captureOutput(() => restartProject(ctx));
    assert.equal(request.route, `/api/v1/projects/${projectId}/restart`);
    assert.match(request.options.idempotencyKey, /^[0-9a-f-]{36}$/);
  });
});
