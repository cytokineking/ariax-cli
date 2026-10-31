/** Forge sessions and commands on the existing authenticated API origin. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { usageError } from '../args.js';
import { isUUID } from '../uuid.js';
import { accountIdentity, atomicWrite } from '../operations.js';
import { ApiError, NetworkError, backoffDelay } from '../http.js';
import { EXIT } from '../exit-codes.js';
import { checkGpuPolicy } from '../gpu-policy.js';
import { printData, printJson, printKv, printProgress, printTable } from '../output.js';

import { forgeRequest, forgeAccountIdentity, hasCachedForgeConnection } from '../lib/forge-client.js';
import { readSync, redactForgeOutput, redactForgeText } from '../lib/forge-workspace-client.js';

import { runFiles, inputStatus, recoverFile, failedSync } from './forge-files.js';

const API = '/api/v1/forge';
const TERMINAL_COMMANDS = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
const SESSION_OPTIONS = ['gpu', 'allowed-gpus', 'gpu-count', 'tools', 'priority', 'max-gpu-hours',
  'min-ram-gib', 'min-cpu-count', 'min-disk-gib', 'session-id'];
const OPTIONS = {
  create: [['name', ...SESSION_OPTIONS], 1],
  resume: [['control-revision', ...SESSION_OPTIONS], 2],
  project: [['limit', 'cursor'], 2],
  activity: [['limit', 'cursor'], 2],
  limit: [['gpu-hours', 'clear', 'limit-revision', 'operation-id'], 2],
  catalog: [['details', 'task', 'tool', 'compact', 'model', 'mode'], 1],
  list: [[], 1], status: [[], 2], tools: [['details'], 2],
  'tools add': [['tools', 'priority', 'selection-id'], 3],
  'tools wait': [['timeout', 'wait-timeout'], 4],
  run: [['tool', 'gpus', 'cwd', 'timeout-seconds', 'command-id', 'wait-ready', 'input-ids', 'wait', 'wait-timeout'], 2],
  operations: [[], 1], recover: [['wait', 'wait-timeout'], 2],
  finish: [['timeout-seconds', 'operation-id', 'wait', 'wait-timeout'], 2],
  commands: [['retained'], 2], command: [['retained'], 3], watch: [['timeout', 'wait-timeout'], 3],
  'inputs add': [['file', 'artifact', 'url', 'path', 'input-id'], 3],
  'inputs list': [['retained'], 3], 'inputs status': [['retained'], 4],
  sync: [['wait', 'sync-id', 'timeout', 'wait-timeout'], 2],
  files: [['path'], 2], 'files recover': [['path', 'catalog', 'archive', 'artifact', 'version', 'operation-id', 'overwrite', 'wait', 'wait-timeout'], 3],
  download: [['dest'], 3], link: [[], 3],
  logs: [['tail', 'cursor', 'wait-seconds', 'retained'], 3], cancel: [[], 3], close: [[], 2],
};

export const help = `ariax forge create --name NAME --gpu GPU [--allowed-gpus RTX5090,L40S] [--gpu-count 1] [--tools boltz2,bindcraft2] [--priority boltz2] [--max-gpu-hours H] [--session-id UUID]
  ariax forge resume PROJECT [--control-revision N] --gpu GPU [usual hardware/tool options] [--session-id UUID]
  ariax forge project PROJECT [--limit 50] [--cursor CURSOR]
  ariax forge activity PROJECT [--limit 50] [--cursor CURSOR]
  ariax forge limit SESSION (--gpu-hours H | --clear) [--limit-revision N] [--operation-id UUID]
  ariax forge catalog [--details | --compact] [--task FAMILY] [--tool TOOL]
  ariax forge catalog --tool TOOL [--model MODEL] [--mode MODE] [--json]
  ariax forge list
  ariax forge status SESSION
  ariax forge tools SESSION [--details]
  ariax forge tools add SESSION --tools TOOL,... [--priority TOOL,...] [--selection-id UUID]
  ariax forge tools wait SESSION TOOL [--wait-timeout SECONDS]
  ariax forge run SESSION --tool TOOL [--gpus 0,1] [--cwd /workspace] [--timeout-seconds SECONDS] [--command-id UUID] [--wait-ready [--input-ids ID,...]] [--wait] [--wait-timeout SECONDS] -- COMMAND ARG...
  ariax forge operations
  ariax forge recover OPERATION_ID [--wait] [--wait-timeout SECONDS]
  ariax forge finish SESSION [--timeout-seconds SECONDS] [--operation-id UUID] [--wait] [--wait-timeout SECONDS]
  ariax forge commands SESSION [--retained]
  ariax forge command SESSION COMMAND_ID [--retained]
  ariax forge watch SESSION COMMAND_ID [--wait-timeout SECONDS]
  ariax forge logs SESSION COMMAND_ID [--tail 1000] [--cursor CURSOR] [--wait-seconds 0..25] [--retained]
  ariax forge cancel SESSION COMMAND_ID
  ariax forge close SESSION
  ariax forge inputs add SESSION --file FILE --path PATH [--input-id UUID]
  ariax forge inputs add SESSION --artifact PROJECT_ID:PATH --path PATH [--input-id UUID]
  ariax forge inputs add SESSION --url URL --path PATH [--input-id UUID]
  ariax forge inputs list SESSION
  ariax forge inputs status SESSION INPUT_ID
  ariax forge sync SESSION [--wait] [--sync-id UUID] [--wait-timeout SECONDS]
  ariax forge files PROJECT [--path /workspace]
  ariax forge files recover PROJECT --path DEST (--catalog PROJECT:PATH --version N | --archive PROJECT:CHECKPOINT:PATH | --artifact PROJECT:PATH) [--overwrite] [--operation-id UUID] [--wait] [--wait-timeout SECONDS]
  ariax forge download PROJECT PATH --dest LOCAL
  ariax forge link PROJECT PATH
  Files and links refer to the current project workspace, not a historical version.
  Sync flushes changed files on an active session; it is not an atomic multi-file snapshot.
  Hardware options: --min-ram-gib N --min-cpu-count N --min-disk-gib N
  --wait-ready waits for the session, tool, listed inputs and command capacity before dispatch.
  --wait-timeout bounds local waiting in seconds (run/files recover default 1800, recover default 60); --timeout-seconds limits remote execution (default 86400).
  Finish uses --timeout-seconds for its fixed remote deadline (default 3600); its --wait-timeout defaults to 7200 seconds.
  For tools wait, watch and sync, --wait-timeout is in seconds; omission or 0 waits indefinitely. Their older --timeout option also uses seconds.
  Elsewhere the global --timeout is a per-request limit in milliseconds (default 30000).
  --gpu is preferred; --allowed-gpus lists it plus permitted fallbacks. Include a core GPU: H100, A100_80GB, L40, L40S, or RTX6000PRO.
  Use catalog --compact to find tools; --model/--mode select exact IDs and their requirements.
  --model/--mode require --tool and cannot combine with --compact/--details. Omit them for the full tool record.`;

function actionOf(positionals) {
  if (positionals[0] === 'inputs' && ['add', 'list', 'status'].includes(positionals[1])) return `inputs ${positionals[1]}`;
  if (positionals[0] === 'tools' && ['add', 'wait'].includes(positionals[1])) return `tools ${positionals[1]}`;
  if (positionals[0] === 'files' && positionals[1] === 'recover') return 'files recover';
  return positionals[0];
}

export function validateArguments({ positionals, flags, passthrough, globals }) {
  if (!positionals.length && globals.help && !Object.keys(flags).length) return;
  const action = actionOf(positionals);
  if (['checkpoint', 'checkpoints'].includes(action)
      || ['checkpoint', 'checkpoint-id', 'restore-session'].some(name => Object.hasOwn(flags, name))) {
    throw usageError('Forge checkpoints and restore selectors are no longer supported. Use the current project workspace; upgrade the CLI and server together. Run: ariax forge --help');
  }
  if (!Object.hasOwn(OPTIONS, action)) throw usageError('forge: unknown action. Run: ariax forge --help');
  const [allowed, operands] = OPTIONS[action];
  for (const name of Object.keys(flags)) {
    if (!allowed.includes(name)) throw usageError(`forge ${action}: unsupported flag --${name}.`);
  }
  if (flags.timeout !== undefined && flags['wait-timeout'] !== undefined) {
    throw usageError('forge: use only --wait-timeout for the local wait.');
  }
  const count = positionals.length - (action === 'run' ? (passthrough?.length ?? 0) : 0);
  if (count > operands) throw usageError(`forge ${action}: unexpected positional arguments; expected at most ${operands}.`);
  if (globals.help) return;
  if (count < operands) throw usageError(`forge ${action}: missing required positional arguments. Run: ariax forge --help`);
  if (action === 'run' && !passthrough?.length) throw usageError('forge run: supply a command and its arguments after --.');
}

export function uuid(value, label) {
  if (!isUUID(value)) throw usageError(`forge: ${label} must be a UUID.`);
  return value.trim().toLowerCase();
}

export function required(value, flag) {
  if (typeof value !== 'string' || !value.trim()) throw usageError(`forge: --${flag} is required and must be nonempty.`);
  return value.trim();
}

function number(value, flag, { integer = false, zero = false } = {}) {
  const result = Number(value);
  if (!['string', 'number'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(result) || (zero ? result < 0 : result <= 0)
      || (integer && !Number.isSafeInteger(result))) {
    throw usageError(`forge: --${flag} must be a ${zero ? 'nonnegative' : 'positive'} ${integer ? 'integer' : 'number'}.`);
  }
  return result;
}

function csv(value, flag) {
  if (typeof value !== 'string') throw usageError(`forge: --${flag} must be a comma-separated list.`);
  const parts = value.split(',').map(part => part.trim());
  if (parts.some(part => !part) || new Set(parts).size !== parts.length) {
    throw usageError(`forge: --${flag} must contain distinct nonempty values.`);
  }
  return parts;
}

function sessionOptions(flags) {
  const hardware = {};
  for (const [flag, field] of [['min-ram-gib', 'min_ram_gib'], ['min-cpu-count', 'min_cpu_count'], ['min-disk-gib', 'min_disk_gib']]) {
    if (flags[flag] !== undefined) hardware[field] = number(flags[flag], flag, { integer: field === 'min_cpu_count' });
  }
  return { gpu_type: required(flags.gpu, 'gpu'),
    ...(flags['allowed-gpus'] === undefined ? {} : { allowed_gpus: csv(flags['allowed-gpus'], 'allowed-gpus') }),
    gpu_count: flags['gpu-count'] === undefined ? 1 : number(flags['gpu-count'], 'gpu-count', { integer: true }),
    ...selection(flags),
    ...(Object.keys(hardware).length ? { hardware } : {}),
    ...(flags['max-gpu-hours'] === undefined ? {} : { max_gpu_hours: number(flags['max-gpu-hours'], 'max-gpu-hours') }) };
}

function gpuSelection(value) {
  if (typeof value !== 'string') throw usageError('forge: --gpus must be a comma-separated list of device indices.');
  const parts = value.split(',').map(part => part.trim());
  const ids = parts.map(part => Number(part));
  if (parts.some(part => !/^\d+$/.test(part)) || ids.some(id => !Number.isSafeInteger(id)) || new Set(ids).size !== ids.length) {
    throw usageError('forge: --gpus must contain distinct nonnegative integer device indices.');
  }
  return ids;
}

export function projectUrl(ctx, projectId) {
  return new URL(`/projects/forge/${uuid(projectId, 'project ID')}`, ctx.config.baseUrl).href;
}

function selection(flags, adding = false) {
  const parse = (value, flag) => {
    if (typeof value !== 'string') throw usageError(`forge: --${flag} must be a comma-separated list.`);
    const names = value.split(',').map(name => name.trim());
    if (names.some(name => !name) || new Set(names).size !== names.length) {
      throw usageError(`forge: --${flag} must contain distinct tool names.`);
    }
    return names;
  };
  const tools = flags.tools === undefined ? [] : parse(flags.tools, 'tools');
  if (adding && !tools.length) throw usageError('forge tools add: --tools is required.');
  if (tools.includes('base')) throw usageError('forge: base is always included; omit it from --tools.');
  const priority = flags.priority === undefined ? [...tools] : parse(flags.priority, 'priority');
  if (priority.some(tool => !tools.includes(tool))) throw usageError('forge: --priority must name selected tools.');
  priority.push(...tools.filter(tool => !priority.includes(tool)));
  return { tools, priority };
}

export function recordPath(ctx, id, create = false) {
  let dir = path.resolve(ctx.config.rootDir);
  for (const name of ['.ariax', 'forge']) {
    dir = path.join(dir, name);
    if (create) {
      try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    let stat;
    try { stat = fs.lstatSync(dir); } catch (error) { if (!create && error.code === 'ENOENT') return null; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw usageError('Forge request storage must use real directories, not symlinks.');
    if (create) fs.chmodSync(dir, 0o700);
  }
  return path.join(dir, `${uuid(id, 'request ID')}.json`);
}

export function readRecord(file) {
  if (!file) return null;
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try {
    if (!fs.fstatSync(fd).isFile()) throw usageError('Forge request record must be a regular file.');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
}

export function saveResult(file, record, result) {
  const next = { ...record, result: redactForgeOutput(result),
    ...(isUUID(result?.project_id) ? { project_id: result.project_id } : {}) };
  atomicWrite(file, JSON.stringify(next, null, 2) + '\n');
}

export function localWaitSeconds(value, fallback, { allowZero = false } = {}) {
  const seconds = value === undefined ? fallback : number(value, 'wait-timeout', { zero: allowZero });
  if (seconds > 86400) throw usageError('forge: --wait-timeout cannot exceed 86400 seconds.');
  return seconds;
}

export async function controlled(ctx, id, seconds, operation, {resume} = {}) {
  const controller = new AbortController();
  let expired = false;
  const interrupt = () => controller.abort();
  const timer = seconds ? setTimeout(() => { expired = true; controller.abort(); }, seconds * 1000) : undefined;
  process.once('SIGINT', interrupt);
  try { return await operation(controller.signal); }
  catch (error) {
    if (!controller.signal.aborted) {
      if (!error.action) {
        try { if (readRecord(recordPath(ctx,id))) error.action = `Inspect or recover the same operation with ariax forge recover ${id}.`; }
        catch { /* Preserve the original error. */ }
      }
      throw error;
    }
    let saved;
    try { saved = readRecord(recordPath(ctx,id)); } catch { /* Preserve the interruption. */ }
    const next = saved ? `ariax forge recover ${id}` : resume;
    const stopped = new Error(next
      ? `${expired ? 'Local wait timed out' : 'Interrupted'}; remote work may continue. Continue with: ${next}`
      : `${expired ? 'Local wait timed out' : 'Interrupted'} before the request was saved; no operation was sent.`);
    stopped.exitCode = expired ? EXIT.NETWORK : EXIT.INTERRUPTED;
    if (next) stopped.action = `Use ${next} with the original account and API origin. Local interruption does not cancel remote work.`;
    if (saved && savedKind(id,saved.request) === 'finish' && saved.result) {
      stopped.details = {finish:redactForgeOutput(saved.result)};
      printProgress(`Last observed finish: execution ${saved.result.execution}; drain ${saved.result.drain}; durability ${saved.result.durability}; release ${saved.result.release}.`);
    }
    throw stopped;
  } finally { clearTimeout(timer); process.removeListener('SIGINT', interrupt); }
}

