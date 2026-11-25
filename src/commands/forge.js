/** Forge sessions and commands on the existing authenticated API origin. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { usageError } from '../args.js';
import { isUUID } from '../uuid.js';
import { accountIdentity, atomicWrite } from '../operations.js';
import { ApiError, NetworkError, backoffDelay, createClient } from '../http.js';
import { requireTrustedApiOrigin, supportsStoredCredentials } from '../config.js';
import { EXIT } from '../exit-codes.js';
import { checkGpuPolicy } from '../gpu-policy.js';
import { printData, printJson, printKv, printProgress, printTable } from '../output.js';
import { resolveProjectId } from '../resolve.js';
import { isForgeOperationTerminal, pruneExpiredRecords } from '../state-dir.js';
import { detectAgentShell } from '../agent-env.js';

import { forgeRequest, forgeAccountIdentity, hasCachedForgeConnection } from '../lib/forge-client.js';
import { readSync, redactForgeOutput, redactForgeText, workspacePath } from '../lib/forge-workspace-client.js';

import { runFiles, inputStatus, recoverFile, failedSync } from './forge-files.js';
import { readForgeToolGuide } from './skills.js';
import { runForgeSummary } from './summary.js';

const API = '/api/v1/forge';
const TERMINAL_COMMANDS = new Set(['succeeded', 'failed', 'cancelled', 'interrupted', 'timed_out']);
const DEFAULT_WATCH_TAIL_LINES = 80;
const MAX_WATCH_TAIL_LINES = 400;
const MAX_WATCH_TAIL_BYTES = 4096;
const CLOSE_PENDING_FILES_LIMIT = 100;
const CLOSE_PENDING_BYTES_LIMIT = 500 * 1024 * 1024;
const SESSION_OPTIONS = ['gpu', 'allowed-gpus', 'gpu-count', 'tools', 'priority', 'max-gpu-hours',
  'min-ram-gib', 'min-cpu-count', 'min-disk-gib', 'session-id'];
const OPTIONS = {
  create: [['name', ...SESSION_OPTIONS, 'wait', 'wait-timeout', 'details'], 1],
  resume: [['control-revision', 'hydrate', ...SESSION_OPTIONS, 'wait', 'wait-timeout', 'details'], 2],
  project: [['limit', 'cursor', 'details'], 2],
  summary: [['top'], 2],
  activity: [['limit', 'cursor', 'details'], 2],
  limit: [['gpu-hours', 'clear', 'limit-revision', 'operation-id', 'details'], 2],
  catalog: [['details', 'full', 'all', 'task', 'tool', 'compact', 'model', 'mode', 'query', 'search', 'modality', 'tier', 'with-guide'], 1],
  list: [['details', 'active', 'state', 'name', 'project', 'limit'], 1],
  status: [['details'], 2],
  tools: [['details'], 2],
  'tools add': [['tools', 'priority', 'selection-id', 'details'], 3],
  'tools wait': [['timeout', 'wait-timeout', 'details'], 4],
  run: [['tool', 'gpus', 'cwd', 'timeout-seconds', 'command-id', 'wait-ready', 'input-ids', 'wait', 'wait-timeout', 'tail'], 2],
  pack: [['src', 'dest', 'format', 'max-shard-gib', 'remove-src', 'no-manifest', 'wait', 'wait-timeout', 'wait-ready', 'tail', 'operation-id', 'details'], 2],
  operations: [[], 1], recover: [['wait', 'wait-timeout'], 2],
  finish: [['timeout-seconds', 'operation-id', 'wait', 'wait-timeout'], 2],
  commands: [['retained', 'details'], 2], command: [['retained', 'details'], 3], watch: [['timeout', 'wait-timeout', 'tail'], 3],
  'inputs add': [['file', 'artifact', 'url', 'path', 'input-id', 'wait-ready', 'wait-timeout'], 3],
  'inputs list': [['retained'], 3], 'inputs status': [['retained'], 4],
  sync: [['wait', 'sync-id', 'timeout', 'wait-timeout'], 2],
  files: [['path', 'cursor', 'recursive'], 2], 'files delete': [['path', 'operation-id', 'recursive', 'wait', 'wait-timeout'], 3], 'files hydrate': [['path', 'operation-id', 'wait', 'wait-timeout'], 3], 'files recover': [['path', 'catalog', 'archive', 'artifact', 'version', 'operation-id', 'overwrite', 'wait', 'wait-timeout'], 3],
  download: [['dest'], 3], link: [[], 3],
  logs: [['tail', 'cursor', 'wait-seconds', 'retained'], 3], cancel: [['wait', 'wait-timeout'], 3], close: [['force', 'wait', 'wait-timeout'], 2],
};

const SUBCOMMAND_HELP = Object.freeze({
  create: `ariax forge create --name NAME --gpu GPU [--allowed-gpus RTX5090,L40S] [--gpu-count 1] [--tools TOOL,...] [--priority TOOL,...] [--max-gpu-hours H] [--min-ram-gib N] [--min-cpu-count N] [--min-disk-gib N] [--session-id UUID] [--wait] [--wait-timeout SECONDS] [--details]
  Include a compatible core GPU (H100, A100_80GB, L40S, or RTX6000PRO). base is always included.`,
  resume: `ariax forge resume PROJECT [--control-revision N] --gpu GPU [--allowed-gpus ...] [--gpu-count N] [--tools TOOL,...] [--hydrate PATH ...] [--max-gpu-hours H] [--session-id UUID] [--wait] [--wait-timeout SECONDS] [--details]
  Reopens saved /workspace and /inputs in the same project. Prior /inputs remain remotely; inspect with ariax forge files PROJECT --path /inputs.`,
  project: `ariax forge project <PROJECT_UUID_OR_NAME> [--limit 50] [--cursor CURSOR] [--details]
  Inspect project status, control revision, and session history.`,
  summary: `ariax forge summary PROJECT [--top 5]
  Compact Forge workspace, session accounting, hygiene warnings, and handoff summary.`,
  activity: `ariax forge activity PROJECT [--limit 50] [--cursor CURSOR] [--details]`,
  limit: `ariax forge limit SESSION (--gpu-hours H | --clear) [--limit-revision N] [--operation-id UUID] [--details]`,
  catalog: `ariax forge catalog [--task TASK] [--query TEXT] [--modality MOD] [--tier TIER] [--all] [--full | --details]
  ariax forge catalog --tool TOOL [--model MODEL] [--mode MODE] [--with-guide] [--json]`,
  list: `ariax forge list [--active] [--state STATE] [--name SUBSTR] [--project UUID] [--limit N] [--details]
  Returns compact session summaries by default; add --details for full tool metadata.`,
  status: `ariax forge status SESSION [--details]`,
  tools: `ariax forge tools SESSION [--details]
  ariax forge tools add SESSION --tools TOOL,... [--priority TOOL,...] [--selection-id UUID] [--details]
  ariax forge tools wait SESSION TOOL [--wait-timeout SECONDS] [--details]`,
  'tools add': `ariax forge tools add SESSION --tools TOOL,... [--priority TOOL,...] [--selection-id UUID] [--details]`,
  'tools wait': `ariax forge tools wait SESSION TOOL [--wait-timeout SECONDS] [--details]`,
  run: `ariax forge run SESSION --tool TOOL [--gpus 0,1] [--cwd /workspace] [--timeout-seconds SECONDS] [--command-id UUID] [--wait-ready [--input-ids ID,...]] [--wait] [--wait-timeout SECONDS] [--tail N] -- COMMAND ARG...
  Put the native command and arguments after --. Remote script failures exit with code 11 and include output_tail.`,
  pack: `ariax forge pack SESSION --src PATH --dest /workspace/archives/NAME.tar.zst [--format tar.zst|tar.gz] [--max-shard-gib 10] [--remove-src] [--no-manifest] [--wait] [--wait-timeout SECONDS] [--wait-ready] [--tail N] [--operation-id UUID] [--details]
  Stages in /scratch, verifies archive integrity, auto-shards >--max-shard-gib, and emits structured data.pack when --wait is used.`,
  operations: `ariax forge operations`,
  recover: `ariax forge recover OPERATION_ID [--wait] [--wait-timeout SECONDS]`,
  finish: `ariax forge finish SESSION [--timeout-seconds SECONDS] [--operation-id UUID] [--wait] [--wait-timeout SECONDS]
  Drains active commands, flushes durable /workspace files, and releases the GPU cleanly (--timeout-seconds defaults to 3600; --wait-timeout defaults to 7200).`,
  commands: `ariax forge commands SESSION [--retained] [--details]`,
  command: `ariax forge command SESSION COMMAND_ID [--retained] [--details]`,
  watch: `ariax forge watch SESSION COMMAND_ID [--wait-timeout SECONDS] [--tail N]`,
  logs: `ariax forge logs SESSION COMMAND_ID [--tail 1000] [--cursor CURSOR] [--wait-seconds 0..25] [--retained]`,
  cancel: `ariax forge cancel SESSION COMMAND_ID [--wait] [--wait-timeout SECONDS]`,
  close: `ariax forge close SESSION [--force] [--wait] [--wait-timeout SECONDS]
  Emergency teardown (75s sync ceiling). Prefer ariax forge finish --wait for normal completion.`,
  inputs: `ariax forge inputs add SESSION (--file FILE | --artifact PROJECT_ID:PATH | --url URL) --path PATH [--input-id UUID] [--wait-ready] [--wait-timeout SECONDS]
  ariax forge inputs list SESSION [--retained]
  ariax forge inputs status SESSION INPUT_ID [--retained]
  --path is relative to /inputs (immutable once published; use a new --path for updates).`,
  'inputs add': `ariax forge inputs add SESSION (--file FILE | --artifact PROJECT_ID:PATH | --url URL) --path PATH [--input-id UUID] [--wait-ready] [--wait-timeout SECONDS]
  --path is relative to /inputs (immutable once published; use a new --path for updated files).`,
  'inputs list': `ariax forge inputs list SESSION [--retained]`,
  'inputs status': `ariax forge inputs status SESSION INPUT_ID [--retained]`,
  sync: `ariax forge sync SESSION [--wait] [--sync-id UUID] [--wait-timeout SECONDS]`,
  files: `ariax forge files PROJECT [--path /workspace] [--recursive] [--cursor CURSOR]
  ariax forge files delete PROJECT --path PATH [--recursive] [--operation-id UUID] [--wait] [--wait-timeout SECONDS]
  ariax forge files hydrate SESSION --path PATH [--operation-id UUID] [--wait] [--wait-timeout SECONDS]
  ariax forge files recover PROJECT --path DEST (--catalog PROJECT:PATH --version N | --archive PROJECT:CHECKPOINT:PATH | --artifact PROJECT:PATH) [--overwrite] [--operation-id UUID] [--wait] [--wait-timeout SECONDS]`,
  'files delete': `ariax forge files delete PROJECT --path PATH [--recursive] [--operation-id UUID] [--wait] [--wait-timeout SECONDS]`,
  'files hydrate': `ariax forge files hydrate SESSION --path PATH [--operation-id UUID] [--wait] [--wait-timeout SECONDS]`,
  'files recover': `ariax forge files recover PROJECT --path DEST (--catalog PROJECT:PATH --version N | --archive PROJECT:CHECKPOINT:PATH | --artifact PROJECT:PATH) [--overwrite] [--operation-id UUID] [--wait] [--wait-timeout SECONDS]`,
  download: `ariax forge download PROJECT PATH --dest LOCAL`,
  link: `ariax forge link PROJECT PATH`,
});

export function helpFor(positionals = []) {
  const action = actionOf(positionals);
  if (action && Object.prototype.hasOwnProperty.call(SUBCOMMAND_HELP, action)) {
    return SUBCOMMAND_HELP[action];
  }
  return help;
}

export const help = `ariax forge create --name NAME --gpu GPU [--allowed-gpus RTX5090,L40S] [--gpu-count 1] [--tools boltz2,bindcraft2] [--priority boltz2] [--max-gpu-hours H] [--session-id UUID] [--wait] [--wait-timeout SECONDS]
  ariax forge resume PROJECT [--control-revision N] --gpu GPU [--hydrate PATH ...] [usual hardware/tool options] [--session-id UUID] [--wait] [--wait-timeout SECONDS]
  ariax forge project PROJECT [--limit 50] [--cursor CURSOR] [--details]
  ariax forge summary PROJECT [--top 5]
  ariax forge activity PROJECT [--limit 50] [--cursor CURSOR] [--details]
  ariax forge limit SESSION (--gpu-hours H | --clear) [--limit-revision N] [--operation-id UUID] [--details]
  ariax forge catalog [--task TASK] [--query TEXT] [--modality MOD] [--tier TIER] [--all] [--full | --details]
  ariax forge catalog --tool TOOL [--model MODEL] [--mode MODE] [--with-guide] [--json]
  ariax forge list [--active] [--state STATE] [--name SUBSTR] [--project UUID] [--limit N] [--details]
  ariax forge status SESSION [--details]
  ariax forge tools SESSION [--details]
  ariax forge tools add SESSION --tools TOOL,... [--priority TOOL,...] [--selection-id UUID] [--details]
  ariax forge tools wait SESSION TOOL [--wait-timeout SECONDS]
  ariax forge run SESSION --tool TOOL [--gpus 0,1] [--cwd /workspace] [--timeout-seconds SECONDS] [--command-id UUID] [--wait-ready [--input-ids ID,...]] [--wait] [--wait-timeout SECONDS] [--tail N] -- COMMAND ARG...
  ariax forge pack SESSION --src PATH --dest /workspace/archives/NAME.tar.zst [--format tar.zst|tar.gz] [--max-shard-gib 10] [--remove-src] [--no-manifest] [--wait] [--wait-timeout SECONDS] [--wait-ready] [--tail N] [--operation-id UUID]
  ariax forge operations
  ariax forge recover OPERATION_ID [--wait] [--wait-timeout SECONDS]
  ariax forge finish SESSION [--timeout-seconds SECONDS] [--operation-id UUID] [--wait] [--wait-timeout SECONDS]
  ariax forge commands SESSION [--retained] [--details]
  ariax forge command SESSION COMMAND_ID [--retained] [--details]
  ariax forge watch SESSION COMMAND_ID [--wait-timeout SECONDS] [--tail N]
  ariax forge logs SESSION COMMAND_ID [--tail 1000] [--cursor CURSOR] [--wait-seconds 0..25] [--retained]
  ariax forge cancel SESSION COMMAND_ID [--wait] [--wait-timeout SECONDS]
  ariax forge close SESSION [--force] [--wait] [--wait-timeout SECONDS]
  ariax forge inputs add SESSION --file FILE --path PATH [--input-id UUID] [--wait-ready] [--wait-timeout SECONDS]
  ariax forge inputs add SESSION --artifact PROJECT_ID:PATH --path PATH [--input-id UUID] [--wait-ready] [--wait-timeout SECONDS]
  ariax forge inputs add SESSION --url URL --path PATH [--input-id UUID] [--wait-ready] [--wait-timeout SECONDS]
  ariax forge inputs list SESSION
  ariax forge inputs status SESSION INPUT_ID
  ariax forge sync SESSION [--wait] [--sync-id UUID] [--wait-timeout SECONDS]
  ariax forge files PROJECT [--path /workspace] [--recursive] [--cursor CURSOR]
  ariax forge files delete PROJECT --path PATH [--recursive] [--operation-id UUID] [--wait] [--wait-timeout SECONDS]
  ariax forge files hydrate SESSION --path PATH [--operation-id UUID] [--wait] [--wait-timeout SECONDS]
  ariax forge files recover PROJECT --path DEST (--catalog PROJECT:PATH --version N | --archive PROJECT:CHECKPOINT:PATH | --artifact PROJECT:PATH) [--overwrite] [--operation-id UUID] [--wait] [--wait-timeout SECONDS]
  ariax forge download PROJECT PATH --dest LOCAL
  ariax forge link PROJECT PATH
  Files and links refer to the current project workspace, not a historical version.
  Sync flushes changed files on an active session; it is not an atomic multi-file snapshot.
  Pack stages in /scratch, verifies archive integrity, shards >--max-shard-gib (default 10 GiB), and writes a manifest under /workspace.
  Hardware options: --min-ram-gib N --min-cpu-count N --min-disk-gib N
  --wait-ready waits for the session, tool, listed inputs and command capacity before dispatch.
  --wait-timeout bounds local waiting in seconds (create/resume/close/run/pack/files recover default 1800, recover default 60); --timeout-seconds limits remote execution (default 86400).
  --tail bounds output_tail lines returned by run --wait, pack --wait, and watch (default 80, max 400, capped at 4096 bytes). Remote command failures exit with code 11.
  Finish uses --timeout-seconds for its fixed remote deadline (default 3600); its --wait-timeout defaults to 7200 seconds.
  For tools wait, watch and sync, --wait-timeout is in seconds; omission or 0 waits indefinitely. Their older --timeout option also uses seconds.
  Elsewhere the global --timeout is a per-request limit in milliseconds (default 30000).
  --gpu is preferred; --allowed-gpus lists it plus permitted fallbacks. Include a core GPU: H100, A100_80GB, L40S, or RTX6000PRO.
  forge catalog is public and returns compact summaries by default (use --all for experimental/legacy, --full for the complete catalog).
  Use --tool TOOL --with-guide to inspect one tool's full requirements and bundled guide in a single call; --model/--mode narrow to exact IDs.`;

function actionOf(positionals) {
  if (positionals[0] === 'inputs' && ['add', 'list', 'status'].includes(positionals[1])) return `inputs ${positionals[1]}`;
  if (positionals[0] === 'tools' && ['add', 'wait'].includes(positionals[1])) return `tools ${positionals[1]}`;
  if (positionals[0] === 'files' && ['recover', 'hydrate', 'delete'].includes(positionals[1])) return `files ${positionals[1]}`;
  return positionals[0];
}

export function validateArguments({ positionals, flags, passthrough, globals }) {
  if (!positionals.length && globals.help && !Object.keys(flags).length) return;
  const action = actionOf(positionals);
  if (['checkpoint', 'checkpoints'].includes(action)
      || ['checkpoint', 'checkpoint-id', 'restore-session'].some(name => Object.hasOwn(flags, name))) {
    throw usageError('Forge checkpoints and restore selectors are no longer supported. Use the current project workspace; upgrade the CLI and server together. Run: ariax forge --help');
  }
  if (globals.help && Object.prototype.hasOwnProperty.call(SUBCOMMAND_HELP, action) && !Object.keys(flags).length) {
    return;
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

function forgeRecordDir(rootDir, create = false) {
  let dir = path.resolve(rootDir);
  if (create) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
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
  return dir;
}

export function recordPath(ctx, id, create = false) {
  const dir = forgeRecordDir(ctx.config.rootDir, create);
  return dir ? path.join(dir, `${uuid(id, 'request ID')}.json`) : null;
}

export function findRecord(ctx, id) {
  const primary = recordPath(ctx, id, false);
  const primaryRecord = readRecord(primary);
  if (primaryRecord) return { file: primary, record: primaryRecord, legacy: false };
  const legacyRoot = !ctx.config.rootDirExplicit ? ctx.config.legacyRootDir : null;
  if (legacyRoot && path.resolve(legacyRoot) !== path.resolve(ctx.config.rootDir)) {
    const legacyDir = forgeRecordDir(legacyRoot, false);
    if (legacyDir) {
      const legacyFile = path.join(legacyDir, `${uuid(id, 'request ID')}.json`);
      const legacyRecord = readRecord(legacyFile);
      if (legacyRecord) return { file: legacyFile, record: legacyRecord, legacy: true };
    }
  }
  return { file: primary, record: null, legacy: false };
}

export function readRecordFor(ctx, id) {
  return findRecord(ctx, id).record;
}

export function listRecordFiles(ctx) {
  const seen = new Set();
  const entries = [];
  const roots = [ctx.config.rootDir];
  const legacyRoot = !ctx.config.rootDirExplicit ? ctx.config.legacyRootDir : null;
  if (legacyRoot && path.resolve(legacyRoot) !== path.resolve(ctx.config.rootDir)) roots.push(legacyRoot);
  for (const root of roots) {
    const dir = forgeRecordDir(root, false);
    if (!dir) continue;
    for (const name of fs.readdirSync(dir).filter(entry => entry.endsWith('.json') && isUUID(entry.slice(0, -5))).sort()) {
      const id = name.slice(0, -5);
      if (seen.has(id)) continue;
      seen.add(id);
      entries.push({ id, name, file: path.join(dir, name) });
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
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
  const next = { ...record, updated_at: new Date().toISOString(), result: redactForgeOutput(result),
    ...(isUUID(result?.project_id) ? { project_id: result.project_id } : {}) };
  atomicWrite(file, JSON.stringify(next, null, 2) + '\n');
  if (isForgeOperationTerminal(next)) {
    pruneExpiredRecords(path.dirname(file), { isTerminal: isForgeOperationTerminal });
  }
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
        try { if (readRecordFor(ctx,id)) error.action = `Inspect or recover the same operation with ariax forge recover ${id}.`; }
        catch { /* Preserve the original error. */ }
      }
      throw error;
    }
    let saved;
    try { saved = readRecordFor(ctx,id); } catch { /* Preserve the interruption. */ }
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
  if (request.path === '/v1/files/hydrate' && request.body.operation_id === id) return 'file-hydration';
  if (request.path === '/v1/inputs' && request.body.input_id === id) return 'input';
  if (request.type === 'project-file-input-v2' && request.body.operation_id === id) return 'input';
  if (request.type === 'project-file-copy-v1' && request.body.operation_id === id) return 'file-recovery';
  if (['project-file-delete-v1','project-file-delete-tree-v1'].includes(request.type) && request.body.operation_id === id) return 'file-deletion';
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
  const retrySafe = ['session', 'command', 'selection', 'cancel', 'close', 'limit', 'finish', 'file-hydration'].includes(kind);
  let failures = 0;
  let lastCapacityCode;
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
      const viewQuery = { view: ctx.flags?.details === true ? 'full' : 'summary' };
      const res = request.session_id
        ? await forgeRequest(ctx, request.session_id, 'POST', request.path, {
          body: request.body,
          ...(kind === 'selection' ? { query: viewQuery } : {}),
          signal,
        })
        : await ctx.client.post(request.path, {
          body: request.body,
          ...(kind === 'session' || kind === 'limit' ? { query: viewQuery } : {}),
          signal,
        });
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
        if (error.code !== lastCapacityCode) {
          printProgress(`Waiting for command readiness: ${error.code}`);
          lastCapacityCode = error.code;
        }
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

