/** `ariax storage` — inspect account/project storage usage, entries, cleanup suggestions, and deletions. */
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { usageError } from '../args.js';
import { EXIT } from '../exit-codes.js';
import { isUUID } from '../uuid.js';
import { NetworkError } from '../http.js';
import { resolveProjectId } from '../resolve.js';
import { printData, printJson, printKv, printProgress, printTable } from '../output.js';

const MAX_PAGES = 20;

const OPTIONS = {
  usage: [['refresh', 'after'], 1],
  projects: [['q', 'protocol', 'status', 'sort', 'limit', 'cursor', 'all'], 1],
  project: [['refresh', 'wait', 'wait-timeout'], 2],
  entries: [['path', 'limit', 'cursor'], 2],
  suggest: [[], 2],
  delete: [['path', 'recursive', 'preview', 'suggested', 'expected-control-revision', 'operation-id'], 2],
  deletion: [[], 3],
};

const SUBCOMMAND_HELP = Object.freeze({
  usage: `ariax storage usage [--refresh] [--after UUID]
  Show account-wide storage usage, retained storage summary, and measurement counts.`,
  projects: `ariax storage projects [--q TEXT] [--protocol P] [--status S] [--sort updated_at|name|bytes_desc] [--limit N] [--cursor C] [--all]
  List projects with storage byte usage and freshness.`,
  project: `ariax storage project PROJECT [--refresh [--wait] [--wait-timeout SECONDS]]
  PROJECT accepts a project UUID or an exact unique project name.
  Inspect project storage usage, directories, largest files, retained bytes, and cleanup status.`,
  entries: `ariax storage entries PROJECT [--path P] [--limit N] [--cursor C]
  PROJECT accepts a project UUID or an exact unique project name.
  Browse stored directories and files under a project.`,
  suggest: `ariax storage suggest PROJECT
  PROJECT accepts a project UUID or an exact unique project name.
  List reclaimable storage paths (for Forge projects, highlights directories for \`ariax forge pack\` or \`ariax forge files delete\`).`,
  delete: `ariax storage delete PROJECT (--path P [--path P2 ...] | --suggested) [--recursive] --preview
  ariax storage delete PROJECT --path P [--recursive] [--expected-control-revision N] [--operation-id UUID]
  PROJECT accepts a project UUID or an exact unique project name.
  CLI \`ariax storage delete\` performs scoped path deletion only; \`whole_project_delete\` is web-only.
  Use \`--preview\` first to inspect impact; actual deletions require an explicit \`--path\`.`,
  deletion: `ariax storage deletion PROJECT DELETION_ID
  PROJECT accepts a project UUID or an exact unique project name.
  Inspect the state of a submitted storage deletion operation (may report \`write_grants_pending\` until \`verification_not_before\` passes).`,
});

export function helpFor(positionals = []) {
  const action = positionals[0];
  if (action && Object.prototype.hasOwnProperty.call(SUBCOMMAND_HELP, action)) {
    return SUBCOMMAND_HELP[action];
  }
  return help;
}

export const help = `ariax storage usage [--refresh] [--after UUID]
  ariax storage projects [--q TEXT] [--protocol P] [--status S] [--sort updated_at|name|bytes_desc] [--limit N] [--cursor C] [--all]
  ariax storage project PROJECT [--refresh [--wait] [--wait-timeout SECONDS]]
  ariax storage entries PROJECT [--path P] [--limit N] [--cursor C]
  ariax storage suggest PROJECT
  ariax storage delete PROJECT (--path P [--path P2 ...] | --suggested) [--recursive] --preview
  ariax storage delete PROJECT --path P [--recursive] [--expected-control-revision N] [--operation-id UUID]
  ariax storage deletion PROJECT DELETION_ID
  PROJECT accepts a project UUID or an exact unique project name.
  CLI \`ariax storage delete\` performs scoped path deletion only; \`whole_project_delete\` is web-only.
  Use \`storage delete --preview\` (with one or more \`--path\` flags or \`--suggested\`) to inspect impact before submitting an explicit \`--path\` deletion.
  For Forge projects, \`storage suggest\` highlights large or high-file-count directories for \`ariax forge pack\` or \`ariax forge files delete\`.
  After a managed deletion, cleanup may report \`write_grants_pending\` until \`verification_not_before\` passes (waiting for active upload grants to expire).
  During that window, \`usage.retained.bytes\` reflects logically retained storage while raw \`usage.bytes\` still includes objects awaiting removal (\`pending_deletion_bytes\`).`;