function savedKind(id, request) {
  if (request?.method !== 'POST' || !request.body || typeof request.body !== 'object' || Array.isArray(request.body)) return null;
  if (!request.session_id && request.body.session_id === id && (request.path === `${API}/sessions`
      || new RegExp(`^${API}/projects/[0-9a-f-]{36}/sessions$`).test(request.path))) return 'session';
  const control = new RegExp(`^${API}/sessions/([0-9a-f-]{36})/(close|limit|finish)$`).exec(request.path ?? '');
  if (!request.session_id && control && isUUID(control[1])) {
    if (control[2] === 'close' && !Object.keys(request.body).length) return 'close';
    if (control[2] === 'finish' && request.body.operation_id === id
        && Number.isSafeInteger(request.body.timeout_seconds) && request.body.timeout_seconds >= 1
        && request.body.timeout_seconds <= 86400 && Object.keys(request.body).length === 2) return 'finish';
    if (control[2] === 'limit' && Object.keys(request.body).length === 2
        && (request.body.max_gpu_hours === null || (typeof request.body.max_gpu_hours === 'number' && request.body.max_gpu_hours > 0))
        && Number.isSafeInteger(request.body.expected_limit_revision) && request.body.expected_limit_revision >= 0) return 'limit';
  }
  if (!isUUID(request.session_id)) return null;
  if (request.path === '/v1/commands' && request.body.command_id === id) return 'command';
  if (request.path === '/v1/tools' && request.body.selection_id === id) return 'selection';
  if (request.path === '/v1/sync' && request.body.sync_id === id) return 'sync';
  if (request.path === '/v1/inputs' && request.body.input_id === id) return 'input';
  if (request.type === 'project-file-input-v2' && request.body.operation_id === id) return 'input';
  if (request.type === 'project-file-copy-v1' && request.body.operation_id === id) return 'file-recovery';
  if (new RegExp(`^/v1/commands/[0-9a-f-]{36}/cancel$`).test(request.path) && !Object.keys(request.body).length) return 'cancel';
  return null;
}

export function transient(error) {
  return error instanceof NetworkError || (error instanceof ApiError
    && ([429, 502, 503, 504].includes(error.status) || (error.status >= 500 && error.retryable === true)));
}

function checkIdentity(record, account, id) {
  if (Object.keys(account).some(field => record[field] !== account[field])) {
    throw usageError(`Forge request ${id} belongs to a different account or API origin. Restore the original account and origin to recover it.`);
  }
}

