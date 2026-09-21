/**
 * `ariax results <project-id> [--path <artifact-prefix>] [--download <dir>] [--overwrite] [--limit N] [--details]`
 * List artifacts; with --download, presign + stream each file safely.
 */
import fs from 'node:fs';
import path from 'node:path';
import { printData, printJson, printTable, printProgress } from '../output.js';
import { usageError } from '../args.js';
import { EXIT } from '../exit-codes.js';
import { resolveProjectId } from '../resolve.js';
import { prepareDestPath, declaredSha256, downloadUrl } from '../download.js';
import { openDownloadState } from '../download-state.js';

/** @param {{ client: any, flags: Record<string, any>, positionals: string[], json: boolean, fetchImpl?: typeof fetch }} ctx */
export async function run(ctx) {
  const operand = ctx.positionals[0];
  if (!operand) throw usageError('results: missing <project-id> (UUID or exact unique project name).');
  const projectId = await resolveProjectId(ctx.client, String(operand));

  let limit;
  if (ctx.flags.limit !== undefined) {
    limit = Number(ctx.flags.limit);
    if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
      throw usageError(`results: --limit must be an integer 1..100 (got "${ctx.flags.limit}").`);
    }
  }
  let artifactPrefix;
  if (ctx.flags.path !== undefined) {
    if (typeof ctx.flags.path !== 'string' || ctx.flags.path === '') {
      throw usageError('results: --path requires an artifact prefix (e.g. --path output).');
    }
    artifactPrefix = ctx.flags.path;
  }
  const downloadDir = ctx.flags.download;
  if (downloadDir !== undefined && (typeof downloadDir !== 'string' || downloadDir === '')) {
    throw usageError('results: --download requires a directory (e.g. --download ./out).');
  }
  const controller = new AbortController();
  const interrupt = () => {
    const error = new Error('Results interrupted. Re-run the same command to resume completed downloads.');
    error.exitCode = EXIT.INTERRUPTED;
    controller.abort(error);
  };
  process.once('SIGINT', interrupt);
  const signal = ctx.signal ? AbortSignal.any([controller.signal, ctx.signal]) : controller.signal;
  const meta = {};
  const responseInfo = {};
  try {
    const pages = artifactPages(ctx.client, projectId, limit, artifactPrefix, {
      signal,
      onMeta: (value, requestId) => {
        Object.assign(meta, value);
        if (requestId) responseInfo.requestId = requestId;
      },
    });
    if (downloadDir !== undefined) return await downloadAll({ ...ctx, signal }, projectId, pages, downloadDir, meta, responseInfo);
    let count = 0;
    let displayed = 0;
    // JSON retains a single envelope. Details preserve the historical raw
    // artifact response; the default projects a stable, compact public view.
    const artifacts = [];
    for await (const batch of pages) {
      count += batch.length;
      if (ctx.json) artifacts.push(...batch);
      else if (batch.length) displayed += emitTable(batch, ctx.flags.details === true);
    }
    if (ctx.json) {
      if (ctx.flags.details === true) {
        printJson({ data: { artifacts }, meta, ...(responseInfo.requestId ? { request_id: responseInfo.requestId } : {}) });
      }
      else {
        const visible = artifacts.filter((artifact) => !isOperationalArtifact(artifact)).map(presentArtifact);
        printJson({ data: { artifacts: visible, count: visible.length } });
      }
    }
    else if (!displayed) {
      printData(count
        ? 'No user-facing artifacts found. Use --details to inspect operational artifacts.'
        : 'No artifacts found.');
    }
    return { count };
  } finally {
    process.removeListener('SIGINT', interrupt);
  }
}

