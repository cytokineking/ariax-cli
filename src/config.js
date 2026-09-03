/** Runtime config from env + global flags. Never logs the API key. */
import path from 'node:path';

export const DEFAULT_BASE_URL = 'https://www.ariax.bio';
const OFFICIAL_API_ORIGINS = new Set([
  'https://ariax.bio',
  'https://www.ariax.bio',
]);

function configError(message) {
  const error = new Error(message);
  error.code = 'ARIAX_USAGE';
  error.exitCode = 1;
  return error;
}

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

export function supportsStoredCredentials(baseUrl) {
  try {
    return OFFICIAL_API_ORIGINS.has(new URL(baseUrl).origin);
  } catch {
    return false;
  }
}

function parseBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw configError('API base URL must be a valid absolute URL.');
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw configError('API base URL must contain only an origin (no credentials, path, query, or fragment).');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw configError('API base URL must use HTTPS; HTTP is allowed only for localhost development.');
  }
  return url.origin;
}

export function loadConfig(flags, env = process.env) {
  const apiKey = env.ARIAX_API_KEY || '';
  const rawBase =
    flags['base-url'] || env.ARIAX_BASE_URL || DEFAULT_BASE_URL;
  const baseUrl = parseBaseUrl(rawBase);
  const rootDir = flags['root-dir']
    ? path.resolve(String(flags['root-dir']))
    : path.resolve(env.ARIAX_ROOT_DIR || process.cwd());
  const jsonForced = flags.json === true;
  const jsonDisabled = flags.json === false;
  const piped = !process.stdout.isTTY;
  const jsonMode = jsonForced || (!jsonDisabled && piped);
  const allowCustomOrigin = flags['allow-custom-origin'] === true
    || env.ARIAX_ALLOW_CUSTOM_ORIGIN === '1';
  return {
    apiKey,
    apiKeySource: apiKey ? 'environment' : null,
    baseUrl,
    rootDir,
    jsonMode,
    jsonForced,
    allowCustomOrigin,
  };
}

export function requireApiKey(config) {
  if (!config.apiKey || !config.apiKey.startsWith('arx_')) {
    const err = new Error(
      'Ariax is not connected. Run `ariax login`, or set ARIAX_API_KEY for automation.'
    );
    err.code = 'AUTH';
    err.exitHint = 'auth';
    throw err;
  }
}

/** Prevent accidental credential disclosure to a mistyped or malicious API host. */
export function requireTrustedApiOrigin(config) {
  const url = new URL(config.baseUrl);
  if (OFFICIAL_API_ORIGINS.has(url.origin) || isLoopback(url.hostname)) return;
  if (config.allowCustomOrigin) return;
  throw configError(
    `Refusing to send an API key to non-Ariax origin ${url.origin}. `
      + 'For an intentional self-hosted or test endpoint, add --allow-custom-origin.',
  );
}
