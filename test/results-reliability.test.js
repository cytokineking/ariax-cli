import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { collectArtifacts, run } from '../src/commands/results.js';

const projectId = '123e4567-e89b-12d3-a456-426614174000';
const directories = [];
const digest = (content) => crypto.createHash('sha256').update(content).digest('hex');
const artifact = (name, content = name) => ({ path: `output/${name}.txt`, size: Buffer.byteLength(content), sha256: digest(content) });
function directory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-results-'));
  directories.push(dir);
  return dir;
}
afterEach(() => directories.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function context(client, dir, fetchImpl, extra = {}) {
  return { client, flags: { download: dir, overwrite: true }, positionals: [projectId], json: true, fetchImpl, ...extra };
}
function clientFor(items, post) {
  return {
    get: async () => ({ data: items, meta: { next_cursor: null, output_roots: ['output'], archive_manifest_url: null } }),
    post: post ?? (async (_url, { body }) => ({ data: body.paths.map((key) => ({ path: key, url: `https://storage.example/${key}` })) })),
  };
}

describe('artifact pagination reliability', () => {
  it('retrieves more than 2,000 entries through empty filtered pages', async () => {
    let calls = 0;
    const items = await collectArtifacts({ get: async (_url, { query }) => {
      assert.equal(query.cursor, calls ? `page-${calls}` : undefined);
      const page = calls++;
      return { data: page === 7 ? [] : Array.from({ length: 100 }, (_, i) => ({ path: `output/${page}-${i}.pdb` })), meta: { next_cursor: page < 25 ? `page-${calls}` : null } };
    } }, projectId);
    assert.equal(items.length, 2500);
    assert.equal(calls, 26);
  });

  it('rejects a repeated cursor, including cycles over empty pages', async () => {
    let calls = 0;
    await assert.rejects(collectArtifacts({ get: async () => ({ data: [], meta: { next_cursor: ['a', 'b', 'a'][calls++] } }) }, projectId), /repeated a continuation cursor/);
    assert.equal(calls, 3);
  });

  it('preserves API output-root and sanitized-manifest discovery in JSON', async (t) => {
    const lines = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = (line) => { lines.push(String(line)); return true; };
    try { await run({
      client: { get: async (_url, { query }) => {
        assert.equal(query.path, undefined);
        return { data: [{ path: 'ranked_results/combined_ranking.csv' }], meta: {
          next_cursor: null, output_roots: ['esmfold2', 'validation', 'ranked_results', 'archives'],
          archive_manifest_url: `/api/v1/projects/${projectId}/artifacts/archive-manifest`,
        } };
      } }, flags: {}, positionals: [projectId], json: true,
    });
    } finally { process.stdout.write = originalWrite; }
    const output = JSON.parse(lines.join(''));
    assert.equal(output.meta.output_roots.length, 4);
    assert.match(output.meta.archive_manifest_url, /archive-manifest$/);
  });

  it('cancels pagination without reading another page and removes SIGINT handler', async (t) => {
    const controller = new AbortController();
    const before = process.listenerCount('SIGINT');
    let calls = 0;
    await assert.rejects(run({
      client: { get: async () => { calls++; controller.abort(new Error('cancelled')); return { data: [], meta: { next_cursor: 'more' } }; } },
      flags: {}, positionals: [projectId], json: true, signal: controller.signal,
    }), /cancelled/);
    assert.equal(calls, 1);
    assert.equal(process.listenerCount('SIGINT'), before);
  });
});

describe('download recovery', () => {
  it('signs bounded batches just before transfer and downloads before fetching the next page', async (t) => {
    let page = 0;
    let fetched = 0;
    const signedSizes = [];
    const client = {
      get: async () => {
        if (page++) { assert.equal(fetched, 101); return { data: [artifact('last')], meta: { next_cursor: null } }; }
        return { data: Array.from({ length: 101 }, (_, i) => artifact(String(i))), meta: { next_cursor: 'more' } };
      },
      post: async (_url, { body }) => {
        signedSizes.push(body.paths.length);
        if (signedSizes.length === 2) assert.equal(fetched, 100);
        return { data: body.paths.map((key) => ({ path: key, url: `https://storage.example/${key}` })) };
      },
    };
    await run(context(client, directory(), async (url) => { fetched++; return new Response(path.basename(new URL(url).pathname, '.txt')); }));
    assert.deepEqual(signedSizes, [100, 1, 1]);
    assert.equal(fetched, 102);
  });

  it('refreshes an expired storage URL once and checkpoints only completed bytes', async (t) => {
    const dir = directory();
    let signed = 0;
    let fetched = 0;
    const client = clientFor([artifact('a')], async (_url, { body }) => ({ data: [{ path: body.paths[0], url: `https://storage.example/signed-${++signed}` }] }));
    const result = await run(context(client, dir, async () => ++fetched === 1 ? new Response('expired', { status: 403 }) : new Response('a')));
    assert.equal(result.downloaded, 1);
    assert.equal(signed, 2);
    const journal = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((name) => name.startsWith('.ariax-download-'))), 'utf8');
    assert.ok(journal.includes(digest('a')));
    assert.ok(!journal.includes('storage.example'));
    assert.ok(!journal.includes('signed-'));
  });

  it('refreshes a known expired URL before fetching and does not loop on forbidden responses', async (t) => {
    let signed = 0;
    let fetched = 0;
    const client = clientFor([artifact('a')], async () => ({ data: [{ path: 'output/a.txt', url: `https://storage.example/${++signed}`, expires_at: signed === 1 ? '2000-01-01T00:00:00Z' : '2999-01-01T00:00:00Z' }] }));
    await assert.rejects(run(context(client, directory(), async (url) => {
      fetched++;
      assert.ok(url.endsWith('/2'));
      return new Response('forbidden', { status: 403 });
    })), /1 artifact\(s\) failed/);
    assert.equal(signed, 2);
    assert.equal(fetched, 1);
  });

  it('resumes a partial batch even with --overwrite and redownloads changed local bytes', async (t) => {
    const dir = directory();
    const client = clientFor([artifact('a'), artifact('b')]);
    await assert.rejects(run(context(client, dir, async (url) => {
      if (url.endsWith('/b.txt')) throw new Error('connection lost');
      return new Response('a');
    })), /failed to download/);
    const requests = [];
    const resumed = await run(context(client, dir, async (url) => { requests.push(url); return new Response('b'); }));
    assert.equal(resumed.resumed, 1);
    assert.equal(resumed.downloaded, 1);
    assert.equal(requests.length, 1);
    fs.writeFileSync(path.join(dir, 'output/a.txt'), 'x');
    const fixed = await run(context(client, dir, async () => new Response('a')));
    assert.equal(fixed.downloaded, 1);
    assert.equal(fixed.resumed, 1);
  });

  it('does not trust checkpoints for changed remote identities or overwrite unrelated files', async (t) => {
    const dir = directory();
    await run(context(clientFor([artifact('a')]), dir, async () => new Response('a')));
    const changed = await run(context(clientFor([artifact('a', 'new')]), dir, async () => new Response('new')));
    assert.equal(changed.downloaded, 1);
    fs.writeFileSync(path.join(dir, 'output/b.txt'), 'user data');
    const skipped = await run(context(clientFor([artifact('b')]), dir, async () => { throw new Error('must not fetch'); }, { flags: { download: dir } }));
    assert.equal(skipped.downloaded, 0);
    assert.equal(fs.readFileSync(path.join(dir, 'output/b.txt'), 'utf8'), 'user data');
  });
});