export async function* artifactPages(client, projectId, limit, artifactPrefix, { signal, onMeta } = {}) {
  let cursor;
  const seenCursors = new Set();
  do {
    signal?.throwIfAborted();
    const query = { limit: limit ?? 100, cursor };
    if (artifactPrefix !== undefined) query.path = artifactPrefix;
    const res = await client.get(`/api/v1/projects/${encodeURIComponent(projectId)}/artifacts`, { query, signal });
    signal?.throwIfAborted();
    const data = res.data ?? {};
    const batch = Array.isArray(data) ? data : (data.artifacts ?? data.items);
    if (!Array.isArray(batch)) throw serverError('Artifact listing returned an invalid page.');
    onMeta?.(res.meta || {}, res.requestId);
    const next = data.next_cursor ?? data.cursor ?? res.meta?.next_cursor ?? res.meta?.cursor;
    if (next !== undefined && next !== null && (typeof next !== 'string' || !next)) {
      throw serverError('Artifact listing returned an invalid cursor.');
    }
    if (next && seenCursors.has(next)) throw serverError('Artifact listing repeated a continuation cursor; retry the listing.');
    if (next) seenCursors.add(next);
    yield batch;
    cursor = next;
  } while (cursor);
}

export async function collectArtifacts(client, projectId, limit, artifactPrefix, options) {
  const items = [];
  for await (const batch of artifactPages(client, projectId, limit, artifactPrefix, options)) items.push(...batch);
  return items;
}

function emitTable(artifacts, details = false) {
  const visible = details ? artifacts : artifacts.filter((artifact) => !isOperationalArtifact(artifact));
  if (!visible.length) return 0;
  if (details) {
    printTable(['path', 'size', 'sha256'], visible.map((a) => [
      artifactPath(a), artifactBytes(a) ?? '-', shortHash(declaredSha256(a)),
    ]));
    return visible.length;
  }
  printTable(['path', 'role', 'size'], visible.map((artifact) => {
    const item = presentArtifact(artifact);
    return [item.path, humanRole(item.role), item.size_bytes ?? 'unknown'];
  }));
  return visible.length;
}

function serverError(message, code = 'results_invalid_response', action = 'Retry the read-only results command. If the error repeats, contact Ariax support.') {
  const error = new Error(message);
  error.exitCode = EXIT.SERVER;
  error.code = code;
  error.retryable = false;
  error.action = action;
  error.details = { action };
  return error;
}

