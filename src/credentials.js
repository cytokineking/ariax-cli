/** Stored Ariax API credentials: native keyring first, private file fallback. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const KEYRING_SERVICE = 'ariax-cli';
export const KEYRING_ACCOUNT = 'https://www.ariax.bio';

export function looksLikeApiKey(value) {
  return typeof value === 'string' && /^arx_[A-Za-z0-9_-]{8,}$/.test(value);
}

export function credentialFilePath({
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
} = {}) {
  if (platform === 'win32' && env.APPDATA) {
    return path.join(env.APPDATA, 'ariax-cli', 'credentials.json');
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'ariax-cli', 'credentials.json');
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'ariax-cli', 'credentials.json');
}

function credentialError(message) {
  const error = new Error(message);
  error.code = 'ARIAX_USAGE';
  error.exitCode = 1;
  return error;
}

async function defaultEntryFactory() {
  const { Entry } = await import('@napi-rs/keyring');
  return new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT);
}

export function createCredentialStore({
  entryFactory = defaultEntryFactory,
  filePath = credentialFilePath(),
  platform = process.platform,
} = {}) {
  let entryLoaded = false;
  let entry;

  async function getEntry() {
    if (entryLoaded) return entry;
    entryLoaded = true;
    try {
      entry = await entryFactory();
    } catch {
      entry = null;
    }
    return entry;
  }

  async function readFileCredential() {
    let stat;
    try {
      stat = await fs.lstat(filePath);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw credentialError('Could not read stored Ariax credentials at ' + filePath + '.');
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw credentialError('Refusing to read unsafe Ariax credential path ' + filePath + '.');
    }
    if (platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      throw credentialError(
        'Ariax credential file permissions are too broad at ' + filePath
          + '; run chmod 600 on that file.',
      );
    }
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (parsed?.version !== 1 || !looksLikeApiKey(parsed.api_key)) {
        throw new Error('invalid credential file');
      }
      return { apiKey: parsed.api_key, storage: 'file' };
    } catch {
      throw credentialError(
        'Stored Ariax credentials are invalid at ' + filePath + '; run ariax login again.',
      );
    }
  }

  return {
    filePath,

    async read() {
      const currentEntry = await getEntry();
      if (currentEntry) {
        try {
          const apiKey = await currentEntry.getPassword();
          if (looksLikeApiKey(apiKey)) return { apiKey, storage: 'keychain' };
          if (apiKey) {
            throw credentialError(
              'The Ariax credential in the system keychain is invalid; run ariax login again.',
            );
          }
        } catch (error) {
          if (error?.code === 'ARIAX_USAGE') throw error;
        }
      }
      return readFileCredential();
    },

    async storeSecure(apiKey) {
      if (!looksLikeApiKey(apiKey)) throw credentialError('Invalid Ariax API key.');
      const currentEntry = await getEntry();
      if (!currentEntry) return false;
      try {
        await currentEntry.setPassword(apiKey);
        return true;
      } catch {
        return false;
      }
    },

    async storeFile(apiKey) {
      if (!looksLikeApiKey(apiKey)) throw credentialError('Invalid Ariax API key.');
      const directory = path.dirname(filePath);
      const temporary = path.join(
        directory,
        '.credentials-' + process.pid + '-' + randomUUID() + '.tmp',
      );
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      if (platform !== 'win32') await fs.chmod(directory, 0o700);
      try {
        await fs.writeFile(
          temporary,
          JSON.stringify({ version: 1, api_key: apiKey }) + '\n',
          { encoding: 'utf8', mode: 0o600, flag: 'wx' },
        );
        await fs.rename(temporary, filePath);
        if (platform !== 'win32') await fs.chmod(filePath, 0o600);
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
      }
      return true;
    },

    async remove() {
      let keychain = false;
      const currentEntry = await getEntry();
      if (currentEntry) {
        try {
          await currentEntry.deletePassword();
          keychain = true;
        } catch {
          // A missing or unavailable keychain entry is already logged out.
        }
      }
      let file = false;
      try {
        await fs.unlink(filePath);
        file = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw credentialError('Could not remove stored Ariax credentials at ' + filePath + '.');
        }
      }
      return { keychain, file };
    },
  };
}