// Canonicalize only the L40 family. Saved session requests are replayed as
// recorded; equivalent aliases may identify the same original intent.
function sessionGpuIntent(request) {
  if (!request?.body || typeof request.body !== 'object') return request;
  const canonical = value => typeof value === 'string' && /^(L40|L40S)$/i.test(value.trim()) ? 'L40S' : value;
  const body = { ...request.body, gpu_type: canonical(request.body.gpu_type) };
  if (Array.isArray(body.allowed_gpus)) {
    const values = [];
    for (const raw of body.allowed_gpus) {
      const gpu = canonical(raw);
      if (gpu !== 'L40S' || !values.includes(gpu)) values.push(gpu);
    }
    body.allowed_gpus = values;
  }
  return { ...request, body };
}

export async function submit(ctx, id, request, label, recovery, options = {}) {
  if (!options.signal) return controlled(ctx, id, 60, signal => submit(ctx, id, request, label, recovery, { ...options, signal }));
  const account = request.session_id && !options.readiness && request.path !== '/v1/commands'
    ? await forgeAccountIdentity(ctx, request.session_id, { signal: options.signal })
    : await accountIdentity(ctx, { signal: options.signal });
  fs.mkdirSync(ctx.config.rootDir, { recursive: true, mode: 0o700 });
  const file = recordPath(ctx, id, true);
  if (label === 'session_id') request = sessionGpuIntent(request);
  const candidate = { id, ...account, request, result: null, ...(options.readiness ? { readiness: options.readiness } : {}) };
  const found = findRecord(ctx, id);
  let record = found.record;
  let previous = !!record;
  if (!record) {
    // New-admission policy must not block authenticated, identical recovery of
    // a request saved before this policy existed. The checks below still bind
    // every replay to its original account, origin and request body.
    if (label === 'session_id') {
      await checkGpuPolicy(ctx, { protocol: 'forge', allowed_gpus: request.body.allowed_gpus ?? [request.body.gpu_type] }, { source: 'Forge session' });
    }
    try {
      atomicWrite(file, JSON.stringify(candidate, null, 2) + '\n', true);
      record = candidate;
      pruneExpiredRecords(path.dirname(file), { isTerminal: isForgeOperationTerminal });
    }
    catch (error) { if (error.code !== 'EEXIST') throw error; record = readRecord(file); previous = true; }
  } else if (found.legacy) {
    atomicWrite(file, JSON.stringify(record, null, 2) + '\n');
  }
  if (label === 'session_id' && record?.id === id && record.request?.body?.files_contract !== 2) {
    throw new ApiError({ status: 409, code: 'upgrade_required', message: `Saved session request ${id} uses the legacy file contract. Inspect the original session; it cannot be replayed as a current-workspace request.` });
  }
  const savedRequest = label === 'session_id' ? sessionGpuIntent(record?.request) : record?.request;
  if (record?.id !== id || !isDeepStrictEqual(savedRequest, request)) {
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
  const found = findRecord(ctx, id);
  const record = found.record;
  const directRead = record?.request?.session_id && resourcePath.startsWith('/v1/') && `${record.request?.path}/${id}` === resourcePath;
  const sessionRead = resourcePath === `${API}/sessions/${id}` && record?.request?.body?.session_id === id;
  if (record?.id === id && (sessionRead || directRead || `${record.request?.path}/${id}` === resourcePath)
      && record.api_origin === new URL(ctx.config.baseUrl).origin) {
    const targetFile = found.legacy ? recordPath(ctx, id, true) : found.file;
    saveResult(targetFile, record, result);
  }
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
  if (kind === 'sessions') {
    printTable(
      ['session_id', 'project_id', 'name', 'state', 'gpu', 'gpu_count'],
      data.sessions.map(s => [s.session_id, s.project_id ?? '-', s.name, s.state, s.gpu_type, s.gpu_count]),
    );
  }
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
      if (kind === 'catalog' && typeof data.guide_content === 'string') {
        printData('');
        printData(`--- Guide (${data.guide_id ?? ctx.flags.tool}) ---`);
        printData(data.guide_content);
      }
    }
    else if (kind === 'catalog') {
      const hasSummary = data.tools.some(t => typeof t.summary === 'string' && t.summary);
      if (hasSummary) {
        printTable(
          ['tool', 'tier', 'gpu', 'tasks', 'summary'],
          data.tools.map(t => [t.tool, t.tier ?? '-', t.gpu, t.capabilities?.tasks?.join(',') || '-', t.summary || t.name || '-']),
        );
      } else {
        printTable(['tool', 'name', 'gpu', 'tasks', 'guide'], data.tools.map(t => [t.tool, t.name, t.gpu, t.capabilities?.tasks?.join(',') || 'unknown', t.capabilities?.guide || 'unknown']));
      }
      const hiddenExp = res.meta?.hidden_experimental_count ?? 0;
      const hiddenLeg = res.meta?.hidden_legacy_count ?? 0;
      if (hiddenExp || hiddenLeg) {
        printProgress(`Hidden: ${hiddenExp} experimental, ${hiddenLeg} legacy (pass --all to include).`);
      }
      if (data.tools.length === 0 && Array.isArray(res.meta?.available_tasks) && res.meta.available_tasks.length) {
        printProgress(`No Forge tools matched task "${ctx.flags.task ?? ''}". Available tasks: ${res.meta.available_tasks.join(', ')}.`);
      }
    }
    else printTable(['tool', 'state', 'error'], data.tools.map(t => [t.tool, t.state, t.error?.message]));
  }
  else if (kind === 'inputs') printTable(['input_id', 'path', 'state', 'size_bytes'], data.inputs.map(i => [i.input_id ?? '-', i.path, i.state, i.size_bytes ?? '-']));
  else if (kind === 'files') {
    printTable(['path', 'kind', 'size_bytes'], data.entries.map(e => [e.path, e.kind, e.size_bytes]));
    if (data.recursive) {
      printKv({ file_count: data.file_count, total_bytes: data.total_bytes, truncated: data.truncated });
    }
    if (data.next_cursor) printKv({ next_cursor: data.next_cursor });
  }
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

