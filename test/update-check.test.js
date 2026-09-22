import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  NPM_LATEST_URL,
  GITHUB_LATEST_URL,
  UPDATE_CHECK_INTERVAL_MS,
  automaticUpdateNotice,
  compareVersions,
  fetchLatestVersion,
  fetchLatestRevision,
  formatUpdateNotice,
  isUpdateAvailable,
  parseVersion,
  readUpdateCache,
  shouldRunAutomaticUpdateCheck,
  updateCachePath,
} from '../src/update-check.js';

async function temporaryCache(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ariax-update-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return path.join(directory, 'update-check.json');
}

describe('update version comparison', () => {
  it('parses stable and prerelease SemVer without accepting malformed values', () => {
    assert.deepEqual(parseVersion('1.2.3'), {
      major: 1, minor: 2, patch: 3, prerelease: [],
    });
    assert.deepEqual(parseVersion('1.2.3-beta.2+build.4')?.prerelease, ['beta', '2']);
    for (const invalid of ['v1.2.3', '1.2', '01.2.3', '1.2.3-01', 'latest', null]) {
      assert.equal(parseVersion(invalid), null);
    }
  });

  it('orders stable, prerelease, and development-ahead versions correctly', () => {
    assert.equal(compareVersions('1.2.3', '1.2.4'), -1);
    assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
    assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1);
    assert.equal(compareVersions('1.0.0-beta.1', '1.0.0'), -1);
    assert.equal(compareVersions('1.0.0+local', '1.0.0'), 0);
    assert.equal(compareVersions('bad', '1.0.0'), null);
    assert.equal(isUpdateAvailable('1.0.0', '1.1.0'), true);
    assert.equal(isUpdateAvailable('2.0.0', '1.1.0'), false);
    assert.equal(isUpdateAvailable('0.1.0', '0.1.0'), false);
    assert.equal(isUpdateAvailable('0.2.0', '0.1.0'), false);
  });
});

