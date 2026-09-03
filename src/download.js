/**
 * Safe artifact downloads: presigned URL -> streaming write -> atomic rename.
 *
 * Safety rules:
 * - Reject absolute paths, drive letters, backslashes, NUL bytes, and any
 *   `..` segment that would escape the destination directory.
 * - Only allow a conservative filename charset per path segment.
 * - Stream to a temp file in the destination dir, then atomically rename.
 * - Validate declared SHA-256 checksums when metadata provides one.
 * - Never overwrite unless `overwrite: true` is explicitly requested.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { validateTransferUrl } from './http.js';

const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

export class UnsafePathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsafePathError';
    this.exitCode = 5;
  }
}

export class ChecksumMismatchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChecksumMismatchError';
    this.exitCode = 10;
  }
}

export class OverwriteRefusedError extends Error {
  constructor(dest) {
    super(`Refusing to overwrite existing file: ${dest} (pass --overwrite to replace it).`);
    this.name = 'OverwriteRefusedError';
    this.exitCode = 7;
  }
}

/**
 * Validate an artifact relative path and resolve it under destDir.
 * @param {string} destDir
 * @param {string} artifactPath
 * @returns {string} absolute destination path
 */
export function safeDestPath(destDir, artifactPath) {
  const parts = safePathParts(artifactPath);
  const base = path.resolve(destDir);
  const dest = path.resolve(base, ...parts);
  if (dest !== base && !dest.startsWith(base + path.sep)) {
    throw new UnsafePathError(`Artifact path escapes destination: ${JSON.stringify(artifactPath)}`);
  }
  return dest;
}

function safePathParts(artifactPath) {
  if (typeof artifactPath !== 'string' || artifactPath.length === 0) {
    throw new UnsafePathError('Artifact has an empty path; refusing to download.');
  }
  if (artifactPath.includes('\0')) {
    throw new UnsafePathError('Artifact path contains NUL byte; refusing to download.');
  }
  const normalized = artifactPath.replace(/\\/g, '/');
  if (normalized !== artifactPath) {
    throw new UnsafePathError(`Unsafe artifact path (backslashes): ${JSON.stringify(artifactPath)}`);
  }
  if (path.posix.isAbsolute(normalized)) {
    throw new UnsafePathError(`Unsafe artifact path (absolute): ${JSON.stringify(artifactPath)}`);
  }
  const parts = normalized.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw new UnsafePathError(`Unsafe artifact path (empty/dotdot segment): ${JSON.stringify(artifactPath)}`);
  }
  for (const seg of parts) {
    if (!SEGMENT_RE.test(seg)) {
      throw new UnsafePathError(`Unsafe artifact filename ${JSON.stringify(seg)} in ${JSON.stringify(artifactPath)}.`);
    }
  }
  return parts;
}

/** Resolve a destination after rejecting symlinked parents beneath the download root. */
export function prepareDestPath(destDir, artifactPath) {
  const parts = safePathParts(artifactPath);
  const requestedBase = path.resolve(destDir);
  fs.mkdirSync(requestedBase, { recursive: true, mode: 0o700 });
  const base = fs.realpathSync(requestedBase);
  let parent = base;
  for (const segment of parts.slice(0, -1)) {
    parent = path.join(parent, segment);
    try {
      const stat = fs.lstatSync(parent);
      if (stat.isSymbolicLink()) {
        throw new UnsafePathError(`Artifact path uses a symlinked directory: ${JSON.stringify(artifactPath)}`);
      }
      if (!stat.isDirectory()) {
        throw new UnsafePathError(`Artifact path parent is not a directory: ${JSON.stringify(artifactPath)}`);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      fs.mkdirSync(parent, { mode: 0o700 });
    }
  }
  return path.join(parent, parts.at(-1));
}

/** Extract a sha256 hex digest from artifact metadata when available. */
export function declaredSha256(artifact) {
  if (!artifact || typeof artifact !== 'object') return null;
  const candidates = [
    artifact.sha256,
    artifact.sha_256,
    artifact.checksum_sha256,
    artifact.checksum,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && /^[0-9a-fA-F]{64}$/.test(c.trim())) return c.trim().toLowerCase();
    if (c && typeof c === 'object' && typeof c.sha256 === 'string' && /^[0-9a-fA-F]{64}$/.test(c.sha256.trim())) {
      return c.sha256.trim().toLowerCase();
    }
  }
  return null;
}

/**
 * Stream a fetch Response body to a temp file, verify, then rename.
 * @param {Response} res fetch Response with a readable body
 * @param {string} dest absolute destination path
 * @param {{ expectedSha256?: string|null, overwrite?: boolean, signal?: AbortSignal, onBytes?: (bytes:number)=>void }} [opts]
 * @returns {Promise<{ path: string, bytes: number, sha256: string }>}
 */
export async function streamToFile(res, dest, opts = {}) {
  const { expectedSha256 = null, overwrite = false } = opts;
  if (!res || !res.body) throw new Error('Download response has no body.');
  if (!overwrite && fs.existsSync(dest)) throw new OverwriteRefusedError(dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const file = fs.createWriteStream(tmp, { mode: 0o600, flags: 'wx' });
  try {
    const { Readable } = await import('node:stream');
    const source = Readable.fromWeb(res.body);
    source.on('data', (chunk) => {
      bytes += chunk.length;
      hash.update(chunk);
      if (chunk.length > 0) opts.onBytes?.(chunk.length);
    });
    await pipeline(source, file, { signal: opts.signal });
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw err;
  }
  const digest = hash.digest('hex');
  if (expectedSha256 && digest !== expectedSha256.toLowerCase()) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw new ChecksumMismatchError(
      `Checksum mismatch for ${path.basename(dest)}: expected sha256 ${expectedSha256}, got ${digest}.`,
    );
  }
  if (overwrite) {
    fs.renameSync(tmp, dest);
  } else {
    // link() fails atomically with EEXIST, closing the check/rename race that
    // could otherwise overwrite a file created while the download was active.
    try {
      fs.linkSync(tmp, dest);
      fs.unlinkSync(tmp);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch {}
      if (err?.code === 'EEXIST') throw new OverwriteRefusedError(dest);
      throw err;
    }
  }
  return { path: dest, bytes, sha256: digest };
}

/**
 * Download one artifact via presigned URL.
 * @param {typeof fetch} fetchImpl
 * @param {string} url presigned URL
 * @param {string} dest absolute destination path
 * timeoutMs bounds connection and read inactivity, not the total transfer time.
 * @param {{ expectedSha256?: string|null, overwrite?: boolean, timeoutMs?: number, signal?: AbortSignal }} [opts]
 */
export async function downloadUrl(fetchImpl, url, dest, opts = {}) {
  const source = validateTransferUrl(url, 'Download');
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const signal = opts.signal ? AbortSignal.any([ctrl.signal, opts.signal]) : ctrl.signal;
  let res;
  try {
    signal.throwIfAborted();
    res = await fetchImpl(source, { signal, redirect: 'error' });
    timer.refresh();
    if (!res.ok) {
      await res.body?.cancel();
      const error = new Error(`Download failed (HTTP ${res.status}) for ${path.basename(dest)}.`);
      error.status = res.status;
      throw error;
    }
    return await streamToFile(res, dest, { ...opts, signal, onBytes: () => timer.refresh() });
  } catch (err) {
    if (opts.signal?.aborted) throw opts.signal.reason;
    if (ctrl.signal.aborted || err?.name === 'AbortError') {
      throw new Error(`Download timed out after ${timeoutMs}ms without progress: ${dest}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
