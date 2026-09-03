/**
 * `ariax submit -f job.json --name <n> [--input structure.pdb] [--wait]`
 * Project creation with an internally generated request identifier.
 * Mutations are never retried automatically.
 */
import fs from 'node:fs';
import { printData, printJson, printProgress } from '../output.js';
import { usageError } from '../args.js';
import { EXIT } from '../exit-codes.js';
import { loadResume, clearResume, resumeHint } from '../resume.js';
import { waitForProject } from '../poll.js';
import { readAndValidateInput } from '../input.js';
import { prepareStructureInput } from '../structure-input.js';
import { createSequencePrompt } from '../sequence-prompt.js';
import { isUUID } from '../uuid.js';
import { validateTransferUrl } from '../http.js';
import { accountIdentity, createOperation, sourceIdentity, sendOperation, waitForOperation } from '../operations.js';

/** @param {{ client: any, flags: Record<string, any>, json: boolean, config: { rootDir: string } }} ctx */
export async function run(ctx) {
  const { flags } = ctx;

  if (flags.resume === true) {
    const saved = await loadResume(ctx.config.rootDir);
    if (!saved || !saved.projectId) {
      throw usageError(
        `submit: --resume found no saved legacy wait state under ${ctx.config.rootDir}. Use ariax operations and ariax recover <operation-id> --wait for journaled submissions.`,
      );
    }
    printProgress(`Resuming wait for project ${saved.projectId} (no resubmission).`);
    return waitAndReport(ctx, saved.projectId);
  }

  const file = flags.file || flags.f;
  if (!file) throw usageError('submit: missing required -f/--file job.json.');
  const name = flags.name;
  if (!name) throw usageError('submit: missing required --name <project-name>.');
  const projectName = String(name);
  if (projectName.length > 27 || !/^[A-Za-z0-9-]+$/.test(projectName)) {
    throw usageError('submit: --name may contain only letters, numbers, and dashes and must be 27 characters or fewer.');
  }
  const spec = readJsonFile(String(file));
  const sources = [sourceIdentity(String(file))];
  let preparedBytes;
  let account;
  let body = { ...spec, name: projectName };

  const recoveryIntentId = flags['input-upload-intent-id'];
  if (recoveryIntentId !== undefined) {
    if (!isUUID(String(recoveryIntentId))) {
      throw usageError('submit: --input-upload-intent-id must be a UUID.');
    }
    body.input_upload_intent_id = String(recoveryIntentId);
  }
  if (flags.input !== undefined) {
    if (spec.input_upload_intent_id !== undefined) {
      throw usageError('submit: remove input_upload_intent_id from job.json when using --input.');
    }
    const input = readAndValidateInput(String(flags.input));
    sources.push(sourceIdentity(String(flags.input)));
    const prompt = createSequencePrompt(ctx);
    let prepared;
    try {
      prepared = await prepareStructureInput({
        spec,
        text: input.text,
        targetFilename: input.targetFilename,
        promptSequence: prompt.ask,
      });
    } finally {
      prompt.close();
    }
    body = { ...prepared.spec, name: projectName };
    preparedBytes = Buffer.from(prepared.text, 'utf8');
    for (const message of prepared.messages) printProgress(message);

    if (recoveryIntentId !== undefined) {
      body.input_upload_intent_id = String(recoveryIntentId);
    } else {
      const projectType = typeof prepared.spec.project_type === 'string'
        ? prepared.spec.project_type
        : prepared.spec.protocol_config?.design_type;
      if (typeof projectType !== 'string' || !projectType) {
        throw usageError('submit: job.json must identify project_type (or protocol_config.design_type) when --input is used.');
      }
      account = await accountIdentity(ctx);
      const init = await ctx.client.post('/api/v1/uploads/init', {
        body: {
          project_name: projectName,
          project_type: projectType,
          target_filename: input.targetFilename,
        },
      });
      const upload = init.data ?? {};
      if (typeof upload.upload_url !== 'string' || !upload.upload_url) {
        const error = new Error('Upload authorization returned no destination.');
        error.exitCode = EXIT.SERVER;
        throw error;
      }
      if (typeof upload.upload_intent_id !== 'string' || !upload.upload_intent_id) {
        const error = new Error('Upload authorization returned no intent id.');
        error.exitCode = EXIT.SERVER;
        throw error;
      }
      await putInput(
        ctx.fetchImpl,
        upload.upload_url,
        upload.upload_headers,
        preparedBytes,
      );
      body.input_upload_intent_id = upload.upload_intent_id;
    }
  }

  account ??= await accountIdentity(ctx);
  const operation = createOperation(ctx, {
    action: 'project:create', request: { method: 'POST', path: '/api/v1/projects', body },
    account, sources, preparedBytes,
  });
  const res = await sendOperation(ctx, operation);
  if (operation.state === 'in_progress') {
    if (flags.wait === true) {
      await waitForOperation(ctx, operation);
      return waitAndReport(ctx, operation.project_id, operation);
    }
    if (ctx.json) printJson({ data: { ...res.data, local_operation_id: operation.id }, meta: res.meta });
    else printData(`Operation in progress. Check with: ariax operations ${operation.id}`);
    return { operationId: operation.id, projectId: operation.project_id };
  }
  const project = res.data?.project ?? res.data ?? {};
  const projectId = project.id ?? project.project_id ?? res.data?.project_id;
  const jobId = project.job_id ?? project.jobId ?? res.data?.job_id ?? null;
  if (!projectId) {
    const err = new Error('Submit succeeded but the response carried no project id.');
    err.exitCode = EXIT.SERVER;
    throw err;
  }

  if (ctx.json) {
    if (flags.wait !== true) {
      printJson({ data: res.data, meta: { ...res.meta, local_operation_id: operation.id }, request_id: res.requestId });
    }
  } else {
    printData(`project_id: ${projectId}`);
    if (jobId) printData(`job_id: ${jobId}`);
    if (project.status) printData(`status: ${project.status}`);
  }

  if (flags.wait !== true) {
    printProgress(`Track with: ariax status ${projectId} --wait`);
    return { projectId, operationId: operation.id };
  }
  return waitAndReport(ctx, String(projectId), operation);
}

