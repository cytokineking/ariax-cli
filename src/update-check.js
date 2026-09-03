/** Quiet, dependency-free checks for newer stable ariax-cli releases on npm. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const NPM_LATEST_URL = 'https://registry.npmjs.org/ariax-cli/latest';

/** Return parsed SemVer parts, or null for an invalid version. */
export function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );
  if (!match) return null;
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

/** SemVer comparison: negative when a < b, positive when a > b. */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const l = left.prerelease[i];
    const r = right.prerelease[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    const lNumeric = /^\d+$/.test(l);
    const rNumeric = /^\d+$/.test(r);
    if (lNumeric && rNumeric) return Number(l) < Number(r) ? -1 : 1;
    if (lNumeric !== rNumeric) return lNumeric ? -1 : 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

export function isUpdateAvailable(currentVersion, latestVersion, currentChannel = 'npm') {
  const comparison = compareVersions(currentVersion, latestVersion);
  return comparison === -1 || (comparison === 0 && currentChannel !== 'npm');
}

/** Use the operating system's normal per-user cache location. */
export function updateCachePath({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (platform === 'win32' && env.LOCALAPPDATA) {
    return path.join(env.LOCALAPPDATA, 'ariax-cli', 'update-check.json');
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Caches', 'ariax-cli', 'update-check.json');
  }
  return path.join(env.XDG_CACHE_HOME || path.join(home, '.cache'), 'ariax-cli', 'update-check.json');
}

export async function readUpdateCache(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!parsed || parsed.version !== 1) return null;
    if (typeof parsed.checked_at !== 'string') return null;
    if ((parsed.latest_version !== null && !parseVersion(parsed.latest_version))
      || !Number.isFinite(Date.parse(parsed.checked_at))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeUpdateCache(file, value) {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** Fetch npm's stable `latest` release. No Ariax headers or credentials are used. */
export async function fetchLatestVersion({ fetchImpl = globalThis.fetch, timeoutMs = 5_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(NPM_LATEST_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    // Absence of a first release is a valid bootstrap state, not a registry outage.
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
    const body = await response.json();
    const parsed = parseVersion(body?.version);
    if (!parsed || parsed.prerelease.length > 0) {
      throw new Error('npm registry returned an invalid stable version');
    }
    return body.version;
  } finally {
    clearTimeout(timer);
  }
}

export function shouldRunAutomaticUpdateCheck({ command, jsonMode, env = process.env, interactive } = {}) {
  if (!interactive || jsonMode) return false;
  if (!command || ['help', 'upgrade', 'login', 'logout', 'inputs'].includes(command)) return false;
  if (env.NO_UPDATE_NOTIFIER === '1') return false;
  const ci = String(env.CI ?? '').toLowerCase();
  if (ci && ci !== '0' && ci !== 'false') return false;
  return true;
}

/**
 * Return a notice at most once per interval. Automatic failures are intentionally
 * swallowed so npm availability can never affect an Ariax command.
 */
export async function automaticUpdateNotice({
  currentVersion,
  currentChannel = 'npm',
  fetchImpl = globalThis.fetch,
  cacheFile = updateCachePath(),
  now = Date.now(),
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
  timeoutMs = 750,
} = {}) {
  try {
    const nowIso = new Date(now).toISOString();
    const cached = await readUpdateCache(cacheFile);
    const checkedAt = cached ? Date.parse(cached.checked_at) : Number.NaN;
    const fresh = cached && now - checkedAt >= 0 && now - checkedAt < intervalMs;
    let latestVersion = cached?.latest_version;
    let next = cached;

    if (!fresh) {
      latestVersion = await fetchLatestVersion({ fetchImpl, timeoutMs });
      next = {
        version: 1,
        checked_at: nowIso,
        latest_version: latestVersion,
        ...(cached?.latest_version === latestVersion && cached?.notified_at
          ? { notified_at: cached.notified_at, notified_version: cached.notified_version }
          : {}),
      };
    }

    if (!isUpdateAvailable(currentVersion, latestVersion, currentChannel)) {
      if (!fresh) await writeUpdateCache(cacheFile, next);
      return null;
    }

    const notifiedAt = next?.notified_at ? Date.parse(next.notified_at) : Number.NaN;
    const alreadyNotified = next?.notified_version === latestVersion
      && now - notifiedAt >= 0
      && now - notifiedAt < intervalMs;
    if (alreadyNotified) {
      if (!fresh) await writeUpdateCache(cacheFile, next);
      return null;
    }

    await writeUpdateCache(cacheFile, {
      ...next,
      notified_at: nowIso,
      notified_version: latestVersion,
    });
    return { currentVersion, latestVersion };
  } catch {
    return null;
  }
}

export function formatUpdateNotice({ currentVersion, latestVersion }) {
  return `Ariax CLI ${latestVersion} is available; you have ${currentVersion}. Run: ariax upgrade`;
}