async function downloadAll(ctx, projectId, pages, downloadDir, meta, responseInfo) {
  const overwrite = ctx.flags.overwrite === true;
  const fetchImpl = ctx.fetchImpl ?? globalThis.fetch;
  const downloaded = [];
  const skipped = [];
  const resumed = [];
  const completed = [];
  const failures = [];
  let archiveExpectations;
  let archiveVerification = 'not_advertised';
  const state = openDownloadState(downloadDir, projectId, ctx.config?.baseUrl ?? 'https://www.ariax.bio');
  try {
    for await (const listedArtifacts of pages) {
      if (archiveExpectations === undefined) {
        const manifest = await loadArchiveExpectations(ctx.client, projectId, meta.archive_manifest_url, ctx.signal);
        archiveExpectations = manifest.expectations;
        archiveVerification = manifest.state;
      }
      const artifacts = listedArtifacts.map((artifact) => applyArchiveExpectation(artifact, archiveExpectations));
      const pending = [];
      for (const artifact of artifacts) {
        ctx.signal?.throwIfAborted();
        const rel = artifactPath(artifact);
        let dest;
        try {
          dest = prepareDestPath(downloadDir, rel);
          if (await state.matches({ ...artifact, path: rel }, dest, ctx.signal)) {
            resumed.push(rel);
            completed.push({ ...presentArtifact(artifact), status: 'resumed' });
            continue;
          }
        } catch (error) {
          ctx.signal?.throwIfAborted();
          const failure = presentFailure(rel, error);
          failures.push(ctx.flags.details === true ? detailedFailure(failure, error) : failure);
          if (!ctx.json) printProgress(`failed: ${rel}: ${failure.reason}`);
          continue;
        }
        if (!overwrite && fs.existsSync(dest)) {
          if (ctx.flags.details === true) printProgress(`skip: exists (pass --overwrite to replace): ${dest}`);
          skipped.push(rel);
          completed.push({ ...presentArtifact(artifact), status: 'skipped_existing' });
          continue;
        }
        pending.push({ ...artifact, path: rel, dest });
      }
      // Sign only the next bounded transfer batch, after existing-file checks.
      // Subsequent pages do not receive URLs until these files are complete.
      for (let offset = 0; offset < pending.length; offset += 100) {
        const batch = pending.slice(offset, offset + 100);
        let signed;
        try {
          signed = await presignBatch(ctx.client, projectId, batch.map((a) => a.path), ctx.signal);
        } catch (error) {
          ctx.signal?.throwIfAborted();
          for (const artifact of batch) {
            const failure = presentFailure(artifact.path, error);
            failures.push(ctx.flags.details === true ? detailedFailure(failure, error) : failure);
            if (!ctx.json) printProgress(`failed: ${artifact.path}: ${failure.reason}`);
          }
          continue;
        }
        for (const artifact of batch) {
          ctx.signal?.throwIfAborted();
          const rel = artifact.path;
          try {
            let entry = signed.get(rel);
            let refreshed = false;
            if (entry?.expiresAt && entry.expiresAt <= Date.now() + 30_000) {
              entry = (await presignBatch(ctx.client, projectId, [rel], ctx.signal)).get(rel);
              refreshed = true;
            }
            if (!entry) throw serverError('No download URL was returned.');
            if (ctx.flags.details === true) printProgress(`downloading ${rel} …`);
            let out;
            try {
              out = await downloadUrl(fetchImpl, entry.url, artifact.dest, {
                expectedSha256: declaredSha256(artifact), expectedBytes: artifact.expected_bytes,
                overwrite, signal: ctx.signal,
              });
            } catch (error) {
              // Storage expiry uses 401/403. Refresh at most once per transfer;
              // permission/not-found/checksum failures must remain visible.
              if (refreshed || ![401, 403].includes(error.status)) throw error;
              ctx.signal?.throwIfAborted();
              const fresh = (await presignBatch(ctx.client, projectId, [rel], ctx.signal)).get(rel);
              if (!fresh) throw serverError('No refreshed download URL was returned.');
              out = await downloadUrl(fetchImpl, fresh.url, artifact.dest, {
                expectedSha256: declaredSha256(artifact), expectedBytes: artifact.expected_bytes,
                overwrite, signal: ctx.signal,
              });
            }
            state.record(artifact, out);
            const expected = declaredSha256(artifact);
            downloaded.push({
              path: rel, dest: out.path, bytes: out.bytes, sha256: out.sha256,
              checksum_verified: Boolean(expected),
              ...(artifact.archive_manifest_verified === true ? { verification_source: 'archive_manifest' } : {}),
            });
            completed.push({ ...presentArtifact({ ...artifact, size: out.bytes }), status: 'downloaded' });
          } catch (error) {
            ctx.signal?.throwIfAborted();
            const failure = presentFailure(rel, error);
            failures.push(ctx.flags.details === true ? detailedFailure(failure, error) : failure);
            if (!ctx.json) printProgress(`failed: ${rel}: ${failure.reason}`);
          }
        }
      }
    }
  } finally {
    state.close();
  }
  const destination = path.resolve(downloadDir);
  const counts = { downloaded: downloaded.length, resumed: resumed.length, skipped: skipped.length, failed: failures.length };
  const compact = {
    destination,
    counts,
    files: completed.filter((artifact) => !isOperationalArtifact(artifact)),
  };
  const details = {
    dir: downloadDir,
    downloaded,
    skipped,
    resumed,
    failed: failures.length,
    failures,
    checkpoint: state.path,
    archive_verification: archiveVerification,
  };
  if (!ctx.json) {
    printData(`Results: ${downloaded.length} downloaded, ${resumed.length} resumed, ${skipped.length} skipped, ${failures.length} failed`);
    printData(`Destination: ${destination}`);
    const visible = completed.filter((artifact) => !isOperationalArtifact(artifact));
    if (visible.length) printTable(['path', 'role', 'size', 'status'], visible.map((item) => [item.path, humanRole(item.role), item.size_bytes ?? 'unknown', item.status]));
    if (ctx.flags.details === true) {
      printData(`checkpoint: ${state.path}`);
      printData(`archive verification: ${archiveVerification}`);
    }
    for (const failure of failures) {
      printData(`Failure: ${failure.path} [${failure.code}] ${failure.reason}`);
      printData(`Action: ${failure.action}`);
    }
  }
  if (failures.length) {
    const allRetryable = failures.every((failure) => failure.retryable === true);
    const error = serverError(
      `${failures.length} artifact(s) failed to download. Completed files are saved and will resume safely.`,
      'artifact_download_failed',
      allRetryable
        ? 'Rerun the same results command; completed files will resume.'
        : 'Correct the listed non-retryable failures, then rerun the same results command; completed files will resume.',
    );
    error.exitCode = commonFailureExitCode(failures);
    error.retryable = allRetryable;
    error.details = ctx.flags.details === true
      ? { ...details, action: error.action, resumable: true }
      : { ...compact, failures, action: error.action, resumable: true };
    throw error;
  }
  if (ctx.json) {
    printJson(ctx.flags.details === true
      ? { data: details, meta, ...(responseInfo.requestId ? { request_id: responseInfo.requestId } : {}) }
      : { data: compact });
  }
  return {
    downloaded: downloaded.length,
    resumed: resumed.length,
    archiveVerification,
    downloads: downloaded,
  };
}