async function putInput(fetchImpl, url, headers, body) {
  const destination = validateTransferUrl(url, 'Upload');
  let response;
  try {
    response = await fetchImpl(destination, {
      method: 'PUT',
      headers: headers && typeof headers === 'object' ? headers : {},
      body,
      redirect: 'error',
    });
  } catch (cause) {
    const error = new Error('Direct input upload failed before receiving a response.');
    error.exitCode = EXIT.NETWORK;
    error.retryable = true;
    error.cause = cause;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`Direct input upload failed (HTTP ${response.status}).`);
    error.exitCode = EXIT.SERVER;
    throw error;
  }
}

export async function waitAndReport(ctx, projectId, operation) {
  const pollMs = ctx.flags['poll-interval'] !== undefined
    ? Math.max(1, Number(ctx.flags['poll-interval'])) * 1000
    : 3000;
  const timeoutMs = ctx.flags['wait-timeout'] !== undefined
    ? Math.max(1, Number(ctx.flags['wait-timeout'])) * 1000
    : 0;
  if (!Number.isFinite(pollMs)) throw usageError('submit: --poll-interval must be a number of seconds.');
  if (!Number.isFinite(timeoutMs)) throw usageError('submit: --wait-timeout must be a number of seconds.');

  let stopped = false;
  const onSigint = () => { stopped = true; };
  process.once('SIGINT', onSigint);
  try {
    printProgress('Waiting for a terminal state (completed/failed/paused/aborted)…');
    const out = await waitForProject(ctx.client, projectId, {
      pollIntervalMs: pollMs,
      timeoutMs,
      shouldStop: () => stopped,
      onTick: ({ status, elapsedMs }) => {
        printProgress(`… status=${status ?? 'unknown'} elapsed=${Math.round(elapsedMs / 1000)}s`);
      },
    });
    if (stopped || out.stopped) {
      printProgress('Interrupted. Remote work continues (SIGINT never aborts).');
      printProgress(resumeHint({ projectId, rootDir: ctx.config.rootDir }));
      const err = new Error('Interrupted; remote work continues.');
      err.exitCode = EXIT.INTERRUPTED;
      throw err;
    }
    if (out.timedOut) {
      printProgress(`Wait timed out (last status: ${out.status ?? 'unknown'}). Remote work continues.`);
      printProgress(resumeHint({ projectId, rootDir: ctx.config.rootDir }));
      const err = new Error('Wait timed out; remote work continues.');
      err.exitCode = EXIT.NETWORK;
      throw err;
    }
    // Each new mutation has its own permanent journal. Only legacy waits use resume.json.
    if (!operation) await clearResume(ctx.config.rootDir, projectId);
    if (String(out.status).toLowerCase() === 'failed') {
      const err = new Error(`Project ${projectId} ended in state "failed".`);
      err.exitCode = EXIT.SERVER;
      throw err;
    }
    if (ctx.json) {
      printJson({ data: out.project, meta: { waited: true, status: out.status } });
    } else {
      printData(`status: ${out.status}`);
      printData(`project_id: ${out.project?.id ?? projectId}`);
    }
    return { projectId, status: out.status };
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}

function readJsonFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    const e = new Error(`Cannot read file "${file}": ${err.message}`);
    e.exitCode = 1;
    throw e;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    const e = new Error(`Invalid JSON in "${file}": ${err.message}`);
    e.exitCode = 5;
    throw e;
  }
}