const KNOWN_CATALOG_TASKS = Object.freeze([
  'antibodies',
  'binder-design',
  'molecular-prediction',
  'sequence-optimization',
  'validation-search',
]);

const MAX_SUMMARY_ARGV_CHARS = 512;

function compactSessionTool(tool) {
  if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return tool;
  const out = {};
  for (const key of ['tool', 'state', 'error', 'version', 'started_at', 'ready_at', 'updated_at']) {
    if (Object.prototype.hasOwnProperty.call(tool, key) && tool[key] !== undefined) {
      out[key] = tool[key];
    }
  }
  return Object.keys(out).length ? out : tool;
}

function compactSessionPayload(data, details = false) {
  if (details || !data || typeof data !== 'object' || Array.isArray(data)) return data;
  if (!Array.isArray(data.tools)) return data;
  return { ...data, tools: data.tools.map(compactSessionTool) };
}

function compactCommandEntry(command, details = false) {
  if (details || !command || typeof command !== 'object' || Array.isArray(command)) return command;
  if (!Array.isArray(command.argv)) return command;
  let changed = false;
  const argv = command.argv.map((arg) => {
    if (typeof arg === 'string' && arg.length > MAX_SUMMARY_ARGV_CHARS) {
      changed = true;
      const preview = arg.slice(0, 80).replace(/\s+/g, ' ').trim();
      return preview
        ? `${preview} … <truncated ${arg.length} chars; pass --details for full argv>`
        : `<truncated ${arg.length} chars; pass --details for full argv>`;
    }
    return arg;
  });
  return changed ? { ...command, argv } : command;
}

function compactCommandsPayload(data, details = false) {
  if (details || !data || typeof data !== 'object' || Array.isArray(data)) return data;
  if (!Array.isArray(data.commands)) return data;
  return { ...data, commands: data.commands.map((cmd) => compactCommandEntry(cmd, false)) };
}

function parsePackOutput(outputTail, { src, requestedDest, format, removeSrc, noManifest }) {
  const text = typeof outputTail === 'string' ? outputTail : '';
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  let parsed = null;
  let noticeLine = null;
  for (const line of lines) {
    if (!noticeLine && /^pack notice:/i.test(line)) {
      noticeLine = line.replace(/^pack notice:\s*/i, '').trim();
    }
  }
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        const candidate = JSON.parse(line);
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
          parsed = candidate;
          break;
        }
      } catch { /* keep scanning */ }
    }
  }
  const actualDest = typeof parsed?.dest === 'string' && parsed.dest
    ? parsed.dest
    : (typeof parsed?.archive === 'string' && parsed.archive ? parsed.archive : requestedDest);
  const actualFormat = typeof parsed?.format === 'string' && parsed.format
    ? parsed.format
    : (actualDest.endsWith('.tar.gz') || actualDest.endsWith('.tgz') ? 'tar.gz' : format);
  const fallbackNotice = noticeLine
    ?? (actualDest !== requestedDest || actualFormat !== format
      ? `Fell back from ${format} (${requestedDest}) to ${actualFormat} (${actualDest}).`
      : null);
  const manifestPath = parsed && Object.prototype.hasOwnProperty.call(parsed, 'manifest_path')
    ? parsed.manifest_path
    : (noManifest ? null : `${actualDest}.manifest.json`);
  return {
    parsed: parsed !== null,
    summary: {
      src: typeof parsed?.src === 'string' && parsed.src ? parsed.src : src,
      requested_dest: requestedDest,
      actual_dest: actualDest,
      manifest_path: manifestPath,
      format: actualFormat,
      ...(typeof parsed?.sharded === 'boolean' ? { sharded: parsed.sharded } : {}),
      ...(Array.isArray(parsed?.shards) && parsed.shards.length ? { shards: parsed.shards } : {}),
      file_count: typeof parsed?.file_count === 'number' && Number.isFinite(parsed.file_count) ? parsed.file_count : null,
      uncompressed_bytes: typeof parsed?.uncompressed_bytes === 'number' && Number.isFinite(parsed.uncompressed_bytes) ? parsed.uncompressed_bytes : null,
      compressed_bytes: typeof parsed?.compressed_bytes === 'number' && Number.isFinite(parsed.compressed_bytes) ? parsed.compressed_bytes : null,
      removed_src: typeof parsed?.removed_src === 'boolean' ? parsed.removed_src : Boolean(removeSrc),
      fallback_notice: fallbackNotice,
    },
  };
}

// Summary is for routing only. Keep all observed qualification states visible,
// including unknown/missing values. Inspect the selected model/mode before use.
function compactCatalogTool(tool) {
  const qual = tool.capabilities?.qualification;
  const alreadyCompactQual = qual && !Array.isArray(qual) && typeof qual === 'object' && Object.hasOwn(qual, 'rows');
  const rows = Array.isArray(qual) ? qual : [];
  const states = field => [...new Set(rows.length ? rows.map(row => row?.[field] ?? 'unknown') : ['unknown'])];
  return {
    tool: tool.tool,
    name: tool.name,
    gpu: tool.gpu,
    ...(tool.tier !== undefined ? { tier: tool.tier } : {}),
    ...(tool.summary !== undefined ? { summary: tool.summary } : {}),
    ...(Array.isArray(tool.modalities) ? { modalities: tool.modalities } : {}),
    ...(Array.isArray(tool.inputs) ? { inputs: tool.inputs } : {}),
    ...(Array.isArray(tool.outputs) ? { outputs: tool.outputs } : {}),
    ...(tool.superseded_by !== undefined ? { superseded_by: tool.superseded_by } : {}),
    ...(tool.pairs_with !== undefined ? { pairs_with: tool.pairs_with } : {}),
    resources: tool.resources ?? null,
    models: Array.isArray(tool.models)
      ? tool.models.map(model => ({
        id: model.id,
        ...(Array.isArray(model.modes) ? { modes: model.modes } : {}),
        resources: model.resources ?? null,
      }))
      : null,
    capabilities: {
      tasks: tool.capabilities?.tasks ?? null,
      guide: tool.capabilities?.guide ?? null,
      qualification: alreadyCompactQual
        ? qual
        : { rows: rows.length, native: states('native'), installation: states('installation'), restoration: states('restoration') },
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

async function catalogGet(ctx, routePath, options = {}) {
  try {
    return await ctx.client.get(routePath, options);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    let apiKey = ctx.config.apiKey;
    if (!apiKey && ctx.credentialStore && supportsStoredCredentials(ctx.config.baseUrl)) {
      try { apiKey = (await ctx.credentialStore.read())?.apiKey || ''; } catch { apiKey = ''; }
    }
    if (!apiKey) throw error;
    try { requireTrustedApiOrigin(ctx.config); } catch { throw error; }
    const authClient = createClient({
      baseUrl: ctx.config.baseUrl,
      apiKey,
      timeoutMs: ctx.timeoutMs,
      fetchImpl: ctx.fetchImpl,
      telemetry: ctx.telemetry,
    });
    return authClient.get(routePath, options);
  }
}

export async function poll(ctx, resourcePath, id, inspect, resume, sessionId, readResult, pollOpts = {}) {
  const waitTimeout = ctx.flags['wait-timeout'] ?? ctx.flags.timeout;
  const timeoutMs = waitTimeout === undefined ? 0 : localWaitSeconds(waitTimeout, 0, { allowZero: true }) * 1000;
  const intervalMs = typeof pollOpts.intervalMs === 'number' && pollOpts.intervalMs > 0 ? pollOpts.intervalMs : 3000;
  const heartbeatMs = typeof pollOpts.heartbeatMs === 'number' && pollOpts.heartbeatMs > 0 ? pollOpts.heartbeatMs : 0;
  const deadline = timeoutMs ? Date.now() + timeoutMs : 0;
  const controller = new AbortController();
  let timedOut = false, timer, lastState, lastProgressKey;
  let lastEmitAt = 0;
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
        const lifecycle = await ctx.client.get(`${API}/sessions/${sessionId}`, {
          query: ctx.flags?.details ? undefined : { view: 'summary' },
          signal: controller.signal,
        });
        if (['closing', 'closed', 'failed'].includes(lifecycle.data.state)) {
          failed('session_unavailable', `Session ${sessionId} is ${lifecycle.data.state}`, lifecycle.data.error);
        }
        if (lifecycle.data.state === 'available') break;
        if (lifecycle.data.state !== lastState) {
          printProgress(`state: ${redactForgeText(String(lifecycle.data.state))}`);
          lastState = lifecycle.data.state;
        }
        await delay(intervalMs, undefined, { signal: controller.signal });
      }
    }
    for (;;) {
      const res = readResult ? await readResult({ signal: controller.signal }) : sessionId
        ? await forgeRequest(ctx, sessionId, 'GET', resourcePath, {
          ...(resourcePath === '/v1/session' && !ctx.flags?.details ? { query: { view: 'summary' } } : {}),
          signal: controller.signal,
        })
        : await ctx.client.get(resourcePath, { signal: controller.signal });
      remember(ctx, id, resourcePath, res.data);
      const { state, done, progress, progressKey } = inspect(res.data);
      const now = Date.now();
      const effectiveKey = progressKey ?? progress ?? String(state);
      const heartbeatDue = heartbeatMs > 0 && lastEmitAt > 0 && (now - lastEmitAt) >= heartbeatMs;
      if (effectiveKey !== lastProgressKey || state !== lastState || heartbeatDue) {
        printProgress(progress ? redactForgeText(String(progress)) : `state: ${redactForgeText(String(state))}`);
        if (state === 'unknown' && state !== lastState) {
          printProgress('Keep the same command ID while its outcome is uncertain; a fresh command could duplicate execution.');
        }
        lastState = state;
        lastProgressKey = effectiveKey;
        lastEmitAt = now;
      }
      if (done) return res;
      await delay(intervalMs, undefined, { signal: controller.signal });
    }
  } catch (error) {
    if (controller.signal.aborted) {
      error = new Error(`${timedOut ? 'Wait timed out' : 'Interrupted'}; remote work continues. Resume with: ${resume}`);
      error.exitCode = timedOut ? EXIT.NETWORK : EXIT.INTERRUPTED;
    }
    throw error;
  } finally { clearTimeout(timer); process.removeListener('SIGINT', interrupt); }
}

