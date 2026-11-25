/**
 * Ariax CLI entry: parse args, build config + client, dispatch commands.
 * Core operation uses built-in Node APIs; native keyring support is optional.
 * Exit codes are stable (see exit-codes.js).
 */
import path from 'node:path';
import { detectAgentShell, isNonInteractiveEnv } from './agent-env.js';
import { buildInfo, formatBuildInfo } from './build-info.js';
import { parseArgv, usageError, isUsageError } from './args.js';
import {
  loadConfig,
  requireApiKey,
  requireTrustedApiOrigin,
  supportsStoredCredentials,
} from './config.js';
import { createCredentialStore } from './credentials.js';
import {
  commandTemplateFor,
  evaluateFeedbackOpportunity,
  recordCliError,
  recordFeedbackAdvisory,
} from './error-ring.js';
import { ConnectivityError, ServerTimeoutError, createClient } from './http.js';
import { installStdoutEpipeHandler, parseFieldsOption, printData, printJson, printProgress, setOutputFields } from './output.js';
import { defaultStateDir, resolveWritableStateDir } from './state-dir.js';
import { EXIT } from './exit-codes.js';
import { isUUID } from './uuid.js';
import {
  automaticUpdateNotice,
  formatUpdateNotice,
  shouldRunAutomaticUpdateCheck,
} from './update-check.js';
import * as me from './commands/me.js';
import * as protocols from './commands/protocols.js';
import * as pricing from './commands/pricing.js';
import * as schema from './commands/schema.js';
import * as validate from './commands/validate.js';
import * as submit from './commands/submit.js';
import * as projects from './commands/projects.js';
import * as jobs from './commands/jobs.js';
import * as status from './commands/status.js';
import * as logs from './commands/logs.js';
import * as pause from './commands/pause.js';
import * as restart from './commands/restart.js';
import * as abort from './commands/abort.js';
import * as results from './commands/results.js';
import * as upgrade from './commands/upgrade.js';
import * as login from './commands/login.js';
import * as logout from './commands/logout.js';
import * as skills from './commands/skills.js';
import * as operations from './commands/operations.js';
import * as recover from './commands/recover.js';
import * as candidates from './commands/candidates.js';
import * as runs from './commands/runs.js';
import * as gpuPreferences from './commands/gpu-preferences.js';
import * as inputs from './commands/inputs.js';
import * as feedback from './commands/feedback.js';
import * as forge from './commands/forge.js';
import * as storage from './commands/storage.js';
import * as summary from './commands/summary.js';
import * as discover from './commands/discover.js';

const COMMANDS = {
  discover,
  me, protocols, pricing, schema, validate, submit,
  projects, jobs, status, logs, pause, restart, abort, results, summary, storage, upgrade,
  login, logout,
  skills, operations, recover, inputs, candidates, runs,
  feedback, forge,
  'gpu-preferences': gpuPreferences,
};

// Validate the command surface before config, credential access, or any command work.
// Value/content validation remains with each command.
const COMMAND_OPTIONS = {
  discover: [['query', 'task', 'modality', 'execution', 'all'], 0],
  me: [[], 0],
  protocols: [[], 0],
  pricing: [['details', 'gpu', 'gpu-count', 'all-counts'], 0],
  schema: [['raw', 'kind', 'output', 'o', 'details', 'example'], 1],
  skills: [['read', 'reference', 'doc', 'tool', 'paths', 'details', 'list'], 1],
  validate: [['file', 'f', 'input', 'input-dir', 'details'], 0],
  submit: [['file', 'f', 'name', 'input', 'input-dir', 'input-upload-intent-id', 'wait', 'resume', 'poll-interval', 'wait-timeout', 'details'], 0],
  projects: [['status', 'protocol', 'name', 'limit', 'cursor', 'all', 'details'], 0],
  jobs: [['project', 'status', 'limit', 'cursor', 'all'], 0],
  status: [['wait', 'resume', 'poll-interval', 'wait-timeout', 'details'], 1],
  logs: [['tail', 'log-ref', 'list'], 1],
  pause: [[], 1],
  restart: [['wait', 'poll-interval', 'wait-timeout', 'details'], 1],
  abort: [[], 1],
  feedback: [[
    'category', 'type', 'summary', 'message', 'file', 'f',
    'severity', 'project', 'job', 'session', 'command',
    'protocol', 'tool', 'failed-request-id', 'attach-last-error',
    'operation-id', 'dry-run',
  ], 1],
  operations: [['all-origins'], 1],
  recover: [['wait', 'poll-interval', 'wait-timeout', 'details'], 1],
  'gpu-preferences': [['file', 'example'], 1],
  runs: [['job', 'limit', 'cursor', 'all'], 1],
  candidates: [['view', 'limit', 'cursor', 'all', 'eligible', 'output', 'overwrite', 'details'], 1],
  results: [['path', 'download', 'overwrite', 'limit', 'cursor', 'details'], 1],
  summary: [['top', 'include-sequences'], 1],
  upgrade: [['check', 'yes', 'channel'], 0],
  login: [['with-token', 'insecure-storage'], 0],
  logout: [[], 0],
  help: [[], 3],
};