describe('npm latest lookup', () => {
  it('treats a missing first package separately from registry failure', async () => {
    assert.equal(await fetchLatestVersion({ fetchImpl: async () => new Response('', { status: 404 }) }), null);
  });
  it('uses the fixed HTTPS registry URL without credentials', async () => {
    let request;
    const latest = await fetchLatestVersion({
      fetchImpl: async (url, options) => {
        request = { url, options };
        return new Response(JSON.stringify({ version: '1.4.0' }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    assert.equal(latest, '1.4.0');
    assert.equal(request.url, NPM_LATEST_URL);
    assert.equal(request.options.method, 'GET');
    assert.equal(request.options.redirect, 'error');
    assert.equal(request.options.headers.authorization, undefined);
    assert.equal(JSON.stringify(request.options).includes('arx_'), false);
  });

  it('rejects registry errors and invalid versions', async () => {
    await assert.rejects(
      fetchLatestVersion({ fetchImpl: async () => new Response('', { status: 503 }) }),
      /HTTP 503/,
    );
    await assert.rejects(
      fetchLatestVersion({ fetchImpl: async () => new Response(JSON.stringify({ version: 'latest' })) }),
      /invalid stable version/,
    );
    await assert.rejects(
      fetchLatestVersion({ fetchImpl: async () => new Response(JSON.stringify({ version: '2.0.0-beta.1' })) }),
      /invalid stable version/,
    );
  });
});

describe('GitHub latest lookup', () => {
  it('resolves main without credentials and validates the complete SHA', async () => {
    const sha = 'b'.repeat(40);
    assert.equal(await fetchLatestRevision({ fetchImpl: async (url, options) => {
      assert.equal(url, GITHUB_LATEST_URL);
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.authorization, undefined);
      assert.ok(options.signal instanceof AbortSignal);
      return new Response(JSON.stringify({ sha }));
    } }), sha);
    for (const response of [new Response('', { status: 403 }), new Response(JSON.stringify({ sha: 'short' }))]) {
      await assert.rejects(fetchLatestRevision({ fetchImpl: async () => response }), /GitHub returned/);
    }
  });
});

describe('automatic update notices', () => {
  it('checks GitHub commits even when the package version has not changed', async (t) => {
    const cacheFile = await temporaryCache(t);
    const options = { currentVersion: '0.1.0', currentChannel: 'github', currentRevision: 'a'.repeat(40), cacheFile, now: 1_000 };
    let calls = 0;
    const fetchImpl = async (url) => {
      calls += 1;
      assert.equal(url, GITHUB_LATEST_URL);
      return new Response(JSON.stringify({ sha: 'b'.repeat(40) }));
    };
    const notice = await automaticUpdateNotice({ ...options, fetchImpl });
    assert.equal(notice.latestRevision, 'b'.repeat(40));
    assert.match(formatUpdateNotice(notice), /GitHub main is at b{12}; you have a{12}.*ariax upgrade/);
    assert.equal(await automaticUpdateNotice({ ...options, fetchImpl, now: 2_000 }), null);
    assert.equal(await automaticUpdateNotice({ ...options, fetchImpl, currentRevision: 'b'.repeat(40), now: 3_000 }), null);
    assert.equal(calls, 1);
    assert.ok(await automaticUpdateNotice({ ...options, fetchImpl, now: UPDATE_CHECK_INTERVAL_MS + 1_001 }));
    assert.equal(calls, 2);
  });

  it('does not reuse a cached release from a different channel', async (t) => {
    const cacheFile = await temporaryCache(t);
    let calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return new Response(JSON.stringify(url === GITHUB_LATEST_URL ? { sha: 'a'.repeat(40) } : { version: '0.1.0' }));
    };
    const options = { currentVersion: '0.1.0', currentRevision: 'a'.repeat(40), cacheFile, fetchImpl, now: 1_000 };
    assert.equal(await automaticUpdateNotice({ ...options, currentChannel: 'github' }), null);
    assert.equal(await automaticUpdateNotice({ ...options, currentChannel: 'npm', now: 2_000 }), null);
    assert.deepEqual(calls, [GITHUB_LATEST_URL, NPM_LATEST_URL]);
  });

  it('ignores old npm-only caches when checking a GitHub build', async (t) => {
    const cacheFile = await temporaryCache(t);
    await fs.writeFile(cacheFile, JSON.stringify({ version: 1, checked_at: new Date(1_000).toISOString(), latest_version: '1.0.0' }));
    assert.equal(await readUpdateCache(cacheFile), null);
    const notice = await automaticUpdateNotice({
      currentVersion: '0.1.0', currentChannel: 'github', currentRevision: 'a'.repeat(40), cacheFile, now: 2_000,
      fetchImpl: async () => new Response(JSON.stringify({ sha: 'b'.repeat(40) })),
    });
    assert.equal(notice.latestRevision, 'b'.repeat(40));
  });

  it('caches an unpublished registry response without warning or repeated lookups', async (t) => {
    const cacheFile = await temporaryCache(t);
    assert.equal(await automaticUpdateNotice({
      currentVersion: '0.1.0', currentChannel: 'npm', cacheFile, now: 1_000,
      fetchImpl: async () => new Response('', { status: 404 }),
    }), null);
    assert.equal((await readUpdateCache(cacheFile)).latest_version, null);
    assert.equal(await automaticUpdateNotice({
      currentVersion: '0.1.0', currentChannel: 'npm', cacheFile, now: 2_000,
      fetchImpl: async () => { throw new Error('unexpected lookup'); },
    }), null);
  });
  it('checks immediately, then uses the cache and notifies at most once per interval', async (t) => {
    const cacheFile = await temporaryCache(t);
    const start = Date.parse('2026-09-03T12:00:00Z');
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response(JSON.stringify({ version: '1.1.0' }));
    };

    assert.deepEqual(await automaticUpdateNotice({
      currentVersion: '1.0.0', cacheFile, fetchImpl, now: start,
    }), { currentVersion: '1.0.0', latestVersion: '1.1.0' });
    assert.equal(calls, 1);

    assert.equal(await automaticUpdateNotice({
      currentVersion: '1.0.0', cacheFile,
      fetchImpl: async () => { throw new Error('cache should avoid fetch'); },
      now: start + 1_000,
    }), null);
    assert.equal(calls, 1);

    assert.deepEqual(await automaticUpdateNotice({
      currentVersion: '1.0.0', cacheFile, fetchImpl,
      now: start + UPDATE_CHECK_INTERVAL_MS + 1,
    }), { currentVersion: '1.0.0', latestVersion: '1.1.0' });
    assert.equal(calls, 2);
  });

  it('caches a current version and silently ignores offline checks', async (t) => {
    const cacheFile = await temporaryCache(t);
    assert.equal(await automaticUpdateNotice({
      currentVersion: '1.0.0',
      cacheFile,
      fetchImpl: async () => new Response(JSON.stringify({ version: '1.0.0' })),
      now: 1_000,
    }), null);
    assert.equal((await readUpdateCache(cacheFile)).latest_version, '1.0.0');

    const offlineCache = path.join(path.dirname(cacheFile), 'offline.json');
    assert.equal(await automaticUpdateNotice({
      currentVersion: '1.0.0',
      cacheFile: offlineCache,
      fetchImpl: async () => { throw new Error('offline'); },
      now: 1_000,
    }), null);
    assert.equal((await readUpdateCache(offlineCache)).checked_at, new Date(1_000).toISOString());
    let retried = false;
    await automaticUpdateNotice({
      currentVersion: '1.0.0', cacheFile: offlineCache, now: 2_000,
      fetchImpl: async () => { retried = true; throw new Error('offline'); },
    });
    assert.equal(retried, false);
  });

  it('runs only for ordinary interactive human commands', () => {
    const enabled = { command: 'projects', jsonMode: false, env: {}, interactive: true };
    assert.equal(shouldRunAutomaticUpdateCheck(enabled), true);
    assert.equal(shouldRunAutomaticUpdateCheck({ ...enabled, command: 'upgrade' }), false);
    assert.equal(shouldRunAutomaticUpdateCheck({ ...enabled, command: 'login' }), false);
    assert.equal(shouldRunAutomaticUpdateCheck({ ...enabled, command: 'logout' }), false);
    assert.equal(shouldRunAutomaticUpdateCheck({ ...enabled, command: 'help' }), false);
    assert.equal(shouldRunAutomaticUpdateCheck({ ...enabled, jsonMode: true }), false);
    assert.equal(shouldRunAutomaticUpdateCheck({ ...enabled, interactive: false }), false);
    assert.equal(shouldRunAutomaticUpdateCheck({ ...enabled, env: { CI: 'true' } }), false);
    assert.equal(shouldRunAutomaticUpdateCheck({ ...enabled, env: { NO_UPDATE_NOTIFIER: '1' } }), false);
  });

  it('uses normal per-user cache locations and a concise notice', () => {
    assert.equal(
      updateCachePath({ platform: 'darwin', home: '/Users/test', env: {} }),
      '/Users/test/Library/Caches/ariax-cli/update-check.json',
    );
    assert.equal(
      formatUpdateNotice({ currentVersion: '1.0.0', latestVersion: '1.1.0' }),
      'Ariax CLI 1.1.0 is available; you have 1.0.0. Run: ariax upgrade',
    );
  });
});
