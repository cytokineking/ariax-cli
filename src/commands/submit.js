/**
 * `ariax submit -f job.json --name <n> [--input structure.pdb] [--wait]`
 * Project creation with an internally generated request identifier.
 * Mutations are never retried automatically.
 */
import fs from 'node:fs';
import { printData, printJson, printProgress } from '../output.js';
import { usageError } from '../args.js';
import { EXIT, errorCodeToExit } from '../exit-codes.js';
import { loadResume, clearResume, resumeHint } from '../resume.js';
import { waitForProject } from '../poll.js';
import { readAndValidateInput } from '../input.js';
import { prepareStructureInput, protocolId } from '../structure-input.js';
import { createSequencePrompt } from '../sequence-prompt.js';
import { isUUID } from '../uuid.js';
import { DEFAULT_TIMEOUT_MS, validateTransferUrl } from '../http.js';
import { accountIdentity, createOperation, sourceIdentity, sendOperation, verifyOperationStorage, waitForOperation } from '../operations.js';
import { isBindcraft2, prepareBindcraft2Bundle, requiredBindcraft2Inputs } from '../bindcraft2-inputs.js';
import { bindCraft2ProgressSummary } from '../bindcraft2-progress.js';
import { campaignStatusLines, compactCampaign, compactSubmission, usesCompactCampaignPresentation } from '../campaign-presentation.js';
import { checkGpuPolicy } from '../gpu-policy.js';

