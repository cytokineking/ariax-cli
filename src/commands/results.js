/**
 * `ariax results <project-id> [--path <artifact-prefix>] [--download <dir>] [--overwrite] [--limit N]`
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
  try {
    const pages = artifactPages(ctx.client, projectId, limit, artifactPrefix, { signal, onMeta: (value) => Object.assign(meta, value) });
    if (downloadDir !== undefined) return await downloadAll({ ...ctx, signal }, projectId, pages, downloadDir, meta);
    let count = 0;
    // JSON retains the existing single-envelope contract. Human output and
    // downloads consume pages incrementally instead of retaining the campaign.
    const artifacts = [];
    for await (const batch of pages) {
      count += batch.length;
      if (ctx.json) artifacts.push(...batch);
      else if (batch.length) emitTable(batch);
    }
    if (ctx.json) printJson({ data: { artifacts }, meta });
    else if (!count) printData('No artifacts found.');
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
    onMeta?.(res.meta || {});
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

function emitTable(artifacts) {
  printTable(['path', 'size', 'sha256'], artifacts.map((a) => [
    artifactPath(a), a.size ?? a.bytes ?? '-', shortHash(declaredSha256(a)),
  ]));
}

function serverError(message) {
  const error = new Error(message);
  error.exitCode = EXIT.SERVER;
  return error;
}

async function downloadAll(ctx, projectId, pages, downloadDir, meta) {
  const overwrite = ctx.flags.overwrite === true;
  const fetchImpl = ctx.fetchImpl ?? globalThis.fetch;
  const downloaded = [];
  const skipped = [];
  const resumed = [];
  let failed = 0;
  const state = openDownloadState(downloadDir, projectId, ctx.config?.baseUrl ?? 'https://www.ariax.bio');
  try {
    for await (const artifacts of pages) {
      const pending = [];
      for (const artifact of artifacts) {
        ctx.signal?.throwIfAborted();
        const rel = artifactPath(artifact);
        let dest;
        try {
          dest = prepareDestPath(downloadDir, rel);
          if (await state.matches({ ...artifact, path: rel }, dest, ctx.signal)) {
            resumed.push(rel);
            continue;
          }
        } catch (error) {
          ctx.signal?.throwIfAborted();
          printProgress(`skip: unsafe or unreadable artifact ${JSON.stringify(rel)} (${error.message})`);
          failed += 1;
          continue;
        }
        if (!overwrite && fs.existsSync(dest)) {
          printProgress(`skip: exists (pass --overwrite to replace): ${dest}`);
          skipped.push(rel);
          continue;
        }
        pending.push({ ...artifact, path: rel, dest });
      }
      // Sign only the next bounded transfer batch, after existing-file checks.
      // Subsequent pages do not receive URLs until these files are complete.
      for (let offset = 0; offset < pending.length; offset += 100) {
        const batch = pending.slice(offset, offset + 100);
        const signed = await presignBatch(ctx.client, projectId, batch.map((a) => a.path), ctx.signal);
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
            printProgress(`downloading ${rel} …`);
            let out;
            try {
              out = await downloadUrl(fetchImpl, entry.url, artifact.dest, {
                expectedSha256: declaredSha256(artifact), overwrite, signal: ctx.signal,
              });
            } catch (error) {
              // Storage expiry uses 401/403. Refresh at most once per transfer;
              // permission/not-found/checksum failures must remain visible.
              if (refreshed || ![401, 403].includes(error.status)) throw error;
              ctx.signal?.throwIfAborted();
              const fresh = (await presignBatch(ctx.client, projectId, [rel], ctx.signal)).get(rel);
              if (!fresh) throw serverError('No refreshed download URL was returned.');
              out = await downloadUrl(fetchImpl, fresh.url, artifact.dest, {
                expectedSha256: declaredSha256(artifact), overwrite, signal: ctx.signal,
              });
            }
            state.record(artifact, out);
            downloaded.push({ path: rel, dest: out.path, bytes: out.bytes, sha256: out.sha256 });
          } catch (error) {
            ctx.signal?.throwIfAborted();
            printProgress(`failed: ${rel}: ${error.message}`);
            failed += 1;
          }
        }
      }
    }
  } finally {
    state.close();
  }
  const details = { dir: downloadDir, downloaded, skipped, resumed, failed, checkpoint: state.path };
  if (!ctx.json) {
    printData(`downloaded: ${downloaded.length} file(s) to ${path.resolve(downloadDir)}`);
    if (resumed.length) printData(`resumed (verified complete): ${resumed.length}`);
    if (skipped.length) printData(`skipped (exists): ${skipped.length}`);
    if (failed) printData(`failed: ${failed}`);
  }
  if (failed) {
    const error = serverError(`${failed} artifact(s) failed to download. Re-run the same command to resume.`);
    error.details = details;
    throw error;
  }
  if (ctx.json) printJson({ data: details, meta });
  return { downloaded: downloaded.length, resumed: resumed.length };
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

function shortHash(h) {
  if (!h) return '-';
  return h.length > 16 ? `${h.slice(0, 12)}…` : h;
}