function validateCommandArguments({ command, positionals, flags }) {
  let options = Object.prototype.hasOwnProperty.call(COMMAND_OPTIONS, command) ? COMMAND_OPTIONS[command] : undefined;
  let label = command || 'ariax';
  if (command === undefined) options = [[], 0];
  if (command === 'projects' && positionals[0] === 'export') {
    options = [['output'], 2];
    label = 'projects export';
  }
  if (command === 'skills' && positionals[0] === 'install') {
    options = [['target', 'scope', 'dry-run', 'yes'], 1];
    label = 'skills install';
  }
  if (command === 'skills' && positionals[0] === 'status') {
    options = [['target', 'scope'], 1];
    label = 'skills status';
  }
  if (command === 'inputs') {
    const action = positionals[0];
    if (!['inspect', 'prepare'].includes(action)) {
      throw usageError('inputs: expected inspect or prepare.');
    }
    options = [action === 'inspect' ? ['input', 'input-dir', 'pdb', 'file', 'residues', 'full', 'details'] : ['input', 'input-dir', 'pdb', 'file', 'output'], 1];
    label = `inputs ${action}`;
  }
  if (!options) return; // Unknown commands are reported by the dispatcher.
  const [allowed, maxOperands] = options;
  for (const name of Object.keys(flags)) {
    if (!allowed.includes(name)) throw usageError(`${label}: unsupported flag --${name}.`);
  }
  if (positionals.length > maxOperands) {
    throw usageError(`${label}: unexpected positional arguments; expected at most ${maxOperands}.`);
  }
}

/** Commands that work without an API key. Credentials are never sent for them. */
const PUBLIC_COMMANDS = new Set(['discover', 'protocols', 'pricing', 'schema', 'skills', 'upgrade', 'login', 'logout', 'inputs']);

/** Whether an invocation runs unauthenticated without requiring an API key. */
export function isPublicInvocation(command, positionals = [], flags = {}) {
  if (PUBLIC_COMMANDS.has(command)) return true;
  if (command === 'forge' && positionals[0] === 'catalog') return true;
  if (command === 'feedback' && flags?.['dry-run'] === true) return true;
  if (command === 'gpu-preferences' && flags?.example === true) return true;
  return false;
}

export function packageVersion() {
  return buildInfo().version;
}

/** Map any thrown error to a stable exit code. Exported for tests. */
export function exitCodeFor(err) {
  if (err && typeof err.exitCode === 'number') return err.exitCode;
  if (isUsageError(err)) return EXIT.USAGE;
  if (err && err.code === 'AUTH') return EXIT.AUTH;
  return EXIT.SERVER;
}

function rejectedApiKeyAction({ command, apiKeySource } = {}) {
  const keyUrl = login.API_KEYS_URL;
  if (command === 'login') {
    const environmentNote = apiKeySource === 'environment'
      ? ' Update or unset ARIAX_API_KEY as well; it overrides saved login.'
      : '';
    return `Create or copy a valid key at ${keyUrl}, then run \`ariax login\` again.${environmentNote}`;
  }
  if (apiKeySource === 'environment') {
    return `Replace ARIAX_API_KEY with a new key from ${keyUrl} in your environment or secret manager, then rerun the command. It overrides saved login.`;
  }
  return `Create or copy a new key at ${keyUrl}, run \`ariax login\` in your terminal to replace the saved key, then rerun the command.`;
}