/** @param {{ client: any, flags: Record<string, any>, json: boolean, config: { rootDir: string } }} ctx */
export async function run(ctx) {
  const { flags } = ctx;

  if (flags.resume === true) {
    const saved = await loadResume(ctx.config.rootDir, { legacyRootDir: ctx.config.legacyRootDir });
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
  let preparedInputs;
  let account;
  let uploadedIntent;
  let body = { ...spec, name: projectName };

  const recoveryIntentId = flags['input-upload-intent-id'];
  if (recoveryIntentId !== undefined) {
    if (!isUUID(String(recoveryIntentId))) {
      throw usageError('submit: --input-upload-intent-id must be a UUID.');
    }
    body.input_upload_intent_id = String(recoveryIntentId);
  }
  if (flags.input !== undefined && flags['input-dir'] !== undefined) {
    throw usageError('submit: choose only one input source: --input or --input-dir.');
  }
  if (protocolId(spec.protocol) === 'boltzgen'
      && (spec.project_type ?? spec.protocol_config?.design_type) !== 'miniprotein-small-molecule'
      && flags.input === undefined) {
    throw usageError('submit: BoltzGen requires --input FILE to validate target chains and residues.');
  }
  if (isBindcraft2(spec)) {
    if (flags.input === undefined && flags['input-dir'] === undefined) {
      throw usageError('submit: BindCraft2 requires --input FILE or --input-dir DIR.');
    }
    if (spec.input_upload_intent_id !== undefined) {
      throw usageError('submit: remove input_upload_intent_id from job.json; use --input-upload-intent-id only for an existing authorization.');
    }
    const bundle = prepareBindcraft2Bundle({
      spec,
      inputFile: flags.input,
      inputDir: flags['input-dir'],
    });
    await checkGpuPolicy(ctx, bundle.spec, { source: 'submit' });
    sources.push(...bundle.sources);
    preparedInputs = bundle.files.map(({ filename, bytes }) => ({ filename, bytes }));

    const validation = await ctx.client.post('/api/v1/validate', { body: bundle.spec });
    const normalized = validation.data?.normalized_job_spec;
    if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
      const error = new Error('BindCraft2 validation returned no normalized job spec.');
      error.exitCode = EXIT.SERVER;
      throw error;
    }
    const normalizedFiles = requiredBindcraft2Inputs(normalized);
    if (JSON.stringify(normalizedFiles) !== JSON.stringify(bundle.required)) {
      const error = new Error('BindCraft2 validation changed the required input file set; no upload was attempted.');
      error.exitCode = EXIT.SERVER;
      throw error;
    }
    body = { ...normalized, name: projectName };
    if (Object.hasOwn(normalized, 'allowed_gpus')
        && JSON.stringify(normalized.allowed_gpus) !== JSON.stringify(bundle.spec.allowed_gpus)) {
      await checkGpuPolicy(ctx, body, { source: 'submit normalized spec', advise: false });
    }
    const projectType = typeof normalized.project_type === 'string' && normalized.project_type
      ? normalized.project_type : bundle.projectType;

    if (recoveryIntentId !== undefined) {
      body.input_upload_intent_id = String(recoveryIntentId);
    } else {
      requireOperationStorage(ctx.config.rootDir);
      account = await accountIdentity(ctx);
      const init = await ctx.client.post('/api/v1/uploads/init', {
        body: {
          project_name: projectName,
          project_type: projectType,
          target_filename: bundle.primaryFilename,
          input_files: bundle.required,
        },
      });
      const upload = init.data ?? {};
      const descriptors = validateBundleUploads(upload.uploads, bundle.required);
      if (typeof upload.upload_intent_id !== 'string' || !upload.upload_intent_id) {
        const error = new Error('Upload authorization returned no intent id.');
        error.exitCode = EXIT.SERVER;
        throw error;
      }
      try {
        const byName = new Map(bundle.files.map((entry) => [entry.filename, entry.bytes]));
        for (const descriptor of descriptors) {
          await putInput(
            ctx.fetchImpl,
            descriptor.upload_url,
            descriptor.upload_headers,
            byName.get(descriptor.filename),
            ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          );
        }
      } catch (error) {
        appendUploadReservationHint(error, upload);
        throw error;
      }
      uploadedIntent = { id: upload.upload_intent_id, expiresAt: upload.expires_at,
        sourceArg: flags['input-dir'] !== undefined ? '--input-dir INPUT_DIR' : '--input INPUT_FILE' };
      body.input_upload_intent_id = upload.upload_intent_id;
    }
  } else if (flags['input-dir'] !== undefined) {
    throw usageError('submit: --input-dir is supported only for BindCraft2 jobs.');
  } else if (flags.input !== undefined) {
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
    await checkGpuPolicy(ctx, body, { source: 'submit' });
    preparedBytes = Buffer.from(prepared.text, 'utf8');
    if (!ctx.json) {
      for (const message of prepared.messages) printProgress(message);
    }

    if (recoveryIntentId !== undefined) {
      body.input_upload_intent_id = String(recoveryIntentId);
    } else {
      const projectType = typeof prepared.spec.project_type === 'string'
        ? prepared.spec.project_type
        : prepared.spec.protocol_config?.design_type;
      if (typeof projectType !== 'string' || !projectType) {
        throw usageError('submit: job.json must identify project_type (or protocol_config.design_type) when --input is used.');
      }
      requireOperationStorage(ctx.config.rootDir);
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
      try {
        await putInput(
          ctx.fetchImpl,
          upload.upload_url,
          upload.upload_headers,
          preparedBytes,
          ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        );
      } catch (error) {
        appendUploadReservationHint(error, upload);
        throw error;
      }
      uploadedIntent = { id: upload.upload_intent_id, expiresAt: upload.expires_at, sourceArg: '--input INPUT_FILE' };
      body.input_upload_intent_id = upload.upload_intent_id;
    }
  }

  if (flags.input === undefined && flags['input-dir'] === undefined) {
    await checkGpuPolicy(ctx, body, { source: 'submit' });
  }
  account ??= await accountIdentity(ctx);
  let operation;
  try {
    operation = createOperation(ctx, {
      action: 'project:create', request: { method: 'POST', path: '/api/v1/projects', body },
      account, sources, preparedBytes, preparedInputs,
    });
  } catch (error) {
    if (uploadedIntent) appendUnjournaledUploadHint(error, uploadedIntent, projectName);
    throw error;
  }
  const res = await sendOperation(ctx, operation);
  const compactDefault = usesCompactCampaignPresentation(body) && flags.details !== true;
  if (operation.state === 'in_progress') {
    if (flags.wait === true) {
      await waitForOperation(ctx, operation);
      return waitAndReport(ctx, operation.project_id, operation);
    }
    if (ctx.json) {
      if (compactDefault) printJson({ data: compactSubmission({ ...res.data, status: 'submission_in_progress' }, body, operation.id) });
      else printJson({ data: { ...res.data, local_operation_id: operation.id }, meta: res.meta });
    }
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
      if (compactDefault) {
        printJson({ data: compactSubmission(project, body, operation.id) });
      } else {
        printJson({ data: res.data, meta: { ...res.meta, local_operation_id: operation.id }, request_id: res.requestId });
      }
    }
  } else {
    if (!compactDefault) {
      printData(`project_id: ${projectId}`);
      if (jobId) printData(`job_id: ${jobId}`);
      if (project.status) printData(`status: ${project.status}`);
    } else {
      const submission = compactSubmission(project, body, operation.id);
      printData(`${projectName} — submitted`);
      printData(`Project: ${projectId}${jobId ? ` · Job: ${jobId}` : ''}`);
      printData(`Protocol: ${submission.accepted_settings.protocol ?? 'unknown'} · Binder: ${submission.accepted_settings.binder_format ?? 'unknown'}`);
      printData(`Requested: ${submission.accepted_settings.requested_designs ?? 'unknown'} accepted design(s) · Attempt limit: ${submission.accepted_settings.attempt_limit ?? 'unknown'}`);
      printData(`Next: ${submission.next.command}`);
    }
  }

  if (flags.wait !== true) {
    printProgress(`Track with: ariax status ${projectId} --wait`);
    return { projectId, operationId: operation.id };
  }
  return waitAndReport(ctx, String(projectId), operation);
}