function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let val = bytes / 1024;
  let unit = 0;
  while (val >= 1024 && unit < units.length - 1) { val /= 1024; unit++; }
  return `${val >= 10 ? val.toFixed(1) : val.toFixed(2)} ${units[unit]}`;
}

export function extractSynchronization(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.synchronization && typeof data.synchronization === 'object') return data.synchronization;
  if (data.runtime_observation?.synchronization && typeof data.runtime_observation.synchronization === 'object') {
    return data.runtime_observation.synchronization;
  }
  return null;
}

const HYGIENE_ACTIONS = Object.freeze({
  high_file_count: (sessionId) =>
    `Pack bulk directories into a compressed archive before finishing: ariax forge pack ${sessionId || 'SESSION'} --src /scratch/<run> --dest /workspace/archives/<name>.tar.zst --wait --json`,
  high_small_file_count: (sessionId, details) => {
    const rawPath = typeof details?.path === 'string' && details.path.trim() ? details.path.trim() : null;
    const src = rawPath ? (rawPath.startsWith('/') ? rawPath : `/${rawPath}`) : '/workspace/<dir>';
    const slug = rawPath ? rawPath.replace(/^\/+|\/+$/g, '').split('/').pop() || 'archive' : 'archive';
    return `Pack high-file-count directory into a compressed archive before finishing: ariax forge pack ${sessionId || 'SESSION'} --src ${src} --dest /workspace/archives/${slug}.tar.zst --remove-src --wait --json`;
  },
  high_pending_files: (sessionId) =>
    `Use ariax forge finish ${sessionId || 'SESSION'} --wait --json to allow full drain, or pack bulk directories with ariax forge pack.`,
  low_disk_space: (sessionId) =>
    `Remove unneeded intermediates under /scratch or pack and remove raw outputs with ariax forge pack ${sessionId || 'SESSION'} --src /scratch/<run> --dest /workspace/archives/<name>.tar.zst --remove-src --wait --json`,
  symlink_blocks_sync: () =>
    'Replace symlinks under /workspace with regular files or move them to /scratch so synchronization can proceed.',
  file_near_20gib_limit: (sessionId) =>
    `Pack large outputs into sharded archives below the 20 GiB file limit using ariax forge pack ${sessionId || 'SESSION'} --max-shard-gib 10.`,
  scratch_data_not_saved: (sessionId) =>
    `Pack outputs you want to keep with \`ariax forge pack ${sessionId || 'SESSION'} --src /scratch/<run> --dest /workspace/archives/<name>.tar.zst --wait --json\`. If outputs were already packed into /workspace/archives/, no further action is needed.`,
});

export function emitHygieneNotices(ctx, sync, { sessionId, includeScratch = false } = {}) {
  if (!sync || typeof sync !== 'object') return;
  const structured = ctx.json === true || (!ctx.config?.jsonDisabled && Boolean(detectAgentShell(ctx.env)));
  const seenCodes = new Set();
  const scratchBytes = typeof sync.scratch_bytes === 'number' && Number.isFinite(sync.scratch_bytes)
    ? sync.scratch_bytes
    : 0;
  const emit = (code, message, action, details) => {
    const cleanCode = String(code);
    const cleanMessage = redactForgeText(String(message));
    const cleanAction = action ? redactForgeText(String(action)) : undefined;
    const cleanDetails = details && typeof details === 'object' ? redactForgeOutput(details) : undefined;
    if (structured) {
      printProgress(JSON.stringify({
        notice: {
          code: cleanCode,
          message: cleanMessage,
          ...(cleanAction ? { action: cleanAction } : {}),
          ...(cleanDetails ? { details: cleanDetails } : {}),
        },
      }));
    } else {
      printProgress(`warning [${cleanCode}]: ${cleanMessage}${cleanAction ? ` — ${cleanAction}` : ''}`);
    }
  };
  if (Array.isArray(sync.warnings)) {
    for (const warning of sync.warnings) {
      if (!warning || typeof warning !== 'object' || typeof warning.code !== 'string' || !warning.code.trim()) continue;
      const code = warning.code.trim();
      if (code === 'scratch_data_not_saved' && scratchBytes <= 0) continue;
      seenCodes.add(code);
      const message = typeof warning.message === 'string' && warning.message.trim() ? warning.message.trim() : code;
      const details = warning.details && typeof warning.details === 'object' ? warning.details : undefined;
      const action = typeof warning.action === 'string' && warning.action.trim()
        ? warning.action.trim()
        : HYGIENE_ACTIONS[code]?.(sessionId, details);
      emit(code, message, action, details);
    }
  }
  if (includeScratch && !seenCodes.has('scratch_data_not_saved') && scratchBytes > 0) {
    emit(
      'scratch_data_not_saved',
      `/scratch contains ${formatBytes(scratchBytes)} of ephemeral data that will not be saved after session release.`,
      HYGIENE_ACTIONS.scratch_data_not_saved(sessionId),
      { scratch_bytes: scratchBytes },
    );
  }
}

export async function observeSessionSync(
  ctx,
  sessionId,
  sessionPath,
  initialData = null,
  { tryDirect = false, propagateAuthErrors = false } = {},
) {
  const fromInitial = extractSynchronization(initialData);
  if (fromInitial) return fromInitial;

  const hasSessionShape = Boolean(
    initialData
    && typeof initialData === 'object'
    && (initialData.session_id === sessionId || isUUID(initialData.project_id)),
  );
  let sessionData = hasSessionShape ? initialData : null;
  if (!sessionData) {
    try {
      const res = await ctx.client.get(sessionPath, { attempts: 1 });
      sessionData = res.data;
      const fromSession = extractSynchronization(sessionData);
      if (fromSession) return fromSession;
    } catch (error) {
      if (propagateAuthErrors && error instanceof ApiError && [401, 403, 404].includes(error.status)) {
        throw error;
      }
    }
  }

  if (sessionData && !['closed', 'failed'].includes(sessionData.state) && isUUID(sessionData.project_id)) {
    try {
      const filesStatus = await ctx.client.get(`${API}/projects/${sessionData.project_id}/files/status`, { attempts: 1 });
      const fromFilesStatus = extractSynchronization(filesStatus.data);
      if (fromFilesStatus) return fromFilesStatus;
    } catch { /* Control-plane file status telemetry is best-effort. */ }
  }

  const canDirect = sessionData ? sessionData.state === 'available' : tryDirect;
  if (canDirect && (tryDirect || hasCachedForgeConnection(ctx, sessionId))) {
    try {
      const direct = await forgeRequest(ctx, sessionId, 'GET', '/v1/session');
      const fromDirect = extractSynchronization(direct.data);
      if (fromDirect) return fromDirect;
    } catch { /* Direct daemon lookup is best-effort. */ }
  }
  return null;
}

function tailLimit(value) {
  if (value === undefined) return DEFAULT_WATCH_TAIL_LINES;
  const lines = number(value, 'tail', { integer: true });
  if (lines > MAX_WATCH_TAIL_LINES) throw usageError(`forge: --tail must be an integer 1..${MAX_WATCH_TAIL_LINES}.`);
  return lines;
}

function boundOutputTail(text, maxLines = DEFAULT_WATCH_TAIL_LINES, maxBytes = MAX_WATCH_TAIL_BYTES) {
  if (typeof text !== 'string' || !text.length) return '';
  let clean = redactForgeText(text);
  const trailingNewline = clean.endsWith('\n');
  const body = trailingNewline ? clean.slice(0, -1) : clean;
  const lines = body.split('\n');
  if (lines.length > maxLines) {
    clean = lines.slice(lines.length - maxLines).join('\n') + (trailingNewline ? '\n' : '');
  }
  const buf = Buffer.from(clean, 'utf8');
  if (buf.length > maxBytes) {
    let start = buf.length - maxBytes;
    while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++;
    clean = buf.subarray(start).toString('utf8');
  }
  return clean;
}

function isFailedCommand(command) {
  return ['failed', 'interrupted', 'timed_out'].includes(command?.state)
    || (command?.state === 'succeeded' && typeof command?.exit_code === 'number' && command.exit_code !== 0);
}

function commandFailedError(sessionId, commandId, command, outputTail) {
  const state = command?.state ?? 'failed';
  const exitCode = command?.exit_code;
  const details = {
    command_id: commandId,
    state,
    ...(exitCode !== undefined ? { exit_code: exitCode } : {}),
    ...(outputTail ? { output_tail: outputTail } : {}),
  };
  const failure = new ApiError({
    code: 'command_failed',
    message: `Command ${commandId} is ${state}${typeof exitCode === 'number' ? ` (exit_code=${exitCode})` : ''}${command?.error?.message ? `: ${command.error.message}` : ''}`,
    details,
    retryable: false,
  });
  failure.action = `Inspect ariax forge command ${sessionId} ${commandId} and ariax forge logs ${sessionId} ${commandId}. Keep the same command ID while its outcome is uncertain.`;
  return failure;
}

