/** Credential-free inspection and deterministic input preparation. */
import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { usageError } from '../args.js';
import { EXIT } from '../exit-codes.js';
import { printData, printJson } from '../output.js';
import { MAX_INPUT_SIZE } from '../input.js';
import { loadInputSource, sha256 } from '../input-source.js';
import { prepareStructureInput, protocolId, selectedChains } from '../structure-input.js';
import { compactInspection, inputManifest, inspectChains, stableJson } from '../input-manifest.js';

function invalid(message) {
  return Object.assign(new Error(message), {exitCode:EXIT.VALIDATION, code:'validation_failed'});
}

function readJob(filename) {
  let bytes;
  try {
    const stat = fs.statSync(filename);
    if (!stat.isFile()) throw new Error('Path is not a file.');
    if (stat.size > MAX_INPUT_SIZE) throw new Error('Job JSON exceeds the 10 MB limit.');
    bytes = fs.readFileSync(filename);
  } catch (error) {
    throw usageError(`Cannot read job file: ${error.message}`);
  }
  let spec;
  if (bytes.length > MAX_INPUT_SIZE) throw invalid('Job JSON exceeds the 10 MB limit.');
  try { spec = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); } catch { throw invalid('Job file must contain valid JSON.'); }
  if (!spec || Array.isArray(spec) || typeof spec !== 'object') throw invalid('Job JSON must be an object.');
  const protocol = protocolId(spec.protocol);
  if (!protocol) throw invalid('Job JSON must identify a supported protocol: bindcraft-v1.5, boltzgen, pxdesign, or esmfold2-pipeline.');
  const chains = selectedChains(spec, protocol);
  if (!chains.length || new Set(chains).size !== chains.length) throw invalid('Job JSON must explicitly select one or more distinct target chains.');
  if (spec.input_upload_intent_id !== undefined) throw invalid('Remove input_upload_intent_id when preparing a new local input copy.');
  stableJson(spec); // Reject non-finite numbers before any normalization or hashing.
  return {spec, bytes};
}

function writePreparedDirectory(directory, files) {
  const target = path.resolve(directory);
  if (fs.existsSync(target)) {
    if (!fs.lstatSync(target).isDirectory()) throw usageError('--output must be a new directory or an identical preparation directory.');
    const identical = Object.entries(files).every(([name, bytes]) => {
      const filename = path.join(target, name);
      if (!fs.existsSync(filename)) return false;
      const stat = fs.lstatSync(filename);
      return stat.isFile() && stat.size === bytes.length && fs.readFileSync(filename).equals(bytes);
    });
    if (identical) return target;
    throw Object.assign(new Error('Output directory already exists with different content; choose a new --output directory.'), {exitCode:EXIT.CONFLICT, code:'input_output_conflict'});
  }
  const parent = path.dirname(target);
  fs.mkdirSync(parent, {recursive:true});
  const staging = fs.mkdtempSync(path.join(parent, '.ariax-inputs-'));
  try {
    for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(staging, name), bytes, {flag:'wx', mode:0o600});
    fs.renameSync(staging, target);
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, {recursive:true, force:true});
  }
  return target;
}

function output(ctx, data) {
  if (ctx.json) printJson({data});
  else printData(stableJson({data}));
}

export async function run(ctx) {
  const [action, ...extra] = ctx.positionals;
  if (!['inspect', 'prepare'].includes(action) || extra.length) {
    throw usageError('Usage: ariax inputs inspect|prepare (--input FILE | --pdb ID) [-f job.json] [--output DIR] [--full]');
  }
  const allowed = action === 'inspect' ? ['input','pdb','file','full'] : ['input','pdb','file','output'];
  for (const flag of Object.keys(ctx.flags)) if (!allowed.includes(flag)) throw usageError(`inputs ${action}: unsupported flag --${flag}.`);
  if (action === 'prepare' && (!ctx.flags.file || !ctx.flags.output)) throw usageError('inputs prepare requires -f job.json and --output DIR.');
  const job = ctx.flags.file !== undefined ? readJob(String(ctx.flags.file)) : null;
  const input = await loadInputSource(ctx.flags, ctx.fetchImpl, ctx.timeoutMs,
    protocolId(job?.spec.protocol) === 'bindcraft' ? 'pdb' : 'cif');
  if (action === 'inspect') {
    const inspection = inspectChains(input, {spec:job?.spec});
    let preparation = null;
    if (job) {
      try {
        const prepared = await prepareStructureInput({spec:job.spec, text:input.text, targetFilename:input.targetFilename});
        preparation = {ready:true, prepared_sha256:sha256(Buffer.from(prepared.text)), job_sha256:sha256(stableJson(prepared.spec)),
          transforms:prepared.transforms, preparation_notes:prepared.messages};
      } catch (error) {
        preparation = {ready:false, error:{code:error.code || 'validation_failed', message:error.message}};
      }
    }
    output(ctx, compactInspection({schema_version:1, kind:'ariax_input_inspection', source:input.source,
      ...inspection, preparation}, ctx.flags.full === true));
    return;
  }

  const prepared = await prepareStructureInput({spec:job.spec, text:input.text, targetFilename:input.targetFilename});
  // The saved copy/job must be exactly what the existing submit command will use.
  const repeated = await prepareStructureInput({spec:prepared.spec, text:prepared.text, targetFilename:input.targetFilename});
  if (repeated.text !== prepared.text || stableJson(repeated.spec) !== stableJson(prepared.spec)) {
    throw invalid('Input preparation is not stable on the prepared copy; no files were written.');
  }
  const manifest = inputManifest(input, prepared, job.spec, job.bytes, ctx.currentBuild);
  const directory = writePreparedDirectory(String(ctx.flags.output), {
    [input.targetFilename]:Buffer.from(prepared.text, 'utf8'),
    'job.json':Buffer.from(stableJson(prepared.spec)),
    'input-manifest.json':Buffer.from(stableJson(manifest)),
  });
  output(ctx, {output_directory:directory, input:path.join(directory,input.targetFilename),
    job:path.join(directory,'job.json'), manifest:path.join(directory,'input-manifest.json'),
    source_sha256:manifest.source.sha256, prepared_sha256:manifest.prepared.sha256, job_sha256:manifest.job.sha256,
    selected_chains:manifest.selected_chains, transforms:manifest.transforms, warnings:manifest.warnings});
}
