/** Submit one project-scoped feedback message and print its receipt. */
import { usageError } from '../args.js';
import { EXIT } from '../exit-codes.js';
import { printData, printJson } from '../output.js';
import { resolveProjectId } from '../resolve.js';
import { isUUID } from '../uuid.js';

const CATEGORIES = new Set(['technical-support', 'feature-request', 'other']);
const MAX_MESSAGE_BYTES = 8192;
const MAX_CONTEXT_BYTES = 2048;
const REVISION_RE = /^[a-f0-9]{40}$/;

/** Validate every user-supplied value before credentials or HTTP are used. */
export function validateInput({ positionals = [], flags = {}, currentVersion, currentBuild } = {}) {
  if (positionals.length !== 1 || typeof positionals[0] !== 'string' || !positionals[0].trim()) {
    throw usageError('feedback: exactly one project UUID or exact unique project name is required.');
  }
  if (!CATEGORIES.has(flags.category)) {
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

  const version = currentVersion ?? currentBuild?.version;
  if (typeof version !== 'string' || !version.trim() || version.length > 128) {
    throw usageError('feedback: installed CLI version is invalid.');
  }
  const context = { cli_version: version };
  const revision = currentBuild?.source_revision;
  if (revision !== null && revision !== undefined) {
    if (typeof revision !== 'string' || !REVISION_RE.test(revision)) {
      throw usageError('feedback: installed CLI revision is invalid.');
    }
    context.cli_revision = revision;
  }
  if (Buffer.byteLength(JSON.stringify(context), 'utf8') > MAX_CONTEXT_BYTES) {
    throw usageError('feedback: CLI context exceeds the 2048-byte limit.');
  }

  return {
    project: positionals[0].trim(),
    category: flags.category,
    message: flags.message.trim(),
    ...(flags.job === undefined ? {} : { job_id: flags.job.trim() }),
    context,
  };
}

function validReceipt(res, projectId, category) {
  const data = res?.data;
  if (res?.status !== 201 || !data || typeof data !== 'object' || Array.isArray(data)
    || !isUUID(data.feedback_id) || !isUUID(data.project_id)
    || data.project_id.toLowerCase() !== projectId.toLowerCase()
    || data.category !== category
    || typeof data.created_at !== 'string' || !data.created_at.trim()
    || !Number.isFinite(Date.parse(data.created_at))) {
    const error = new Error('Feedback response did not contain a valid receipt; delivery status is uncertain.');
    error.code = 'invalid_feedback_response';
    error.exitCode = EXIT.SERVER;
    error.requestId = res?.requestId;
    throw error;
  }
  return {
    feedback_id: data.feedback_id,
    project_id: data.project_id,
    category: data.category,
    created_at: data.created_at,
  };
}

export async function run(ctx) {
  const input = ctx.feedbackInput ?? validateInput(ctx);
  const projectId = await resolveProjectId(ctx.client, input.project);
  const { project: _project, ...body } = input;
  const res = await ctx.client.post(`/api/v1/projects/${encodeURIComponent(projectId)}/feedback`, { body });
  const receipt = validReceipt(res, projectId, input.category);
  if (ctx.json) {
    printJson({ data: receipt, ...(res.requestId ? { request_id: res.requestId } : {}) });
    return;
  }
  printData(`Feedback recorded: ${receipt.feedback_id}`);
  printData(`For follow-up, contact support@ariax.bio and include feedback ID ${receipt.feedback_id}.`);
}
