import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  NPM_LATEST_URL,
  UPDATE_CHECK_INTERVAL_MS,
  automaticUpdateNotice,
  compareVersions,
  fetchLatestVersion,
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
    assert.equal(isUpdateAvailable('0.1.0', '0.1.0', 'github'), true);
    assert.equal(isUpdateAvailable('0.1.0', '0.1.0', 'unknown'), true);
    assert.equal(isUpdateAvailable('0.1.0', '0.1.0', 'npm'), false);
    assert.equal(isUpdateAvailable('0.2.0', '0.1.0', 'github'), false);
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

describe('automatic update notices', () => {
  it('caches an unpublished registry response without warning or repeated lookups', async (t) => {
    const cacheFile = await temporaryCache(t);
    assert.equal(await automaticUpdateNotice({
      currentVersion: '0.1.0', currentChannel: 'github', cacheFile, now: 1_000,
      fetchImpl: async () => new Response('', { status: 404 }),
    }), null);
    assert.equal((await readUpdateCache(cacheFile)).latest_version, null);
    assert.equal(await automaticUpdateNotice({
      currentVersion: '0.1.0', currentChannel: 'github', cacheFile, now: 2_000,
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
    await assert.rejects(fs.access(offlineCache));
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