async function watchCommand(ctx, sessionId, commandId, options = {}) {
  const maxLines = tailLimit(ctx.flags.tail);
  const waitTimeout = ctx.flags['wait-timeout'] ?? ctx.flags.timeout;
  const timeout = options.signal || waitTimeout === undefined ? 0 : localWaitSeconds(waitTimeout, 0, { allowZero: true }) * 1000;
  const controller = options.signal ? null : new AbortController();
  const signal = options.signal ?? controller.signal;
  let interrupted = false;
  const interrupt = () => { if (!signal.aborted) { interrupted = true; controller.abort(); } };
  const timer = timeout ? setTimeout(() => controller.abort(), timeout) : undefined;
  if (controller) process.once('SIGINT', interrupt);
  let cursor;
  let rollingTail = '';
  printProgress(`Waiting. Resume with: ariax forge watch ${sessionId} ${commandId}`);
  try {
    for (;;) {
      const result = await forgeRequest(ctx, sessionId, 'GET', `/v1/commands/${commandId}/logs`, {
        query: { wait_seconds: 25, ...(cursor ? { cursor } : { tail: maxLines }) }, signal,
      });
      cursor = result.data.next_cursor;
      if (result.data.gap) {
        printProgress('An output interval is unavailable; the retained tail follows.');
        rollingTail = '';
      }
      if (typeof result.data.text === 'string' && result.data.text.length) {
        rollingTail = boundOutputTail(rollingTail + result.data.text, maxLines, MAX_WATCH_TAIL_BYTES);
      }
      const command = result.data.command;
      remember(ctx, commandId, `/v1/commands/${commandId}`, command);
      if (isFailedCommand(command)) throw commandFailedError(sessionId, commandId, command, rollingTail);
      if (TERMINAL_COMMANDS.has(command.state)) {
        return { ...result, data: { ...command, ...(rollingTail ? { output_tail: rollingTail } : {}) } };
      }
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
  let result;
  if (current && TERMINAL_COMMANDS.has(current.data?.state)) {
    let outputTail = typeof current.data.output_tail === 'string' ? current.data.output_tail : '';
    if (!outputTail) {
      try {
        const maxLines = tailLimit(ctx.flags.tail);
        const logsRes = current.retained
          ? await ctx.client.get(`${API}/sessions/${session}/commands/${id}/logs`, { query: { tail: maxLines }, signal })
          : await forgeRequest(ctx, session, 'GET', `/v1/commands/${id}/logs`, { query: { tail: maxLines, wait_seconds: 0 }, signal });
        if (typeof logsRes.data?.text === 'string' && logsRes.data.text.length) {
          outputTail = boundOutputTail(logsRes.data.text, maxLines, MAX_WATCH_TAIL_BYTES);
        }
      } catch { /* Preserve command outcome when log tail cannot be read. */ }
    }
    result = { ...current, data: { ...current.data, ...(outputTail ? { output_tail: outputTail } : {}) } };
  } else {
    result = await watchCommand(ctx, session, id, { signal });
  }
  if (isFailedCommand(result.data)) throw commandFailedError(session, id, result.data, result.data.output_tail);
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
  let lastLine;
  for (;;) {
    validateFinish(result.data,id,session);
    if (result.data.phase === 'completed') { finishOutcome(result.data); return result; }
    const line = `Finish ${id}: ${result.data.phase}; execution ${result.data.execution}; save ${result.data.durability}; release ${result.data.release}`;
    if (line !== lastLine) {
      printProgress(line);
      lastLine = line;
    }
    await delay(3000,undefined,{signal});
    result = await ctx.client.get(`${API}/sessions/${session}/finish`,{signal});
    validateFinish(result.data,id,session);
    if (file && record) saveResult(file,record,result.data);
  }
}

async function waitRecovered(ctx, record, result, kind, account, signal) {
  const id = record.id, session = record.request.session_id;
  if (kind === 'finish') return waitFinish(ctx,id,record.request.path.split('/')[5],result,signal,recordPath(ctx,id,true),record);
  if (kind === 'command') return waitCommandResult(ctx, session, id, signal, result);
  if (kind === 'cancel') return watchCommand(ctx, session, record.request.path.split('/')[3], {signal});
  if (kind === 'input' && result.retained) {
    const error = new ApiError({status:409,code:'input_unavailable',message:`Input ${id} has only a retained observation.`});
    error.action = `Inspect ariax forge inputs status ${session} ${id} --retained. Retained history does not confirm installation in an active workspace.`;
    throw error;
  }
  let lastLine;
  for (;;) {
    const data = result.data;
    if (kind === 'session') {
      if (data.state === 'available' || data.state === 'ready') return result;
      if (['closing','closed','failed'].includes(data.state)) failed('session_unavailable', `Session ${id} is ${data.state}`, data.error);
    } else if (kind === 'close') {
      if (data.state === 'closed' || data.state === 'released') return result;
      if (data.state === 'failed') failed('session_unavailable', `Session closure failed`, data.error);
    } else if (kind === 'selection') {
      const tools = record.request.body.tools.map(name => data.tools?.find(tool => tool.tool === name));
      const failure = tools.find(tool => tool?.state === 'failed');
      if (failure) failed('tool_failed', `Tool ${failure.tool} failed`, failure.error);
      if (tools.every(tool => tool?.state === 'ready')) return result;
    } else if (kind === 'file-deletion') {
      if (data.state === 'failed' || data.cleanup_state === 'attention') failed('file_delete_failed', `File deletion ${id} needs attention`,
        data.error ?? data.failures?.[0]?.error ?? (data.failure_code ? {message:data.failure_code} : undefined),
        'Inspect the file and cleanup status before another action.');
      if (data.state === 'deleted' && ['complete','unknown'].includes(data.cleanup_state)) return result;
    } else if (kind === 'file-hydration') {
      if (data.state === 'failed') failed('file_hydration_failed', `File hydration ${id} failed`, data.error, 'Inspect the local path and saved file before retrying.');
      if (data.state === 'ready') return result;
    } else if (kind === 'file-recovery') {
      if (data.state === 'failed') failed('file_recovery_failed',`File recovery ${id} failed`,data.error,
        `Inspect the destination and operation ${id} before another action.`);
      if (['ready','saved'].includes(data.state)) return result;
    } else if (kind === 'sync' || kind === 'input') {
      if (data.state === 'failed' && kind === 'sync') failedSync(id,session,data);
      if (data.state === 'failed') failed('input_failed', `Input ${id} failed`, data.error,
        `Inspect the same input ID before starting a new operation.`);
      if (data.state === (kind === 'sync' ? 'saved' : 'ready')) return result;
    } else throw usageError(`Waiting is not supported for saved operation ${id}.`);
    const line = `Waiting for saved operation ${id}: ${data.state ?? 'pending'}`;
    if (line !== lastLine) {
      printProgress(line);
      lastLine = line;
    }
    await delay(kind === 'file-recovery' ? Math.max(1000,(data.retry_after ?? 3)*1000) : 3000, undefined, {signal});
    if (kind === 'session') result = await ctx.client.get(`${API}/sessions/${id}`, {signal});
    else if (kind === 'close') result = await ctx.client.get(record.request.path.slice(0,-'/close'.length), {signal});
    else if (kind === 'selection') result = await forgeRequest(ctx,session,'GET','/v1/session',{signal});
    else if (kind === 'input') result = await inputStatus(ctx,session,id,{signal,account});
    else if (kind === 'file-recovery' || kind === 'file-deletion') result = await recoverFile(ctx,id,readRecordFor(ctx,id) ?? record,{signal,account});
    else if (kind === 'file-hydration') result = await forgeRequest(ctx,session,'GET',`/v1/files/hydrate/${id}`,{signal});
    else result = await readSync(ctx,session,id,{signal});
    saveResult(recordPath(ctx,id,true), readRecordFor(ctx,id) ?? record, result.data);
  }
}

export function failed(code, message, error, recovery) {
  const failure = new ApiError({ status: 500, code, message: `${message}${error?.message ? `: ${error.message}` : ''}`, retryable: false });
  if (recovery) failure.action = recovery;
  throw failure;
}

function posixQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function validatePackPath(value, flag, { allowScratch }) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 1024
      || value.includes('\\') || /[\x00-\x1f\x7f]/.test(value)) {
    throw usageError(`forge pack: --${flag} must be an absolute POSIX path without control characters or backslashes.`);
  }
  const normalized = allowScratch && value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value;
  const pattern = allowScratch ? /^\/(scratch|workspace)\// : /^\/workspace\//;
  if (!pattern.test(normalized)) {
    throw usageError(allowScratch
      ? `forge pack: --${flag} must be a path under /scratch/ or /workspace/ (root directories are not allowed).`
      : `forge pack: --${flag} must be a file path under /workspace/ (root /workspace is not allowed).`);
  }
  if (!allowScratch && value.endsWith('/')) {
    throw usageError(`forge pack: --${flag} must name an archive file, not end with '/'.`);
  }
  const parts = normalized.slice(1).split('/');
  if (parts.length < 2 || parts.some((part) => !part || part === '.' || part === '..' || Buffer.byteLength(part) > 255)) {
    throw usageError(`forge pack: --${flag} cannot contain empty, dot, or traversal components.`);
  }
  return normalized;
}

