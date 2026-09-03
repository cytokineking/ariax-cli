/** `ariax validate -f job.json` — job-spec validation (POST /api/v1/validate). */
import fs from 'node:fs';
import { printData, printJson, printKv, printProgress } from '../output.js';
import { EXIT } from '../exit-codes.js';
import { readAndValidateInput } from '../input.js';
import { createSequencePrompt } from '../sequence-prompt.js';
import { prepareStructureInput } from '../structure-input.js';

/** @param {{ client: any, flags: Record<string, any>, json: boolean }} ctx */
export async function run(ctx) {
  const file = ctx.flags.file || ctx.flags.f;
  if (!file) {
    const err = new Error('Missing job file. Usage: ariax validate -f job.json');
    err.exitCode = EXIT.USAGE;
    throw err;
  }
  let body = readJsonFile(String(file));
  if (ctx.flags.input !== undefined) {
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
    for (const message of prepared.messages) printProgress(message);
  }
  const res = await ctx.client.post('/api/v1/validate', { body });
  if (ctx.json) {
    printJson({ data: res.data, meta: res.meta, request_id: res.requestId });
    return;
  }
  const d = res.data ?? {};
  const valid = d.valid ?? d.ok ?? res.status < 300;
  printKv({
    valid: valid ? 'true' : 'false',
    protocol: d.protocol ?? d.protocol_id ?? '-',
    request_id: res.requestId || '-',
  });
  const errors = d.errors ?? d.field_errors ?? d.details;
  if (Array.isArray(errors) && errors.length > 0) {
    printData('errors:');
    for (const e of errors) {
      printData(`  - ${typeof e === 'string' ? e : JSON.stringify(e)}`);
    }
  } else if (errors && typeof errors === 'object') {
    printData(`errors: ${JSON.stringify(errors)}`);
  }
  if (d.normalized_job_spec && typeof d.normalized_job_spec === 'object') {
    printProgress('Normalized job spec returned by the server (see --json for full output).');
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