async function loadArchiveExpectations(client, projectId, manifestUrl, signal) {
  if (manifestUrl === undefined || manifestUrl === null) return { state: 'not_advertised', expectations: new Map() };
  const expectedUrl = `/api/v1/projects/${encodeURIComponent(projectId)}/artifacts/archive-manifest`;
  if (manifestUrl !== expectedUrl) throw serverError(
    'Artifact listing returned an invalid archive manifest URL.',
    'artifact_manifest_invalid',
    'Do not use the advertised manifest. Contact Ariax support.',
  );
  signal?.throwIfAborted();
  const response = await client.get(manifestUrl, { signal });
  signal?.throwIfAborted();
  const manifest = response.data;
  if (!manifest || manifest.schema_version !== 1 || !Array.isArray(manifest.archives)) {
    throw serverError('Archive manifest returned an invalid document.', 'artifact_manifest_invalid', 'Do not use the manifest. Contact Ariax support.');
  }
  const expectations = new Map();
  for (const archive of manifest.archives) {
    if (archive?.stage !== 'verified') continue;
    if (typeof archive.path !== 'string') continue; // Older manifests expose names but no public digest.
    if (!Number.isInteger(archive.bytes) || archive.bytes < 0 || typeof archive.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(archive.sha256)) {
      throw serverError('Archive manifest contains invalid verification metadata.', 'artifact_manifest_invalid', 'Do not use the manifest. Contact Ariax support.');
    }
    if (expectations.has(archive.path)) {
      throw serverError('Archive manifest repeats an archive path.', 'artifact_manifest_invalid', 'Do not use the manifest. Contact Ariax support.');
    }
    expectations.set(archive.path, { bytes: archive.bytes, sha256: archive.sha256 });
  }
  const state = expectations.size ? 'verified_manifest_loaded' : (manifest.stage === 'unavailable' ? 'unavailable' : 'manifest_has_no_digests');
  return { state, expectations };
}

function applyArchiveExpectation(artifact, expectations) {
  const rel = artifactPath(artifact);
  const expected = expectations.get(rel);
  if (!expected) return artifact;
  const listedBytes = artifact?.size ?? artifact?.bytes;
  if (listedBytes !== undefined && listedBytes !== null && Number(listedBytes) !== expected.bytes) {
    throw serverError(
      `Archive size metadata disagrees with its verified manifest for ${rel}.`,
      'artifact_metadata_mismatch',
      'Do not use the archive. Contact Ariax support with the artifact path.',
    );
  }
  const listedHash = declaredSha256(artifact);
  if (listedHash && listedHash !== expected.sha256) {
    throw serverError(
      `Archive checksum metadata disagrees with its verified manifest for ${rel}.`,
      'artifact_metadata_mismatch',
      'Do not use the archive. Contact Ariax support with the artifact path.',
    );
  }
  return {
    ...artifact,
    path: rel,
    sha256: expected.sha256,
    expected_bytes: expected.bytes,
    archive_manifest_verified: true,
  };
}