function checkCommand(record, result) {
  const body = record.request.body, data = result.data;
  if (data?.command_id !== record.id || data.tool !== body.tool || !isDeepStrictEqual(data.argv, body.argv)
      || data.cwd !== body.cwd || data.timeout_seconds !== body.timeout_seconds
      || (body.gpu_ids !== undefined && !isDeepStrictEqual(data.gpu_ids, body.gpu_ids))) {
    throw new ApiError({ status: 409, code: 'command_conflict', message: `Command ${record.id} does not match its saved request.` });
  }
}

async function optionalRead(read) {
  try { return await read(); }
  catch (error) { if (error.status === 404) return null; throw error; }
}

// A retained admission can outlive a host journal. If the live record is
// absent, inspect retained history before deciding that an ID can be submitted.
async function observeCommand(ctx, record, signal) {
  const { id, request } = record, session = request.session_id;
  let live, unavailable;
  try {
    checkIdentity(record, await forgeAccountIdentity(ctx, session, {signal}), id);
    live = await forgeRequest(ctx, session, 'GET', `/v1/commands/${id}`, { signal });
  } catch (error) {
    if (error.status !== 404 && error.code !== 'session_unready' && !transient(error)) throw error;
    if (error.status !== 404) unavailable = error;
  }
  if (live) {
    checkCommand(record, live);
    return { result: live, live: true };
  }
  const retained = await optionalRead(() => ctx.client.get(`${API}/sessions/${session}/commands/${id}`, { signal }));
  if (retained) {
    checkCommand(record, retained);
    return { result: { ...retained, meta: { ...retained.meta, source: 'retained' }, retained: true }, live: false };
  }
  if (unavailable) throw unavailable;
  return null;
}

async function waitReady(ctx, record, account, signal) {
  const { session_id: session, body } = record.request;
  let last;
  for (;;) {
    const lifecycle = await ctx.client.get(`${API}/sessions/${session}`, { signal });
    if (['closing', 'closed', 'failed'].includes(lifecycle.data.state)) {
      failed('session_unavailable', `Session ${session} is ${lifecycle.data.state}`, lifecycle.data.error);
    }
    let state = `session ${lifecycle.data.state}`;
    if (lifecycle.data.state === 'available') {
      checkIdentity(record, await forgeAccountIdentity(ctx, session, {signal}), record.id);
      const current = await forgeRequest(ctx, session, 'GET', '/v1/session', { signal });
      if (['closing', 'closed', 'failed'].includes(current.data.state)) {
        failed('session_unavailable', `Session ${session} is ${current.data.state}`, current.data.error);
      }
      const tool = current.data.tools?.find(item => item.tool === body.tool);
      if (!tool) throw usageError(`Tool ${body.tool} is not selected. Inspect ariax forge tools ${session}.`);
      if (tool.state === 'failed') failed('tool_failed', `Tool ${body.tool} failed`, tool.error);
      state = `tool ${body.tool}: ${tool.state}`;
      if (current.data.state === 'available' && tool.state === 'ready') {
        let pending;
        for (const id of record.readiness?.input_ids ?? []) {
          const input = await inputStatus(ctx, session, id, { signal, account });
          if (input.data?.state === 'failed') failed('input_failed', `Input ${id} failed`, input.data.error,
            `Inspect ariax forge inputs status ${session} ${id}.`);
          if (input.data?.state !== 'ready') { pending = id; break; }
        }
        if (!pending) return;
        state = `input ${pending}: pending`;
      }
    }
    if (state !== last) { printProgress(`Waiting for ${state}`); last = state; }
    await delay(3000, undefined, { signal });
  }
}

async function dispatchSaved(ctx, file, record, account, { previous, signal }) {
  const { id, request } = record, kind = savedKind(id, request);
  const retrySafe = ['session', 'command', 'selection', 'cancel', 'close', 'limit', 'finish'].includes(kind);
  let failures = 0;
  for (;;) {
    try {
      // Session and tool-selection POSTs compare the complete saved fields on
      // the server; a session status projection cannot prove that match.
      if (kind === 'command') {
        // While provisioning there is no direct endpoint to inspect yet.
        if (record.readiness) {
          const lifecycle = await ctx.client.get(`${API}/sessions/${request.session_id}`, { signal });
          if (lifecycle.data.state !== 'available') {
            if (previous) {
              const retained = await optionalRead(() => ctx.client.get(`${API}/sessions/${request.session_id}/commands/${id}`, {signal}));
              if (retained) {
                checkCommand(record, retained);
                saveResult(file, record, retained.data);
                return { ...retained, meta: { ...retained.meta, source: 'retained' }, retained: true };
              }
            }
            await waitReady(ctx, record, account, signal);
          }
        }
        const found = await observeCommand(ctx, record, signal);
        if (found && (!found.live || found.result.data.state !== 'pending' || found.result.data.cancel_requested !== false)) {
          saveResult(file, record, found.result.data);
          return found.result;
        }
        if (!found && record.result) {
          const error = new ApiError({status:409,code:'command_unconfirmed',message:`Command ${id} was previously observed but is absent from live and retained history.`});
          error.action = `Inspect session ${request.session_id} and retained command history. Keep command ID ${id}; do not start it again while its outcome is uncertain.`;
          throw error;
        }
      }
      if (kind === 'command' && record.readiness) await waitReady(ctx, record, account, signal);
      if (request.session_id) {
        const directAccount = await forgeAccountIdentity(ctx, request.session_id, { signal });
        checkIdentity(record, directAccount, id);
      }
      const res = request.session_id
        ? await forgeRequest(ctx, request.session_id, 'POST', request.path, { body: request.body, signal })
        : await ctx.client.post(request.path, { body: request.body, signal });
      const label = { session: 'session_id', command: 'command_id', selection: 'selection_id' }[kind];
      if (label && res.data?.[label] !== id) throw new NetworkError(`Forge response has no matching ${label}.`);
      if (kind === 'command') checkCommand(record, res);
      if (kind === 'finish') validateFinish(res.data,id,request.path.split('/')[5]);
      saveResult(file, record, res.data);
      return res;
    } catch (error) {
      if (signal?.aborted) throw error;
      const capacity = kind === 'command' && record.readiness &&
        ['gpu_busy', 'cpu_busy', 'command_capacity', 'tool_unready', 'session_unready', 'hydration_pending', 'file_mutation_pending'].includes(error.code);
      if (capacity) {
        printProgress(`Waiting for command readiness: ${error.code}`);
        previous = true;
        await delay(3000, undefined, { signal });
        continue;
      }
      if (!retrySafe || !transient(error) || failures >= 2) throw error;
      const ms = error.retryAfterMs ?? backoffDelay(failures, 500, 3000);
      failures++;
      previous = true;
      printProgress(`Temporary error; reconciling saved operation ${id} (retry ${failures}/2).`);
      await delay(ms, undefined, { signal });
    }
  }
}

export async function submit(ctx, id, request, label, recovery, options = {}) {
  if (!options.signal) return controlled(ctx, id, 60, signal => submit(ctx, id, request, label, recovery, { ...options, signal }));
  const account = request.session_id && !options.readiness && request.path !== '/v1/commands'
    ? await forgeAccountIdentity(ctx, request.session_id, { signal: options.signal })
    : await accountIdentity(ctx, { signal: options.signal });
  fs.mkdirSync(ctx.config.rootDir, { recursive: true, mode: 0o700 });
  const file = recordPath(ctx, id, true);
  const candidate = { id, ...account, request, result: null, ...(options.readiness ? { readiness: options.readiness } : {}) };
  let record = readRecord(file);
  let previous = !!record;
  if (!record) {
    // New-admission policy must not block authenticated, identical recovery of
    // a request saved before this policy existed. The checks below still bind
    // every replay to its original account, origin and request body.
    if (label === 'session_id') {
      await checkGpuPolicy(ctx, { protocol: 'forge', allowed_gpus: request.body.allowed_gpus ?? [request.body.gpu_type] }, { source: 'Forge session' });
    }
    try { atomicWrite(file, JSON.stringify(candidate, null, 2) + '\n', true); record = candidate; }
    catch (error) { if (error.code !== 'EEXIST') throw error; record = readRecord(file); previous = true; }
  }
  if (label === 'session_id' && record?.id === id && record.request?.body?.files_contract !== 2) {
    throw new ApiError({ status: 409, code: 'upgrade_required', message: `Saved session request ${id} uses the legacy file contract. Inspect the original session; it cannot be replayed as a current-workspace request.` });
  }
  if (record?.id !== id || !isDeepStrictEqual(record.request, request)) {
    throw new ApiError({ status: 409, code: 'request_conflict', message: `Forge request ${id} differs from its saved request. Use the original fields to retry.` });
  }
  checkIdentity(record, account, id);
  if (options.readiness && record.readiness && !isDeepStrictEqual(record.readiness, options.readiness)) {
    throw new ApiError({ status: 409, code: 'request_conflict', message: `Forge request ${id} has different saved readiness inputs.` });
  }
  if (options.readiness && !record.readiness) {
    record = { ...record, readiness: options.readiness };
    atomicWrite(file, JSON.stringify(record, null, 2) + '\n');
  }
  printProgress(`${label}: ${id}`);
  try {
    return await dispatchSaved(ctx, file, record, account, { previous, signal: options.signal });
  } catch (error) {
    error.action = `Recover the saved request with ariax forge recover ${id}, using the same --root-dir, account and API origin. ${recovery || ''}`.trim();
    throw error;
  }
}

