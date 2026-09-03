import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createClient } from '../src/http.js';
import { main } from '../src/main.js';

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

describe('CLI infrastructure confidentiality', () => {
  it('does not retain arbitrary REST error details on ApiError', async () => {
    const client = createClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: async () => new Response(JSON.stringify({
        error: {
          code: 'validation_failed',
          message: 'Job specification is invalid',
          retryable: false,
          details: {
            vendor: 'compute-vendor-a',
            internal_resource_id: 'infrastructure-secret-id',
            host: '203.0.113.8',
            path: '/root/private/run.py',
            exception: 'CalledProcessError',
          },
        },
        request_id: 'request-safe',
      }), { status: 422, headers: { 'content-type': 'application/json' } }),
    });

    await assert.rejects(client.get('/api/v1/projects/x', { attempts: 1 }), (error) => {
      assert.equal(error.message, 'Job specification is invalid');
      assert.equal(error.requestId, 'request-safe');
      assert.equal(Object.prototype.hasOwnProperty.call(error, 'details'), false);
      assert.doesNotMatch(JSON.stringify(error), /compute-vendor-a|infrastructure-secret-id|203\.0\.113\.8|\/root\/private|CalledProcessError/);
      return true;
    });
  });

  it('omits arbitrary error details from JSON-mode output', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: {
        code: 'validation_failed',
        message: 'Job specification is invalid',
        retryable: false,
        details: {
          vendor: 'compute-vendor-b',
          internal_address: '203.0.113.9',
          volume_id: 'volume-secret-id',
          trace: '/root/private/module.py:99',
        },
      },
      request_id: 'request-safe',
    }), { status: 422, headers: { 'content-type': 'application/json' } });
    try {
      const out = await captureOutput(() => main(
        ['me', '--json', '--base-url', 'https://api.example.test', '--allow-custom-origin'],
        { ARIAX_API_KEY: 'arx_abcdefghijk' },
      ));
      assert.equal(out.value, 5);
      const printed = JSON.parse(out.stdout);
      assert.deepEqual(printed, {
        error: { code: 'validation_failed', message: 'Job specification is invalid', retryable: false },
        request_id: 'request-safe',
      });
      assert.doesNotMatch(out.stdout, /compute-vendor-b|203\.0\.113\.9|volume-secret-id|\/root\/private/);
      assert.equal(out.stderr, '');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