export function validateArguments({ positionals, flags, globals }) {
  if (!positionals.length && globals.help && !Object.keys(flags).length) return;
  const action = positionals[0];
  if (!Object.hasOwn(OPTIONS, action)) {
    throw usageError('storage: unknown subcommand. Use usage, projects, project, entries, suggest, delete, or deletion. Run: ariax help storage');
  }
  const [allowed, expectedOperands] = OPTIONS[action];
  for (const name of Object.keys(flags)) {
    if (!allowed.includes(name)) throw usageError(`storage ${action}: unsupported flag --${name}.`);
  }
  if (positionals.length > expectedOperands) {
    throw usageError(`storage ${action}: unexpected positional arguments; expected at most ${expectedOperands}.`);
  }
  if (globals.help) return;
  if (positionals.length < expectedOperands) {
    throw usageError(`storage ${action}: missing required positional arguments. Run: ariax help storage`);
  }
}

function requiredString(value, flag, action) {
  if (typeof value !== 'string' || !value.trim()) {
    throw usageError(`storage ${action}: --${flag} must be a nonempty string.`);
  }
  return value.trim();
}

function validateUuid(value, label, action) {
  if (!isUUID(value)) throw usageError(`storage ${action}: ${label} must be a UUID.`);
  return String(value).trim().toLowerCase();
}

function validateInteger(value, flag, action, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const num = Number(value);
  if (!['string', 'number'].includes(typeof value) || String(value).trim() === ''
      || !Number.isSafeInteger(num) || num < min || num > max) {
    throw usageError(`storage ${action}: --${flag} must be an integer ${min}..${max}.`);
  }
  return num;
}

function formatBytes(value) {
  if (value === null || value === undefined || value === '') return '-';
  const bytes = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return String(value);
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let val = bytes / 1024;
  let unit = 0;
  while (val >= 1024 && unit < units.length - 1) { val /= 1024; unit++; }
  return `${val >= 10 ? val.toFixed(1) : val.toFixed(2)} ${units[unit]}`;
}

function emitEnvelope(res, extraMeta = undefined) {
  const meta = extraMeta ? { ...(res.meta || {}), ...extraMeta } : res.meta;
  printJson({
    data: res.data,
    ...(meta !== undefined ? { meta } : {}),
    ...(res.requestId ? { request_id: res.requestId } : {}),
  });
}