function validateBundleUploads(value, required) {
  if (!Array.isArray(value) || value.length !== required.length) {
    const error = new Error('Upload authorization did not describe the exact BindCraft2 input bundle.');
    error.exitCode = EXIT.SERVER;
    throw error;
  }
  const names = value.map((entry) => entry?.filename);
  if (new Set(names).size !== names.length || JSON.stringify([...names].sort()) !== JSON.stringify(required)
      || value.some((entry) => typeof entry.upload_url !== 'string' || !entry.upload_url
        || entry.upload_method !== 'PUT' || !entry.upload_headers || typeof entry.upload_headers !== 'object'
        || Array.isArray(entry.upload_headers))) {
    const error = new Error('Upload authorization returned invalid or mismatched BindCraft2 upload descriptors.');
    error.exitCode = EXIT.SERVER;
    throw error;
  }
  return value;
}

function appendUploadReservationHint(error, upload) {
  const expiresAt = typeof upload.expires_at === 'string' && Number.isFinite(Date.parse(upload.expires_at))
    ? upload.expires_at
    : null;
  error.message += expiresAt
    ? ` Project creation was not requested. The project-name reservation may remain active until ${expiresAt}; wait until then, then rerun the same command.`
    : ' Project creation was not requested. The project-name reservation may remain active for up to 15 minutes; wait for it to expire, then rerun the same command.';
}

function requireOperationStorage(rootDir) {
  try {
    verifyOperationStorage(rootDir);
  } catch (error) {
    error.message += ' No upload was reserved. Retry with --root-dir WRITABLE_DIRECTORY.';
    throw error;
  }
}

function appendUnjournaledUploadHint(error, intent, projectName) {
  const expiry = typeof intent.expiresAt === 'string' && Number.isFinite(Date.parse(intent.expiresAt))
    ? ` before ${intent.expiresAt}` : ' before the upload intent expires (normally 15 minutes)';
  error.message += ` Project creation was not requested. Uploaded input intent ${intent.id} can be reused${expiry}. No operation ID was returned, so ariax recover cannot use this attempt. Keep the original job and input bytes, account, and API origin. Retry with a writable root directory: ariax submit -f JOB_JSON ${intent.sourceArg} --name ${projectName} --input-upload-intent-id ${intent.id} --root-dir WRITABLE_DIRECTORY.`;
}

async function putInput(fetchImpl, url, headers, body, timeoutMs) {
  const destination = validateTransferUrl(url, 'Upload');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(destination, {
      method: 'PUT',
      headers: headers && typeof headers === 'object' ? headers : {},
      body,
      signal: controller.signal,
      redirect: 'error',
    });
  } catch (cause) {
    const error = new Error(controller.signal.aborted
      ? `Direct input upload timed out after ${timeoutMs}ms.`
      : 'Direct input upload failed before receiving a response.');
    error.exitCode = EXIT.NETWORK;
    error.retryable = true;
    error.cause = cause;
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const error = new Error(`Direct input upload failed (HTTP ${response.status}).`);
    error.exitCode = EXIT.SERVER;
    throw error;
  }
}

