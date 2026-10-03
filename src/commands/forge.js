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

import { runFiles } from './forge-files.js';

const API = '/api/v1/forge';
const TERMINAL_COMMANDS = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
const OPTIONS = {
  create: [['name', 'gpu', 'provider', 'tools', 'priority', 'max-hours', 'session-id', 'restore-session', 'checkpoint'], 1],
  list: [[], 1], status: [[], 2], tools: [[], 2],
  'tools add': [['tools', 'priority', 'selection-id'], 3],
  'tools wait': [['timeout'], 4],
  run: [['tool', 'cwd', 'timeout-seconds', 'command-id'], 2],
  commands: [[], 2], command: [[], 3], watch: [['timeout'], 3],
  'inputs add': [['file', 'artifact', 'url', 'path', 'input-id'], 3],
  'inputs list': [[], 3], 'inputs status': [[], 4],
  sync: [['wait', 'checkpoint-id', 'timeout'], 2], checkpoints: [[], 2], checkpoint: [[], 3],
  files: [['path', 'checkpoint'], 2], download: [['dest', 'checkpoint'], 3],
  logs: [['tail'], 3], cancel: [[], 3], close: [[], 2],
};

export const help = `ariax forge create --name NAME --gpu GPU [--provider hyperstack|vastai] [--tools boltz2,bindcraft2] [--priority boltz2] [--max-hours 2] [--session-id UUID]
  ariax forge list
  ariax forge status SESSION
  ariax forge tools SESSION
  ariax forge tools add SESSION --tools TOOL,... [--priority TOOL,...] [--selection-id UUID]
  ariax forge tools wait SESSION TOOL [--timeout SECONDS]
  ariax forge run SESSION --tool TOOL [--cwd /workspace] [--timeout-seconds 3600] [--command-id UUID] -- COMMAND ARG...
  ariax forge commands SESSION
  ariax forge command SESSION COMMAND_ID
  ariax forge watch SESSION COMMAND_ID [--timeout SECONDS]
  ariax forge logs SESSION COMMAND_ID [--tail 1000]
  ariax forge cancel SESSION COMMAND_ID
  ariax forge close SESSION
  ariax forge inputs add SESSION --file FILE --path PATH [--input-id UUID]
  ariax forge inputs add SESSION --artifact PROJECT_ID:PATH --path PATH [--input-id UUID]
  ariax forge inputs add SESSION --url URL --path PATH [--input-id UUID]
  ariax forge inputs list SESSION
  ariax forge inputs status SESSION INPUT_ID
  ariax forge sync SESSION [--wait] [--checkpoint-id UUID] [--timeout SECONDS]
  ariax forge checkpoints SESSION
  ariax forge checkpoint SESSION CHECKPOINT_ID
  ariax forge files SESSION [--path /workspace] [--checkpoint UUID]
  ariax forge download SESSION PATH --dest LOCAL [--checkpoint UUID]
  ariax forge create --name NAME --gpu GPU --restore-session SOURCE --checkpoint UUID [usual create options]`;

function actionOf(positionals) {
  if (positionals[0] === 'inputs' && ['add', 'list', 'status'].includes(positionals[1])) return `inputs ${positionals[1]}`;
  if (positionals[0] === 'tools' && ['add', 'wait'].includes(positionals[1])) return `tools ${positionals[1]}`;
  return positionals[0];
}