function buildPackScript({ src, dest, format, explicitFormat, maxShardGib, removeSrc, noManifest, packId }) {
  return [
    'set -euo pipefail',
    `SRC=${posixQuote(src)}`,
    `DEST=${posixQuote(dest)}`,
    `FORMAT=${posixQuote(format)}`,
    `EXPLICIT_FORMAT=${posixQuote(explicitFormat ? '1' : '0')}`,
    `MAX_SHARD_GIB=${posixQuote(String(maxShardGib))}`,
    `REMOVE_SRC=${posixQuote(removeSrc ? '1' : '0')}`,
    `NO_MANIFEST=${posixQuote(noManifest ? '1' : '0')}`,
    `PACK_ID=${posixQuote(packId)}`,
    'if [ ! -e "$SRC" ]; then',
    '  echo "pack error: source path does not exist: $SRC" >&2',
    '  exit 2',
    'fi',
    'STAGE="/scratch/.ariax-pack-${PACK_ID}"',
    'mkdir -p "$STAGE"',
    'trap \'rm -rf "$STAGE"\' EXIT',
    'PARENT="$(dirname "$SRC")"',
    'BASE="$(basename "$SRC")"',
    'python3 - "$SRC" "$PARENT" "$STAGE/files.lst" "$STAGE/stats.json" <<\'PY\'',
    'import json, os, stat, sys',
    'src, parent, list_path, stats_path = sys.argv[1:5]',
    'entries = []',
    'file_count = 0',
    'uncompressed_bytes = 0',
    'skipped = 0',
    'visited_dirs = set()',
    'def add_rel(full_path):',
    '    rel = os.path.relpath(full_path, parent)',
    '    if rel.startswith("-"):',
    '        rel = "./" + rel',
    '    entries.append(rel)',
    'def walk_entry(full_path):',
    '    global file_count, uncompressed_bytes, skipped',
    '    try:',
    '        st = os.stat(full_path)',
    '    except OSError:',
    '        skipped += 1',
    '        return',
    '    mode = st.st_mode',
    '    if stat.S_ISREG(mode):',
    '        add_rel(full_path)',
    '        file_count += 1',
    '        uncompressed_bytes += st.st_size',
    '    elif stat.S_ISDIR(mode):',
    '        key = (st.st_dev, st.st_ino)',
    '        if key in visited_dirs:',
    '            skipped += 1',
    '            return',
    '        visited_dirs.add(key)',
    '        children = sorted(os.listdir(full_path))',
    '        before = len(entries)',
    '        for name in children:',
    '            walk_entry(os.path.join(full_path, name))',
    '        if len(entries) == before:',
    '            add_rel(full_path)',
    '    else:',
    '        skipped += 1',
    'walk_entry(src)',
    'with open(list_path, "wb") as f:',
    '    for rel in entries:',
    '        f.write(rel.encode("utf-8") + b"\\0")',
    'with open(stats_path, "w", encoding="utf-8") as f:',
    '    json.dump({"file_count": file_count, "uncompressed_bytes": uncompressed_bytes, "skipped_special_or_broken": skipped}, f)',
    'if skipped:',
    '    sys.stderr.write(f"pack notice: skipped {skipped} broken symlink or special file(s)\\n")',
    'PY',
    'ACTUAL_FORMAT="$FORMAT"',
    'ACTUAL_DEST="$DEST"',
    'if [ "$FORMAT" = "tar.zst" ]; then',
    '  if command -v zstd >/dev/null 2>&1; then',
    '    COMPRESS_CMD=(zstd -T0 -3)',
    '    VERIFY_CMD=(zstd -t)',
    '    DECOMPRESS_CMD=(zstd -dc)',
    '  elif [ "$EXPLICIT_FORMAT" = "1" ]; then',
    '    echo "pack error: zstd is not installed in this image; re-run with --format tar.gz" >&2',
    '    exit 3',
    '  else',
    '    echo "pack notice: zstd not found; falling back to tar.gz" >&2',
    '    ACTUAL_FORMAT="tar.gz"',
    '    if [[ "$ACTUAL_DEST" == *.tar.zst ]]; then',
    '      ACTUAL_DEST="${ACTUAL_DEST%.tar.zst}.tar.gz"',
    '    elif [[ "$ACTUAL_DEST" != *.tar.gz && "$ACTUAL_DEST" != *.tgz ]]; then',
    '      ACTUAL_DEST="${ACTUAL_DEST}.tar.gz"',
    '    fi',
    '    if command -v pigz >/dev/null 2>&1; then COMPRESS_CMD=(pigz); else COMPRESS_CMD=(gzip); fi',
    '    VERIFY_CMD=(gzip -t)',
    '    DECOMPRESS_CMD=(gzip -dc)',
    '  fi',
    'else',
    '  if command -v pigz >/dev/null 2>&1; then COMPRESS_CMD=(pigz); else COMPRESS_CMD=(gzip); fi',
    '  VERIFY_CMD=(gzip -t)',
    '  DECOMPRESS_CMD=(gzip -dc)',
    'fi',
    'if [ -d "$ACTUAL_DEST" ]; then',
    '  echo "pack error: destination path is an existing directory: $ACTUAL_DEST" >&2',
    '  exit 2',
    'fi',
    'if [ -s "$STAGE/files.lst" ]; then',
    '  tar -C "$PARENT" --dereference --no-recursion --null -T "$STAGE/files.lst" -cf - | "${COMPRESS_CMD[@]}" > "$STAGE/archive.tmp"',
    'else',
    '  tar -C "$PARENT" --no-recursion -cf - "$BASE" | "${COMPRESS_CMD[@]}" > "$STAGE/archive.tmp"',
    'fi',
    '"${VERIFY_CMD[@]}" "$STAGE/archive.tmp"',
    '"${DECOMPRESS_CMD[@]}" "$STAGE/archive.tmp" | tar -tf - > "$STAGE/entries.txt"',
    'COMPRESSED_BYTES="$(python3 -c \'import os, sys; print(os.path.getsize(sys.argv[1]))\' "$STAGE/archive.tmp")"',
    'MAX_SHARD_BYTES=$((MAX_SHARD_GIB * 1024 * 1024 * 1024))',
    'SHARDED=0',
    'if [ "$COMPRESSED_BYTES" -gt "$MAX_SHARD_BYTES" ]; then',
    '  SHARDED=1',
    '  split -b "${MAX_SHARD_GIB}G" -d -a 3 "$STAGE/archive.tmp" "$STAGE/archive.part"',
    '  python3 - "$COMPRESSED_BYTES" "$STAGE"/archive.part* <<\'PY\'',
    'import os, sys',
    'expected = int(sys.argv[1])',
    'total = sum(os.path.getsize(p) for p in sys.argv[2:])',
    'if total != expected:',
    '    sys.stderr.write(f"pack error: shard byte total {total} != archive size {expected}\\n")',
    '    sys.exit(4)',
    'PY',
    '  rm -f "$STAGE/archive.tmp"',
    'fi',
    'python3 - "$SRC" "$ACTUAL_DEST" "$ACTUAL_FORMAT" "$SHARDED" "$COMPRESSED_BYTES" "$NO_MANIFEST" "$REMOVE_SRC" "$STAGE/stats.json" "$STAGE/entries.txt" "$STAGE/manifest.json" "$STAGE/summary.json" "$STAGE" <<\'PY\'',
    'import glob, json, os, sys',
    'src, dest, fmt, sharded_s, comp_s, no_manifest_s, remove_src_s, stats_path, entries_path, manifest_path, summary_path, stage = sys.argv[1:13]',
    'sharded = sharded_s == "1"',
    'no_manifest = no_manifest_s == "1"',
    'remove_src = remove_src_s == "1"',
    'stats = json.load(open(stats_path, encoding="utf-8"))',
    'sample = []',
    'with open(entries_path, encoding="utf-8", errors="replace") as f:',
    '    for line in f:',
    '        line = line.rstrip("\\r\\n")',
    '        if line:',
    '            sample.append(line)',
    '            if len(sample) >= 50:',
    '                break',
    'shards = []',
    'if sharded:',
    '    for p in sorted(glob.glob(os.path.join(stage, "archive.part*"))):',
    '        suffix = os.path.basename(p).split("archive.", 1)[1]',
    '        shards.append(f"{dest}.{suffix}")',
    'manifest = {',
    '    "src": src,',
    '    "dest": dest,',
    '    "format": fmt,',
    '    "sharded": sharded,',
    '    "shards": shards,',
    '    "file_count": stats["file_count"],',
    '    "uncompressed_bytes": stats["uncompressed_bytes"],',
    '    "compressed_bytes": int(comp_s),',
    '    "sample_entries": sample,',
    '}',
    'if not no_manifest:',
    '    with open(manifest_path, "w", encoding="utf-8") as f:',
    '        json.dump(manifest, f, indent=2)',
    '        f.write("\\n")',
    'summary = {**manifest, "manifest_path": None if no_manifest else f"{dest}.manifest.json", "removed_src": remove_src}',
    'with open(summary_path, "w", encoding="utf-8") as f:',
    '    json.dump(summary, f)',
    '    f.write("\\n")',
    'PY',
    'mkdir -p "$(dirname "$ACTUAL_DEST")"',
    'if [ "$SHARDED" = "1" ]; then',
    '  for p in "$STAGE"/archive.part*; do',
    '    base="$(basename "$p")"',
    '    suffix="${base#archive.}"',
    '    mv -f "$p" "${ACTUAL_DEST}.${suffix}"',
    '  done',
    'else',
    '  if [ -d "$ACTUAL_DEST" ]; then',
    '    echo "pack error: destination path is an existing directory: $ACTUAL_DEST" >&2',
    '    exit 2',
    '  fi',
    '  mv -f "$STAGE/archive.tmp" "$ACTUAL_DEST"',
    'fi',
    'if [ "$NO_MANIFEST" = "0" ]; then',
    '  mv -f "$STAGE/manifest.json" "${ACTUAL_DEST}.manifest.json"',
    'fi',
    'if [ "$REMOVE_SRC" = "1" ]; then',
    '  rm -rf "$SRC"',
    'fi',
    'cat "$STAGE/summary.json"',
  ].join('\n');
}

async function waitSessionReady(ctx, sessionId, initialResult, signal) {
  let result = initialResult;
  const record = readRecordFor(ctx, sessionId);
  const writeFile = record ? recordPath(ctx, sessionId, true) : null;
  let lastState;
  let attempt = 0;
  for (;;) {
    const state = result.data?.state;
    if (state === 'available' || state === 'ready') return result;
    if (['closing', 'closed', 'failed'].includes(state)) {
      failed('session_unavailable', `Session ${sessionId} is ${state}`, result.data?.error);
    }
    if (state !== lastState) {
      printProgress(`Waiting for session ${sessionId}: ${redactForgeText(String(state ?? 'pending'))}`);
      lastState = state;
    }
    const waitMs = Math.min(3000, Math.round(1000 * Math.pow(1.5, attempt)));
    attempt += 1;
    await delay(waitMs, undefined, { signal });
    result = await ctx.client.get(`${API}/sessions/${sessionId}`, {
      query: ctx.flags?.details ? undefined : { view: 'summary' },
      signal,
    });
    if (record && writeFile) saveResult(writeFile, record, result.data);
  }
}

async function waitSessionClosed(ctx, sessionId, sessionPath, closeId, initialResult, signal) {
  let result = initialResult;
  const record = readRecordFor(ctx, closeId);
  const writeFile = record ? recordPath(ctx, closeId, true) : null;
  let lastState;
  let attempt = 0;
  for (;;) {
    const state = result.data?.state;
    if (state === 'closed' || state === 'released') return result;
    if (state === 'failed') {
      failed('session_unavailable', `Session ${sessionId} closure failed`, result.data?.error);
    }
    if (state !== lastState) {
      printProgress(`Waiting for session ${sessionId} closure: ${redactForgeText(String(state ?? 'closing'))}`);
      lastState = state;
    }
    const waitMs = Math.min(3000, Math.round(1000 * Math.pow(1.5, attempt)));
    attempt += 1;
    await delay(waitMs, undefined, { signal });
    result = await ctx.client.get(sessionPath, { signal });
    remember(ctx, sessionId, sessionPath, result.data);
    if (record && writeFile) saveResult(writeFile, record, result.data);
  }
}

