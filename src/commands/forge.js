/** Forge sessions and commands on the existing authenticated API origin. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { usageError } from '../args.js';
import { isUUID } from '../uuid.js';
import { accountIdentity, atomicWrite } from '../operations.js';
import { ApiError } from '../http.js';
import { EXIT } from '../exit-codes.js';
import { printData, printJson, printKv, printProgress, printTable } from '../output.js';

import { forgeRequest, forgeAccountIdentity, hasCachedForgeConnection } from '../lib/forge-client.js';

import { runFiles } from './forge-files.js';

const API = '/api/v1/forge';
const TERMINAL_COMMANDS = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
const SESSION_OPTIONS = ['gpu', 'gpu-count', 'tools', 'priority', 'max-gpu-hours',
  'min-ram-gib', 'min-cpu-count', 'min-disk-gib', 'session-id', 'restore-session', 'checkpoint'];
const OPTIONS = {
  create: [['name', ...SESSION_OPTIONS], 1],
  resume: [['control-revision', ...SESSION_OPTIONS], 2],
  project: [['limit', 'cursor'], 2],
  activity: [['limit', 'cursor'], 2],
  limit: [['gpu-hours', 'clear', 'limit-revision'], 2],
  catalog: [['details', 'task', 'tool', 'compact'], 1],
  list: [[], 1], status: [[], 2], tools: [['details'], 2],
  'tools add': [['tools', 'priority', 'selection-id'], 3],
  'tools wait': [['timeout'], 4],
  run: [['tool', 'gpus', 'cwd', 'timeout-seconds', 'command-id'], 2],
  commands: [['retained'], 2], command: [['retained'], 3], watch: [['timeout'], 3],
  'inputs add': [['file', 'artifact', 'url', 'path', 'input-id'], 3],
  'inputs list': [['retained'], 3], 'inputs status': [['retained'], 4],
  sync: [['wait', 'checkpoint-id', 'timeout'], 2], checkpoints: [['retained'], 2], checkpoint: [['retained'], 3],
  files: [['path', 'checkpoint'], 2], download: [['dest', 'checkpoint'], 3],
  link: [['checkpoint'], 3],
  logs: [['tail', 'cursor', 'wait-seconds', 'retained'], 3], cancel: [[], 3], close: [[], 2],
};

export const help = `ariax forge create --name NAME --gpu GPU [--gpu-count 1] [--tools boltz2,bindcraft2] [--priority boltz2] [--max-gpu-hours H] [--session-id UUID]
  ariax forge resume PROJECT --restore-session SOURCE --checkpoint UUID --control-revision N --gpu GPU [usual hardware/tool options] [--session-id UUID]
  ariax forge project PROJECT [--limit 50] [--cursor CURSOR]
  ariax forge activity PROJECT [--limit 50] [--cursor CURSOR]
  ariax forge limit SESSION (--gpu-hours H | --clear) --limit-revision N
  ariax forge catalog [--details | --compact] [--task FAMILY] [--tool TOOL]
  ariax forge list
  ariax forge status SESSION
  ariax forge tools SESSION [--details]
  ariax forge tools add SESSION --tools TOOL,... [--priority TOOL,...] [--selection-id UUID]
  ariax forge tools wait SESSION TOOL [--timeout SECONDS]
  ariax forge run SESSION --tool TOOL [--gpus 0,1] [--cwd /workspace] [--timeout-seconds 3600] [--command-id UUID] -- COMMAND ARG...
  ariax forge commands SESSION [--retained]
  ariax forge command SESSION COMMAND_ID [--retained]
  ariax forge watch SESSION COMMAND_ID [--timeout SECONDS]
  ariax forge logs SESSION COMMAND_ID [--tail 1000] [--cursor CURSOR] [--wait-seconds 0..25] [--retained]
  ariax forge cancel SESSION COMMAND_ID
  ariax forge close SESSION
  ariax forge inputs add SESSION --file FILE --path PATH [--input-id UUID]
  ariax forge inputs add SESSION --artifact PROJECT_ID:PATH --path PATH [--input-id UUID]
  ariax forge inputs add SESSION --url URL --path PATH [--input-id UUID]
  ariax forge inputs list SESSION
  ariax forge inputs status SESSION INPUT_ID
  ariax forge sync SESSION [--wait] [--checkpoint-id UUID] [--timeout SECONDS]
  ariax forge checkpoints SESSION [--retained]
  ariax forge checkpoint SESSION CHECKPOINT_ID [--retained]
  ariax forge files SESSION [--path /workspace] [--checkpoint UUID]
  ariax forge download SESSION PATH --dest LOCAL [--checkpoint UUID]
  ariax forge link SESSION PATH [--checkpoint UUID]
  ariax forge create --name NAME --gpu GPU --restore-session SOURCE --checkpoint UUID [usual create options]
  Hardware options: --min-ram-gib N --min-cpu-count N --min-disk-gib N
  Catalog --compact summarizes qualification; omit it for full selected-mode evidence.`;

function actionOf(positionals) {
  if (positionals[0] === 'inputs' && ['add', 'list', 'status'].includes(positionals[1])) return `inputs ${positionals[1]}`;
  if (positionals[0] === 'tools' && ['add', 'wait'].includes(positionals[1])) return `tools ${positionals[1]}`;
  return positionals[0];
}

export function validateArguments({ positionals, flags, passthrough, globals }) {
  if (!positionals.length && globals.help && !Object.keys(flags).length) return;
  const action = actionOf(positionals);
  if (!Object.hasOwn(OPTIONS, action)) throw usageError('forge: unknown action. Run: ariax forge --help');
  const [allowed, operands] = OPTIONS[action];
  for (const name of Object.keys(flags)) {
    if (!allowed.includes(name)) throw usageError(`forge ${action}: unsupported flag --${name}.`);
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

function sessionOptions(flags, resuming) {
  if ((flags['restore-session'] === undefined) !== (flags.checkpoint === undefined)
      || (resuming && flags['restore-session'] === undefined)) {
    throw usageError(`forge ${resuming ? 'resume' : 'create'}: --restore-session and --checkpoint are required together.`);
  }
  const hardware = {};
  for (const [flag, field] of [['min-ram-gib', 'min_ram_gib'], ['min-cpu-count', 'min_cpu_count'], ['min-disk-gib', 'min_disk_gib']]) {
    if (flags[flag] !== undefined) hardware[field] = number(flags[flag], flag, { integer: field === 'min_cpu_count' });
  }
  return { gpu_type: required(flags.gpu, 'gpu'),
    gpu_count: flags['gpu-count'] === undefined ? 1 : number(flags['gpu-count'], 'gpu-count', { integer: true }),
    ...selection(flags),
    ...(Object.keys(hardware).length ? { hardware } : {}),
    ...(flags['max-gpu-hours'] === undefined ? {} : { max_gpu_hours: number(flags['max-gpu-hours'], 'max-gpu-hours') }),
    restore: flags['restore-session'] === undefined ? null : {
      session_id: uuid(flags['restore-session'], 'restore session ID'), checkpoint_id: uuid(flags.checkpoint, 'checkpoint ID'),
    } };
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
  const next = { ...record, result,
    ...(isUUID(result?.project_id) ? { project_id: result.project_id } : {}) };
  atomicWrite(file, JSON.stringify(next, null, 2) + '\n');
}

export async function submit(ctx, id, request, label, recovery) {
  const account = request.session_id
    ? await forgeAccountIdentity(ctx, request.session_id)
    : await accountIdentity(ctx);
  fs.mkdirSync(ctx.config.rootDir, { recursive: true, mode: 0o700 });
  const file = recordPath(ctx, id, true);
  const candidate = { id, ...account, request, result: null };
  let record = readRecord(file);
  if (!record) {
    try { atomicWrite(file, JSON.stringify(candidate, null, 2) + '\n', true); record = candidate; }
    catch (error) { if (error.code !== 'EEXIST') throw error; record = readRecord(file); }
  }
  if (record?.id !== id || !isDeepStrictEqual(record.request, request)) {
    throw new ApiError({ status: 409, code: 'request_conflict', message: `Forge request ${id} differs from its saved request. Use the original fields to retry.` });
  }
  for (const field of Object.keys(account)) {
    if (record[field] !== account[field]) throw usageError(`Forge request ${id} belongs to a different account or API origin. Restore the original account and origin to retry.`);
  }
  printProgress(`${label}: ${id}`);
  try {
    const res = request.session_id
      ? await forgeRequest(ctx, request.session_id, 'POST', request.path, { body: record.request.body })
      : await ctx.client.post(request.path, { body: record.request.body });
    if (['session_id', 'command_id', 'selection_id'].includes(label) && res.data?.[label] !== id) {
      throw new Error(`Forge response has no matching ${label}; inspect or retry the saved request.`);
    }
    saveResult(file, record, res.data);
    return res;
  } catch (error) {
    error.action = recovery;
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
  if (res.data?.state === 'unknown') printProgress(`Command outcome is uncertain. Inspect the same command ID ${res.data.command_id}; keep that ID and its saved request until the outcome is known. A fresh command could duplicate execution.`);
  if (ctx.json) { printJson({ data: res.data, meta: res.meta, request_id: res.requestId }); return; }
  const data = res.data;
  if (Number.isSafeInteger(data?.limit_revision) && data.limit_revision >= 0
      && data.applied_limit_revision !== data.limit_revision
      && ['provisioning', 'starting', 'available'].includes(data.state)) {
    printProgress(`Limit revision ${data.limit_revision} is saved; host application is pending. The host retains its previous deadline until delivery. Inspect ariax forge status ${data.session_id} for applied_limit_revision.`);
  }
  if (kind === 'sessions') printTable(['session_id', 'name', 'state', 'gpu', 'gpu_count'], data.sessions.map(s => [s.session_id, s.name, s.state, s.gpu_type, s.gpu_count]));
  else if (kind === 'commands') printTable(['command_id', 'tool', 'gpu_ids', 'state', 'exit_code'], data.commands.map(c => [c.command_id, c.tool, c.gpu_ids?.join(','), c.state, c.exit_code]));
  else if (kind === 'tools' || kind === 'catalog') {
    if (ctx.flags.details || (kind === 'catalog' && (ctx.flags.compact || ctx.flags.tool !== undefined))) {
      for (const tool of data.tools) printKv(tool);
    }
    else if (kind === 'catalog') printTable(['tool', 'name', 'gpu', 'tasks', 'guide'], data.tools.map(t => [t.tool, t.name, t.gpu, t.capabilities?.tasks?.join(',') || 'unknown', t.capabilities?.guide || 'unknown']));
    else printTable(['tool', 'state', 'error'], data.tools.map(t => [t.tool, t.state, t.error?.message]));
  }
  else if (kind === 'inputs') printTable(['input_id', 'path', 'state', 'size_bytes'], data.inputs.map(i => [i.input_id, i.path, i.state, i.size_bytes]));
  else if (kind === 'checkpoints') printTable(['checkpoint_id', 'state', 'file_count', 'size_bytes'], data.checkpoints.map(c => [c.checkpoint_id, c.state, c.file_count, c.size_bytes]));
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
// including unknown/missing values, and require the full catalog for a mode.
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

export async function poll(ctx, resourcePath, id, inspect, resume, sessionId) {
  const timeoutMs = ctx.flags.timeout === undefined ? 0 : number(ctx.flags.timeout, 'timeout', { zero: true }) * 1000;
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
          printProgress(`state: ${lifecycle.data.state}`);
          lastState = lifecycle.data.state;
        }
        await delay(3000, undefined, { signal: controller.signal });
      }
    }
    for (;;) {
      const res = sessionId
        ? await forgeRequest(ctx, sessionId, 'GET', resourcePath, { signal: controller.signal })
        : await ctx.client.get(resourcePath, { signal: controller.signal });
      remember(ctx, id, resourcePath, res.data);
      const { state, done } = inspect(res.data);
      if (state !== lastState) {
        printProgress(`state: ${state}`);
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

async function watchCommand(ctx, sessionId, commandId) {
  const timeout = ctx.flags.timeout === undefined ? 0 : number(ctx.flags.timeout, 'timeout', { zero: true }) * 1000;
  const controller = new AbortController();
  let interrupted = false;
  const interrupt = () => { if (!controller.signal.aborted) { interrupted = true; controller.abort(); } };
  const timer = timeout ? setTimeout(() => controller.abort(), Math.min(timeout, 2_147_483_647)) : undefined;
  process.once('SIGINT', interrupt);
  let cursor;
  printProgress(`Waiting. Resume with: ariax forge watch ${sessionId} ${commandId}`);
  try {
    for (;;) {
      const result = await forgeRequest(ctx, sessionId, 'GET', `/v1/commands/${commandId}/logs`, {
        query: { wait_seconds: 25, ...(cursor ? { cursor } : {}) }, signal: controller.signal,
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
    if (controller.signal.aborted) {
      error = new Error(`${interrupted ? 'Interrupted' : 'Wait timed out'}; remote work continues. Resume with: ariax forge watch ${sessionId} ${commandId}`);
      error.exitCode = interrupted ? EXIT.INTERRUPTED : EXIT.NETWORK;
    }
    throw error;
  } finally { clearTimeout(timer); process.removeListener('SIGINT', interrupt); }
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
    const body = { session_id: sessionId, ...sessionOptions(flags, resuming),
      ...(resuming ? { expected_control_revision: number(flags['control-revision'], 'control-revision', { integer: true, zero: true }) }
        : { name: required(flags.name, 'name') }) };
    const destination = resuming ? `${API}/projects/${uuid(ctx.positionals[1], 'project ID')}/sessions` : `${API}/sessions`;
    return report(ctx, await submit(ctx, sessionId, { method: 'POST', path: destination, body }, 'session_id',
      `Inspect ariax forge status ${sessionId}; retry the same ${action} request with --session-id ${sessionId}, identical fields, and the same --root-dir, account, and API origin.`));
  }
  if (action === 'catalog') {
    const task = ctx.flags.task;
    if (flags.compact && flags.details) throw usageError('forge catalog: --compact and --details cannot be combined.');
    const selectedTool = flags.tool === undefined ? undefined : required(flags.tool, 'tool');
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
  const sessionId = uuid(ctx.positionals[(action.startsWith('tools ') || action.startsWith('inputs ')) ? 2 : 1], 'session ID');
  const sessionPath = `${API}/sessions/${sessionId}`;
  if (action.startsWith('inputs ') || ['sync','checkpoints','checkpoint','files','download','link'].includes(action)) return runFiles(ctx, action, sessionId, sessionPath);
  if (action === 'limit') {
    if ((flags['gpu-hours'] === undefined) === (flags.clear === undefined) || (flags.clear !== undefined && flags.clear !== true)) {
      throw usageError('forge limit: supply exactly one of --gpu-hours H or --clear.');
    }
    const body = { max_gpu_hours: flags.clear ? null : number(flags['gpu-hours'], 'gpu-hours'),
      expected_limit_revision: number(flags['limit-revision'], 'limit-revision', { integer: true, zero: true }) };
    const res = await submit(ctx, randomUUID(), { method: 'POST', path: `${sessionPath}/limit`, body }, 'request_id',
      `Inspect ariax forge status ${sessionId} for max_gpu_hours, limit_revision, applied_limit_revision, and expires_at before another edit. An accepted edit replaces the total allowance from allocation; the host retains its previous deadline until applied_limit_revision matches limit_revision.`);
    remember(ctx, sessionId, sessionPath, res.data);
    return report(ctx, res);
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
    return report(ctx, await submit(ctx, commandId, { method: 'POST', session_id: sessionId, path: '/v1/commands', body }, 'command_id',
      `Inspect ariax forge command ${sessionId} ${commandId} first. Recover the saved run request with --command-id ${commandId}, identical fields, and the same --root-dir, account, and API origin. Keep this ID while the outcome is uncertain; a fresh command could duplicate execution.`));
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
    if (error.code === 'human_resume_required' || error.code === 'control_revision_conflict') {
      const action = actionOf(ctx.positionals);
      let projectId = isUUID(error.details?.project_id) ? uuid(error.details.project_id, 'project ID') : undefined;
      try {
        if (!projectId && ['resume', 'project'].includes(action)) projectId = uuid(ctx.positionals[1], 'project ID');
        else if (!projectId && action === 'inputs add' && ctx.flags.artifact !== undefined) projectId = uuid(ctx.flags.artifact.split(':')[0], 'project ID');
        else if (!projectId) {
          const sessionId = action === 'create' ? ctx.flags['restore-session']
            : ctx.positionals[action.startsWith('tools ') || action.startsWith('inputs ') ? 2 : 1];
          if (isUUID(sessionId)) projectId = (await ctx.client.get(`${API}/sessions/${uuid(sessionId, 'session ID')}`)).data.project_id;
        }
      } catch { /* Retain the original hold/conflict even when inspection fails. */ }
      const link = isUUID(projectId) ? projectUrl(ctx, projectId) : 'the same project page';
      if (isUUID(projectId)) error.details = { ...error.details, project_id: projectId, approval_url: link };
      error.action = error.code === 'human_resume_required'
        ? `Stop this project's work and ask your user to open ${link} and choose "Allow agent to resume". Await their direction, inspect the project control revision, then explicitly resume the same project. Do not continue held work through a replacement project.`
        : `Project control changed. Inspect ${isUUID(projectId) ? `ariax forge project ${projectId}` : 'the project'} before continuing; a newer pause may require human approval.`;
    } else if (['checkpoint_required', 'checkpoint_unready'].includes(error.code)) {
      const action = actionOf(ctx.positionals);
      error.action = ['create', 'resume'].includes(action)
        ? `Inspect ariax forge checkpoints ${ctx.flags['restore-session']} and select a completed checkpoint with --checkpoint UUID. A terminal source cannot create a new checkpoint.`
        : `Run ariax forge sync ${ctx.positionals[1]} --wait to save files, or select an existing completed checkpoint with --checkpoint UUID.`;
    } else if (['limit_revision_conflict', 'session_closing'].includes(error.code)) {
      error.action = `Inspect ariax forge status ${ctx.positionals[1]} for the current state, max_gpu_hours, limit_revision, applied_limit_revision and expires_at before another edit. Closing compute must finish cleanup.`;
    } else if (['session_cleanup_pending', 'project_session_active', 'restore_source_active'].includes(error.code)) {
      error.action = `Inspect the project history and source session status. Wait for confirmed cleanup before resuming; keep the same project and saved session request.`;
    } else if (['request_conflict', 'idempotency_conflict', 'command_conflict'].includes(error.code)) {
      error.action = 'Inspect the saved request and existing session or command. Recover its original fields and caller ID; resolve the existing outcome before choosing any new operation.';
    }
    throw error;
  }
}
