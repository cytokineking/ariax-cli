/** Submit structured agent/CLI feedback or legacy project-scoped feedback. */
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { detectAgentShell, isCiEnv } from '../agent-env.js';
import { usageError } from '../args.js';
import { feedbackConsentMode, readLastCliError } from '../error-ring.js';
import { EXIT } from '../exit-codes.js';
import { printData, printJson, printProgress } from '../output.js';
import { resolveProjectId } from '../resolve.js';
import { isUUID } from '../uuid.js';

const LEGACY_CATEGORIES = new Set(['technical-support', 'feature-request', 'other']);
const FEEDBACK_TYPES = new Set([
  'bug',
  'agent-friction',
  'docs-gap',
  'missing-capability',
  'technical-support',
  'feature-request',
  'other',
]);
const SEVERITIES = new Set(['blocker', 'high', 'medium', 'low']);
const TRIAGE_STATUSES = new Set([
  'new',
  'claimed',
  'investigating',
  'pr_proposed',
  'issue_opened',
  'needs_human_support',
  'duplicate',
  'resolved',
  'ignored',
]);
const CLI_CHANNELS = new Set(['github', 'npm', 'source', 'unknown']);
const PHASE4_FLAGS = [
  'type',
  'summary',
  'severity',
  'project',
  'session',
  'command',
  'protocol',
  'tool',
  'failed-request-id',
  'attach-last-error',
  'file',
  'f',
  'dry-run',
  'operation-id',
];

const MAX_SUMMARY_CHARS = 200;
const MAX_MESSAGE_BYTES = 8192;
const MAX_LEGACY_CONTEXT_BYTES = 2048;
const MAX_CONTEXT_BYTES = 4096;
const REVISION_RE = /^[a-f0-9]{40}$/;
const SLUG_RE = /^[a-z0-9._-]{1,64}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const FINGERPRINT_RE = /^[0-9a-f]{16,64}$/i;