// Reads can refresh a local record, but never create a request or replay work.
function remember(ctx, id, resourcePath, result) {
  const file = recordPath(ctx, id);
  const record = readRecord(file);
  const directRead = record?.request?.session_id && resourcePath.startsWith('/v1/') && `${record.request?.path}/${id}` === resourcePath;
  const sessionRead = resourcePath === `${API}/sessions/${id}` && record?.request?.body?.session_id === id;
  if (record?.id === id && (sessionRead || directRead || `${record.request?.path}/${id}` === resourcePath)
      && record.api_origin === new URL(ctx.config.baseUrl).origin) saveResult(file, record, result);
}

export function report(ctx, res, kind) {
  res = { ...res, data: redactForgeOutput(res.data), meta: redactForgeOutput(res.meta),
    requestId: typeof res.requestId === 'string' ? redactForgeText(res.requestId) : res.requestId };
  if (res.data?.state === 'unknown') printProgress(`Command outcome is uncertain. Inspect the same command ID ${res.data.command_id}; keep that ID and its saved request until the outcome is known. A fresh command could duplicate execution.`);
  if (ctx.json) { printJson({ data: res.data, meta: res.meta, request_id: res.requestId }); return; }
  const data = res.data;
  if (Number.isSafeInteger(data?.limit_revision) && data.limit_revision >= 0
      && data.applied_limit_revision !== data.limit_revision
      && ['provisioning', 'starting', 'available'].includes(data.state)) {
    printProgress(`Limit revision ${data.limit_revision} is saved; host application is pending. The host retains its previous deadline until delivery. Inspect ariax forge status ${data.session_id} for applied_limit_revision.`);
  }
  if (kind === 'sessions') printTable(['session_id', 'name', 'state', 'gpu', 'gpu_count'], data.sessions.map(s => [s.session_id, s.name, s.state, s.gpu_type, s.gpu_count]));
  else if (kind === 'operations') {
    printTable(['operation_id', 'kind', 'session_id', 'last_observed_state'], data.operations.map(item =>
      [item.operation_id, item.kind, item.session_id, item.last_observed_state]));
    if (data.truncated) printProgress('More local records exist; this listing is limited to 10000 filenames.');
    if (data.unreadable) printProgress(`${data.unreadable} local records could not be read.`);
  }
  else if (kind === 'commands') printTable(['command_id', 'tool', 'gpu_ids', 'state', 'exit_code'], data.commands.map(c => [c.command_id, c.tool, c.gpu_ids?.join(','), c.state, c.exit_code]));
  else if (kind === 'tools' || kind === 'catalog') {
    if (ctx.flags.details || (kind === 'catalog' && (ctx.flags.compact || ctx.flags.tool !== undefined))) {
      for (const tool of data.tools) printKv(tool);
    }
    else if (kind === 'catalog') printTable(['tool', 'name', 'gpu', 'tasks', 'guide'], data.tools.map(t => [t.tool, t.name, t.gpu, t.capabilities?.tasks?.join(',') || 'unknown', t.capabilities?.guide || 'unknown']));
    else printTable(['tool', 'state', 'error'], data.tools.map(t => [t.tool, t.state, t.error?.message]));
  }
  else if (kind === 'inputs') printTable(['input_id', 'path', 'state', 'size_bytes'], data.inputs.map(i => [i.input_id, i.path, i.state, i.size_bytes]));
  else if (kind === 'files') printTable(['path', 'kind', 'size_bytes'], data.entries.map(e => [e.path, e.kind, e.size_bytes]));
  else if (kind === 'activity') {
    printTable(['created_at', 'kind', 'id', 'session_id', 'state/action', 'origin'], data.events.map(e =>
      [e.created_at, e.kind, e.id, e.session_id, e.record.state ?? e.record.action, e.record.origin]));
    printKv({ next_cursor: data.next_cursor, synchronization: data.synchronization });
  }
  else if (kind === 'logs') {
    printData(data.text || (data.output_available === true ? '(empty retained output)'
      : data.output_available === false ? '(output unavailable)' : '(output availability not reported)'));
    printKv(Object.fromEntries(['next_cursor', 'gap', 'output_available', 'output_truncated', 'output_complete', 'output_error', 'output_files']
      .filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]])));
    if (data.output_truncated === true) printProgress('Only a bounded tail is retained; an earlier prefix was omitted.');
    if (data.output_complete === false && data.output_available === true) printProgress('The retained tail is partial; final output has not been captured.');
    if (data.output_complete === true) printProgress('The terminal tail was captured. Earlier output may still be truncated.');
  }
  else printKv(data);
}

// Summary is for routing only. Keep all observed qualification states visible,
// including unknown/missing values. Inspect the selected model/mode before use.
function compactCatalogTool(tool) {
  const rows = Array.isArray(tool.capabilities?.qualification) ? tool.capabilities.qualification : [];
  const states = field => [...new Set(rows.length ? rows.map(row => row?.[field] ?? 'unknown') : ['unknown'])];
  return {
    tool: tool.tool,
    name: tool.name,
    gpu: tool.gpu,
    resources: tool.resources ?? null,
    models: Array.isArray(tool.models) ? tool.models.map(model => ({ id: model.id, resources: model.resources ?? null })) : null,
    capabilities: {
      tasks: tool.capabilities?.tasks ?? null,
      guide: tool.capabilities?.guide ?? null,
      qualification: { rows: rows.length, native: states('native'), installation: states('installation'), restoration: states('restoration') },
    },
  };
}

// Keep selected rows intact: scope/workload can carry scientific limits that
// cannot safely be inferred from a passed state or shortened as generic prose.
function selectedCatalogTool(tool, model, mode) {
  const models = Array.isArray(tool.models) ? tool.models : [];
  const rows = Array.isArray(tool.capabilities?.qualification) ? tool.capabilities.qualification : [];
  const modelRows = rows.filter(row => model === undefined || row?.model === model);
  const selectedModels = models.filter(item => model === undefined || item.id === model);
  if (model !== undefined && !selectedModels.length && !modelRows.length) {
    throw usageError(`forge catalog: model "${model}" is not in tool "${tool.tool}".`);
  }
  const qualification = modelRows.filter(row => mode === undefined || row?.mode === mode);
  if (mode !== undefined && !qualification.length && !selectedModels.some(item => item.modes?.includes(mode))) {
    throw usageError(`forge catalog: mode "${mode}" is not in tool "${tool.tool}"${model === undefined ? '' : ` model "${model}"`}.`);
  }
  return {
    tool: tool.tool,
    name: tool.name,
    gpu: tool.gpu,
    resources: tool.resources ?? null,
    models: selectedModels.filter(item => mode === undefined || item.modes?.includes(mode)
      || qualification.some(row => row?.model === item.id)).map(item => ({
      id: item.id,
      modes: mode === undefined ? item.modes ?? null : [mode],
      resources: item.resources ?? null,
    })),
    capabilities: {
      tasks: tool.capabilities?.tasks ?? null,
      guide: tool.capabilities?.guide ?? null,
      terms: tool.capabilities?.terms ?? null,
      citations: tool.capabilities?.citations ?? null,
      qualification,
    },
  };
}

export async function poll(ctx, resourcePath, id, inspect, resume, sessionId, readResult) {
  const waitTimeout = ctx.flags['wait-timeout'] ?? ctx.flags.timeout;
  const timeoutMs = waitTimeout === undefined ? 0 : localWaitSeconds(waitTimeout, 0, { allowZero: true }) * 1000;
  const deadline = timeoutMs ? Date.now() + timeoutMs : 0;
  const controller = new AbortController();
  let timedOut = false, timer, lastState;
  const interrupt = () => controller.abort();
  const expire = () => {
    const remaining = deadline - Date.now();
    if (remaining > 0) { timer = setTimeout(expire, Math.min(remaining, 2_147_483_647)); return; }
    timedOut = true;
    controller.abort();
  };
  process.once('SIGINT', interrupt);
  if (deadline) expire();
  printProgress(`Waiting. Resume with: ${resume}`);
  try {
    // A new allocation has no direct endpoint yet. Wait for its lifecycle
    // before connecting; an existing protected connection stays independent.
    if (sessionId && resourcePath === '/v1/session' && !hasCachedForgeConnection(ctx, sessionId)) {
      for (;;) {
        const lifecycle = await ctx.client.get(`${API}/sessions/${sessionId}`, { signal: controller.signal });
        if (['closing', 'closed', 'failed'].includes(lifecycle.data.state)) {
          failed('session_unavailable', `Session ${sessionId} is ${lifecycle.data.state}`, lifecycle.data.error);
        }
        if (lifecycle.data.state === 'available') break;
        if (lifecycle.data.state !== lastState) {
          printProgress(`state: ${redactForgeText(String(lifecycle.data.state))}`);
          lastState = lifecycle.data.state;
        }
        await delay(3000, undefined, { signal: controller.signal });
      }
    }
    for (;;) {
      const res = readResult ? await readResult({ signal: controller.signal }) : sessionId
        ? await forgeRequest(ctx, sessionId, 'GET', resourcePath, { signal: controller.signal })
        : await ctx.client.get(resourcePath, { signal: controller.signal });
      remember(ctx, id, resourcePath, res.data);
      const { state, done } = inspect(res.data);
      if (state !== lastState) {
        printProgress(`state: ${redactForgeText(String(state))}`);
        if (state === 'unknown') printProgress('Keep the same command ID while its outcome is uncertain; a fresh command could duplicate execution.');
        lastState = state;
      }
      if (done) return res;
      await delay(3000, undefined, { signal: controller.signal });
    }
  } catch (error) {
    if (controller.signal.aborted) {
      error = new Error(`${timedOut ? 'Wait timed out' : 'Interrupted'}; remote work continues. Resume with: ${resume}`);
      error.exitCode = timedOut ? EXIT.NETWORK : EXIT.INTERRUPTED;
    }
    throw error;
  } finally { clearTimeout(timer); process.removeListener('SIGINT', interrupt); }
}

