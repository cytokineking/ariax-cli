/** `ariax storage` — inspect account/project storage usage, entries, cleanup suggestions, and deletions. */
import { randomUUID } from 'node:crypto';
import { usageError } from '../args.js';
import { isUUID } from '../uuid.js';
import { NetworkError } from '../http.js';
import { resolveProjectId } from '../resolve.js';
import { printData, printJson, printKv, printProgress, printTable } from '../output.js';

const MAX_PAGES = 20;

const OPTIONS = {
  usage: [['refresh', 'after'], 1],
  projects: [['q', 'protocol', 'status', 'sort', 'limit', 'cursor', 'all'], 1],
  project: [['refresh'], 2],
  entries: [['path', 'limit', 'cursor'], 2],
  suggest: [[], 2],
  delete: [['path', 'recursive', 'preview', 'expected-control-revision', 'operation-id'], 2],
  deletion: [[], 3],
};

export const help = `ariax storage usage [--refresh] [--after UUID]
  ariax storage projects [--q TEXT] [--protocol P] [--status S] [--sort updated_at|name|bytes_desc] [--limit N] [--cursor C] [--all]
  ariax storage project PROJECT [--refresh]
  ariax storage entries PROJECT [--path P] [--limit N] [--cursor C]
  ariax storage suggest PROJECT
  ariax storage delete PROJECT --path P [--recursive] [--preview] [--expected-control-revision N] [--operation-id UUID]
  ariax storage deletion PROJECT DELETION_ID
  PROJECT accepts a project UUID or an exact unique project name.
  Use \`storage delete --preview\` to inspect impact before submitting a deletion.
  For Forge projects, \`storage suggest\` highlights large or high-file-count directories for \`ariax forge pack\` or \`ariax forge files delete\`.`;

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
    const res = flags.refresh === true
      ? await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/storage/refresh`, { body: {} })
      : await ctx.client.get(`/api/v1/projects/${encodeURIComponent(projectId)}/storage`);
    if (ctx.json) {
      emitEnvelope(res, res.status === 202 ? { accepted: true, status: 202 } : undefined);
      return;
    }
    const d = res.data || {};
    const usage = d.usage || {};
    printKv({
      project_id: d.project_id ?? projectId,
      name: d.name ?? '-',
      status: d.status ?? '-',
      kind: usage.kind ?? d.cleanup?.kind ?? '-',
      bytes: formatBytes(usage.bytes),
      object_count: usage.object_count ?? '-',
      freshness: usage.freshness ?? '-',
      measured_at: usage.measured_at ?? '-',
      refresh_state: usage.refresh?.state ?? '-',
      control_revision: d.control?.revision ?? '-',
      cleanup_state: d.cleanup?.state ?? '-',
      ...(res.status === 202 ? { accepted: true } : {}),
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
    if (ctx.json) { emitEnvelope(res); return; }
    const d = res.data || {};
    printKv({
      project_id: d.project_id ?? projectId,
      state: d.state ?? '-',
      ...(d.final_result ? { final_result: d.final_result } : {}),
    });
    const items = Array.isArray(d.items) ? d.items : [];
    if (!items.length) {
      printData('No cleanup suggestions.');
      return;
    }
    const hasForgeFields = items.some((item) =>
      item && (item.suggestion !== undefined || item.file_count !== undefined || item.bytes !== undefined || item.reason !== undefined),
    );
    if (hasForgeFields) {
      printTable(
        ['path', 'kind', 'file_count', 'bytes', 'suggestion', 'reason'],
        items.map((item) => [
          item.path ?? '-',
          item.kind ?? '-',
          item.file_count ?? '-',
          formatBytes(item.bytes),
          item.suggestion ?? '-',
          item.reason ?? '-',
        ]),
      );
    } else {
      printTable(
        ['path', 'kind'],
        items.map((item) => [item.path ?? '-', item.kind ?? '-']),
      );
    }
    return;
  }

  if (action === 'delete') {
    const targetPath = requiredString(flags.path, 'path', 'delete');
    const recursive = flags.recursive === true;
    if (flags.preview === true) {
      if (flags['operation-id'] !== undefined) {
        throw usageError('storage delete: --operation-id cannot be combined with --preview.');
      }
      if (flags['expected-control-revision'] !== undefined) {
        throw usageError('storage delete: --expected-control-revision cannot be combined with --preview.');
      }
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