async function presignBatch(client, projectId, paths, signal) {
  signal?.throwIfAborted();
  const res = await client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/artifacts/presign`, {
    body: { paths }, signal,
  });
  signal?.throwIfAborted();
  const map = new Map();
  const allowed = new Set(paths);
  const add = (key, entry) => {
    if (!allowed.has(key)) return;
    const url = typeof entry === 'string' ? entry
      : entry?.url ?? entry?.download_url ?? entry?.presigned_url ?? entry?.href;
    if (typeof url !== 'string') return;
    const explicit = Date.parse(entry?.expires_at);
    const duration = Number(entry?.expires_in_seconds);
    const expiresAt = Number.isFinite(explicit) ? explicit
      : Number.isFinite(duration) && duration > 0 ? Date.now() + duration * 1000 : null;
    map.set(key, { url, expiresAt });
  };
  const data = res.data ?? {};
  if (data.urls && typeof data.urls === 'object' && !Array.isArray(data.urls)) {
    for (const [key, entry] of Object.entries(data.urls)) add(key, entry);
  }
  const entries = Array.isArray(data) ? data : data.items ?? data.artifacts ?? [];
  if (Array.isArray(entries)) for (const entry of entries) add(entry?.path ?? entry?.key, entry);
  if (!map.size && paths.length === 1) add(paths[0], data);
  return map;
}

/** Compatibility helper; downloads use just-in-time batches instead. */
export async function presignAll(client, projectId, paths) {
  const map = new Map();
  for (let offset = 0; offset < paths.length; offset += 100) {
    const batch = await presignBatch(client, projectId, paths.slice(offset, offset + 100));
    for (const [key, entry] of batch) map.set(key, entry.url);
  }
  return map;
}

function artifactPath(a) {
  const p = a?.path ?? a?.key ?? a?.name ?? a?.filename;
  return typeof p === 'string' && p ? p : 'artifact';
}

function artifactBytes(artifact) {
  const value = artifact?.size ?? artifact?.bytes ?? artifact?.content_length;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}

/** Stable compact artifact projection; raw transport records remain under --details. */
export function presentArtifact(artifact) {
  const artifactName = artifactPath(artifact);
  return {
    path: artifactName,
    role: artifactRole(artifactName),
    size_bytes: artifactBytes(artifact),
  };
}

function artifactRole(artifactName) {
  const name = path.posix.basename(artifactName).toLowerCase();
  if (name === '!_trajectories.csv') return 'trajectory_summary';
  if (name === '!_refolded.csv') return 'refold_summary';
  if (name === '!_ranked.csv') return 'ranked_candidate_summary';
  if (name === 'summary.csv') return 'campaign_summary';
  if (name === 'sequences.fasta' || /\.(?:fasta|fa)$/.test(name)) return 'sequences';
  if (/\.(?:pdb|cif|mmcif)$/.test(name)) return 'structure';
  if (/\.(?:tar\.gz|tgz|zip)$/.test(name)) return 'archive';
  if (name.endsWith('.csv')) return 'table';
  if (name.endsWith('.json')) return 'metadata';
  if (/\.(?:log|txt)$/.test(name)) return 'text';
  return 'artifact';
}

function humanRole(role) {
  return ({
    trajectory_summary: 'trajectories',
    refold_summary: 'refolded',
    ranked_candidate_summary: 'ranked',
    campaign_summary: 'summary',
  })[role] ?? role;
}

function isOperationalArtifact(artifact) {
  const rel = artifactPath(artifact).toLowerCase();
  const name = path.posix.basename(rel);
  return name.startsWith('.ariax-')
    || name.includes('manifest')
    || name.includes('provenance')
    || name.includes('build-info')
    || rel.includes('/checkpoint')
    || rel.includes('/worker_state');
}

function presentFailure(artifactName, error) {
  const base = {
    path: artifactName,
    exit_code: Number.isInteger(error?.exitCode) ? error.exitCode : EXIT.SERVER,
    reason: String(error?.message || error || 'Download failed.'),
  };
  if (error?.name === 'UnsafePathError') {
    return { ...base, reason: 'The published artifact path is unsafe.', code: 'unsafe_artifact_path', retryable: false, action: 'Do not download this artifact. Contact Ariax support with the artifact path.' };
  }
  if (error?.name === 'ChecksumMismatchError') {
    return { ...base, reason: 'Downloaded bytes did not match the published checksum.', code: 'artifact_integrity_mismatch', retryable: false, action: 'Do not use the downloaded bytes. Contact Ariax support with the artifact path.' };
  }
  if (error?.name === 'SizeMismatchError') {
    return { ...base, reason: 'Downloaded bytes did not match the published size.', code: 'artifact_integrity_mismatch', retryable: false, action: 'Do not use the downloaded bytes. Contact Ariax support with the artifact path.' };
  }
  if (error?.code === 'ENOSPC') {
    return { ...base, reason: 'The download destination is out of space.', code: 'destination_full', retryable: false, action: 'Free space or choose another --download directory, then rerun the same command.' };
  }
  if (['EACCES', 'EPERM', 'EROFS'].includes(error?.code)) {
    return { ...base, reason: 'The download destination is not writable.', code: 'destination_not_writable', retryable: false, action: 'Choose a writable --download directory or correct its permissions, then rerun the same command.' };
  }
  if (error?.name === 'OverwriteRefusedError') {
    return { ...base, reason: 'The destination file already exists.', code: 'destination_exists', retryable: false, action: 'Use another directory or pass --overwrite if replacing the file is intended.' };
  }
  if ([EXIT.AUTH, EXIT.FORBIDDEN].includes(error?.exitCode) || [401, 403].includes(error?.status)) {
    return { ...base, reason: 'The artifact download was not authorized.', code: 'download_not_authorized', retryable: false, action: 'Check authentication and project access, then rerun the same command.' };
  }
  if (error?.exitCode === EXIT.NOT_FOUND || error?.status === 404) {
    return { ...base, reason: 'The artifact is not available at its published location.', code: 'artifact_not_available', retryable: false, action: 'Check that result publication is complete. If it is complete, contact Ariax support.' };
  }
  if (error?.exitCode === EXIT.RATE_LIMIT || error?.status === 429) {
    return { ...base, reason: 'The artifact transfer was rate limited.', code: 'download_rate_limited', retryable: true, action: 'Wait briefly, then rerun the same command; completed files will resume.' };
  }
  if (/No (?:refreshed )?download URL was returned/.test(base.reason)) {
    return { ...base, reason: 'No usable download URL was published.', code: 'download_url_missing', retryable: false, action: 'Contact Ariax support with the artifact path; no usable download URL was published.' };
  }
  if (error?.retryable === true || error?.exitCode === EXIT.NETWORK || (Number.isInteger(error?.status) && error.status >= 500)) {
    return { ...base, reason: 'The artifact transfer was interrupted.', code: 'download_interrupted', retryable: true, action: 'Rerun the same command; completed files will resume.' };
  }
  if (/network|connection|socket|timed? out|timeout|fetch failed/i.test(base.reason)) {
    return { ...base, reason: 'The artifact transfer was interrupted.', code: 'download_interrupted', retryable: true, action: 'Rerun the same command; completed files will resume.' };
  }
  return { ...base, code: 'artifact_download_failed', retryable: false, action: 'Review the failure, correct it, then rerun the same command; completed files will resume.' };
}

function detailedFailure(failure, error) {
  return {
    ...failure,
    error_type: typeof error?.name === 'string' ? error.name : null,
    status: Number.isInteger(error?.status) ? error.status : null,
    diagnostic: String(error?.message || error || 'Download failed.'),
  };
}

function commonFailureExitCode(failures) {
  const codes = new Set(failures.map((failure) => failure.exit_code).filter(Number.isInteger));
  return codes.size === 1 ? [...codes][0] : EXIT.SERVER;
}

function shortHash(h) {
  if (!h) return '-';
  return h.length > 16 ? `${h.slice(0, 12)}…` : h;
}