async function watchCommand(ctx, sessionId, commandId, options = {}) {
  const waitTimeout = ctx.flags['wait-timeout'] ?? ctx.flags.timeout;
  const timeout = options.signal || waitTimeout === undefined ? 0 : localWaitSeconds(waitTimeout, 0, { allowZero: true }) * 1000;
  const controller = options.signal ? null : new AbortController();
  const signal = options.signal ?? controller.signal;
  let interrupted = false;
  const interrupt = () => { if (!signal.aborted) { interrupted = true; controller.abort(); } };
  const timer = timeout ? setTimeout(() => controller.abort(), timeout) : undefined;
  if (controller) process.once('SIGINT', interrupt);
  let cursor;
  printProgress(`Waiting. Resume with: ariax forge watch ${sessionId} ${commandId}`);
  try {
    for (;;) {
      const result = await forgeRequest(ctx, sessionId, 'GET', `/v1/commands/${commandId}/logs`, {
        query: { wait_seconds: 25, ...(cursor ? { cursor } : {}) }, signal,
      });
      cursor = result.data.next_cursor;
      if (result.data.gap) printProgress('An output interval is unavailable; the retained tail follows.');
      const command = result.data.command;
      remember(ctx, commandId, `/v1/commands/${commandId}`, command);
      if (['failed', 'interrupted'].includes(command.state)) failed('command_failed', `Command ${commandId} is ${command.state}`, command.error,
        `Inspect ariax forge command ${sessionId} ${commandId} and ariax forge logs ${sessionId} ${commandId}. Keep the same command ID while its outcome is uncertain.`);
      if (TERMINAL_COMMANDS.has(command.state)) return { ...result, data: command };
    }
  } catch (error) {
    if (controller?.signal.aborted) {
      error = new Error(`${interrupted ? 'Interrupted' : 'Wait timed out'}; remote work continues. Resume with: ariax forge watch ${sessionId} ${commandId}`);
      error.exitCode = interrupted ? EXIT.INTERRUPTED : EXIT.NETWORK;
    }
    error.action ||= `Inspect or watch the same command with ariax forge watch ${sessionId} ${commandId}. Do not start a new command while its outcome is uncertain.`;
    throw error;
  } finally { clearTimeout(timer); if (controller) process.removeListener('SIGINT', interrupt); }
}

async function waitCommandResult(ctx, session, id, signal, current) {
  if (current?.retained && !TERMINAL_COMMANDS.has(current.data?.state)) {
    const error = new ApiError({status:409,code:'command_unavailable',message:`Command ${id} has only a retained ${current.data?.state ?? 'unknown'} outcome.`});
    error.action = `Inspect ariax forge command ${session} ${id} --retained. Keep the same ID while the outcome is uncertain.`;
    throw error;
  }
  const result = current && TERMINAL_COMMANDS.has(current.data?.state) ? current
    : await watchCommand(ctx, session, id, {signal});
  if (['failed', 'interrupted'].includes(result.data.state)) failed('command_failed', `Command ${id} is ${result.data.state}`, result.data.error,
    `Inspect ariax forge command ${session} ${id} and ariax forge logs ${session} ${id}.`);
  if (result.data.state === 'cancelled') failed('command_cancelled', `Command ${id} was cancelled`, result.data.error,
    `Inspect ariax forge command ${session} ${id} and its logs before deciding whether to run new work.`);
  return result;
}

function validateFinish(data, id, session) {
  const valid = (field, values) => values.includes(data?.[field]);
  if (data?.operation_id !== id || data.session_id !== session
      || !valid('phase',['draining','closing','completed'])
      || !valid('execution',['pending','succeeded','failed','cancelled','interrupted','timed_out'])
      || !valid('drain',['pending','saved','failed','interrupted'])
      || !valid('durability',['pending','saved','failed']) || !valid('release',['pending','released'])
      || !valid('termination',[null,'finished','timed_out','interrupted'])
      || !(data.selected_command_ids === null || (Array.isArray(data.selected_command_ids)
        && data.selected_command_ids.length <= 64 && data.selected_command_ids.every(isUUID)))) {
    throw new NetworkError('Forge finish response is invalid or belongs to another operation.');
  }
}

function finishOutcome(data) {
  if (data.phase !== 'completed') return;
  if (data.release === 'released' && data.durability === 'saved' && data.drain === 'saved'
      && data.execution === 'succeeded' && data.termination === 'finished') return;
  const error = new ApiError({status:500,code:'finish_incomplete',message:'Finish completed with failed or interrupted work, saving, or release.',retryable:false});
  error.details = {finish:redactForgeOutput(data)};
  error.action = `Inspect finish operation ${data.operation_id}, its command outcomes and saved files. Release and durability are reported separately.`;
  printProgress(`execution: ${data.execution}; drain: ${data.drain}; durability: ${data.durability}; release: ${data.release}; termination: ${data.termination}`);
  throw error;
}

async function waitFinish(ctx, id, session, initial, signal, file, record) {
  let result = initial;
  for (;;) {
    validateFinish(result.data,id,session);
    if (result.data.phase === 'completed') { finishOutcome(result.data); return result; }
    printProgress(`Finish ${id}: ${result.data.phase}; execution ${result.data.execution}; save ${result.data.durability}; release ${result.data.release}`);
    await delay(3000,undefined,{signal});
    result = await ctx.client.get(`${API}/sessions/${session}/finish`,{signal});
    validateFinish(result.data,id,session);
    if (file && record) saveResult(file,record,result.data);
  }
}

async function waitRecovered(ctx, record, result, kind, account, signal) {
  const id = record.id, session = record.request.session_id;
  if (kind === 'finish') return waitFinish(ctx,id,record.request.path.split('/')[5],result,signal,recordPath(ctx,id),record);
  if (kind === 'command') return waitCommandResult(ctx, session, id, signal, result);
  if (kind === 'cancel') return watchCommand(ctx, session, record.request.path.split('/')[3], {signal});
  if (kind === 'input' && result.retained) {
    const error = new ApiError({status:409,code:'input_unavailable',message:`Input ${id} has only a retained observation.`});
    error.action = `Inspect ariax forge inputs status ${session} ${id} --retained. Retained history does not confirm installation in an active workspace.`;
    throw error;
  }
  for (;;) {
    const data = result.data;
    if (kind === 'session') {
      if (data.state === 'available') return result;
      if (['closing','closed','failed'].includes(data.state)) failed('session_unavailable', `Session ${id} is ${data.state}`, data.error);
    } else if (kind === 'close') {
      if (data.state === 'closed') return result;
      if (data.state === 'failed') failed('session_unavailable', `Session closure failed`, data.error);
    } else if (kind === 'selection') {
      const tools = record.request.body.tools.map(name => data.tools?.find(tool => tool.tool === name));
      const failure = tools.find(tool => tool?.state === 'failed');
      if (failure) failed('tool_failed', `Tool ${failure.tool} failed`, failure.error);
      if (tools.every(tool => tool?.state === 'ready')) return result;
    } else if (kind === 'file-recovery') {
      if (data.state === 'failed') failed('file_recovery_failed',`File recovery ${id} failed`,undefined,
        `Inspect the destination and operation ${id} before another action.`);
      if (['ready','saved'].includes(data.state)) return result;
    } else if (kind === 'sync' || kind === 'input') {
      if (data.state === 'failed' && kind === 'sync') failedSync(id,session,data);
      if (data.state === 'failed') failed('input_failed', `Input ${id} failed`, data.error,
        `Inspect the same input ID before starting a new operation.`);
      if (data.state === (kind === 'sync' ? 'saved' : 'ready')) return result;
    } else throw usageError(`Waiting is not supported for saved operation ${id}.`);
    printProgress(`Waiting for saved operation ${id}: ${data.state ?? 'pending'}`);
    await delay(kind === 'file-recovery' ? Math.max(1000,(data.retry_after ?? 3)*1000) : 3000, undefined, {signal});
    if (kind === 'session') result = await ctx.client.get(`${API}/sessions/${id}`, {signal});
    else if (kind === 'close') result = await ctx.client.get(record.request.path.slice(0,-'/close'.length), {signal});
    else if (kind === 'selection') result = await forgeRequest(ctx,session,'GET','/v1/session',{signal});
    else if (kind === 'input') result = await inputStatus(ctx,session,id,{signal,account});
    else if (kind === 'file-recovery') result = await recoverFile(ctx,id,readRecord(recordPath(ctx,id)),{signal,account});
    else result = await readSync(ctx,session,id,{signal});
    saveResult(recordPath(ctx,id), readRecord(recordPath(ctx,id)) ?? record, result.data);
  }
}