export function validateArguments({ positionals, flags, passthrough, globals }) {
  if (!positionals.length && globals.help && !Object.keys(flags).length) return;
  const action = actionOf(positionals);
  if (!Object.hasOwn(OPTIONS, action)) throw usageError('forge: expected create, list, status, tools, run, commands, command, watch, logs, cancel, or close.');
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
  if (String(value).trim() === '' || !Number.isFinite(result) || (zero ? result < 0 : result <= 0)
      || (integer && !Number.isSafeInteger(result))) {
    throw usageError(`forge: --${flag} must be a ${zero ? 'nonnegative' : 'positive'} ${integer ? 'integer' : 'number'}.`);
  }
  return result;
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

async function submit(ctx, id, request, label, recovery) {
  const account = await accountIdentity(ctx);
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
    const res = await ctx.client.post(request.path, { body: record.request.body });
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
  if (record?.id === id && `${record.request?.path}/${id}` === resourcePath
      && record.api_origin === new URL(ctx.config.baseUrl).origin) saveResult(file, record, result);
}

export function report(ctx, res, kind) {
  if (ctx.json) { printJson({ data: res.data, meta: res.meta, request_id: res.requestId }); return; }
  const data = res.data;
  if (kind === 'sessions') printTable(['session_id', 'name', 'state', 'gpu'], data.sessions.map(s => [s.session_id, s.name, s.state, s.gpu_type]));
  else if (kind === 'commands') printTable(['command_id', 'tool', 'state', 'exit_code'], data.commands.map(c => [c.command_id, c.tool, c.state, c.exit_code]));
  else if (kind === 'tools') printTable(['tool', 'state', 'error'], data.tools.map(t => [t.tool, t.state, t.error?.message]));
  else if (kind === 'inputs') printTable(['input_id', 'path', 'state', 'size_bytes'], data.inputs.map(i => [i.input_id, i.path, i.state, i.size_bytes]));
  else if (kind === 'checkpoints') printTable(['checkpoint_id', 'state', 'file_count', 'size_bytes'], data.checkpoints.map(c => [c.checkpoint_id, c.state, c.file_count, c.size_bytes]));
  else if (kind === 'files') printTable(['path', 'kind', 'size_bytes'], data.entries.map(e => [e.path, e.kind, e.size_bytes]));
  else if (kind === 'logs') printData(data.text || '(no log lines)');
  else printKv(data);
}

export async function poll(ctx, resourcePath, id, inspect, resume) {
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
    for (;;) {
      const res = await ctx.client.get(resourcePath, { signal: controller.signal });
      remember(ctx, id, resourcePath, res.data);
      const { state, done } = inspect(res.data);
      if (state !== lastState) { printProgress(`state: ${state}`); lastState = state; }
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

export function failed(code, message, error) {
  throw new ApiError({ status: 500, code, message: `${message}${error?.message ? `: ${error.message}` : ''}`, retryable: false });
}

export async function run(ctx) {
  const action = actionOf(ctx.positionals);
  const flags = ctx.flags;
  if (action === 'create') {
    const sessionId = flags['session-id'] === undefined ? randomUUID() : uuid(flags['session-id'], 'session ID');
    const provider = flags.provider === undefined ? 'hyperstack' : required(flags.provider, 'provider');
    if (!['hyperstack', 'vastai'].includes(provider)) throw usageError('forge: --provider must be hyperstack or vastai.');
    if ((flags['restore-session'] === undefined) !== (flags.checkpoint === undefined)) throw usageError('forge create: --restore-session and --checkpoint are required together.');
    const restore = flags['restore-session'] === undefined ? null : {session_id:uuid(flags['restore-session'], 'restore session ID'),checkpoint_id:uuid(flags.checkpoint, 'checkpoint ID')};
    const body = { session_id: sessionId, restore, name: required(flags.name, 'name'), provider,
      gpu_type: required(flags.gpu, 'gpu'), ...selection(flags),
      ...(flags['max-hours'] === undefined ? {} : { max_hours: number(flags['max-hours'], 'max-hours') }) };
    return report(ctx, await submit(ctx, sessionId, { method: 'POST', path: `${API}/sessions`, body }, 'session_id',
      `Retry the same create request with --session-id ${sessionId}, the same --root-dir, account, and API origin.`));
  }
  if (action === 'list') return report(ctx, await ctx.client.get(`${API}/sessions`), 'sessions');
  const sessionId = uuid(ctx.positionals[(action.startsWith('tools ') || action.startsWith('inputs ')) ? 2 : 1], 'session ID');
  const sessionPath = `${API}/sessions/${sessionId}`;
  if (action.startsWith('inputs ') || ['sync','checkpoints','checkpoint','files','download'].includes(action)) return runFiles(ctx, action, sessionId, sessionPath);
  if (action === 'tools add') {
    const id = flags['selection-id'] === undefined ? randomUUID() : uuid(flags['selection-id'], 'selection ID');
    return report(ctx, await submit(ctx, id, { method: 'POST', path: `${sessionPath}/tools`, body: { selection_id: id, ...selection(flags, true) } }, 'selection_id',
      `Inspect ariax forge tools ${sessionId}; retry with --selection-id ${id}, identical fields, and the same --root-dir, account, and API origin.`));
  }
  if (action === 'status' || action === 'tools') {
    const res = await ctx.client.get(sessionPath);
    remember(ctx, sessionId, sessionPath, res.data);
    return report(ctx, action === 'tools' ? { ...res, data: { session_id: sessionId, tools: res.data.tools } } : res, action);
  }
  if (action === 'tools wait') {
    const toolName = ctx.positionals[3];
    const res = await poll(ctx, sessionPath, sessionId, session => {
      if (['closing', 'closed', 'failed'].includes(session.state)) failed('session_unavailable', `Session ${sessionId} is ${session.state}`, session.error);
      const tool = session.tools.find(t => t.tool === toolName);
      if (!tool) throw usageError(`Tool ${toolName} is not selected. Inspect ariax forge tools ${sessionId}.`);
      if (tool.state === 'failed') failed('tool_failed', `Tool ${toolName} failed`, tool.error);
      return { state: tool.state, done: session.state === 'available' && tool.state === 'ready' };
    }, `ariax forge tools wait ${sessionId} ${toolName}`);
    return report(ctx, { ...res, data: { session_id: sessionId, ...res.data.tools.find(t => t.tool === toolName) } });
  }
  if (action === 'run') {
    const commandId = flags['command-id'] === undefined ? randomUUID() : uuid(flags['command-id'], 'command ID');
    const cwd = flags.cwd === undefined ? '/workspace' : required(flags.cwd, 'cwd');
    if (!path.posix.isAbsolute(cwd) || (cwd !== '/workspace' && !cwd.startsWith('/workspace/'))
        || cwd.split('/').includes('..')) throw usageError('forge: --cwd must stay under /workspace.');
    if (!ctx.passthrough[0]) throw usageError('forge run: the command after -- must be nonempty.');
    const body = { command_id: commandId, tool: required(flags.tool, 'tool'), argv: ctx.passthrough,
      cwd: path.posix.normalize(cwd), timeout_seconds: flags['timeout-seconds'] === undefined ? 86400 : number(flags['timeout-seconds'], 'timeout-seconds', { integer: true }) };
    return report(ctx, await submit(ctx, commandId, { method: 'POST', path: `${sessionPath}/commands`, body }, 'command_id',
      `Retry the same run request with --command-id ${commandId}, the same --root-dir, account, and API origin.`));
  }
  if (action === 'close') {
    const res = await submit(ctx, randomUUID(), { method: 'POST', path: `${sessionPath}/close`, body: {} }, 'request_id',
      `Inspect ariax forge status ${sessionId}; repeat ariax forge close ${sessionId} if needed.`);
    remember(ctx, sessionId, sessionPath, res.data);
    return report(ctx, res);
  }
  if (action === 'commands') return report(ctx, await ctx.client.get(`${sessionPath}/commands`), 'commands');
  const commandId = uuid(ctx.positionals[2], 'command ID');
  const commandPath = `${sessionPath}/commands/${commandId}`;
  if (action === 'watch') {
    const res = await poll(ctx, commandPath, commandId, command => {
      if (['failed', 'interrupted'].includes(command.state)) failed('command_failed', `Command ${commandId} is ${command.state}`, command.error);
      return { state: command.state, done: TERMINAL_COMMANDS.has(command.state) };
    }, `ariax forge watch ${sessionId} ${commandId}`);
    return report(ctx, res);
  }
  if (action === 'cancel') {
    const res = await submit(ctx, randomUUID(), { method: 'POST', path: `${commandPath}/cancel`, body: {} }, 'request_id',
      `Inspect ariax forge command ${sessionId} ${commandId}; repeat cancellation if needed.`);
    remember(ctx, commandId, commandPath, res.data);
    return report(ctx, res);
  }
  if (action === 'logs') {
    const tail = flags.tail === undefined ? 1000 : number(flags.tail, 'tail', { integer: true });
    if (tail > 5000) throw usageError('forge logs: --tail must be an integer 1..5000.');
    return report(ctx, await ctx.client.get(`${commandPath}/logs`, { query: { tail } }), 'logs');
  }
  const res = await ctx.client.get(commandPath);
  remember(ctx, commandId, commandPath, res.data);
  return report(ctx, res);
}
