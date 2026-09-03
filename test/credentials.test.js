import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createCredentialStore,
  credentialFilePath,
  looksLikeApiKey,
} from '../src/credentials.js';

async function temporaryCredentialFile(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ariax-credentials-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return path.join(directory, 'credentials.json');
}

describe('credential storage', () => {
  it('recognizes only Ariax-shaped keys', () => {
    assert.equal(looksLikeApiKey('arx_abcdefghijk'), true);
    assert.equal(looksLikeApiKey('not-a-key'), false);
    assert.equal(looksLikeApiKey('arx_short'), false);
  });

  it('uses normal per-user config locations', () => {
    assert.equal(
      credentialFilePath({ platform: 'darwin', home: '/Users/test', env: {} }),
      '/Users/test/Library/Application Support/ariax-cli/credentials.json',
    );
    assert.equal(
      credentialFilePath({ platform: 'linux', home: '/home/test', env: {} }),
      '/home/test/.config/ariax-cli/credentials.json',
    );
    assert.equal(
      credentialFilePath({
        platform: 'win32',
        home: 'C:\\Users\\test',
        env: { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
      }),
      'C:\\Users\\test\\AppData\\Roaming/ariax-cli/credentials.json',
    );
  });

  it('stores and reads through the system keychain without touching the file', async (t) => {
    const filePath = await temporaryCredentialFile(t);
    let password = null;
    const store = createCredentialStore({
      filePath,
      entryFactory: async () => ({
        getPassword: async () => password,
        setPassword: async (value) => { password = value; },
        deletePassword: async () => { password = null; },
      }),
    });
    assert.equal(await store.storeSecure('arx_abcdefghijk'), true);
    assert.deepEqual(await store.read(), {
      apiKey: 'arx_abcdefghijk',
      storage: 'keychain',
    });
    await assert.rejects(fs.access(filePath));
    assert.deepEqual(await store.remove(), { keychain: true, file: false });
    assert.equal(await store.read(), null);
  });

  it('writes a private fallback file and removes it', async (t) => {
    const filePath = await temporaryCredentialFile(t);
    const store = createCredentialStore({
      filePath,
      platform: 'linux',
      entryFactory: async () => { throw new Error('unavailable'); },
    });
    assert.equal(await store.storeSecure('arx_abcdefghijk'), false);
    await store.storeFile('arx_abcdefghijk');
    assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);
    assert.deepEqual(await store.read(), {
      apiKey: 'arx_abcdefghijk',
      storage: 'file',
    });
    assert.deepEqual(await store.remove(), { keychain: false, file: true });
    assert.equal(await store.read(), null);
  });

  it('refuses a fallback file readable by other users', async (t) => {
    const filePath = await temporaryCredentialFile(t);
    await fs.writeFile(
      filePath,
      JSON.stringify({ version: 1, api_key: 'arx_abcdefghijk' }),
      { mode: 0o644 },
    );
    const store = createCredentialStore({
      filePath,
      platform: 'linux',
      entryFactory: async () => { throw new Error('unavailable'); },
    });
    await assert.rejects(store.read(), /permissions are too broad/);
  });
});