export function failed(code, message, error, recovery) {
  const failure = new ApiError({ status: 500, code, message: `${message}${error?.message ? `: ${error.message}` : ''}`, retryable: false });
  if (recovery) failure.action = recovery;
  throw failure;
}

async function runAction(ctx) {
  const action = actionOf(ctx.positionals);
  const flags = ctx.flags;
  if (action === 'create' || action === 'resume') {
    const sessionId = flags['session-id'] === undefined ? randomUUID() : uuid(flags['session-id'], 'session ID');
    const resuming = action === 'resume';
    const projectId = resuming ? uuid(ctx.positionals[1], 'project ID') : undefined;
    let revision;
    if (resuming) {
      if (flags['control-revision'] !== undefined) revision = number(flags['control-revision'], 'control-revision', { integer: true, zero: true });
      else {
        const prior = readRecord(recordPath(ctx,sessionId));
        if (prior) {
          if (prior.request?.path !== `${API}/projects/${projectId}/sessions`
              || !Number.isSafeInteger(prior.request.body?.expected_control_revision) || prior.request.body.expected_control_revision < 0) {
            throw new ApiError({status:409,code:'request_conflict',message:`Saved session ${sessionId} is not this resume request.`});
          }
          revision = prior.request.body.expected_control_revision;
        } else {
          const project = (await ctx.client.get(`${API}/projects/${projectId}`)).data;
          if (!Number.isSafeInteger(project.control?.revision) || project.control.revision < 0) throw new NetworkError('Project control revision is unavailable.');
          if (project.control.human_resume_required === true) throw new ApiError({status:409,code:'human_resume_required',message:'A human must allow this project to resume.',details:{project_id:projectId,control_revision:project.control.revision}});
          revision = project.control.revision;
        }
      }
    }
    const body = { session_id: sessionId, files_contract: 2, ...sessionOptions(flags),
      ...(resuming ? { expected_control_revision: revision }
        : { name: required(flags.name, 'name') }) };
    const destination = resuming ? `${API}/projects/${projectId}/sessions` : `${API}/sessions`;
    return report(ctx, await submit(ctx, sessionId, { method: 'POST', path: destination, body }, 'session_id',
      `Inspect ariax forge status ${sessionId}; retry the same ${action} request with --session-id ${sessionId}, identical fields, and the same --root-dir, account, and API origin.`));
  }
  if (action === 'catalog') {
    const task = ctx.flags.task;
    if (flags.compact && flags.details) throw usageError('forge catalog: --compact and --details cannot be combined.');
    const selectedTool = flags.tool === undefined ? undefined : required(flags.tool, 'tool');
    const model = flags.model === undefined ? undefined : required(flags.model, 'model');
    const mode = flags.mode === undefined ? undefined : required(flags.mode, 'mode');
    const selected = model !== undefined || mode !== undefined;
    if (selected && selectedTool === undefined) throw usageError('forge catalog: --model/--mode require --tool.');
    if (selected && (flags.compact || flags.details)) throw usageError('forge catalog: --model/--mode cannot be combined with --compact or --details.');
    if (task !== undefined && !['binder-design', 'antibodies', 'molecular-prediction',
      'sequence-optimization', 'validation-search'].includes(task)) {
      throw usageError('Use --task binder-design, antibodies, molecular-prediction, sequence-optimization, or validation-search.');
    }
    const response = await ctx.client.get(`${API}/catalog`);
    let tools = response.data.tools;
    if (selectedTool !== undefined) {
      tools = tools.filter(tool => tool.tool === selectedTool);
      if (!tools.length) throw usageError(`forge catalog: tool "${selectedTool}" is not in the current catalog.`);
    }
    if (task !== undefined) tools = tools.filter(tool => tool.capabilities?.tasks?.includes(task));
    if (flags.compact) tools = tools.map(compactCatalogTool);
    if (selected) tools = tools.map(tool => selectedCatalogTool(tool, model, mode));
    if (selectedTool !== undefined || task !== undefined || flags.compact) response.data = { ...response.data, tools };
    return report(ctx, response, 'catalog');
  }
  if (action === 'project' || action === 'activity') {
    const id = uuid(ctx.positionals[1], 'project ID');
    const limit = flags.limit === undefined ? undefined : number(flags.limit, 'limit', { integer: true });
    if (limit > 100) throw usageError(`forge ${action}: --limit must be an integer 1..100.`);
    const res = await ctx.client.get(`${API}/projects/${id}${action === 'activity' ? '/activity' : ''}`, { query: {
      limit, cursor: flags.cursor === undefined ? undefined : required(flags.cursor, 'cursor'),
    } });
    return action === 'activity' ? report(ctx, res, 'activity')
      : report(ctx, { ...res, data: { ...res.data, project_url: projectUrl(ctx, id) } });
  }
  if (action === 'list') return report(ctx, await ctx.client.get(`${API}/sessions`), 'sessions');
  if (action === 'operations') {
    const account = await accountIdentity(ctx);
    const sample = recordPath(ctx,'00000000-0000-4000-8000-000000000000');
    const names = sample ? fs.readdirSync(path.dirname(sample))
      .filter(name => name.endsWith('.json') && isUUID(name.slice(0,-5))).sort() : [];
    let unreadable = 0;
    const operations = [];
    for (const name of names.slice(0,10000)) {
      try {
        const record = readRecord(path.join(path.dirname(sample),name));
        const id = name.slice(0,-5), kind = savedKind(id,record?.request);
        if (record?.id !== id || !kind || Object.keys(account).some(field => record[field] !== account[field])) continue;
        const session = kind === 'session' ? id : record.request.session_id
          ?? new RegExp(`^${API}/sessions/([0-9a-f-]{36})/`).exec(record.request.path)?.[1];
        operations.push({ operation_id:id, kind, session_id:session ?? null,
          last_observed_state:typeof record.result?.state === 'string' ? record.result.state : record.result ? 'recorded' : 'unconfirmed' });
      } catch { unreadable++; }
    }
    return report(ctx,{data:{operations,truncated:names.length > 10000,unreadable}},'operations');
  }
  if (action === 'recover') {
    const id = uuid(ctx.positionals[1], 'operation ID');
    const file = recordPath(ctx,id), record = readRecord(file);
    if (!record || record.id !== id) throw usageError(`No saved Forge operation ${id} was found in this root directory.`);
    const kind = savedKind(id,record.request);
    if (!kind) throw usageError(`Forge operation ${id} has no supported idempotent recovery. Inspect the session and saved request before another action.`);
    if (kind === 'limit' && flags.wait) throw usageError('forge recover: limit edits do not support --wait; inspect session status after recovery.');
    if (kind === 'session' && record.request.body.files_contract !== 2) {
      throw new ApiError({ status: 409, code: 'upgrade_required', message: `Saved session request ${id} uses the legacy file contract and cannot be replayed.` });
    }
    if (record.readiness && (kind !== 'command' || !Array.isArray(record.readiness.input_ids)
        || record.readiness.input_ids.length > 100 || record.readiness.input_ids.some(value => !isUUID(value))
        || new Set(record.readiness.input_ids).size !== record.readiness.input_ids.length)) {
      throw usageError(`Saved readiness for Forge operation ${id} is malformed; no request was sent.`);
    }
    const seconds = localWaitSeconds(flags['wait-timeout'],60);
    return controlled(ctx,id,seconds,async signal => {
      const account = await accountIdentity(ctx,{signal});
      checkIdentity(record,account,id);
      printProgress(`Recovering saved operation: ${id}`);
      try {
        let result = ['sync','input','file-recovery'].includes(kind)
          ? await recoverFile(ctx,id,record,{signal,account,retryFailedSync:kind === 'sync'})
          : await dispatchSaved(ctx,file,record,account,{previous:true,signal});
        if (kind === 'sync' && result.data?.state === 'failed') failedSync(id,record.request.session_id,result.data);
        if (kind === 'file-recovery' && result.data?.state === 'failed') failed('file_recovery_failed',`File recovery ${id} failed`,undefined,
          `Inspect the destination and operation ${id} before another action.`);
        if (flags.wait) result = await waitRecovered(ctx,record,result,kind,account,signal);
        if (kind === 'finish') finishOutcome(result.data);
        return report(ctx,result);
      } catch (error) {
        error.action ||= `Inspect or recover the same operation ${id} using the original root directory, account and API origin.`;
        throw error;
      }
    });
  }
  if (['files', 'files recover', 'download', 'link'].includes(action)) {
    const projectId = uuid(ctx.positionals[action === 'files recover' ? 2 : 1], 'project ID');
    return runFiles(ctx, action, undefined, undefined, projectId);
  }
  const sessionId = uuid(ctx.positionals[(action.startsWith('tools ') || action.startsWith('inputs ')) ? 2 : 1], 'session ID');
  const sessionPath = `${API}/sessions/${sessionId}`;
  if (action === 'sync') {
    if (flags['wait-timeout'] !== undefined && !flags.wait) throw usageError('forge sync: --wait-timeout requires --wait.');
    if (flags.wait && (flags['wait-timeout'] ?? flags.timeout) !== undefined) {
      localWaitSeconds(flags['wait-timeout'] ?? flags.timeout, 0, {allowZero:true});
    }
  }
  if (action.startsWith('inputs ') || action === 'sync') return runFiles(ctx, action, sessionId, sessionPath);
  if (action === 'limit') {
    if ((flags['gpu-hours'] === undefined) === (flags.clear === undefined) || (flags.clear !== undefined && flags.clear !== true)) {
      throw usageError('forge limit: supply exactly one of --gpu-hours H or --clear.');
    }
    const id = flags['operation-id'] === undefined ? randomUUID() : uuid(flags['operation-id'],'operation ID');
    let revision;
    if (flags['limit-revision'] !== undefined) revision = number(flags['limit-revision'], 'limit-revision', { integer: true, zero: true });
    else {
      const prior = readRecord(recordPath(ctx,id));
      if (prior) {
        if (prior.request?.path !== `${sessionPath}/limit` || !Number.isSafeInteger(prior.request.body?.expected_limit_revision)
            || prior.request.body.expected_limit_revision < 0) {
          throw new ApiError({status:409,code:'request_conflict',message:`Saved operation ${id} is not this limit edit.`});
        }
        revision = prior.request.body.expected_limit_revision;
      } else {
        const session = (await ctx.client.get(sessionPath)).data;
        if (session.session_id !== sessionId || !Number.isSafeInteger(session.limit_revision) || session.limit_revision < 0) throw new NetworkError('Session limit revision is unavailable.');
        revision = session.limit_revision;
      }
    }
    const body = { max_gpu_hours: flags.clear ? null : number(flags['gpu-hours'], 'gpu-hours'), expected_limit_revision: revision };
    const res = await submit(ctx, id, { method: 'POST', path: `${sessionPath}/limit`, body }, 'request_id',
      `Inspect ariax forge status ${sessionId} for max_gpu_hours, limit_revision, applied_limit_revision, and expires_at before another edit. An accepted edit replaces the total allowance from allocation; the host retains its previous deadline until applied_limit_revision matches limit_revision.`);
    remember(ctx, sessionId, sessionPath, res.data);
    return report(ctx, res);
  }
  if (action === 'finish') {
    if (flags['wait-timeout'] !== undefined && !flags.wait) throw usageError('forge finish: --wait-timeout requires --wait.');
    const suppliedId = flags['operation-id'] === undefined ? undefined : uuid(flags['operation-id'],'operation ID');
    const prior = suppliedId ? readRecord(recordPath(ctx,suppliedId)) : null;
    if (prior && prior.request?.path !== `${sessionPath}/finish`) throw new ApiError({status:409,code:'request_conflict',message:`Saved operation ${suppliedId} is not this finish request.`});
    const duration = flags['timeout-seconds'] === undefined
      ? prior?.request?.body?.timeout_seconds ?? 3600 : number(flags['timeout-seconds'],'timeout-seconds',{integer:true});
    if (!Number.isSafeInteger(duration) || duration < 1) throw usageError('forge finish: --timeout-seconds must be between 1 and 86400.');
    if (duration > 86400) throw usageError('forge finish: --timeout-seconds must be between 1 and 86400.');
    const existing = await optionalRead(() => ctx.client.get(`${sessionPath}/finish`));
    if (existing && flags['operation-id'] === undefined) {
      const id = uuid(existing.data?.operation_id,'finish operation ID');
      validateFinish(existing.data,id,sessionId);
      if (flags['timeout-seconds'] !== undefined) throw usageError(`A finish operation already exists. Inspect operation ${id}; its accepted deadline cannot be changed.`);
      if (!flags.wait) { finishOutcome(existing.data); return report(ctx,existing); }
      return controlled(ctx,id,localWaitSeconds(flags['wait-timeout'],7200),async signal => {
        try { return report(ctx,await waitFinish(ctx,id,sessionId,existing,signal)); }
        catch (error) { error.action ||= `Inspect ariax forge finish ${sessionId}; do not create another finish operation.`; throw error; }
      },{resume:`ariax forge finish ${sessionId} --wait`});
    }
    const id = suppliedId ?? randomUUID();
    const request = {method:'POST',path:`${sessionPath}/finish`,body:{operation_id:id,timeout_seconds:duration}};
    const perform = async signal => {
      let result = await submit(ctx,id,request,'operation_id',`Inspect ariax forge finish ${sessionId} before starting another finish.`,{signal});
      if (flags.wait) result = await waitFinish(ctx,id,sessionId,result,signal,recordPath(ctx,id),readRecord(recordPath(ctx,id)));
      finishOutcome(result.data);
      return report(ctx,result);
    };
    return controlled(ctx,id,flags.wait ? localWaitSeconds(flags['wait-timeout'],7200) : 60,perform);
  }
  if (action === 'tools add') {
    const id = flags['selection-id'] === undefined ? randomUUID() : uuid(flags['selection-id'], 'selection ID');
    return report(ctx, await submit(ctx, id, { method: 'POST', session_id: sessionId, path: '/v1/tools', body: { selection_id: id, ...selection(flags, true) } }, 'selection_id',
      `Inspect ariax forge tools ${sessionId}; retry with --selection-id ${id}, identical fields, and the same --root-dir, account, and API origin.`));
  }
  if (action === 'tools') return report(ctx, await forgeRequest(ctx, sessionId, 'GET', '/v1/tools'), 'tools');
  if (action === 'status') {
    const res = await ctx.client.get(sessionPath);
    remember(ctx, sessionId, sessionPath, res.data);
    const project = await ctx.client.get(`${API}/projects/${uuid(res.data.project_id, 'project ID')}`);
    return report(ctx, { ...res, data: { ...res.data, project_status: project.data.status,
      control: project.data.control, project_url: projectUrl(ctx, res.data.project_id) } }, action);
  }
  if (action === 'tools wait') {
    const toolName = ctx.positionals[3];
    const res = await poll(ctx, '/v1/session', sessionId, session => {
      if (['closing', 'closed', 'failed'].includes(session.state)) failed('session_unavailable', `Session ${sessionId} is ${session.state}`, session.error);
      const tool = session.tools.find(t => t.tool === toolName);
      if (!tool) throw usageError(`Tool ${toolName} is not selected. Inspect ariax forge tools ${sessionId}.`);
      if (tool.state === 'failed') failed('tool_failed', `Tool ${toolName} failed`, tool.error);
      return { state: tool.state, done: session.state === 'available' && tool.state === 'ready' };
    }, `ariax forge tools wait ${sessionId} ${toolName}`, sessionId);
    return report(ctx, { ...res, data: { session_id: sessionId, ...res.data.tools.find(t => t.tool === toolName) } });
  }
  if (action === 'run') {
    const commandId = flags['command-id'] === undefined ? randomUUID() : uuid(flags['command-id'], 'command ID');
    const cwd = flags.cwd === undefined ? '/workspace' : required(flags.cwd, 'cwd');
    if (!path.posix.isAbsolute(cwd) || (cwd !== '/workspace' && !cwd.startsWith('/workspace/'))
        || cwd.split('/').includes('..')) throw usageError('forge: --cwd must stay under /workspace.');
    if (!ctx.passthrough[0]) throw usageError('forge run: the command after -- must be nonempty.');
    const body = { command_id: commandId, tool: required(flags.tool, 'tool'), argv: ctx.passthrough,
      ...(flags.gpus === undefined ? {} : { gpu_ids: gpuSelection(flags.gpus) }),
      cwd: path.posix.normalize(cwd), timeout_seconds: flags['timeout-seconds'] === undefined ? 86400 : number(flags['timeout-seconds'], 'timeout-seconds', { integer: true }) };
    if (flags['input-ids'] !== undefined && !flags['wait-ready']) throw usageError('forge run: --input-ids requires --wait-ready.');
    if (flags['wait-timeout'] !== undefined && !flags['wait-ready'] && !flags.wait) throw usageError('forge run: --wait-timeout requires --wait-ready or --wait.');
    const ids = flags['input-ids'] === undefined ? [] : csv(flags['input-ids'],'input-ids').map(value => uuid(value,'input ID'));
    if (ids.length > 100 || new Set(ids).size !== ids.length) throw usageError('forge run: --input-ids must contain at most 100 distinct input IDs.');
    const readiness = flags['wait-ready'] ? {input_ids:ids} : undefined;
    const request = { method: 'POST', session_id: sessionId, path: '/v1/commands', body };
    const recovery = `Inspect ariax forge command ${sessionId} ${commandId}. Keep this ID while its outcome is uncertain; a fresh command could duplicate execution.`;
    if (!flags.wait && !readiness) return report(ctx,await submit(ctx,commandId,request,'command_id',recovery));
    const seconds = localWaitSeconds(flags['wait-timeout'],1800);
    return controlled(ctx,commandId,seconds,async signal => {
      let result = await submit(ctx,commandId,request,'command_id',recovery,{signal,readiness});
      if (flags.wait) result = await waitCommandResult(ctx,sessionId,commandId,signal,result);
      return report(ctx,result);
    });
  }
  if (action === 'close') {
    const res = await submit(ctx, randomUUID(), { method: 'POST', path: `${sessionPath}/close`, body: {} }, 'request_id',
      `Inspect ariax forge status ${sessionId}; repeat ariax forge close ${sessionId} if needed.`);
    remember(ctx, sessionId, sessionPath, res.data);
    return report(ctx, res);
  }
  if (action === 'commands') return report(ctx, flags.retained ? await ctx.client.get(`${sessionPath}/commands`) : await forgeRequest(ctx, sessionId, 'GET', '/v1/commands'), 'commands');
  const commandId = uuid(ctx.positionals[2], 'command ID');
  const commandPath = `/v1/commands/${commandId}`;
  if (action === 'watch') {
    return report(ctx, await watchCommand(ctx, sessionId, commandId));
  }
  if (action === 'cancel') {
    const res = await submit(ctx, randomUUID(), { method: 'POST', session_id: sessionId, path: `${commandPath}/cancel`, body: {} }, 'request_id',
      `Inspect ariax forge command ${sessionId} ${commandId}; repeat cancellation if needed.`);
    remember(ctx, commandId, commandPath, res.data);
    return report(ctx, res);
  }
  if (action === 'logs') {
    const tail = flags.tail === undefined ? 1000 : number(flags.tail, 'tail', { integer: true });
    if (tail > 5000) throw usageError('forge logs: --tail must be an integer 1..5000.');
    if (flags.retained) {
      if (flags.cursor !== undefined || flags['wait-seconds'] !== undefined) throw usageError('Retained output is a saved snapshot; cursor waits require an active session.');
      return report(ctx, await ctx.client.get(`${sessionPath}/commands/${commandId}/logs`, { query: { tail } }), 'logs');
    }
    const wait = flags['wait-seconds'] === undefined ? 0 : number(flags['wait-seconds'], 'wait-seconds', { zero: true });
    if (wait > 25) throw usageError('forge logs: --wait-seconds must be within 0..25.');
    return report(ctx, await forgeRequest(ctx, sessionId, 'GET', `${commandPath}/logs`, { query: { tail, wait_seconds: wait, ...(flags.cursor === undefined ? {} : { cursor: required(flags.cursor, 'cursor') }) } }), 'logs');
  }
  const res = flags.retained ? await ctx.client.get(`${sessionPath}/commands/${commandId}`) : await forgeRequest(ctx, sessionId, 'GET', commandPath);
  remember(ctx, commandId, commandPath, res.data);
  return report(ctx, res);
}