function isForgeRead({ command, positionals = [] } = {}) {
  if (command !== 'forge') return false;
  const [action, subaction] = positionals;
  return ['catalog', 'list', 'status', 'project', 'summary', 'activity', 'operations', 'commands', 'command', 'watch', 'logs'].includes(action)
    || (action === 'tools' && subaction !== 'add')
    || (action === 'inputs' && ['list', 'status'].includes(subaction))
    || (action === 'files' && !['delete', 'hydrate', 'recover'].includes(subaction));
}

function resolveErrorRootDir(context = {}) {
  if (context?.config?.rootDir) return context.config.rootDir;
  if (typeof context?.globals?.['root-dir'] === 'string' && context.globals['root-dir'].trim()) {
    return path.resolve(context.globals['root-dir']);
  }
  if (Array.isArray(context?.argv)) {
    for (let i = 0; i < context.argv.length; i += 1) {
      const tok = context.argv[i];
      if (tok === '--') break;
      if (tok === '--root-dir' && typeof context.argv[i + 1] === 'string' && context.argv[i + 1].trim()) {
        return path.resolve(context.argv[i + 1]);
      }
      if (tok.startsWith('--root-dir=') && tok.slice('--root-dir='.length).trim()) {
        return path.resolve(tok.slice('--root-dir='.length));
      }
    }
  }
  const env = context?.env ?? process.env;
  if (typeof env?.ARIAX_ROOT_DIR === 'string' && env.ARIAX_ROOT_DIR.trim()) {
    return path.resolve(env.ARIAX_ROOT_DIR);
  }
  try {
    return path.resolve(resolveWritableStateDir({ env }));
  } catch {
    return path.resolve(defaultStateDir({ env }));
  }
}

function reportError(err, jsonMode, authContext) {
  const code = exitCodeFor(err);
  const rejectedApiKey = err?.status === 401;
  const message = rejectedApiKey
    ? 'Ariax rejected the API key. It may have been revoked or rotated.'
    : (err?.message ? String(err.message) : String(err));
  const requestId = err?.requestId;
  const apiCode = typeof err?.code === 'string' ? err.code
    : (rejectedApiKey ? 'invalid_api_key' : undefined);
  let action = err?.action ?? (rejectedApiKey ? rejectedApiKeyAction(authContext) : undefined);
  if (err instanceof ServerTimeoutError) {
    const guidance = err.method === 'GET' || isForgeRead(authContext)
      ? 'Retry shortly or check status; this timeout usually indicates an upstream server/database delay rather than a client network outage.'
      : 'Retry shortly only after checking status or operations to confirm whether the upstream request completed; keep the original operation ID.';
    const forgeGuidance = authContext?.command === 'forge'
      ? 'Remote Forge jobs may still be running; preserve original operation IDs when reconciling admitted work.'
      : undefined;
    action = [guidance, forgeGuidance, action].filter(Boolean).join(' ');
  } else if (err instanceof ConnectivityError) {
    const guidance = err.method === 'GET' || isForgeRead(authContext)
      ? "Check this client's network connection and retry the same read after connectivity returns."
      : "Check this client's network connection. After connectivity returns, inspect the outcome before retrying; keep the original operation ID if work may have been submitted.";
    const forgeGuidance = authContext?.command === 'forge'
      ? 'Remote Forge jobs may still be running; their status is currently unknown. Preserve original operation IDs when reconciling admitted work.'
      : undefined;
    action = [guidance, forgeGuidance, action].filter(Boolean).join(' ');
  }
  if (jsonMode) {
    printJson({
      error: {
        code: apiCode || 'error',
        message,
        retryable: !rejectedApiKey && err?.retryable === true,
        ...(typeof action === 'string' && action ? { action } : {}),
        ...(err?.details === undefined ? {} : { details: err.details }),
      },
      ...(requestId ? { request_id: requestId } : {}),
    });
  } else {
    printProgress(`error: ${message}`);
    if (apiCode && apiCode !== 'ARIAX_USAGE') printProgress(`code: ${apiCode}`);
    if (typeof action === 'string' && action) printProgress(`action: ${action}`);
    for (const issue of err?.details?.issues || []) {
      printProgress(`${issue.field.join('.') || 'job'} [${issue.rule}]: ${issue.message}`);
    }
    if (typeof err?.details?.output_tail === 'string' && err.details.output_tail) {
      printProgress(`output_tail:\n${err.details.output_tail}`);
    }
    if (requestId) printProgress(`request-id: ${requestId}`);
  }

  if (code !== EXIT.OK && code !== EXIT.INTERRUPTED) {
    try {
      const errorRoot = resolveErrorRootDir(authContext);
      const env = authContext?.env ?? process.env;
      const nowMs = Date.now();
      const entry = {
        command_template: commandTemplateFor(authContext?.command, authContext?.positionals),
        exit_code: code,
        error_code: apiCode ?? null,
        http_status: typeof err?.status === 'number' ? err.status : null,
        request_id: requestId ?? null,
        timestamp: new Date(nowMs).toISOString(),
      };
      const buffer = recordCliError(errorRoot, entry, { now: nowMs });
      const recorded = buffer?.entries?.[buffer.entries.length - 1] ?? entry;
      const notice = evaluateFeedbackOpportunity(buffer, recorded, {
        env,
        now: nowMs,
        attemptedCommand: authContext?.command,
      });
      if (notice) {
        recordFeedbackAdvisory(errorRoot, recorded, { now: nowMs });
        printProgress(JSON.stringify({ notice }));
      }
    } catch {
      // Best-effort ring buffer and feedback advisory must never interfere with exit.
    }
  }
  return code;
}

