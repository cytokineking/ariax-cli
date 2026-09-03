/**
 * Ariax CLI entry: parse args, build config + client, dispatch commands.
 * Core operation uses built-in Node APIs; native keyring support is optional.
 * Exit codes are stable (see exit-codes.js).
 */
import { buildInfo, formatBuildInfo } from './build-info.js';
import { parseArgv, usageError, isUsageError } from './args.js';
import {
  loadConfig,
  requireApiKey,
  requireTrustedApiOrigin,
  supportsStoredCredentials,
} from './config.js';
import { createCredentialStore } from './credentials.js';
import { createClient } from './http.js';
import { printData, printJson, printProgress } from './output.js';
import { EXIT } from './exit-codes.js';
import {
  automaticUpdateNotice,
  formatUpdateNotice,
  shouldRunAutomaticUpdateCheck,
} from './update-check.js';
import * as me from './commands/me.js';
import * as protocols from './commands/protocols.js';
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

const COMMANDS = {
  me, protocols, schema, validate, submit,
  projects, jobs, status, logs, pause, restart, abort, results, upgrade,
  login, logout,
  skills, operations, recover, inputs, candidates, runs,
  'gpu-preferences': gpuPreferences,
};

// Validate the command surface before config, credential access, or any command work.
// Value/content validation remains with each command.
const COMMAND_OPTIONS = {
  me: [[], 0],
  protocols: [[], 0],
  schema: [['raw', 'kind', 'output', 'o'], 1],
  skills: [['read', 'reference'], 1],
  validate: [['file', 'f', 'input'], 0],
  submit: [['file', 'f', 'name', 'input', 'input-upload-intent-id', 'wait', 'resume', 'poll-interval', 'wait-timeout'], 0],
  projects: [['status', 'protocol', 'name', 'limit', 'cursor', 'all'], 0],
  jobs: [['project', 'status', 'limit', 'cursor', 'all'], 0],
  status: [['wait', 'resume', 'poll-interval', 'wait-timeout'], 1],
  logs: [['tail', 'log-ref'], 1],
  pause: [[], 1],
  restart: [['wait', 'poll-interval', 'wait-timeout'], 1],
  abort: [[], 1],
  operations: [[], 1],
  recover: [['wait', 'poll-interval', 'wait-timeout'], 1],
  'gpu-preferences': [['file'], 1],
  runs: [['job', 'limit', 'cursor', 'all'], 1],
  candidates: [['view', 'limit', 'cursor', 'all', 'eligible', 'output', 'overwrite'], 1],
  results: [['path', 'download', 'overwrite', 'limit'], 1],
  upgrade: [['check', 'yes'], 0],
  login: [['with-token', 'insecure-storage'], 0],
  logout: [[], 0],
  help: [[], 1],
};