export async function run(ctx) {
  try { return await runAction(ctx); }
  catch (error) {
    const action = actionOf(ctx.positionals);
    let recovered;
    try {
      if (action === 'recover' && isUUID(ctx.positionals[1])) recovered = readRecord(recordPath(ctx,ctx.positionals[1]));
    } catch { /* Keep the original error. */ }
    const recoveredSession = recovered?.request?.session_id
      ?? new RegExp(`^${API}/sessions/([0-9a-f-]{36})/`).exec(recovered?.request?.path ?? '')?.[1];
    if (error.code === 'human_resume_required' || error.code === 'control_revision_conflict') {
      let projectId = isUUID(error.details?.project_id) ? uuid(error.details.project_id, 'project ID') : undefined;
      try {
        if (!projectId && ['resume', 'project'].includes(action)) projectId = uuid(ctx.positionals[1], 'project ID');
        else if (!projectId && action === 'files recover') projectId = uuid(ctx.positionals[2], 'project ID');
        else if (!projectId && action === 'recover' && isUUID(recovered?.request?.project_id)) projectId = recovered.request.project_id;
        else if (!projectId && action === 'inputs add' && ctx.flags.artifact !== undefined) projectId = uuid(ctx.flags.artifact.split(':')[0], 'project ID');
        else if (!projectId) {
          const sessionId = action === 'recover' ? recoveredSession : action === 'create' ? undefined
            : ctx.positionals[action.startsWith('tools ') || action.startsWith('inputs ') ? 2 : 1];
          if (isUUID(sessionId)) projectId = (await ctx.client.get(`${API}/sessions/${uuid(sessionId, 'session ID')}`)).data.project_id;
        }
      } catch { /* Retain the original hold/conflict even when inspection fails. */ }
      const link = isUUID(projectId) ? projectUrl(ctx, projectId) : 'the same project page';
      if (isUUID(projectId)) error.details = { ...error.details, project_id: projectId, approval_url: link };
      error.action = error.code === 'human_resume_required'
        ? `Stop this project's work and ask your user to open ${link}. "Resume workspace" shows the saved hardware and budget, then clears the hold and allocates a session in the same project atomically. After they use it, inspect the active session and continue there; do not create another session or automatically replay science. Alternatively, "Allow agent to resume later" in the dropdown clears the hold and leaves compute stopped. Await their direction, inspect cleanup and the current control revision, then explicitly resume the same project if authorized. Retain original IDs and revisions for uncertain requests. Do not continue held work through a replacement project.`
        : `Project control changed. Inspect ${isUUID(projectId) ? `ariax forge project ${projectId}` : 'the project'} before continuing; a newer pause may require human approval.`;
    } else if (['checkpoint_required', 'checkpoint_unready'].includes(error.code)) {
      error.action = 'This server requires the removed Forge checkpoint contract. Upgrade the CLI and server together before using the current project workspace.';
    } else if (['limit_revision_conflict', 'session_closing'].includes(error.code)) {
      const session = action === 'recover' ? recoveredSession : ctx.positionals[1];
      error.action = `Inspect ${session ? `ariax forge status ${session}` : 'the session status'} for the current state, max_gpu_hours, limit_revision, applied_limit_revision and expires_at before another edit. A revision conflict does not establish whether the earlier edit was applied. Closing compute must finish cleanup.`;
    } else if (['session_cleanup_pending', 'project_session_active'].includes(error.code)) {
      error.action = `Inspect the project history and active session status. Wait for confirmed cleanup before resuming; keep the same project and saved session request.`;
    } else if (error.code === 'session_unready') {
      if (action === 'files recover' || (action === 'recover' && recovered?.request?.type === 'project-file-copy-v1')) {
        const project = action === 'files recover' ? ctx.positionals[2] : recovered.request.project_id;
        error.action = `Inspect ariax forge project ${project} and the destination writer state; recover the same operation after the workspace is available.`;
      } else if (action === 'finish' || (action === 'recover' && savedKind(ctx.positionals[1],recovered?.request) === 'finish')) {
        const session = action === 'finish' ? ctx.positionals[1] : recoveredSession;
        error.action = `Inspect ariax forge status ${session}, its control state and finish_supported. A session without compatible finish support cannot begin finish; do not assume compute is released.`;
      } else {
        const sessionId = action === 'recover' ? recoveredSession
          : ctx.positionals[action.startsWith('tools ') || action.startsWith('inputs ') ? 2 : 1];
        error.action = `Inspect ariax forge status ${sessionId}. If provisioning or starting, run ariax forge tools wait ${sessionId} base --wait-timeout 1800, then retry the original operation with the same IDs. A closing, closed or failed session requires inspection of its project controls and retained history. ${error.action || ''}`.trim();
      }
    } else if (['request_conflict', 'idempotency_conflict', 'command_conflict'].includes(error.code)) {
      error.action = action === 'finish' ? `Inspect ariax forge finish ${ctx.positionals[1]}; a session has only one finish operation and its deadline cannot be changed.`
        : 'Inspect the saved request and existing session or command. Recover its original fields and caller ID; resolve the existing outcome before choosing any new operation.';
    }
    if (typeof error.message === 'string') error.message = redactForgeText(error.message);
    if (typeof error.action === 'string') error.action = redactForgeText(error.action);
    if (typeof error.requestId === 'string') error.requestId = redactForgeText(error.requestId);
    if (error.details) error.details = redactForgeOutput(error.details);
    throw error;
  }
}