const HELP_TOPICS = {
  discover: 'ariax discover [--query TEXT] [--task TASK] [--modality MODALITY] [--execution managed|forge|all] [--all]',
  forge: forge.help,
  me: 'ariax me',
  protocols: 'ariax protocols',
  pricing: pricing.help,
  schema: `ariax schema <protocol> [--raw] [--details] [--example [TYPE]] [--kind job|submission] [-o, --output FILE]
  Bundled examples include: bindcraft2 (--example pilot|miniprotein|peptide|cyclic-peptide|vhh|scfv|fab|arp|detarget|multistate), boltzgen (--example vhh|peptide|cyclic-peptide|small-molecule|smiles), pxdesign, esmfold2-pipeline, bindcraft-v1.5.`,
  skills: 'ariax skills [protocol|forge] [--list] [--read] [--reference NAME] [--doc NAME] [--tool GUIDE_ID] [--paths] | ariax skills install [--target claude|codex|cursor|antigravity|all] [--scope user|project] [--dry-run] [--yes] | ariax skills status',
  inputs: inputs.help,
  validate: 'ariax validate -f job.json [--input FILE | --input-dir DIR] [--details]',
  submit: 'ariax submit -f job.json --name <name> [--input FILE | --input-dir DIR] [--wait] [--details]',
  operations: 'ariax operations [operation-id] [--all-origins]  (lists current API origin by default; pass --all-origins for all)',
  recover: 'ariax recover <operation-id> [--wait]',
  projects: 'ariax projects [--status s] [--protocol p] [--name n] [--limit N] [--cursor C] [--all] [--details] | ariax projects export PROJECT [-o, --output job.json]',
  jobs: 'ariax jobs [--project <id>] [--status s] [--limit N] [--cursor C] [--all]',
  status: status.help,
  logs: 'ariax logs <job-id> [--list | [--tail N] [--log-ref PATH]]',
  pause: pause.help,
  restart: restart.help,
  'gpu-preferences': gpuPreferences.help,
  abort: abort.help,
  feedback: 'ariax feedback --type bug|agent-friction|docs-gap|missing-capability|technical-support|feature-request|other --summary TEXT (--message TEXT|- | --file FILE) [--severity blocker|high|medium|low] [--project PROJECT] [--job UUID] [--session UUID] [--command UUID] [--protocol P] [--tool T] [--failed-request-id ID] [--attach-last-error] [--operation-id UUID] [--dry-run]',
  runs: 'ariax runs PROJECT [--job JOB_ID] [--limit N] [--cursor TOKEN] [--all]',
  candidates: 'ariax candidates PROJECT [--view final|all|diagnostics] [--limit N] [--cursor TOKEN] [--all] [--eligible] [--output shortlist.json] [--overwrite] [--details]',
  results: 'ariax results PROJECT [--path <artifact-path>] [--download <dir>] [--overwrite] [--limit N] [--cursor TOKEN] [--details]',
  summary: summary.help,
  storage: storage.help,
  upgrade: 'ariax upgrade [--check] [--yes] [--channel github|npm]',
  login: 'ariax login [--with-token] [--insecure-storage]',
  logout: 'ariax logout',
};

