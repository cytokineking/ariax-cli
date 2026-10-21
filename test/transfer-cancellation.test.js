import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient, NetworkError } from '../src/http.js';
import { downloadUrl } from '../src/download.js';

describe('caller cancellation', () => {
  it('cancels an API request without GET retries and removes caller listeners', async () => {
    const caller = new AbortController();
    let calls = 0;
    const client = createClient({ baseUrl: 'https://api.example', fetchImpl: async (_url, { signal }) => {
      calls++;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        caller.abort(new Error('Cancelled by caller'));
      });
    } });
    await assert.rejects(client.get('/items', { signal: caller.signal }), { exitCode: 130, message: 'Cancelled by caller' });
    assert.equal(calls, 1);
    assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  });

  it('keeps timeouts as network failures and cleans up successful caller listeners', async () => {
    const caller = new AbortController();
    const client = createClient({ baseUrl: 'https://api.example', fetchImpl: async () => new Response('{"data":[]}') });
    await client.get('/items', { signal: caller.signal });
    assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
    const timeout = createClient({ baseUrl: 'https://api.example', timeoutMs: 5, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }) });
    await assert.rejects(timeout.get('/items', { attempts: 1, signal: caller.signal }), NetworkError);
    assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  });

  it('stops retry backoff promptly when cancelled', async () => {
    const caller = new AbortController();
    let calls = 0;
    const client = createClient({ baseUrl: 'https://api.example', fetchImpl: async () => { calls++; return new Response('', { status: 503 }); }, sleepImpl: () => {
      caller.abort();
      return new Promise(() => {});
    } });
    await assert.rejects(client.get('/items', { signal: caller.signal }), { exitCode: 130 });
    assert.equal(calls, 1);
    assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  });

  it('clears the real retry timer so an interrupted CLI exits naturally', async () => {
    const script = `
      import { createClient } from ${JSON.stringify(new URL('../src/http.js', import.meta.url).href)};
      import { getEventListeners } from 'node:events';
      const caller = new AbortController();
      let calls = 0;
      const client = createClient({
        baseUrl: 'https://api.example',
        fetchImpl: async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '120' } }); },
        onRetry: () => setTimeout(() => caller.abort(), 10),
      });
      try { await client.get('/items', { signal: caller.signal }); }
      catch (error) { console.log(JSON.stringify({ exitCode: error.exitCode, calls, listeners: getEventListeners(caller.signal, 'abort').length })); }
    `;
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { timeout: 3000 });
    assert.deepEqual(JSON.parse(stdout), { exitCode: 130, calls: 1, listeners: 0 });
  });

  it('allows a progressing body to transfer for longer than the inactivity timeout', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-progress-'));
    const dest = path.join(dir, 'result.pdb');
    let interval;
    let chunks = 0;
    const fetchImpl = async () => new Response(new ReadableStream({
      start(controller) {
        interval = setInterval(() => {
          controller.enqueue(new Uint8Array([65]));
          if (++chunks === 20) { clearInterval(interval); controller.close(); }
        }, 25);
      },
      cancel() { clearInterval(interval); },
    }));
    try {
      const started = Date.now();
      const result = await downloadUrl(fetchImpl, 'https://storage.example/result', dest, { timeoutMs: 200 });
      assert.ok(Date.now() - started > 200);
      assert.equal(result.bytes, 20);
      assert.equal(fs.readFileSync(dest, 'utf8'), 'A'.repeat(20));
      assert.deepEqual(fs.readdirSync(dir), ['result.pdb']);
    } finally { clearInterval(interval); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('bounds a stalled connection before the response arrives', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-connect-'));
    const fetchImpl = async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    try {
      await assert.rejects(downloadUrl(fetchImpl, 'https://storage.example/result', path.join(dir, 'result.pdb'), { timeoutMs: 10 }), /without progress/);
      assert.deepEqual(fs.readdirSync(dir), []);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('cancels a body with the caller reason and removes incomplete files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-cancel-body-'));
    const caller = new AbortController();
    const reason = Object.assign(new Error('Download interrupted.'), { exitCode: 130 });
    let cancelled = false;
    const fetchImpl = async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('incomplete')); },
      cancel() { cancelled = true; },
    }));
    const timer = setTimeout(() => caller.abort(reason), 20);
    try {
      await assert.rejects(downloadUrl(fetchImpl, 'https://storage.example/result', path.join(dir, 'result.pdb'), { signal: caller.signal }), (error) => error === reason);
      assert.equal(cancelled, true);
      assert.deepEqual(fs.readdirSync(dir), []);
      assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
    } finally { clearTimeout(timer); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('times out the body transfer and removes partial files while preserving the original', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-cancel-'));
    const dest = path.join(dir, 'result.pdb');
    fs.writeFileSync(dest, 'original');
    let cancelled = false;
    const fetchImpl = async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('incomplete')); },
      cancel() { cancelled = true; },
    }));
    try {
      await assert.rejects(downloadUrl(fetchImpl, 'https://storage.example/result', dest, { overwrite: true, timeoutMs: 10 }), /timed out/);
      assert.equal(cancelled, true);
      assert.equal(fs.readFileSync(dest, 'utf8'), 'original');
      assert.deepEqual(fs.readdirSync(dir), ['result.pdb']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