export async function run(ctx) {
  const action = ctx.positionals[0];
  const flags = ctx.flags;

  if (action === 'usage') {
    if (flags.after !== undefined && flags.refresh !== true) {
      throw usageError('storage usage: --after requires --refresh.');
    }
    const after = flags.after === undefined ? undefined : validateUuid(flags.after, '--after', 'usage');
    const res = flags.refresh === true
      ? await ctx.client.post('/api/v1/storage/usage', { body: after ? { after } : {} })
      : await ctx.client.get('/api/v1/storage/usage');
    if (ctx.json) { emitEnvelope(res); return; }
    if (flags.refresh === true) {
      printKv({
        queued: res.data?.queued,
        next_after: res.data?.next_after ?? '-',
      });
      if (res.data?.next_after) {
        printProgress(`More projects can be measured — re-run with: ariax storage usage --refresh --after ${res.data.next_after}`);
      }
      return;
    }
    const d = res.data || {};
    printKv({
      bytes: `${formatBytes(d.bytes)} (${d.bytes ?? '-'} bytes)`,
      total_projects: d.total_projects,
      managed_projects: d.managed_projects,
      measured_projects: d.measured_projects,
      measuring_projects: d.measuring_projects,
      ...(d.retained_projects !== undefined ? {
        retained_bytes: d.retained_bytes != null ? `${formatBytes(d.retained_bytes)} (${d.retained_bytes} bytes)` : '-',
        retained_projects: d.retained_projects,
        retained_as_of: d.retained_as_of ?? '-',
      } : {}),
    });
    return;
  }

  if (action === 'projects') {
    const sort = flags.sort === undefined ? undefined : requiredString(flags.sort, 'sort', 'projects');
    if (sort !== undefined && !['updated_at', 'name', 'bytes_desc'].includes(sort)) {
      throw usageError('storage projects: --sort must be updated_at, name, or bytes_desc.');
    }
    const limit = flags.limit === undefined ? undefined : validateInteger(flags.limit, 'limit', 'projects', { min: 1, max: 50 });
    const baseQuery = {
      q: flags.q === undefined ? undefined : requiredString(flags.q, 'q', 'projects'),
      protocol: flags.protocol === undefined ? undefined : requiredString(flags.protocol, 'protocol', 'projects'),
      status: flags.status === undefined ? undefined : requiredString(flags.status, 'status', 'projects'),
      sort,
      limit,
    };
    let cursor = flags.cursor === undefined ? undefined : requiredString(flags.cursor, 'cursor', 'projects');
    const seenCursors = new Set();
    const projects = [];
    let requestId;
    let totalCount;
    let pages = 0;
    const maxPages = flags.all === true ? MAX_PAGES : 1;
    do {
      const res = await ctx.client.get('/api/v1/storage/projects', { query: { ...baseQuery, cursor } });
      pages += 1;
      requestId = res.requestId;
      const batch = Array.isArray(res.data?.projects) ? res.data.projects : [];
      projects.push(...batch);
      if (res.data?.total_count !== undefined) totalCount = res.data.total_count;
      const next = res.data?.next_cursor ?? null;
      if (next && seenCursors.has(next)) {
        throw new NetworkError('Storage projects endpoint repeated a pagination cursor.');
      }
      if (next) seenCursors.add(next);
      cursor = typeof next === 'string' && next ? next : null;
    } while (flags.all === true && cursor && pages < maxPages);
    const capped = Boolean(flags.all === true && cursor && pages >= maxPages);
    const data = {
      projects,
      next_cursor: cursor,
      ...(totalCount !== undefined ? { total_count: totalCount } : {}),
    };
    if (ctx.json) {
      printJson({
        data,
        ...(capped ? { meta: { truncated_by_page_limit: true, max_pages: maxPages } } : {}),
        ...(requestId ? { request_id: requestId } : {}),
      });
      return;
    }
    if (!projects.length) {
      printData('No storage projects found.');
      return;
    }
    printTable(
      ['project_id', 'name', 'protocol', 'status', 'bytes', 'freshness'],
      projects.map((p) => {
        const usage = p.storage?.usage;
        return [
          p.project_id ?? '-',
          p.name ?? '-',
          p.protocol ?? '-',
          p.status ?? '-',
          formatBytes(usage?.bytes),
          usage?.freshness ?? '-',
        ];
      }),
    );
    if (capped) printProgress(`Stopped after ${maxPages} pages; pass --cursor ${cursor} to continue.`);
    else if (cursor) printProgress(`More projects available — re-run with --cursor ${cursor} (or --all).`);
    return;
  }

  const projectId = await resolveProjectId(ctx.client, ctx.positionals[1]);

  if (action === 'project') {
    if (flags.wait === true && flags.refresh !== true) {
      throw usageError('storage project: --wait requires --refresh.');
    }
    if (flags['wait-timeout'] !== undefined && flags.wait !== true) {
      throw usageError('storage project: --wait-timeout requires --wait.');
    }
    let waitTimeoutMs = 300_000;
    if (flags['wait-timeout'] !== undefined) {
      const secs = Number(flags['wait-timeout']);
      if (!['string', 'number'].includes(typeof flags['wait-timeout']) || String(flags['wait-timeout']).trim() === ''
          || !Number.isFinite(secs) || secs <= 0 || secs > 3600) {
        throw usageError('storage project: --wait-timeout must be a positive number of seconds (<= 3600).');
      }
      waitTimeoutMs = Math.round(secs * 1000);
    }
    let res = flags.refresh === true
      ? await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/storage/refresh`, { body: {} })
      : await ctx.client.get(`/api/v1/projects/${encodeURIComponent(projectId)}/storage`);
    let waited = false;
    const refreshStateOf = (payload) => payload?.usage?.refresh?.state ?? null;
    if (flags.refresh === true && flags.wait === true) {
      const initialState = refreshStateOf(res.data);
      const needsPoll = res.status === 202 || (initialState !== null && initialState !== 'idle' && initialState !== 'failed');
      if (needsPoll) {
        waited = true;
        const controller = new AbortController();
        let timedOut = false;
        const interrupt = () => controller.abort();
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, waitTimeoutMs);
        process.once('SIGINT', interrupt);
        let lastProgress = null;
        let attempt = 0;
        const startedAt = Date.now();
        try {
          for (;;) {
            const state = refreshStateOf(res.data) ?? (res.status === 202 ? 'pending' : 'unknown');
            const elapsedSec = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
            const line = `Storage refresh (${projectId}): state=${state} elapsed=${elapsedSec}s`;
            if (state !== lastProgress) {
              printProgress(line);
              lastProgress = state;
            }
            if (state === 'idle' || state === 'failed') break;
            const pollMs = Math.min(3000, Math.round(500 * Math.pow(1.5, attempt)));
            attempt += 1;
            await delay(pollMs, undefined, { signal: controller.signal });
            res = await ctx.client.get(`/api/v1/projects/${encodeURIComponent(projectId)}/storage`, {
              signal: controller.signal,
            });
          }
          const finalState = refreshStateOf(res.data);
          if (finalState === 'idle') {
            printProgress(`Storage refresh complete (${formatBytes(res.data?.usage?.bytes)}, freshness=${res.data?.usage?.freshness ?? 'unknown'}).`);
          } else if (finalState === 'failed') {
            printProgress(`Storage refresh failed (reason=${res.data?.usage?.refresh?.reason ?? 'unknown'}).`);
          }
        } catch (err) {
          if (controller.signal.aborted) {
            const stopErr = new Error(
              `${timedOut ? 'Storage refresh wait timed out' : 'Interrupted'}; remote measurement continues. Check with: ariax storage project ${projectId} --json`,
            );
            stopErr.exitCode = timedOut ? EXIT.NETWORK : EXIT.INTERRUPTED;
            throw stopErr;
          }
          throw err;
        } finally {
          clearTimeout(timer);
          process.removeListener('SIGINT', interrupt);
        }
      }
    }
    if (ctx.json) {
      const extraMeta = waited
        ? { waited: true }
        : (res.status === 202 ? { accepted: true, status: 202 } : undefined);
      emitEnvelope(res, extraMeta);
      return;
    }
    const d = res.data || {};
    const usage = d.usage || {};
    const retainedBytes = usage.retained?.bytes;
    printKv({
      project_id: d.project_id ?? projectId,
      name: d.name ?? '-',
      status: d.status ?? '-',
      kind: usage.kind ?? d.cleanup?.kind ?? '-',
      bytes: formatBytes(usage.bytes),
      ...(retainedBytes !== undefined && retainedBytes !== null ? { retained_bytes: formatBytes(retainedBytes) } : {}),
      ...(typeof usage.pending_deletion_bytes === 'number' && usage.pending_deletion_bytes > 0
        ? { pending_deletion_bytes: formatBytes(usage.pending_deletion_bytes) }
        : {}),
      object_count: usage.object_count ?? '-',
      freshness: usage.freshness ?? '-',
      measured_at: usage.measured_at ?? '-',
      refresh_state: usage.refresh?.state ?? '-',
      control_revision: d.control?.revision ?? '-',
      cleanup_state: d.cleanup?.state ?? '-',
      ...(d.cleanup?.verification_not_before ? { verification_not_before: d.cleanup.verification_not_before } : {}),
      ...(!waited && res.status === 202 ? { accepted: true } : {}),
    });
    if (Array.isArray(usage.directories) && usage.directories.length) {
      printData('');
      printTable(
        ['directory', 'bytes', 'objects'],
        usage.directories.map((dir) => [dir.path, formatBytes(dir.bytes), dir.object_count ?? '-']),
      );
    }
    if (Array.isArray(usage.largest_files) && usage.largest_files.length) {
      printData('');
      printTable(
        ['largest_file', 'bytes'],
        usage.largest_files.map((file) => [file.path, formatBytes(file.bytes)]),
      );
    }
    return;
  }

  if (action === 'entries') {
    const limit = flags.limit === undefined ? undefined : validateInteger(flags.limit, 'limit', 'entries', { min: 1, max: 100 });
    const pathParam = flags.path === undefined ? undefined : String(flags.path);
    const cursorParam = flags.cursor === undefined ? undefined : requiredString(flags.cursor, 'cursor', 'entries');
    const res = await ctx.client.get(`/api/v1/projects/${encodeURIComponent(projectId)}/storage/entries`, {
      query: { path: pathParam, limit, cursor: cursorParam },
    });
    if (ctx.json) { emitEnvelope(res); return; }
    const entries = Array.isArray(res.data?.entries) ? res.data.entries : [];
    if (!entries.length) {
      printData('No storage entries found.');
      return;
    }
    printTable(
      ['path', 'kind', 'bytes', 'modified_at', 'downloadable'],
      entries.map((entry) => [
        entry.path ?? entry.name ?? '-',
        entry.kind ?? '-',
        formatBytes(entry.bytes),
        entry.modified_at ?? '-',
        entry.downloadable ?? '-',
      ]),
    );
    if (res.data?.next_cursor) {
      printProgress(`More entries available — re-run with --cursor ${res.data.next_cursor}`);
    }
    return;
  }

  if (action === 'suggest') {
    const res = await ctx.client.get(`/api/v1/projects/${encodeURIComponent(projectId)}/storage/cleanup-suggestions`);
    const rawData = res.data && typeof res.data === 'object' ? res.data : {};
    const rawItems = Array.isArray(rawData.items) ? rawData.items : [];
    let sumBytes = 0;
    let hasAnyBytes = rawItems.length === 0;
    const normalizedItems = rawItems.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const bytes = typeof item.bytes === 'number' && Number.isFinite(item.bytes) && item.bytes >= 0 ? item.bytes : null;
      if (bytes !== null) {
        sumBytes += bytes;
        hasAnyBytes = true;
      }
      const objectCount = typeof item.object_count === 'number' && Number.isSafeInteger(item.object_count) && item.object_count >= 0
        ? item.object_count
        : (typeof item.file_count === 'number' && Number.isSafeInteger(item.file_count) && item.file_count >= 0
          ? item.file_count
          : null);
      const recursive = typeof item.recursive === 'boolean'
        ? item.recursive
        : (item.kind === 'directory' ? true : (item.kind === 'file' ? false : null));
      return {
        ...item,
        bytes,
        object_count: objectCount,
        recursive,
      };
    });
    const totalReclaimableBytes = typeof rawData.total_reclaimable_bytes === 'number'
      && Number.isFinite(rawData.total_reclaimable_bytes) && rawData.total_reclaimable_bytes >= 0
      ? rawData.total_reclaimable_bytes
      : (hasAnyBytes ? sumBytes : null);
    const enrichedData = {
      ...rawData,
      items: normalizedItems,
      total_reclaimable_bytes: totalReclaimableBytes,
    };
    if (ctx.json) { emitEnvelope({ ...res, data: enrichedData }); return; }
    printKv({
      project_id: enrichedData.project_id ?? projectId,
      state: enrichedData.state ?? '-',
      total_reclaimable_bytes: totalReclaimableBytes === null ? '-' : `${formatBytes(totalReclaimableBytes)} (${totalReclaimableBytes} bytes)`,
      ...(enrichedData.final_result ? { final_result: enrichedData.final_result } : {}),
    });
    if (!normalizedItems.length) {
      printData('No cleanup suggestions.');
      return;
    }
    const hasDetails = normalizedItems.some((item) =>
      item && (item.suggestion !== undefined || item.object_count !== null || item.bytes !== null || item.reason !== undefined),
    );
    if (hasDetails) {
      printTable(
        ['path', 'kind', 'recursive', 'objects', 'bytes', 'suggestion', 'reason'],
        normalizedItems.map((item) => [
          item.path ?? '-',
          item.kind ?? '-',
          item.recursive === null ? '-' : String(item.recursive),
          item.object_count ?? '-',
          formatBytes(item.bytes),
          item.suggestion ?? '-',
          item.reason ?? '-',
        ]),
      );
    } else {
      printTable(
        ['path', 'kind', 'recursive'],
        normalizedItems.map((item) => [item.path ?? '-', item.kind ?? '-', item.recursive === null ? '-' : String(item.recursive)]),
      );
    }
    return;
  }

  if (action === 'delete') {
    const useSuggested = flags.suggested === true;
    const rawPaths = flags.path === undefined ? [] : (Array.isArray(flags.path) ? flags.path : [flags.path]);
    const targetPaths = rawPaths.map((p) => requiredString(p, 'path', 'delete'));
    const recursive = flags.recursive === true;

    if (useSuggested && flags.preview !== true) {
      throw usageError('storage delete: --suggested requires --preview. Review previewed targets and submit explicit --path deletions individually.');
    }
    if (useSuggested && targetPaths.length > 0) {
      throw usageError('storage delete: pass either --path or --suggested, not both.');
    }
    if (!useSuggested && targetPaths.length === 0) {
      throw usageError('storage delete: --path is required (or pass --suggested with --preview).');
    }
    if (targetPaths.length > 1 && flags.preview !== true) {
      throw usageError('storage delete: multiple --path flags require --preview. Submit actual deletions one --path at a time.');
    }

    if (flags.preview === true) {
      if (flags['operation-id'] !== undefined) {
        throw usageError('storage delete: --operation-id cannot be combined with --preview.');
      }
      if (flags['expected-control-revision'] !== undefined) {
        throw usageError('storage delete: --expected-control-revision cannot be combined with --preview.');
      }
      if (useSuggested || targetPaths.length > 1) {
        let targets;
        if (useSuggested) {
          const suggestRes = await ctx.client.get(`/api/v1/projects/${encodeURIComponent(projectId)}/storage/cleanup-suggestions`);
          const items = Array.isArray(suggestRes.data?.items) ? suggestRes.data.items : [];
          const seen = new Set();
          targets = [];
          for (const item of items) {
            if (!item || typeof item.path !== 'string' || !item.path.trim()) continue;
            const p = item.path.trim();
            const rec = typeof item.recursive === 'boolean' ? item.recursive : (item.kind === 'directory' || recursive);
            const key = `${p}:${rec}`;
            if (seen.has(key)) continue;
            seen.add(key);
            targets.push({ path: p, recursive: rec });
          }
        } else {
          targets = [...new Set(targetPaths)].map((p) => ({ path: p, recursive }));
        }
        const previews = [];
        let totalBytes = 0;
        let hasBytes = targets.length === 0;
        let totalObjects = 0;
        let hasObjects = targets.length === 0;
        let lastRequestId;
        for (const t of targets) {
          const previewRes = await ctx.client.get(`/api/v1/projects/${encodeURIComponent(projectId)}/storage/deletions/preview`, {
            query: { path: t.path, recursive: String(t.recursive) },
          });
          lastRequestId = previewRes.requestId ?? lastRequestId;
          const d = previewRes.data || {};
          const b = d.observation?.bytes;
          const o = d.observation?.object_count;
          if (typeof b === 'number' && Number.isFinite(b) && b >= 0) { totalBytes += b; hasBytes = true; }
          if (typeof o === 'number' && Number.isSafeInteger(o) && o >= 0) { totalObjects += o; hasObjects = true; }
          previews.push({
            path: d.path ?? t.path,
            recursive: d.recursive ?? t.recursive,
            capability: d.capability ?? null,
            observation: d.observation ?? null,
            control: d.control ?? null,
          });
        }
        const aggregate = {
          project_id: projectId,
          preview: true,
          ...(useSuggested ? { suggested: true } : {}),
          previews,
          total_bytes: hasBytes ? totalBytes : null,
          total_object_count: hasObjects ? totalObjects : null,
          action: previews.length
            ? 'Review each previewed path and run explicit `ariax storage delete PROJECT --path <PATH> [--recursive]` to delete.'
            : null,
        };
        if (ctx.json) {
          emitEnvelope({ data: aggregate, requestId: lastRequestId });
          return;
        }
        printKv({
          project_id: projectId,
          targets: previews.length,
          total_bytes: formatBytes(aggregate.total_bytes),
          total_object_count: aggregate.total_object_count ?? '-',
        });
        if (!previews.length) {
          printData('No suggested cleanup targets to preview.');
          return;
        }
        printTable(
          ['path', 'recursive', 'allowed', 'bytes', 'objects', 'reason'],
          previews.map((item) => [
            item.path ?? '-',
            String(item.recursive),
            item.capability?.allowed ?? '-',
            formatBytes(item.observation?.bytes),
            item.observation?.object_count ?? '-',
            item.capability?.reason ?? '-',
          ]),
        );
        return;
      }
      const targetPath = targetPaths[0];
      const res = await ctx.client.get(`/api/v1/projects/${encodeURIComponent(projectId)}/storage/deletions/preview`, {
        query: { path: targetPath, recursive: String(recursive) },
      });
      if (ctx.json) { emitEnvelope(res); return; }
      const d = res.data || {};
      printKv({
        project_id: d.project_id ?? projectId,
        path: d.path ?? targetPath,
        recursive: d.recursive ?? recursive,
        allowed: d.capability?.allowed ?? '-',
        reason: d.capability?.reason ?? '-',
        bytes: formatBytes(d.observation?.bytes),
        object_count: d.observation?.object_count ?? '-',
        complete: d.observation?.complete ?? '-',
        control_revision: d.control?.revision ?? '-',
      });
      return;
    }
    const targetPath = targetPaths[0];
    let expectedControlRevision;
    if (flags['expected-control-revision'] !== undefined) {
      expectedControlRevision = validateInteger(
        flags['expected-control-revision'],
        'expected-control-revision',
        'delete',
        { min: 0 },
      );
    } else {
      const storage = await ctx.client.get(`/api/v1/projects/${encodeURIComponent(projectId)}/storage`);
      const rev = storage.data?.control?.revision;
      if (!Number.isSafeInteger(rev) || rev < 0) {
        throw new NetworkError('Project control revision is unavailable.');
      }
      expectedControlRevision = rev;
    }
    const operationId = flags['operation-id'] === undefined
      ? randomUUID()
      : validateUuid(flags['operation-id'], '--operation-id', 'delete');
    const res = await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/storage/deletions`, {
      idempotencyKey: operationId,
      body: {
        path: targetPath,
        recursive,
        expected_control_revision: expectedControlRevision,
      },
    });
    if (ctx.json) {
      emitEnvelope(res, {
        operation_id: operationId,
        ...(res.status === 202 ? { accepted: true, status: 202 } : {}),
      });
      return;
    }
    const d = res.data || {};
    const deletion = d.deletion || {};
    printKv({
      project_id: d.project_id ?? projectId,
      operation_id: deletion.id ?? operationId,
      kind: d.kind ?? '-',
      path: deletion.path ?? targetPath,
      recursive: deletion.recursive ?? recursive,
      state: deletion.state ?? d.storage?.cleanup?.state ?? '-',
      status: d.status ?? d.storage?.status ?? '-',
      ...(res.status === 202 ? { accepted: true } : {}),
    });
    return;
  }

  if (action === 'deletion') {
    const deletionId = validateUuid(ctx.positionals[2], 'DELETION_ID', 'deletion');
    const res = await ctx.client.get(`/api/v1/projects/${encodeURIComponent(projectId)}/storage/deletions/${encodeURIComponent(deletionId)}`);
    if (ctx.json) { emitEnvelope(res); return; }
    const d = res.data || {};
    const deletion = d.deletion || {};
    printKv({
      project_id: d.project_id ?? projectId,
      deletion_id: deletion.id ?? deletionId,
      kind: d.kind ?? '-',
      path: deletion.path ?? '-',
      recursive: deletion.recursive ?? '-',
      state: deletion.state ?? d.storage?.cleanup?.state ?? '-',
      reason: deletion.reason ?? '-',
      status: d.status ?? d.storage?.status ?? '-',
      requested_at: deletion.requested_at ?? '-',
      verified_empty_at: deletion.verified_empty_at ?? '-',
    });
  }
}