const STRUCTURE_BLOCK_RE = /^(?:(?:ATOM  |ATOM\s+\d+|HETATM\s)[^\r\n]*(?:\r?\n|$)){3,}/gm;
const FASTA_BLOCK_RE = /^>[^\r\n]+\r?\n(?:(?:[ACDEFGHIKLMNPQRSTVWYBXZJUO]{20,}|[acgtu]{20,})[ \t]*(?:\r?\n|$))+/gm;
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;
const BEARER_RE = /(Bearer\s+)(?!\[REDACTED\])[A-Za-z0-9._~+/=-]{6,}/gi;
const ARIAX_KEY_RE = /\barx_(?!\[REDACTED\])[A-Za-z0-9_-]{8,}/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const CLOUD_SECRET_RE = /\b(?:sk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{12,}|sk_(?:live|test)_[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|(?:AKIA|ASIA)[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{16,}|AIza[0-9A-Za-z_-]{30,})\b/g;
const UPPER_BIOSEQ_RE = /(?<![A-Za-z0-9_])[ACDEFGHIKLMNPQRSTVWYBXZJUO]{60,}(?![A-Za-z0-9_])/g;
const LOWER_NTSEQ_RE = /(?<![A-Za-z0-9_])[acgtu]{60,}(?![A-Za-z0-9_])/g;

/**
 * Redact credentials, tokens, query/credential URLs, long biological sequences,
 * FASTA blocks, and raw PDB/mmCIF coordinate blocks prior to submission.
 * @param {string} raw
 * @returns {{ text: string, redactionsApplied: number }}
 */
export function redactFeedbackText(raw) {
  if (typeof raw !== 'string' || !raw) return { text: raw ?? '', redactionsApplied: 0 };
  let text = raw;
  let redactionsApplied = 0;

  // 1. Raw PDB/mmCIF coordinate blocks (>=3 consecutive ATOM/HETATM lines).
  text = text.replace(STRUCTURE_BLOCK_RE, (match) => {
    redactionsApplied += 1;
    return match.endsWith('\n') ? '[REDACTED_STRUCTURE_COORDINATES]\n' : '[REDACTED_STRUCTURE_COORDINATES]';
  });

  // 2. Query-bearing or credential-bearing URLs.
  text = text.replace(URL_RE, (candidate) => {
    try {
      const url = new URL(candidate);
      if (url.username || url.password || url.search || url.hash) {
        redactionsApplied += 1;
        return '[REDACTED_URL]';
      }
      return candidate;
    } catch {
      if (/[?@#]/.test(candidate)) {
        redactionsApplied += 1;
        return '[REDACTED_URL]';
      }
      return candidate;
    }
  });

  // 3. Bearer tokens.
  text = text.replace(BEARER_RE, (_, prefix) => {
    redactionsApplied += 1;
    return `${prefix}[REDACTED]`;
  });

  // 4. Ariax API keys.
  text = text.replace(ARIAX_KEY_RE, () => {
    redactionsApplied += 1;
    return 'arx_[REDACTED]';
  });

  // 5. JWTs.
  text = text.replace(JWT_RE, () => {
    redactionsApplied += 1;
    return '[REDACTED_JWT]';
  });

  // 6. Common cloud/provider secret tokens (sk-..., ghp_..., AKIA..., etc.).
  text = text.replace(CLOUD_SECRET_RE, () => {
    redactionsApplied += 1;
    return '[REDACTED_SECRET]';
  });

  // 7. FASTA blocks (header + sequence lines totaling >=40 chars across lines or >=60 chars).
  text = text.replace(FASTA_BLOCK_RE, (match) => {
    const lines = match.split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean);
    const seqLen = lines.reduce((sum, line) => sum + line.length, 0);
    if (seqLen < 60 && lines.length < 2) return match;
    if (seqLen < 40) return match;
    redactionsApplied += 1;
    return match.endsWith('\n')
      ? `[REDACTED_SEQUENCE(${seqLen} chars)]\n`
      : `[REDACTED_SEQUENCE(${seqLen} chars)]`;
  });

  // 8. Contiguous >=60-char amino-acid or nucleotide sequences.
  text = text.replace(UPPER_BIOSEQ_RE, (match) => {
    redactionsApplied += 1;
    return `[REDACTED_SEQUENCE(${match.length} chars)]`;
  });
  text = text.replace(LOWER_NTSEQ_RE, (match) => {
    redactionsApplied += 1;
    return `[REDACTED_SEQUENCE(${match.length} chars)]`;
  });

  return { text, redactionsApplied };
}

function readMessageFile(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw usageError('feedback: --file must be a nonempty path.');
  }
  let fd;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (err) {
    if (err.code === 'ELOOP') {
      throw usageError('feedback: --file must be a regular file, not a symbolic link.');
    }
    if (err.code === 'ENOENT') {
      throw usageError(`feedback: --file not found: ${filePath}`);
    }
    throw usageError(`feedback: unable to read --file: ${err.message || err}`);
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      throw usageError('feedback: --file must be a regular file.');
    }
    if (stat.size === 0) {
      throw usageError('feedback: --file must not be empty.');
    }
    if (stat.size > MAX_MESSAGE_BYTES) {
      throw usageError(`feedback: --file must be at most ${MAX_MESSAGE_BYTES} UTF-8 bytes.`);
    }
    const buf = fs.readFileSync(fd);
    if (buf.length > MAX_MESSAGE_BYTES) {
      throw usageError(`feedback: --file must be at most ${MAX_MESSAGE_BYTES} UTF-8 bytes.`);
    }
    if (buf.includes(0)) {
      throw usageError('feedback: --file must contain UTF-8 text.');
    }
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

async function readMessageFromStdin(stream) {
  if (!stream || stream.isTTY) {
    throw usageError('feedback: --message - requires piped stdin input.');
  }
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
    totalBytes += buf.length;
    if (totalBytes > MAX_MESSAGE_BYTES) {
      throw usageError(`feedback: --message must be at most ${MAX_MESSAGE_BYTES} UTF-8 bytes.`);
    }
    chunks.push(buf);
  }
  const combined = Buffer.concat(chunks);
  if (combined.includes(0)) {
    throw usageError('feedback: stdin message must contain UTF-8 text.');
  }
  return combined.toString('utf8');
}

function isLegacyMode(positionals, flags) {
  const hasPhase4Flag = PHASE4_FLAGS.some((name) => flags[name] !== undefined);
  return !hasPhase4Flag && positionals.length === 1 && flags.category !== undefined && flags.message !== '-';
}

function sanitizeAttachedLastError(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const out = {};
  if (typeof entry.command_template === 'string' && SLUG_RE.test(entry.command_template)) {
    out.command_template = entry.command_template;
  }
  if (Number.isSafeInteger(entry.exit_code) && entry.exit_code >= 0 && entry.exit_code <= 255) {
    out.exit_code = entry.exit_code;
  }
  if (typeof entry.error_code === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(entry.error_code)) {
    out.error_code = entry.error_code;
  }
  if (Number.isSafeInteger(entry.http_status) && entry.http_status >= 100 && entry.http_status <= 599) {
    out.http_status = entry.http_status;
  }
  if (typeof entry.request_id === 'string' && REQUEST_ID_RE.test(entry.request_id)) {
    out.request_id = entry.request_id;
  }
  if (typeof entry.timestamp === 'string' && Number.isFinite(Date.parse(entry.timestamp))) {
    out.timestamp = entry.timestamp;
  }
  return Object.keys(out).length ? out : null;
}

function validateVersionAndRevision(currentVersion, currentBuild) {
  const version = currentVersion ?? currentBuild?.version;
  if (typeof version !== 'string' || !version.trim() || [...version].length > 128) {
    throw usageError('feedback: installed CLI version is invalid.');
  }
  const revision = currentBuild?.source_revision;
  if (revision !== null && revision !== undefined) {
    if (typeof revision !== 'string' || !REVISION_RE.test(revision)) {
      throw usageError('feedback: installed CLI revision is invalid.');
    }
  }
  return { version: version.trim(), revision: revision ?? null };
}

function validatePhase4Flags({ positionals = [], flags = {} }) {
  if (positionals.length > 1) {
    throw usageError('feedback: unexpected positional arguments; expected at most 1.');
  }
  if (positionals.length === 1 && flags.project !== undefined) {
    throw usageError('feedback: pass either positional PROJECT or --project, not both.');
  }
  const rawProject = flags.project !== undefined ? flags.project : positionals[0];
  if (rawProject !== undefined && (typeof rawProject !== 'string' || !rawProject.trim())) {
    throw usageError('feedback: --project must be a nonempty project UUID or exact unique name.');
  }

  if (flags.type !== undefined && flags.category !== undefined) {
    throw usageError('feedback: pass either --type or --category, not both.');
  }
  const type = flags.type ?? flags.category;
  if (!FEEDBACK_TYPES.has(type)) {
    throw usageError(
      'feedback: --type must be bug, agent-friction, docs-gap, missing-capability, technical-support, feature-request, or other.',
    );
  }

  const severity = flags.severity ?? 'medium';
  if (!SEVERITIES.has(severity)) {
    throw usageError('feedback: --severity must be blocker, high, medium, or low.');
  }

  if (typeof flags.summary !== 'string' || !flags.summary.trim()) {
    throw usageError('feedback: --summary is required and must contain nonblank text.');
  }
  const rawSummary = flags.summary.trim();
  if ([...rawSummary].length > MAX_SUMMARY_CHARS) {
    throw usageError(`feedback: --summary must be at most ${MAX_SUMMARY_CHARS} characters.`);
  }

  const hasMessage = flags.message !== undefined;
  const hasFile = flags.file !== undefined;
  if (hasMessage && hasFile) {
    throw usageError('feedback: specify either --message or --file, not both.');
  }
  if (!hasMessage && !hasFile) {
    throw usageError('feedback: either --message or --file is required.');
  }

  if (flags.job !== undefined && (typeof flags.job !== 'string' || !isUUID(flags.job))) {
    throw usageError('feedback: --job must be a valid job UUID.');
  }
  if (flags.session !== undefined && (typeof flags.session !== 'string' || !isUUID(flags.session))) {
    throw usageError('feedback: --session must be a valid Forge session UUID.');
  }
  if (flags.command !== undefined && (typeof flags.command !== 'string' || !isUUID(flags.command))) {
    throw usageError('feedback: --command must be a valid Forge command UUID.');
  }
  if (flags.protocol !== undefined) {
    if (typeof flags.protocol !== 'string' || !SLUG_RE.test(flags.protocol.trim())) {
      throw usageError('feedback: --protocol must match ^[a-z0-9._-]{1,64}$.');
    }
  }
  if (flags.tool !== undefined) {
    if (typeof flags.tool !== 'string' || !SLUG_RE.test(flags.tool.trim())) {
      throw usageError('feedback: --tool must match ^[a-z0-9._-]{1,64}$.');
    }
  }
  if (flags['failed-request-id'] !== undefined) {
    if (typeof flags['failed-request-id'] !== 'string' || !REQUEST_ID_RE.test(flags['failed-request-id'].trim())) {
      throw usageError('feedback: --failed-request-id must match ^[A-Za-z0-9._:-]{1,128}$.');
    }
  }
  if (flags['operation-id'] !== undefined && (typeof flags['operation-id'] !== 'string' || !isUUID(flags['operation-id']))) {
    throw usageError('feedback: --operation-id must be a valid UUID.');
  }

  return {
    project: rawProject ? rawProject.trim() : undefined,
    type,
    severity,
    rawSummary,
  };
}

/** Validate user-supplied feedback inputs synchronously (use prepareInput for stdin `-`). */
export function validateInput({
  positionals = [],
  flags = {},
  currentVersion,
  currentBuild,
  env = process.env,
  config,
  rootDir,
  stdinMessage,
} = {}) {
  const { version, revision } = validateVersionAndRevision(currentVersion, currentBuild);

  // Legacy path: `ariax feedback PROJECT --category ... --message "..." [--job UUID]`
  if (isLegacyMode(positionals, flags)) {
    if (typeof positionals[0] !== 'string' || !positionals[0].trim()) {
      throw usageError('feedback: exactly one project UUID or exact unique project name is required.');
    }
    if (!LEGACY_CATEGORIES.has(flags.category)) {
      throw usageError('feedback: --category must be technical-support, feature-request, or other.');
    }
    if (typeof flags.message !== 'string' || !flags.message.trim()) {
      throw usageError('feedback: --message must contain nonblank text.');
    }
    if (Buffer.byteLength(flags.message, 'utf8') > MAX_MESSAGE_BYTES) {
      throw usageError(`feedback: --message must be at most ${MAX_MESSAGE_BYTES} UTF-8 bytes.`);
    }
    if (flags.job !== undefined && (typeof flags.job !== 'string' || !isUUID(flags.job))) {
      throw usageError('feedback: --job must be a valid job UUID.');
    }
    const context = { cli_version: version };
    if (revision !== null) context.cli_revision = revision;
    if (Buffer.byteLength(JSON.stringify(context), 'utf8') > MAX_LEGACY_CONTEXT_BYTES) {
      throw usageError('feedback: CLI context exceeds the 2048-byte limit.');
    }
    const redactedMessage = redactFeedbackText(flags.message.trim());
    if (!redactedMessage.text.trim()) {
      throw usageError('feedback: --message must contain nonblank text.');
    }
    return {
      mode: 'legacy',
      project: positionals[0].trim(),
      category: flags.category,
      message: redactedMessage.text.trim(),
      ...(flags.job === undefined ? {} : { job_id: flags.job.trim().toLowerCase() }),
      context,
      redactionsApplied: redactedMessage.redactionsApplied,
    };
  }

  // Phase 4 structured feedback path (`POST /api/v1/feedback`).
  const base = validatePhase4Flags({ positionals, flags });

  let rawMessage;
  if (flags.file !== undefined) {
    rawMessage = readMessageFile(flags.file);
  } else if (flags.message === '-') {
    if (stdinMessage === undefined) {
      throw usageError('feedback: --message - requires piped stdin input.');
    }
    rawMessage = stdinMessage;
  } else {
    rawMessage = flags.message;
  }

  if (typeof rawMessage !== 'string' || !rawMessage.trim()) {
    throw usageError('feedback: message must contain nonblank text.');
  }
  if (Buffer.byteLength(rawMessage, 'utf8') > MAX_MESSAGE_BYTES) {
    throw usageError(`feedback: message must be at most ${MAX_MESSAGE_BYTES} UTF-8 bytes.`);
  }

  const redactedSummary = redactFeedbackText(base.rawSummary);
  const redactedMessage = redactFeedbackText(rawMessage.trim());
  const redactionsApplied = redactedSummary.redactionsApplied + redactedMessage.redactionsApplied;

  let summary = redactedSummary.text.trim();
  if ([...summary].length > MAX_SUMMARY_CHARS) {
    summary = [...summary].slice(0, MAX_SUMMARY_CHARS).join('').trim();
  }
  const message = redactedMessage.text.trim();
  if (!summary) {
    throw usageError('feedback: --summary must contain nonblank text.');
  }
  if (!message) {
    throw usageError('feedback: message must contain nonblank text.');
  }
  if (Buffer.byteLength(message, 'utf8') > MAX_MESSAGE_BYTES) {
    throw usageError(`feedback: message must be at most ${MAX_MESSAGE_BYTES} UTF-8 bytes.`);
  }

  const agentShell = detectAgentShell(env);
  const consentMode = feedbackConsentMode(env);
  const channel = CLI_CHANNELS.has(currentBuild?.channel) ? currentBuild.channel : 'unknown';
  const context = {
    cli_version: version,
    ...(revision !== null ? { cli_revision: revision } : {}),
    cli_channel: channel,
    os: `${process.platform}-${process.arch}`,
    node_version: process.version,
    agent_harness: agentShell ?? (isCiEnv(env) ? 'ci' : 'human'),
    auto_submitted: Boolean(agentShell && consentMode === 'friction'),
  };

  let failedRequestId = flags['failed-request-id'] !== undefined
    ? flags['failed-request-id'].trim()
    : undefined;

  if (flags['attach-last-error'] === true) {
    const effectiveRoot = rootDir ?? config?.rootDir;
    const lastError = sanitizeAttachedLastError(
      readLastCliError(effectiveRoot, { excludeCommands: ['feedback'] }),
    );
    if (lastError) {
      context.last_error = lastError;
      if (!failedRequestId && lastError.request_id) {
        failedRequestId = lastError.request_id;
      }
    }
  }

  if (Buffer.byteLength(JSON.stringify(context), 'utf8') > MAX_CONTEXT_BYTES) {
    throw usageError(`feedback: CLI context exceeds the ${MAX_CONTEXT_BYTES}-byte limit.`);
  }

  const payload = {
    type: base.type,
    severity: base.severity,
    summary,
    message,
    ...(flags.job !== undefined ? { job_id: flags.job.trim().toLowerCase() } : {}),
    ...(flags.session !== undefined ? { forge_session_id: flags.session.trim().toLowerCase() } : {}),
    ...(flags.command !== undefined ? { forge_command_id: flags.command.trim().toLowerCase() } : {}),
    ...(flags.protocol !== undefined ? { protocol: flags.protocol.trim() } : {}),
    ...(flags.tool !== undefined ? { forge_tool: flags.tool.trim() } : {}),
    ...(failedRequestId ? { failed_request_id: failedRequestId } : {}),
    context,
  };

  const idempotencyKey = flags['operation-id'] !== undefined
    ? flags['operation-id'].trim().toLowerCase()
    : randomUUID();

  return {
    mode: 'v2',
    project: base.project,
    dryRun: flags['dry-run'] === true,
    consentMode,
    redactionsApplied,
    idempotencyKey,
    payload,
  };
}

/** Async preparation helper that validates flags first and reads stdin when `--message -` is used. */
export async function prepareInput({
  positionals = [],
  flags = {},
  currentVersion,
  currentBuild,
  env = process.env,
  config,
  rootDir,
  input = process.stdin,
} = {}) {
  if (!isLegacyMode(positionals, flags) && flags.message === '-') {
    // Validate non-message flags before reading stdin so bad options fail immediately.
    validateVersionAndRevision(currentVersion, currentBuild);
    validatePhase4Flags({ positionals, flags });
    const stdinMessage = await readMessageFromStdin(input);
    return validateInput({
      positionals,
      flags,
      currentVersion,
      currentBuild,
      env,
      config,
      rootDir,
      stdinMessage,
    });
  }
  return validateInput({ positionals, flags, currentVersion, currentBuild, env, config, rootDir });
}

function invalidReceiptError(res) {
  const error = new Error('Feedback response did not contain a valid receipt; delivery status is uncertain.');
  error.code = 'invalid_feedback_response';
  error.exitCode = EXIT.SERVER;
  error.requestId = res?.requestId;
  return error;
}

function validLegacyReceipt(res, projectId, category) {
  const data = res?.data;
  if (res?.status !== 201 || !data || typeof data !== 'object' || Array.isArray(data)
    || !isUUID(data.feedback_id) || !isUUID(data.project_id)
    || data.project_id.toLowerCase() !== projectId.toLowerCase()
    || data.category !== category
    || typeof data.created_at !== 'string' || !data.created_at.trim()
    || !Number.isFinite(Date.parse(data.created_at))) {
    throw invalidReceiptError(res);
  }
  return {
    feedback_id: data.feedback_id,
    project_id: data.project_id,
    category: data.category,
    created_at: data.created_at,
  };
}

function validV2Receipt(res, expectedType, fallbackSeverity) {
  const data = res?.data;
  if ((res?.status !== 201 && res?.status !== 200)
    || !data || typeof data !== 'object' || Array.isArray(data)
    || !isUUID(data.feedback_id)
    || data.type !== expectedType
    || typeof data.fingerprint !== 'string' || !FINGERPRINT_RE.test(data.fingerprint)
    || typeof data.triage_status !== 'string' || !TRIAGE_STATUSES.has(data.triage_status)
    || typeof data.created_at !== 'string' || !data.created_at.trim()
    || !Number.isFinite(Date.parse(data.created_at))) {
    throw invalidReceiptError(res);
  }
  if (data.severity !== undefined && !SEVERITIES.has(data.severity)) {
    throw invalidReceiptError(res);
  }
  if (data.project_id !== undefined && data.project_id !== null && !isUUID(data.project_id)) {
    throw invalidReceiptError(res);
  }
  return {
    feedback_id: data.feedback_id,
    ...(data.project_id !== undefined ? { project_id: data.project_id } : {}),
    type: data.type,
    severity: data.severity ?? fallbackSeverity,
    fingerprint: data.fingerprint,
    triage_status: data.triage_status,
    created_at: data.created_at,
  };
}

export async function run(ctx) {
  const prepared = ctx.feedbackInput ?? await prepareInput(ctx);

  if (prepared.mode === 'legacy') {
    const projectId = await resolveProjectId(ctx.client, prepared.project);
    if (prepared.redactionsApplied > 0) {
      printProgress(`Notice: redacted ${prepared.redactionsApplied} sensitive pattern(s) before submitting feedback.`);
    }
    const body = {
      category: prepared.category,
      message: prepared.message,
      ...(prepared.job_id ? { job_id: prepared.job_id } : {}),
      context: prepared.context,
    };
    const res = await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/feedback`, { body });
    const receipt = validLegacyReceipt(res, projectId, prepared.category);
    if (ctx.json) {
      printJson({ data: receipt, ...(res.requestId ? { request_id: res.requestId } : {}) });
      return;
    }
    printData(`Feedback recorded: ${receipt.feedback_id}`);
    printData(`For follow-up, contact support@ariax.bio and include feedback ID ${receipt.feedback_id}.`);
    return;
  }

  const payload = { ...prepared.payload };

  if (prepared.dryRun) {
    let unresolvedProject;
    if (prepared.project) {
      if (isUUID(prepared.project)) {
        payload.project_id = prepared.project.trim().toLowerCase();
      } else {
        unresolvedProject = prepared.project;
      }
    }
    const dryRunResult = {
      dry_run: true,
      endpoint: 'POST /api/v1/feedback',
      idempotency_key: prepared.idempotencyKey,
      consent_mode: prepared.consentMode,
      redactions_applied: prepared.redactionsApplied,
      ...(unresolvedProject ? { project_ref: unresolvedProject } : {}),
      payload,
    };
    if (ctx.json) {
      printJson({ data: dryRunResult });
      return;
    }
    printData(
      `Dry run (not submitted) — consent_mode: ${dryRunResult.consent_mode}, redactions_applied: ${dryRunResult.redactions_applied}`,
    );
    printData(JSON.stringify(dryRunResult, null, 2));
    return;
  }

  if (prepared.project) {
    const projectId = await resolveProjectId(ctx.client, prepared.project);
    payload.project_id = projectId.toLowerCase();
  }
  if (prepared.redactionsApplied > 0) {
    printProgress(`Notice: redacted ${prepared.redactionsApplied} sensitive pattern(s) before submitting feedback.`);
  }

  const res = await ctx.client.post('/api/v1/feedback', {
    body: payload,
    idempotencyKey: prepared.idempotencyKey,
  });
  const receipt = validV2Receipt(res, payload.type, payload.severity);
  if (ctx.json) {
    printJson({ data: receipt, ...(res.requestId ? { request_id: res.requestId } : {}) });
    return;
  }
  printData(
    `Feedback recorded: ${receipt.feedback_id} (type: ${receipt.type}, severity: ${receipt.severity}, status: ${receipt.triage_status})`,
  );
  printData(
    `Queued for Ariax engineering triage. For support inquiries, email support@ariax.bio with feedback ID ${receipt.feedback_id}.`,
  );
}