function printHelp(topic, subPositionals = []) {
  const commandModule = topic && Object.prototype.hasOwnProperty.call(COMMANDS, topic) ? COMMANDS[topic] : null;
  if (commandModule && Array.isArray(subPositionals) && subPositionals.length > 0 && typeof commandModule.helpFor === 'function') {
    printData(`usage: ${commandModule.helpFor(subPositionals)}`);
    printData('');
    printData('Global flags: --json, --fields <paths>, --base-url <url>, --allow-custom-origin, --root-dir <dir>, --connection-cache-dir <dir>, --timeout <ms>');
    return;
  }
  if (topic && HELP_TOPICS[topic]) {
    printData(`usage: ${HELP_TOPICS[topic]}`);
    printData('');
    printData('Global flags: --json, --fields <paths>, --base-url <url>, --allow-custom-origin, --root-dir <dir>, --connection-cache-dir <dir>, --timeout <ms>');
    if (topic === 'forge') printData('Forge local waits use --wait-timeout SECONDS; --timeout-seconds limits remote execution. For legacy tools wait/watch/sync, --timeout also means local seconds.');
    return;
  }
  printData('usage: ariax <command> [options]');
  printData('');
  printData('Commands:');
  for (const [topicName, line] of Object.entries(HELP_TOPICS)) {
    const display = topicName === 'forge'
      ? 'ariax forge <action> [options] — Custom GPU sessions (list, create, status, tools, inputs, run, sync, pack, finish, files; run ariax help forge)'
      : topicName === 'storage'
        ? 'ariax storage <usage|projects|project|entries|suggest|delete|deletion> [options] (run ariax help storage)'
        : String(line).split('\n')[0];
    printData(`  ${display}`);
  }
  printData('  (PROJECT accepts a project UUID or an exact unique project name.)');
  printData('');
  printData('Global flags:');
  printData('  --json / --no-json      Force JSON or human output (default: JSON when piped)');
  printData('  --fields <a,b.c>        Project JSON output to specific dot-path fields');
  printData('  --base-url <url>        API base URL (default: https://www.ariax.bio)');
  printData('  --allow-custom-origin   Permit API-key use with a non-Ariax HTTPS origin');
  printData('  --root-dir <dir>              Resume-state directory (default: OS state dir)');
  printData('  --connection-cache-dir <dir>  Forge session connection cache dir (private 0700)');
  printData('  --timeout <ms>                Per-request timeout (default: 30000)');
  printData('  -h, --help              Show help (optionally: ariax help <command>)');
  printData('  --version               Show version');
  printData('');
  printData('Authentication: run ariax login (interactive), or set ARIAX_API_KEY for automation.');
  printData('Env: ARIAX_API_KEY (optional override), ARIAX_BASE_URL,');
  printData('  ARIAX_ALLOW_CUSTOM_ORIGIN=1 (intentional custom endpoints only),');
  printData('  ARIAX_AUTO_FEEDBACK=ask|friction|off (feedback consent mode; default: ask),');
  printData('  ARIAX_TRACE_ID=<uuid> (optional session trace correlation ID),');
  printData('  NO_UPDATE_NOTIFIER=1 (disable automatic version checks)');
  printData('Exit codes: 0 ok, 1 usage, 2 auth, 3 forbidden, 4 not found, 5 validation,');
  printData('  6 payment/credit, 7 conflict, 8 rate-limit, 9 network/timeout, 10 server,');
  printData('  11 remote command failed, 130 interrupted.');
}

function detectRawJsonMode(argv) {
  let jsonForced = false;
  let jsonDisabled = false;
  for (const tok of argv) {
    if (tok === '--') break;
    if (tok === '--json') jsonForced = true;
    else if (tok === '--no-json') jsonDisabled = true;
  }
  return jsonForced || (!jsonDisabled && !process.stdout.isTTY);
}