async function runAction(ctx) {
  const action = actionOf(ctx.positionals);
  const flags = ctx.flags;
  if (action === 'create' || action === 'resume') {
    if (flags['wait-timeout'] !== undefined && !flags.wait) {
      throw usageError(`forge ${action}: --wait-timeout requires --wait.`);
    }
    const sessionId = flags['session-id'] === undefined ? randomUUID() : uuid(flags['session-id'], 'session ID');
    const resuming = action === 'resume';
    const projectId = resuming ? uuid(ctx.positionals[1], 'project ID') : undefined;
    let revision;
    if (resuming) {
      if (flags['control-revision'] !== undefined) revision = number(flags['control-revision'], 'control-revision', { integer: true, zero: true });
      else {
        const prior = readRecordFor(ctx,sessionId);
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
    let hydratePaths;
    if (flags.hydrate !== undefined) {
      const paths = [...new Set((Array.isArray(flags.hydrate) ? flags.hydrate : [flags.hydrate]).map(value => workspacePath(value, true)))].sort();
      hydratePaths = paths.filter((value, index) => !paths.slice(0,index).some(parent => value.startsWith(parent + '/')));
      if (!hydratePaths.length || hydratePaths.length > 64) throw usageError('forge resume: select at most 64 distinct paths.');
    }
    const body = { session_id: sessionId, files_contract: 2, ...sessionOptions(flags),
      ...(resuming ? { expected_control_revision: revision, ...(hydratePaths ? { hydrate_paths: hydratePaths } : {}) }
        : { name: required(flags.name, 'name') }) };
    const destination = resuming ? `${API}/projects/${projectId}/sessions` : `${API}/sessions`;
    const request = { method: 'POST', path: destination, body };
    const recovery = `Inspect ariax forge status ${sessionId}; retry the same ${action} request with --session-id ${sessionId}, identical fields, and the same --root-dir, account, and API origin.`;
    if (!flags.wait) {
      const created = await submit(ctx, sessionId, request, 'session_id', recovery);
      return report(ctx, { ...created, data: compactSessionPayload(created.data, flags.details) });
    }
    const seconds = localWaitSeconds(flags['wait-timeout'], 1800);
    return controlled(ctx, sessionId, seconds, async (signal) => {
      const created = await submit(ctx, sessionId, request, 'session_id', recovery, { signal });
      const ready = await waitSessionReady(ctx, sessionId, created, signal);
      return report(ctx, { ...ready, data: compactSessionPayload(ready.data, flags.details) });
    }, { resume: `ariax forge status ${sessionId}` });
  }
  if (action === 'catalog') {
    const task = flags.task === undefined ? undefined : required(flags.task, 'task');
    if (flags.compact && (flags.details || flags.full)) {
      throw usageError('forge catalog: --compact cannot be combined with --full or --details.');
    }
    const selectedTool = flags.tool === undefined ? undefined : required(flags.tool, 'tool');
    const model = flags.model === undefined ? undefined : required(flags.model, 'model');
    const mode = flags.mode === undefined ? undefined : required(flags.mode, 'mode');
    const selected = model !== undefined || mode !== undefined;
    if (selected && selectedTool === undefined) throw usageError('forge catalog: --model/--mode require --tool.');
    if (selected && (flags.compact || flags.details || flags.full)) {
      throw usageError('forge catalog: --model/--mode cannot be combined with --compact, --full, or --details.');
    }
    if (flags['with-guide'] && selectedTool === undefined) {
      throw usageError('forge catalog: --with-guide requires --tool.');
    }
    if (flags.query !== undefined && flags.search !== undefined && String(flags.query) !== String(flags.search)) {
      throw usageError('forge catalog: pass only one of --query or --search.');
    }
    const q = flags.query !== undefined ? required(flags.query, 'query')
      : (flags.search !== undefined ? required(flags.search, 'search') : undefined);
    const modality = flags.modality === undefined ? undefined : required(flags.modality, 'modality');
    const tier = flags.tier === undefined ? undefined : required(flags.tier, 'tier');
    const isFull = flags.full === true || flags.details === true;
    const includeAll = flags.all === true;

    let response;
    let tools;
    if (selectedTool !== undefined) {
      let usedFallback = false;
      try {
        response = await catalogGet(ctx, `${API}/catalog/${encodeURIComponent(selectedTool)}`, {
          query: {
            ...(model !== undefined ? { model } : {}),
            ...(mode !== undefined ? { mode } : {}),
            dedupe: 1,
          },
        });
        const raw = response.data;
        if (Array.isArray(raw?.tools)) tools = raw.tools;
        else if (raw?.tool && typeof raw.tool === 'object') tools = [raw.tool];
        else if (raw && typeof raw === 'object' && typeof raw.tool === 'string') tools = [raw];
        else tools = [];
      } catch (error) {
        if (error instanceof ApiError && error.status === 404
            && !['unknown_tool', 'unknown_model', 'unknown_mode'].includes(error.code)) {
          usedFallback = true;
          response = await catalogGet(ctx, `${API}/catalog`);
          tools = (Array.isArray(response.data?.tools) ? response.data.tools : [])
            .filter(tool => tool.tool === selectedTool);
        } else {
          throw error;
        }
      }
      if (!tools.length) throw usageError(`forge catalog: tool "${selectedTool}" is not in the current catalog.`);
      if (task !== undefined) tools = tools.filter(tool => tool.capabilities?.tasks?.includes(task));
      if (selected && usedFallback) tools = tools.map(tool => selectedCatalogTool(tool, model, mode));
      if (flags.compact) tools = tools.map(compactCatalogTool);
      response.data = { tools };
      if (flags['with-guide'] && tools.length === 1) {
        const guideId = tools[0].capabilities?.guide || tools[0].tool;
        try {
          const guide = readForgeToolGuide(guideId);
          response.data.guide_id = guide.id;
          response.data.guide_path = guide.path;
          response.data.guide_size_bytes = guide.size_bytes;
          response.data.guide_content = guide.content;
        } catch (err) {
          response.data.guide_error = err?.message || `No bundled guide found for "${guideId}".`;
        }
      }
      return report(ctx, response, 'catalog');
    }

    const catalogQuery = {
      view: isFull ? 'full' : 'summary',
      ...(task !== undefined ? { task } : {}),
      ...(q !== undefined ? { q } : {}),
      ...(modality !== undefined ? { modality } : {}),
      ...(tier !== undefined ? { tier } : {}),
      ...(includeAll ? { include_all: 'true' } : {}),
    };
    response = await catalogGet(ctx, `${API}/catalog`, { query: catalogQuery });
    const rawToolsBeforeFilter = Array.isArray(response.data?.tools) ? response.data.tools : [];
    tools = rawToolsBeforeFilter;
    const serverFiltered = response.meta?.view === 'summary' || response.meta?.view === 'full';
    if (!serverFiltered) {
      if (task !== undefined) tools = tools.filter(tool => tool.capabilities?.tasks?.includes(task));
      if (tier !== undefined) tools = tools.filter(tool => tool.tier === tier);
      if (!includeAll && tier === undefined) {
        tools = tools.filter(tool => !['experimental', 'legacy'].includes(tool.tier));
      }
      if (modality !== undefined) {
        const needle = modality.toLowerCase();
        tools = tools.filter(tool =>
          (Array.isArray(tool.modalities) && tool.modalities.some(m => String(m).toLowerCase().includes(needle)))
          || (Array.isArray(tool.capabilities?.tasks) && tool.capabilities.tasks.some(tk => String(tk).toLowerCase().includes(needle)))
          || String(tool.summary || tool.name || '').toLowerCase().includes(needle));
      }
      if (q !== undefined) {
        const needle = q.toLowerCase();
        tools = tools.filter(tool => {
          const hay = [
            tool.tool, tool.name, tool.summary,
            ...(Array.isArray(tool.modalities) ? tool.modalities : []),
            ...(Array.isArray(tool.inputs) ? tool.inputs : []),
            ...(Array.isArray(tool.outputs) ? tool.outputs : []),
            ...(Array.isArray(tool.capabilities?.tasks) ? tool.capabilities.tasks : []),
          ].filter(Boolean).join(' ').toLowerCase();
          return hay.includes(needle);
        });
      }
    }
    if (!isFull) tools = tools.map(compactCatalogTool);
    let availableTasks;
    if (task !== undefined && tools.length === 0) {
      if (Array.isArray(response.meta?.available_tasks) && response.meta.available_tasks.length) {
        availableTasks = [...new Set(response.meta.available_tasks.filter(v => typeof v === 'string' && v.trim()))].sort();
      } else {
        let taskSource = rawToolsBeforeFilter;
        if (serverFiltered || !taskSource.length) {
          try {
            const fullCat = await catalogGet(ctx, `${API}/catalog`, { query: { view: 'summary', include_all: 'true' }, attempts: 1 });
            if (Array.isArray(fullCat.data?.tools) && fullCat.data.tools.length) taskSource = fullCat.data.tools;
          } catch { /* fallback below */ }
        }
        const discovered = [...new Set(taskSource.flatMap(t => Array.isArray(t?.capabilities?.tasks) ? t.capabilities.tasks : []).filter(v => typeof v === 'string' && v.trim()))].sort();
        availableTasks = discovered.length ? discovered : [...KNOWN_CATALOG_TASKS];
      }
      response.meta = {
        ...(response.meta || {}),
        available_tasks: availableTasks,
      };
    }
    response.data = {
      ...response.data,
      tools,
      ...(availableTasks ? {
        available_tasks: availableTasks,
        hint: `No Forge tools matched task "${task}". Available tasks: ${availableTasks.join(', ')}.`,
      } : {}),
    };
    return report(ctx, response, 'catalog');
  }
  if (action === 'summary') {
    const id = uuid(ctx.positionals[1], 'project ID');
    return runForgeSummary(ctx, id);
  }
  if (action === 'project' || action === 'activity') {
    const id = action === 'project'
      ? await resolveProjectId(ctx.client, ctx.positionals[1])
      : uuid(ctx.positionals[1], 'project ID');
    const limit = flags.limit === undefined ? undefined : number(flags.limit, 'limit', { integer: true });
    if (limit > 100) throw usageError(`forge ${action}: --limit must be an integer 1..100.`);
    const res = await ctx.client.get(`${API}/projects/${id}${action === 'activity' ? '/activity' : ''}`, { query: {
      limit,
      cursor: flags.cursor === undefined ? undefined : required(flags.cursor, 'cursor'),
      ...(flags.details ? {} : { view: 'summary' }),
    } });
    return action === 'activity' ? report(ctx, res, 'activity')
      : report(ctx, { ...res, data: { ...res.data, project_url: projectUrl(ctx, id) } });
  }
  if (action === 'list') {
    const stateFilter = flags.state === undefined ? undefined : required(flags.state, 'state');
    const nameFilter = flags.name === undefined ? undefined : required(flags.name, 'name');
    const projectFilter = flags.project === undefined ? undefined : uuid(flags.project, 'project ID');
    const limit = flags.limit === undefined ? undefined : number(flags.limit, 'limit', { integer: true });
    if (limit !== undefined && limit > 100) throw usageError('forge list: --limit must be an integer 1..100.');
    const query = {
      ...(flags.details ? {} : { view: 'summary' }),
      ...(flags.active === true ? { active: 'true' } : {}),
      ...(stateFilter !== undefined ? { state: stateFilter } : {}),
      ...(nameFilter !== undefined ? { name: nameFilter } : {}),
      ...(projectFilter !== undefined ? { project_id: projectFilter } : {}),
      ...(limit !== undefined ? { limit } : {}),
    };
    const res = await ctx.client.get(`${API}/sessions`, { query: Object.keys(query).length ? query : undefined });
    let sessions = Array.isArray(res.data?.sessions) ? res.data.sessions : [];
    if (flags.active === true) {
      sessions = sessions.filter(s => !['closed', 'failed'].includes(String(s?.state ?? '').toLowerCase()));
    }
    if (stateFilter !== undefined) {
      const targetState = stateFilter.toLowerCase();
      sessions = sessions.filter(s => String(s?.state ?? '').toLowerCase() === targetState);
    }
    if (nameFilter !== undefined) {
      const needle = nameFilter.toLowerCase();
      sessions = sessions.filter(s => String(s?.name ?? '').toLowerCase().includes(needle));
    }
    if (projectFilter !== undefined) {
      sessions = sessions.filter(s => String(s?.project_id ?? '').toLowerCase() === projectFilter);
    }
    if (limit !== undefined) {
      sessions = sessions.slice(0, limit);
    }
    if (!flags.details) {
      sessions = sessions.map(s => compactSessionPayload(s, false));
    }
    return report(ctx, { ...res, data: { ...res.data, sessions } }, 'sessions');
  }
  if (action === 'operations') {
    const account = await accountIdentity(ctx);
    const entries = listRecordFiles(ctx);
    let unreadable = 0;
    const operations = [];
    for (const entry of entries.slice(0,10000)) {
      try {
        const record = readRecord(entry.file);
        const id = entry.id, kind = savedKind(id,record?.request);
        if (record?.id !== id || !kind || Object.keys(account).some(field => record[field] !== account[field])) continue;
        const session = kind === 'session' ? id : record.request.session_id
          ?? new RegExp(`^${API}/sessions/([0-9a-f-]{36})/`).exec(record.request.path)?.[1];
        operations.push({ operation_id:id, kind, session_id:session ?? null,
          last_observed_state:typeof record.result?.state === 'string' ? record.result.state : record.result ? 'recorded' : 'unconfirmed' });
      } catch { unreadable++; }
    }
    return report(ctx,{data:{operations,truncated:entries.length > 10000,unreadable}},'operations');
  }
  if (action === 'recover') {
    const id = uuid(ctx.positionals[1], 'operation ID');
    const found = findRecord(ctx,id), record = found.record;
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
    const tree = record.request.type === 'project-file-delete-tree-v1';
    const seconds = localWaitSeconds(flags['wait-timeout'],tree ? 0 : 60,{allowZero:tree});
    return controlled(ctx,id,seconds,async signal => {
      const account = await accountIdentity(ctx,{signal});
      checkIdentity(record,account,id);
      printProgress(`Recovering saved operation: ${id}`);
      const writeFile = found.legacy ? recordPath(ctx,id,true) : found.file;
      try {
        let result = ['sync','input','file-recovery','file-deletion'].includes(kind)
          ? await recoverFile(ctx,id,record,{signal,account,retryFailedSync:kind === 'sync'})
          : await dispatchSaved(ctx,writeFile,record,account,{previous:true,signal});
        if (kind === 'sync' && result.data?.state === 'failed') failedSync(id,record.request.session_id,result.data);
        if (kind === 'file-recovery' && result.data?.state === 'failed') failed('file_recovery_failed',`File recovery ${id} failed`,result.data.error,
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
  if (['files', 'files recover', 'files delete', 'download', 'link'].includes(action)) {
    const projectId = uuid(ctx.positionals[action === 'files recover' || action === 'files delete' ? 2 : 1], 'project ID');
    return runFiles(ctx, action, undefined, undefined, projectId);
  }
  const sessionId = uuid(ctx.positionals[(action.startsWith('tools ') || action.startsWith('inputs ') || action === 'files hydrate') ? 2 : 1], 'session ID');
  const sessionPath = `${API}/sessions/${sessionId}`;
  if (action === 'files hydrate') {
    if (flags['wait-timeout'] !== undefined && !flags.wait) throw usageError('forge files hydrate: --wait-timeout requires --wait.');
    const id = flags['operation-id'] === undefined ? randomUUID() : uuid(flags['operation-id'], 'operation ID');
    const target = workspacePath(required(flags.path, 'path'));
    const request = {method:'POST', path:'/v1/files/hydrate', session_id:sessionId, body:{operation_id:id,path:target}};
    return controlled(ctx,id,flags.wait ? localWaitSeconds(flags['wait-timeout'],1800) : 60,async signal => {
      let result = await submit(ctx,id,request,'operation_id',`Inspect or retry hydration ${id} with the same ID.`,{signal});
      if (flags.wait) result = await waitRecovered(ctx,readRecord(recordPath(ctx,id)),result,'file-hydration',null,signal);
      if (result.data?.state === 'failed') failed('file_hydration_failed',`File hydration ${id} failed`,result.data.error);
      return report(ctx,result);
    });
  }
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
      const prior = readRecordFor(ctx,id);
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
    return report(ctx, { ...res, data: compactSessionPayload(res.data, flags.details) });
  }
  if (action === 'finish') {
    if (flags['wait-timeout'] !== undefined && !flags.wait) throw usageError('forge finish: --wait-timeout requires --wait.');
    const suppliedId = flags['operation-id'] === undefined ? undefined : uuid(flags['operation-id'],'operation ID');
    const prior = suppliedId ? readRecordFor(ctx,suppliedId) : null;
    if (prior && prior.request?.path !== `${sessionPath}/finish`) throw new ApiError({status:409,code:'request_conflict',message:`Saved operation ${suppliedId} is not this finish request.`});
    const duration = flags['timeout-seconds'] === undefined
      ? prior?.request?.body?.timeout_seconds ?? 3600 : number(flags['timeout-seconds'],'timeout-seconds',{integer:true});
    if (!Number.isSafeInteger(duration) || duration < 1) throw usageError('forge finish: --timeout-seconds must be between 1 and 86400.');
    if (duration > 86400) throw usageError('forge finish: --timeout-seconds must be between 1 and 86400.');
    const preFinishSync = await observeSessionSync(ctx, sessionId, sessionPath, null, { tryDirect: false });
    if (preFinishSync) emitHygieneNotices(ctx, preFinishSync, { sessionId, includeScratch: true });
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
    const res = await submit(ctx, id, { method: 'POST', session_id: sessionId, path: '/v1/tools', body: { selection_id: id, ...selection(flags, true) } }, 'selection_id',
      `Inspect ariax forge tools ${sessionId}; retry with --selection-id ${id}, identical fields, and the same --root-dir, account, and API origin.`);
    return report(ctx, { ...res, data: compactSessionPayload(res.data, flags.details) });
  }
  if (action === 'tools') {
    const res = await forgeRequest(ctx, sessionId, 'GET', '/v1/tools', {
      query: { view: flags.details === true ? 'full' : 'summary' },
    });
    return report(ctx, { ...res, data: compactSessionPayload(res.data, flags.details) }, 'tools');
  }
  if (action === 'status') {
    const res = await ctx.client.get(sessionPath, { query: { view: flags.details === true ? 'full' : 'summary' } });
    remember(ctx, sessionId, sessionPath, res.data);
    const project = await ctx.client.get(`${API}/projects/${uuid(res.data.project_id, 'project ID')}`, { query: { view: 'summary' } });
    const syncInfo = await observeSessionSync(ctx, sessionId, sessionPath, res.data, { tryDirect: false });
    if (syncInfo) emitHygieneNotices(ctx, syncInfo, { sessionId, includeScratch: false });
    const sessionData = compactSessionPayload(res.data, flags.details);
    return report(ctx, { ...res, data: { ...sessionData, project_status: project.data.status,
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
    const matchedTool = res.data.tools.find(t => t.tool === toolName);
    const projectedTool = flags.details ? matchedTool : compactSessionTool(matchedTool);
    return report(ctx, { ...res, data: { session_id: sessionId, ...projectedTool } });
  }
  if (action === 'run') {
    if (flags.tail !== undefined && !flags.wait) throw usageError('forge run: --tail requires --wait.');
    if (flags.tail !== undefined) tailLimit(flags.tail);
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
  if (action === 'pack') {
    if (flags.tail !== undefined && !flags.wait) throw usageError('forge pack: --tail requires --wait.');
    if (flags.tail !== undefined) tailLimit(flags.tail);
    if (flags['wait-timeout'] !== undefined && !flags['wait-ready'] && !flags.wait) {
      throw usageError('forge pack: --wait-timeout requires --wait-ready or --wait.');
    }
    const src = validatePackPath(required(flags.src, 'src'), 'src', { allowScratch: true });
    const dest = validatePackPath(required(flags.dest, 'dest'), 'dest', { allowScratch: false });
    if (dest === src || dest.startsWith(`${src}/`) || src.startsWith(`${dest}/`)) {
      throw usageError('forge pack: --dest cannot equal or overlap --src.');
    }
    const explicitFormat = flags.format !== undefined;
    const format = explicitFormat
      ? required(flags.format, 'format')
      : (dest.endsWith('.tar.gz') || dest.endsWith('.tgz') ? 'tar.gz' : 'tar.zst');
    if (!['tar.zst', 'tar.gz'].includes(format)) {
      throw usageError(`forge pack: --format must be tar.zst or tar.gz (got "${format}").`);
    }
    const maxShardGib = flags['max-shard-gib'] === undefined
      ? 10
      : number(flags['max-shard-gib'], 'max-shard-gib', { integer: true });
    if (maxShardGib < 1 || maxShardGib > 18) {
      throw usageError('forge pack: --max-shard-gib must be an integer between 1 and 18.');
    }
    const commandId = flags['operation-id'] === undefined ? randomUUID() : uuid(flags['operation-id'], 'operation ID');
    const script = buildPackScript({
      src,
      dest,
      format,
      explicitFormat,
      maxShardGib,
      removeSrc: flags['remove-src'] === true,
      noManifest: flags['no-manifest'] === true,
      packId: commandId,
    });
    const body = {
      command_id: commandId,
      tool: 'base',
      argv: ['bash', '-euo', 'pipefail', '-c', script],
      cwd: '/workspace',
      timeout_seconds: 86400,
    };
    const readiness = flags['wait-ready'] ? { input_ids: [] } : undefined;
    const request = { method: 'POST', session_id: sessionId, path: '/v1/commands', body };
    const recovery = `Inspect ariax forge command ${sessionId} ${commandId}. Keep operation ID ${commandId} while its outcome is uncertain; a fresh pack could duplicate work.`;
    const presentPackResult = (result, waited) => {
      const baseData = result?.data && typeof result.data === 'object' ? { ...result.data } : {};
      if (!flags.details) delete baseData.argv;
      if (waited) {
        const { summary, parsed } = parsePackOutput(baseData.output_tail, {
          src,
          requestedDest: dest,
          format,
          removeSrc: flags['remove-src'] === true,
          noManifest: flags['no-manifest'] === true,
        });
        baseData.pack = summary;
        const succeeded = baseData.state === 'succeeded' && (baseData.exit_code === 0 || baseData.exit_code === undefined);
        if (!flags.details && succeeded && parsed) {
          delete baseData.output_tail;
        }
      }
      return report(ctx, { ...result, data: baseData });
    };
    if (!flags.wait && !readiness) return presentPackResult(await submit(ctx, commandId, request, 'command_id', recovery), false);
    const seconds = localWaitSeconds(flags['wait-timeout'], 1800);
    return controlled(ctx, commandId, seconds, async (signal) => {
      let result = await submit(ctx, commandId, request, 'command_id', recovery, { signal, readiness });
      if (flags.wait) result = await waitCommandResult(ctx, sessionId, commandId, signal, result);
      return presentPackResult(result, flags.wait === true);
    });
  }
  if (action === 'close') {
    if (flags['wait-timeout'] !== undefined && !flags.wait) throw usageError('forge close: --wait-timeout requires --wait.');
    const preCloseSync = await observeSessionSync(ctx, sessionId, sessionPath, null, {
      tryDirect: false,
      propagateAuthErrors: true,
    });
    if (flags.force !== true && preCloseSync) {
      const pendingFiles = typeof preCloseSync.pending_files === 'number' && Number.isFinite(preCloseSync.pending_files) ? preCloseSync.pending_files : 0;
      const pendingBytes = typeof preCloseSync.pending_bytes === 'number' && Number.isFinite(preCloseSync.pending_bytes) ? preCloseSync.pending_bytes : 0;
      if (pendingFiles > CLOSE_PENDING_FILES_LIMIT || pendingBytes > CLOSE_PENDING_BYTES_LIMIT) {
        const guardError = new ApiError({
          status: 409,
          code: 'pending_files_use_finish',
          message: `Session ${sessionId} has ${pendingFiles} pending file(s) (${formatBytes(pendingBytes)}) awaiting sync. \`ariax forge close\` has a 75-second final sync ceiling and may drop unsaved files.`,
          details: {
            session_id: sessionId,
            pending_files: pendingFiles,
            pending_bytes: pendingBytes,
            close_sync_ceiling_seconds: 75,
          },
          retryable: false,
        });
        guardError.action = `Run \`ariax forge finish ${sessionId} --wait --json\` to drain and save all files cleanly, or re-run with \`--force\` to close immediately.`;
        throw guardError;
      }
    }
    const closeId = randomUUID();
    const request = { method: 'POST', path: `${sessionPath}/close`, body: {} };
    const recovery = `Inspect ariax forge status ${sessionId}; repeat ariax forge close ${sessionId} if needed.`;
    if (!flags.wait) {
      const res = await submit(ctx, closeId, request, 'request_id', recovery);
      remember(ctx, sessionId, sessionPath, res.data);
      emitHygieneNotices(ctx, extractSynchronization(res.data) ?? preCloseSync, { sessionId, includeScratch: true });
      return report(ctx, res);
    }
    const seconds = localWaitSeconds(flags['wait-timeout'], 1800);
    return controlled(ctx, closeId, seconds, async (signal) => {
      const submitted = await submit(ctx, closeId, request, 'request_id', recovery, { signal });
      remember(ctx, sessionId, sessionPath, submitted.data);
      const closed = await waitSessionClosed(ctx, sessionId, sessionPath, closeId, submitted, signal);
      emitHygieneNotices(ctx, extractSynchronization(closed.data) ?? preCloseSync, { sessionId, includeScratch: true });
      return report(ctx, closed);
    }, { resume: `ariax forge status ${sessionId}` });
  }
  if (action === 'commands') {
    const viewQuery = { view: flags.details === true ? 'full' : 'summary' };
    const res = flags.retained
      ? await ctx.client.get(`${sessionPath}/commands`, { query: viewQuery })
      : await forgeRequest(ctx, sessionId, 'GET', '/v1/commands', { query: viewQuery });
    return report(ctx, { ...res, data: compactCommandsPayload(res.data, flags.details) }, 'commands');
  }
  const commandId = uuid(ctx.positionals[2], 'command ID');
  const commandPath = `/v1/commands/${commandId}`;
  if (action === 'watch') {
    return report(ctx, await watchCommand(ctx, sessionId, commandId));
  }
  if (action === 'cancel') {
    if (flags['wait-timeout'] !== undefined && !flags.wait) {
      throw usageError('forge cancel: --wait-timeout requires --wait.');
    }
    if (flags.wait && flags['wait-timeout'] !== undefined) {
      localWaitSeconds(flags['wait-timeout'], 1800);
    }
    const cancelId = randomUUID();
    const request = { method: 'POST', session_id: sessionId, path: `${commandPath}/cancel`, body: {} };
    const recovery = `Inspect ariax forge command ${sessionId} ${commandId}; repeat cancellation if needed.`;
    const res = await submit(ctx, cancelId, request, 'request_id', recovery);
    remember(ctx, commandId, commandPath, res.data);
    if (!flags.wait || TERMINAL_COMMANDS.has(res.data?.state)) {
      return report(ctx, res);
    }
    const waitCtx = flags['wait-timeout'] === undefined
      ? { ...ctx, flags: { ...flags, 'wait-timeout': 1800 } }
      : ctx;
    const terminal = await poll(
      waitCtx,
      commandPath,
      commandId,
      (cmd) => ({ state: cmd?.state ?? 'unknown', done: TERMINAL_COMMANDS.has(cmd?.state) }),
      `ariax forge command ${sessionId} ${commandId}`,
      sessionId,
      undefined,
      { intervalMs: 1000 },
    );
    return report(ctx, terminal);
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
  const res = flags.retained
    ? await ctx.client.get(`${sessionPath}/commands/${commandId}`, { query: flags.details ? undefined : { view: 'summary' } })
    : await forgeRequest(ctx, sessionId, 'GET', commandPath);
  remember(ctx, commandId, commandPath, res.data);
  return report(ctx, res);
}

export async function run(ctx) {
  try { return await runAction(ctx); }
  catch (error) {
    const action = actionOf(ctx.positionals);
    let recovered;
    try {
      if (action === 'recover' && isUUID(ctx.positionals[1])) recovered = readRecordFor(ctx,ctx.positionals[1]);
    } catch { /* Keep the original error. */ }
    const recoveredSession = recovered?.request?.session_id
      ?? new RegExp(`^${API}/sessions/([0-9a-f-]{36})/`).exec(recovered?.request?.path ?? '')?.[1];
    if (error.code === 'human_resume_required' || error.code === 'control_revision_conflict') {
      let projectId = isUUID(error.details?.project_id) ? uuid(error.details.project_id, 'project ID') : undefined;
      try {
        if (!projectId && ['resume', 'project', 'summary'].includes(action) && isUUID(ctx.positionals[1])) projectId = uuid(ctx.positionals[1], 'project ID');
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