function extractFailureFromJob(job) {
  if (!job || typeof job !== 'object') return { code: null, message: null };
  const nested = job.failure && typeof job.failure === 'object' ? job.failure : null;
  const code = [
    nested?.code,
    job.error_code,
    job.failure_code,
    job.failure_reason,
    job.stop_reason,
  ].find((v) => typeof v === 'string' && v.trim())?.trim() ?? null;
  const message = [
    nested?.message,
    job.error_message,
    job.failure_message,
    job.stop_message,
  ].find((v) => typeof v === 'string' && v.trim())?.trim() ?? null;
  return { code, message };
}

async function fetchLatestJobDetail(client, projectId, projectPayload) {
  const source = projectPayload?.project ?? projectPayload ?? {};
  const inlineJobs = Array.isArray(source.jobs) ? source.jobs : [];
  let job = inlineJobs[0] ?? null;
  let { code, message } = extractFailureFromJob(job);
  if (!job || !code) {
    try {
      const res = await client.get('/api/v1/jobs', {
        query: { project_id: projectId, limit: 1 },
        attempts: 1,
      });
      const list = Array.isArray(res.data)
        ? res.data
        : (Array.isArray(res.data?.jobs) ? res.data.jobs : (Array.isArray(res.data?.items) ? res.data.items : []));
      if (list[0]) {
        const fetchedFailure = extractFailureFromJob(list[0]);
        if (!job || fetchedFailure.code || fetchedFailure.message) {
          job = list[0];
          code = fetchedFailure.code ?? code;
          message = fetchedFailure.message ?? message;
        }
      }
    } catch {
      // Best-effort job lookup must not mask the observed project outcome.
    }
  }
  const projectCode = [
    source.control?.stop_reason,
    source.stop_reason,
    source.bindcraft2_progress?.stop_reason,
    source.bindcraft2_progress?.scheduling_reason,
  ].find((v) => typeof v === 'string' && v.trim())?.trim() ?? null;
  const failureReason = code ?? projectCode ?? null;
  const latestJob = job ? {
    id: job.id ?? null,
    status: job.status ?? job.state ?? null,
    ...(code ? { error_code: code } : {}),
    ...(message ? { message } : {}),
    ...(job.failure && typeof job.failure === 'object' ? { failure: job.failure } : {}),
  } : null;
  return { latestJob, failureReason, failureMessage: message };
}