/** Run the CLI. Returns a process exit code (never throws). */
export async function main(argv = process.argv.slice(2), env = process.env, runtime = {}) {
  installStdoutEpipeHandler();
  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (err) {
    return reportError(err, detectRawJsonMode(argv), { argv, env });
  }
  const { command, positionals, flags, globals } = parsed;
  // Forge's local wait timeout is specified in seconds by its public contract.
  if (command === 'forge' && (positionals[0] === 'watch' || positionals[0] === 'sync'
      || (positionals[0] === 'tools' && positionals[1] === 'wait')) && globals.timeout !== undefined) {
    flags.timeout = globals.timeout;
    delete globals.timeout;
  }

  const argumentJsonMode = globals.json === true || (globals['no-json'] !== true && !process.stdout.isTTY);
  const earlyContext = { command, positionals, globals, argv, env };
  try {
    if (Object.prototype.hasOwnProperty.call(flags, 'api-key')) {
      throw usageError('--api-key is intentionally unsupported because command-line secrets can leak. Run ariax login instead.');
    }
    // Bare `inputs --help` still displays its topic without requiring a subcommand.
    if (!(command === 'inputs' && positionals.length === 0 && Object.keys(flags).length === 0 && globals.help)) {
      if (command === 'forge') forge.validateArguments(parsed);
      else if (command === 'storage') storage.validateArguments(parsed);
      else validateCommandArguments(parsed);
    }
  } catch (err) {
    return reportError(err, argumentJsonMode, earlyContext);
  }

  if (globals.version === true) {
    const info = buildInfo();
    if (argumentJsonMode) printJson({ data: info });
    else printData(formatBuildInfo(info));
    return EXIT.OK;
  }
  if (globals.help === true || command === undefined || command === 'help') {
    const topic = command === 'help' ? positionals[0] : command;
    if (topic && !Object.prototype.hasOwnProperty.call(HELP_TOPICS, topic)) {
      return reportError(
        usageError(`Unknown command '${topic}'. Run 'ariax --help' to list available commands.`),
        argumentJsonMode,
        earlyContext,
      );
    }
    printHelp(topic, command === 'help' ? positionals.slice(1) : positionals);
    return EXIT.OK;
  }
  if (!Object.prototype.hasOwnProperty.call(COMMANDS, command)) {
    return reportError(usageError(`unknown command "${command}". Run: ariax help`), argumentJsonMode, earlyContext);
  }

  const merged = { ...flags };
  if (globals['base-url'] !== undefined) merged['base-url'] = globals['base-url'];
  if (globals['allow-custom-origin'] === true) merged['allow-custom-origin'] = true;
  if (globals['root-dir'] !== undefined) merged['root-dir'] = globals['root-dir'];
  if (globals['connection-cache-dir'] !== undefined) merged['connection-cache-dir'] = globals['connection-cache-dir'];
  if (globals.timeout !== undefined) merged.timeout = globals.timeout;
  if (globals.json === true) merged.json = true;
  if (globals['no-json'] === true && globals.json !== true) merged.json = false;

  let config;
  try {
    config = loadConfig(merged, env);
  } catch (err) {
    const jsonMode = merged.json === true || (merged.json !== false && !process.stdout.isTTY);
    return reportError(err, jsonMode, earlyContext);
  }
  const jsonMode = config.jsonMode;
  const errContext = { command, positionals, globals, config, argv, env };
  const currentBuild = buildInfo();
  const currentVersion = currentBuild.version;
  const telemetry = {
    agent: detectAgentShell(env) ?? 'none',
    cliChannel: currentBuild.channel || 'unknown',
    commandTemplate: commandTemplateFor(command, positionals),
    ...(isUUID(env?.ARIAX_TRACE_ID) ? { sessionTraceId: env.ARIAX_TRACE_ID.trim().toLowerCase() } : {}),
  };

  let feedbackInput;
  if (command === 'feedback') {
    try {
      feedbackInput = await feedback.prepareInput({
        positionals,
        flags,
        currentVersion,
        currentBuild,
        env,
        config,
        input: runtime.input ?? process.stdin,
      });
    } catch (err) {
      return reportError(err, jsonMode, errContext);
    }
  }
  const interactive = runtime.interactive ?? Boolean(
    process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY && !isNonInteractiveEnv(env),
  );
  const fetchImpl = runtime.fetchImpl ?? globalThis.fetch;
  const credentialStore = runtime.credentialStore ?? createCredentialStore();

  let outputFields = null;
  if (globals.fields !== undefined) {
    try {
      outputFields = parseFieldsOption(globals.fields);
    } catch (err) {
      return reportError(err, jsonMode, errContext);
    }
  }

  let timeoutMs = 30_000;
  if (globals.timeout !== undefined) {
    timeoutMs = Number(globals.timeout);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return reportError(usageError('--timeout must be a positive number of milliseconds.'), jsonMode, errContext);
    }
  }

  const authenticated = !isPublicInvocation(command, positionals, flags);
  if (authenticated) {
    if (!config.apiKey && supportsStoredCredentials(config.baseUrl)) {
      try {
        const stored = await credentialStore.read();
        if (stored) {
          config.apiKey = stored.apiKey;
          config.apiKeySource = stored.storage;
        }
      } catch (err) {
        return reportError(err, jsonMode, errContext);
      }
    }
    if (!config.apiKey && interactive && !jsonMode) {
      try {
        const result = await login.authenticateAndStore({
          flags: {},
          positionals: [],
          config,
          env,
          json: false,
          interactive,
          fetchImpl,
          timeoutMs,
          credentialStore,
          telemetry,
          input: runtime.input ?? process.stdin,
          errorOutput: runtime.errorOutput ?? process.stderr,
          promptApiKey: runtime.promptApiKey,
          confirmFileStorage: runtime.confirmFileStorage,
          readTokenFromStdin: runtime.readTokenFromStdin,
        }, { automatic: true });
        config.apiKey = result.apiKey;
        config.apiKeySource = result.storage;
      } catch (err) {
        return reportError(err, jsonMode, { ...errContext, command: 'login', apiKeySource: config.apiKeySource });
      }
    }
    try {
      requireApiKey(config);
    } catch (err) {
      return reportError(Object.assign(err, { exitCode: EXIT.AUTH }), jsonMode, errContext);
    }
    try {
      requireTrustedApiOrigin(config);
    } catch (err) {
      return reportError(err, jsonMode, errContext);
    }
  }

  // Report to agents during long waits. Defer terminal notices until prompts have finished.
  const pendingTerminalNotice = shouldRunAutomaticUpdateCheck({ command, jsonMode, env, interactive })
    ? automaticUpdateNotice({
      currentVersion,
      currentChannel: currentBuild.channel,
      currentRevision: currentBuild.source_revision,
      fetchImpl,
      env,
    }).then((notice) => {
      if (!notice) return;
      const message = formatUpdateNotice(notice, env);
      if (interactive && !jsonMode) return message;
      printProgress(message);
    })
    : undefined;

  const client = createClient({
    baseUrl: config.baseUrl,
    apiKey: authenticated ? config.apiKey : '',
    timeoutMs,
    fetchImpl,
    telemetry,
    onRetry: (info) => {
      printProgress(`… retry ${info.attempt} for ${info.method} ${info.path} in ${info.waitMs}ms`);
    },
  });

  const ctx = {
    client,
    flags,
    positionals,
    passthrough: parsed.passthrough,
    config,
    json: jsonMode,
    fetchImpl,
    timeoutMs,
    credentialStore,
    telemetry,
    env,
    input: runtime.input ?? process.stdin,
    errorOutput: runtime.errorOutput ?? process.stderr,
    promptApiKey: runtime.promptApiKey,
    confirmFileStorage: runtime.confirmFileStorage,
    readTokenFromStdin: runtime.readTokenFromStdin,
    progress: printProgress,
    currentVersion,
    currentBuild,
    feedbackInput,
    interactive,
  };
  try {
    setOutputFields(outputFields);
    await COMMANDS[command].run(ctx);
    return EXIT.OK;
  } catch (err) {
    setOutputFields(null);
    return reportError(err, jsonMode, { ...errContext, apiKeySource: config.apiKeySource });
  } finally {
    setOutputFields(null);
    const message = await pendingTerminalNotice;
    if (message) printProgress(message);
  }
}
