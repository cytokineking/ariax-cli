/** `ariax validate -f job.json` — job-spec validation (POST /api/v1/validate). */
import fs from 'node:fs';
import { printData, printJson, printKv, printProgress } from '../output.js';
import { EXIT } from '../exit-codes.js';
import { readAndValidateInput } from '../input.js';
import { createSequencePrompt } from '../sequence-prompt.js';
import { prepareStructureInput, protocolId } from '../structure-input.js';
import { resolveSpecResidueMappings } from '../input-manifest.js';
import { isBindcraft2, prepareBindcraft2Bundle } from '../bindcraft2-inputs.js';
import { compactScientificSettings, usesCompactCampaignPresentation } from '../campaign-presentation.js';
import { checkGpuPolicy } from '../gpu-policy.js';

/** @param {{ client: any, flags: Record<string, any>, json: boolean }} ctx */
export async function run(ctx) {
  const file = ctx.flags.file || ctx.flags.f;
  if (!file) {
    const err = new Error('Missing job file. Usage: ariax validate -f job.json');
    err.exitCode = EXIT.USAGE;
    throw err;
  }
  let body = readJsonFile(String(file));
  if (ctx.flags.input !== undefined && ctx.flags['input-dir'] !== undefined) {
    const err = new Error('Choose only one input source: --input or --input-dir.');
    err.exitCode = EXIT.USAGE;
    throw err;
  }
  if (protocolId(body.protocol) === 'boltzgen'
      && (body.project_type ?? body.protocol_config?.design_type) !== 'miniprotein-small-molecule'
      && ctx.flags.input === undefined) {
    const err = new Error('BoltzGen validation requires --input FILE to check target chains and residues.');
    err.exitCode = EXIT.USAGE;
    throw err;
  }
  let preparationNotes = [];
  let resolvedMappings = {};
  if (isBindcraft2(body)) {
    if (ctx.flags.input === undefined && ctx.flags['input-dir'] === undefined) {
      const err = new Error('BindCraft2 validation requires --input FILE or --input-dir DIR for local bundle validation.');
      err.exitCode = EXIT.USAGE;
      throw err;
    }
    const bundle = prepareBindcraft2Bundle({
      spec: body,
      inputFile: ctx.flags.input,
      inputDir: ctx.flags['input-dir'],
    });
    body = bundle.spec;
    const primaryEntry = bundle.files.find((entry) => entry.filename === bundle.primaryFilename);
    if (primaryEntry) {
      resolvedMappings = resolveSpecResidueMappings(bundle.spec, primaryEntry.text, primaryEntry.filename);
    }
  } else if (ctx.flags['input-dir'] !== undefined) {
    const err = new Error('--input-dir is supported only for BindCraft2 jobs.');
    err.exitCode = EXIT.USAGE;
    throw err;
  } else if (ctx.flags.input !== undefined) {
    const input = readAndValidateInput(String(ctx.flags.input));
    const prompt = createSequencePrompt(ctx);
    let prepared;
    try {
      prepared = await prepareStructureInput({
        spec: body,
        text: input.text,
        targetFilename: input.targetFilename,
        promptSequence: prompt.ask,
      });
    } finally {
      prompt.close();
    }
    body = prepared.spec;
    preparationNotes = Array.isArray(prepared.messages) ? prepared.messages : [];
    resolvedMappings = resolveSpecResidueMappings(prepared.spec, prepared.text, input.targetFilename);
    if (!ctx.json) {
      for (const message of preparationNotes) printProgress(message);
    }
  }
  await checkGpuPolicy(ctx, body, { source: 'validate' });
  const res = await ctx.client.post('/api/v1/validate', { body });
  const normalized = res.data?.normalized_job_spec;
  if (normalized && Object.hasOwn(normalized, 'allowed_gpus')) {
    await checkGpuPolicy(ctx, { ...body, ...normalized }, { source: 'validate normalized spec', advise: false });
  }
  const d = res.data && typeof res.data === 'object' && !Array.isArray(res.data) ? res.data : {};
  const valid = d.valid ?? d.ok ?? res.status < 300;
  const compactDefault = usesCompactCampaignPresentation(body) && ctx.flags.details !== true;
  if (!compactDefault && ctx.json) {
    printJson({
      data: {
        ...d,
        valid: Boolean(valid),
        preparation_notes: preparationNotes,
        ...resolvedMappings,
      },
      meta: res.meta,
      request_id: res.requestId,
    });
    return;
  }
  const errors = d.errors ?? d.field_errors ?? d.details;
  if (compactDefault) {
    const issues = Array.isArray(errors) ? errors : (errors ? [errors] : []);
    const warnings = Array.isArray(d.warnings) ? d.warnings : (Array.isArray(d.notes) ? d.notes : []);
    const compact = {
      schema_version: 1,
      kind: 'ariax_validation',
      valid: Boolean(valid),
      protocol: d.protocol ?? d.protocol_id ?? body.protocol ?? null,
      accepted_settings: compactScientificSettings(d.normalized_job_spec ?? body),
      issues,
      warnings,
      preparation_notes: preparationNotes,
      ...resolvedMappings,
      action: valid ? null : 'Correct the listed fields and run validation again before submitting.',
    };
    if (ctx.json) printJson({ data: compact });
    else {
      printKv({ valid: compact.valid, protocol: compact.protocol, binder_format: compact.accepted_settings.binder_format });
      for (const issue of issues) printData(`issue: ${typeof issue === 'string' ? issue : JSON.stringify(issue)}`);
      for (const warning of warnings) printData(`warning: ${typeof warning === 'string' ? warning : JSON.stringify(warning)}`);
      if (compact.action) printData(`action: ${compact.action}`);
    }
    return compact;
  }
  printKv({
    valid: valid ? 'true' : 'false',
    protocol: d.protocol ?? d.protocol_id ?? '-',
    request_id: res.requestId || '-',
  });
  if (Array.isArray(errors) && errors.length > 0) {
    printData('errors:');
    for (const e of errors) {
      printData(`  - ${typeof e === 'string' ? e : JSON.stringify(e)}`);
    }
  } else if (errors && typeof errors === 'object') {
    printData(`errors: ${JSON.stringify(errors)}`);
  }
  if (d.normalized_job_spec && typeof d.normalized_job_spec === 'object') {
    printProgress('Normalized job spec returned by the server (use --details --json for the full payload).');
  }
}

export function readJsonFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    const e = new Error(`Cannot read file "${file}": ${err.message}`);
    e.exitCode = EXIT.USAGE;
    throw e;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    const e = new Error(`Invalid JSON in "${file}": ${err.message}`);
    e.exitCode = EXIT.VALIDATION;
    throw e;
  }
}