export async function waitAndReport(ctx, projectId, operation, waitOpts = {}) {
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
    printProgress('Waiting for project execution to settle (completed/failed/paused/aborted)…');
    let lastProgress = null;
    const out = await waitForProject(ctx.client, projectId, {
      pollIntervalMs: pollMs,
      timeoutMs,
      shouldStop: () => stopped,
      onTick: ({ project, status, elapsedMs }) => {
        const fingerprint = waitProgressFingerprint(project, status);
        if (fingerprint !== lastProgress) {
          lastProgress = fingerprint;
          printProgress(waitProgressLine(project, status, elapsedMs));
        }
      },
    });
    if (stopped || out.stopped) {
      printProgress('Interrupted. Remote work continues (SIGINT never aborts).');
      printProgress(resumeHint({ projectId, rootDir: ctx.config.rootDir, rootDirExplicit: ctx.config.rootDirExplicit }));
      const err = new Error('Interrupted; remote work continues.');
      err.exitCode = EXIT.INTERRUPTED;
      throw err;
    }
    if (out.timedOut) {
      printProgress(`Wait timed out (last status: ${out.status ?? 'unknown'}). Remote work continues.`);
      printProgress(resumeHint({ projectId, rootDir: ctx.config.rootDir, rootDirExplicit: ctx.config.rootDirExplicit }));
      const err = new Error('Wait timed out; remote work continues.');
      err.exitCode = EXIT.NETWORK;
      throw err;
    }
    // Each new mutation has its own permanent journal. Only legacy waits use resume.json.
    if (!operation) await clearResume(ctx.config.rootDir, projectId);
    const normalizedStatus = String(out.status ?? '').toLowerCase();
    const compactDefault = usesCompactCampaignPresentation(out.project) && ctx.flags.details !== true;
    const compact = compactDefault ? compactCampaign(out.project, projectId) : null;
    const shouldInspectLatestJob = normalizedStatus === 'failed'
      || normalizedStatus === 'paused'
      || normalizedStatus === 'aborted'
      || normalizedStatus === 'cancelled';
    const jobInfo = shouldInspectLatestJob
      ? await fetchLatestJobDetail(ctx.client, projectId, out.project)
      : { latestJob: null, failureReason: null, failureMessage: null };

    const shouldFail = normalizedStatus === 'failed'
      || (waitOpts.failOnPaused === true && normalizedStatus === 'paused')
      || (waitOpts.failOnAborted === true && (normalizedStatus === 'aborted' || normalizedStatus === 'cancelled'));

    if (shouldFail) {
      const reasonSuffix = jobInfo.failureReason ? ` (${jobInfo.failureReason})` : '';
      const msgSuffix = jobInfo.failureMessage ? `: ${jobInfo.failureMessage}` : '.';
      const verb = normalizedStatus === 'paused' ? 'fell back to' : 'ended in';
      const err = new Error(`Project ${projectId} ${verb} state "${normalizedStatus}"${reasonSuffix}${msgSuffix}`);
      err.code = jobInfo.failureReason || `project_${normalizedStatus}`;
      err.exitCode = errorCodeToExit(jobInfo.failureReason) ?? EXIT.SERVER;
      err.retryable = ['gpu_provisioning_delayed', 'gpu_capacity_unavailable', 'msa_service_unavailable'].includes(jobInfo.failureReason);
      const jobLogHint = jobInfo.latestJob?.id ? ` or inspect logs with ariax logs ${jobInfo.latestJob.id}` : '';
      err.action = normalizedStatus === 'paused'
        ? `Inspect ariax status ${projectId}${jobLogHint}. Adjust GPU preferences or retry ariax restart ${projectId} --wait once capacity is available.`
        : `Inspect ariax status ${projectId}, ariax results ${projectId}${jobLogHint}.`;
      err.details = {
        project_id: projectId,
        status: normalizedStatus,
        lifecycle: compact?.lifecycle ?? { state: normalizedStatus, terminal: normalizedStatus !== 'paused' },
        failure_reason: jobInfo.failureReason,
        ...(jobInfo.failureMessage ? { failure_message: jobInfo.failureMessage } : {}),
        ...(jobInfo.latestJob ? { latest_job: jobInfo.latestJob } : {}),
        ...(compact ? { project: compact } : {}),
      };
      throw err;
    }

    const extraPauseFields = normalizedStatus === 'paused' && (jobInfo.failureReason || jobInfo.latestJob)
      ? {
        ...(jobInfo.failureReason ? { failure_reason: jobInfo.failureReason } : {}),
        ...(jobInfo.latestJob ? { latest_job: jobInfo.latestJob } : {}),
      }
      : {};

    if (ctx.json) {
      if (compactDefault) printJson({ data: { ...compact, ...extraPauseFields }, meta: { waited: true } });
      else printJson({ data: { ...(out.project && typeof out.project === 'object' ? out.project : {}), ...extraPauseFields }, meta: { waited: true, status: out.status } });
    } else {
      if (!compactDefault) {
        printData(`status: ${out.status}`);
        printData(`project_id: ${out.project?.id ?? projectId}`);
        if (jobInfo.failureReason) printData(`failure_reason: ${jobInfo.failureReason}`);
      } else {
        for (const line of campaignStatusLines(compact)) printData(line);
        if (jobInfo.failureReason) printProgress(`Pause/failure reason: ${jobInfo.failureReason}${jobInfo.failureMessage ? ` — ${jobInfo.failureMessage}` : ''}`);
      }
    }
    return { projectId, status: out.status };
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}

export function waitProgressLine(project, status, elapsedMs) {
  const value = project?.project ?? project;
  const summary = bindCraft2ProgressSummary(value);
  return summary
    ? `… ${summary} elapsed=${Math.round(elapsedMs / 1000)}s`
    : `… status=${status ?? 'unknown'} elapsed=${Math.round(elapsedMs / 1000)}s`;
}

export function waitProgressFingerprint(project, status) {
  const value = project?.project ?? project;
  return bindCraft2ProgressSummary(value) ?? `status=${status ?? 'unknown'}`;
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