function validateCommandArguments({ command, positionals, flags }) {
  let options = Object.prototype.hasOwnProperty.call(COMMAND_OPTIONS, command) ? COMMAND_OPTIONS[command] : undefined;
  let label = command || 'ariax';
  if (command === undefined) options = [[], 0];
  if (command === 'projects' && positionals[0] === 'export') {
    options = [['output'], 2];
    label = 'projects export';
  }
  if (command === 'inputs') {
    const action = positionals[0];
    if (!['inspect', 'prepare'].includes(action)) {
      throw usageError('inputs: expected inspect or prepare.');
    }
    options = [action === 'inspect' ? ['input', 'pdb', 'file', 'full'] : ['input', 'pdb', 'file', 'output'], 1];
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
const PUBLIC_COMMANDS = new Set(['protocols', 'schema', 'skills', 'upgrade', 'login', 'logout', 'inputs']);

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

function reportError(err, jsonMode) {
  const code = exitCodeFor(err);
  const message = err?.message ? String(err.message) : String(err);
  const requestId = err?.requestId;
  const apiCode = typeof err?.code === 'string' ? err.code : undefined;
  if (jsonMode) {
    printJson({
      error: {
        code: apiCode || 'error',
        message,
        retryable: err?.retryable === true,
        ...(err?.details === undefined ? {} : { details: err.details }),
      },
      ...(requestId ? { request_id: requestId } : {}),
    });
  } else {
    printProgress(`error: ${message}`);
    if (apiCode && apiCode !== 'ARIAX_USAGE') printProgress(`code: ${apiCode}`);
    for (const issue of err?.details?.issues || []) {
      printProgress(`${issue.field.join('.') || 'job'} [${issue.rule}]: ${issue.message}`);
    }
    if (requestId) printProgress(`request-id: ${requestId}`);
  }
  return code;
}

const HELP_TOPICS = {
  me: 'ariax me',
  protocols: 'ariax protocols',
  schema: 'ariax schema <protocol> [--raw] [--kind job|submission] [-o, --output FILE]',
  skills: 'ariax skills [protocol] [--read] [--reference NAME]',
  inputs: 'ariax inputs inspect|prepare (--input FILE | --pdb ID) [-f job.json] [--output DIR] [--full]',
  validate: 'ariax validate -f job.json [--input FILE]',
  submit: 'ariax submit -f job.json --name <name> [--input FILE] [--wait]',
  operations: 'ariax operations [operation-id]',
  recover: 'ariax recover <operation-id> [--wait]',
  projects: 'ariax projects [--status s] [--protocol p] [--name n] [--limit N] [--cursor C] [--all] | ariax projects export <project-id> [-o, --output job.json]',
  jobs: 'ariax jobs [--project <id>] [--status s] [--limit N] [--cursor C] [--all]',
  status: 'ariax status <project-id> [--wait] [--resume]',
  logs: 'ariax logs <job-id> [--tail N] [--log-ref PATH]',
  pause: 'ariax pause <project-id>',
  restart: 'ariax restart <project-id> [--wait]',
  'gpu-preferences': 'ariax gpu-preferences <project-id> -f preferences.json',
  abort: 'ariax abort <project-id>',
  runs: 'ariax runs <project-id> [--job JOB_ID] [--limit N] [--cursor TOKEN] [--all]',
  candidates: 'ariax candidates <project-id> [--view final|all|diagnostics] [--limit N] [--cursor TOKEN] [--all] [--eligible] [--output shortlist.json] [--overwrite]',
  results: 'ariax results <project-id> [--path <artifact-prefix>] [--download <dir>] [--overwrite] [--limit N]',
  upgrade: 'ariax upgrade [--check] [--yes]',
  login: 'ariax login [--with-token] [--insecure-storage]',
  logout: 'ariax logout',
};

function printHelp(topic) {
  if (topic && HELP_TOPICS[topic]) {
    printData(`usage: ${HELP_TOPICS[topic]}`);
    printData('');
    printData('Global flags: --json, --base-url <url>, --allow-custom-origin, --root-dir <dir>, --timeout <ms>');
    return;
  }
  printData('usage: ariax <command> [options]');
  printData('');
  printData('Commands:');
  for (const line of Object.values(HELP_TOPICS)) printData(`  ${line}`);
  printData('');
  printData('Global flags:');
  printData('  --json / --no-json      Force JSON or human output (default: JSON when piped)');
  printData('  --base-url <url>        API base URL (default: https://www.ariax.bio)');
  printData('  --allow-custom-origin   Permit API-key use with a non-Ariax HTTPS origin');
  printData('  --root-dir <dir>        Resume-state directory (default: cwd)');
  printData('  --timeout <ms>          Per-request timeout (default: 30000)');
  printData('  -h, --help              Show help (optionally: ariax help <command>)');
  printData('  --version               Show version');
  printData('');
  printData('Authentication: run ariax login (interactive), or set ARIAX_API_KEY for automation.');
  printData('Env: ARIAX_API_KEY (optional override), ARIAX_BASE_URL,');
  printData('  ARIAX_ALLOW_CUSTOM_ORIGIN=1 (intentional custom endpoints only),');
  printData('  NO_UPDATE_NOTIFIER=1 (disable automatic version checks)');
  printData('Exit codes: 0 ok, 1 usage, 2 auth, 3 forbidden, 4 not found, 5 validation,');
  printData('  6 payment/credit, 7 conflict, 8 rate-limit, 9 network/timeout, 10 server, 130 interrupted.');
}

/** Run the CLI. Returns a process exit code (never throws). */
export async function main(argv = process.argv.slice(2), env = process.env, runtime = {}) {
  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (err) {
    printProgress(`error: ${err.message}`);
    return EXIT.USAGE;
  }
  const { command, positionals, flags, globals } = parsed;

  const argumentJsonMode = globals.json === true || (globals['no-json'] !== true && !process.stdout.isTTY);
  try {
    if (Object.prototype.hasOwnProperty.call(flags, 'api-key')) {
      throw usageError('--api-key is intentionally unsupported because command-line secrets can leak. Run ariax login instead.');
    }
    // Bare `inputs --help` still displays its topic without requiring a subcommand.
    if (!(command === 'inputs' && positionals.length === 0 && Object.keys(flags).length === 0 && globals.help)) {
      validateCommandArguments(parsed);
    }
  } catch (err) {
    return reportError(err, argumentJsonMode);
  }

  if (globals.version === true) {
    const info = buildInfo();
    if (globals.json === true) printJson({ data: info });
    else printData(formatBuildInfo(info));
    return EXIT.OK;
  }
  if (globals.help === true || command === undefined || command === 'help') {
    printHelp(command === 'help' ? positionals[0] : command);
    return EXIT.OK;
  }
  if (!Object.prototype.hasOwnProperty.call(COMMANDS, command)) {
    printProgress(`error: unknown command "${command}". Run: ariax help`);
    return EXIT.USAGE;
  }

  const merged = { ...flags };
  if (globals['base-url'] !== undefined) merged['base-url'] = globals['base-url'];
  if (globals['allow-custom-origin'] === true) merged['allow-custom-origin'] = true;
  if (globals['root-dir'] !== undefined) merged['root-dir'] = globals['root-dir'];
  if (globals.timeout !== undefined) merged.timeout = globals.timeout;
  if (globals.json === true) merged.json = true;
  if (globals['no-json'] === true && globals.json !== true) merged.json = false;

  let config;
  try {
    config = loadConfig(merged, env);
  } catch (err) {
    const jsonMode = merged.json === true || (merged.json !== false && !process.stdout.isTTY);
    return reportError(err, jsonMode);
  }
  const jsonMode = config.jsonMode;
  const currentBuild = buildInfo();
  const currentVersion = currentBuild.version;
  const interactive = runtime.interactive ?? Boolean(
    process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY,
  );
  const fetchImpl = runtime.fetchImpl ?? globalThis.fetch;
  const credentialStore = runtime.credentialStore ?? createCredentialStore();

  let timeoutMs = 30_000;
  if (merged.timeout !== undefined) {
    timeoutMs = Number(merged.timeout);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return reportError(usageError('--timeout must be a positive number of milliseconds.'), jsonMode);
    }
  }

  const authenticated = !PUBLIC_COMMANDS.has(command);
  if (authenticated) {
    if (!config.apiKey && supportsStoredCredentials(config.baseUrl)) {
      try {
        const stored = await credentialStore.read();
        if (stored) {
          config.apiKey = stored.apiKey;
          config.apiKeySource = stored.storage;
        }
      } catch (err) {
        return reportError(err, jsonMode);
      }
    }
    if (!config.apiKey && interactive && !jsonMode) {
      try {
        const result = await login.authenticateAndStore({
          flags: {},
          positionals: [],
          config,
          json: false,
          interactive,
          fetchImpl,
          timeoutMs,
          credentialStore,
          input: runtime.input ?? process.stdin,
          errorOutput: runtime.errorOutput ?? process.stderr,
          promptApiKey: runtime.promptApiKey,
          confirmFileStorage: runtime.confirmFileStorage,
          readTokenFromStdin: runtime.readTokenFromStdin,
        }, { automatic: true });
        config.apiKey = result.apiKey;
        config.apiKeySource = result.storage;
      } catch (err) {
        return reportError(err, jsonMode);
      }
    }
    try {
      requireApiKey(config);
    } catch (err) {
      return reportError(Object.assign(err, { exitCode: EXIT.AUTH }), jsonMode);
    }
    try {
      requireTrustedApiOrigin(config);
    } catch (err) {
      return reportError(err, jsonMode);
    }
  }

  const updateNoticePromise = shouldRunAutomaticUpdateCheck({
    command,
    jsonMode,
    env,
    interactive,
  })
    ? automaticUpdateNotice({ currentVersion, currentChannel: currentBuild.channel, fetchImpl })
    : Promise.resolve(null);

  const client = createClient({
    baseUrl: config.baseUrl,
    apiKey: authenticated ? config.apiKey : '',
    timeoutMs,
    fetchImpl,
    onRetry: (info) => {
      printProgress(`… retry ${info.attempt} for ${info.method} ${info.path} in ${info.waitMs}ms`);
    },
  });

  const ctx = {
    client,
    flags,
    positionals,
    config,
    json: jsonMode,
    fetchImpl,
    timeoutMs,
    credentialStore,
    env,
    input: runtime.input ?? process.stdin,
    errorOutput: runtime.errorOutput ?? process.stderr,
    promptApiKey: runtime.promptApiKey,
    confirmFileStorage: runtime.confirmFileStorage,
    readTokenFromStdin: runtime.readTokenFromStdin,
    progress: printProgress,
    currentVersion,
    currentBuild,
    interactive,
  };
  try {
    await COMMANDS[command].run(ctx);
    const notice = await updateNoticePromise;
    if (notice) printProgress(formatUpdateNotice(notice));
    return EXIT.OK;
  } catch (err) {
    return reportError(err, jsonMode);
  }
}
