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
import { inspectBindcraft2Bundle, isBindcraft2, prepareBindcraft2Bundle, writeBindcraft2Bundle } from '../bindcraft2-inputs.js';

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
  if (!protocol && !isBindcraft2(spec)) throw invalid('Job JSON must identify a supported protocol: bindcraft-v1.5, bindcraft2, boltzgen, pxdesign, or esmfold2-pipeline.');
  if (!isBindcraft2(spec)) {
    const chains = selectedChains(spec, protocol);
    if (!chains.length || new Set(chains).size !== chains.length) throw invalid('Job JSON must explicitly select one or more distinct target chains.');
  }
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

function shown(value) {
  return value === undefined || value === null ? 'unknown' : String(value);
}

function selectorText(name, selector) {
  if (selector?.validation === 'not_applicable_for_fasta') return null;
  if (!selector?.value) return `${name}=none`;
  return `${name}=${selector.value} (${selector.validated ? 'valid' : 'unverified'}, ${selector.residue_register ?? 'unknown register'})`;
}

function outputBindcraft2Inspection(ctx, inspection) {
  if (ctx.json || ctx.flags.full === true || ctx.flags.details === true) {
    output(ctx, inspection);
    return;
  }
  printData(`BindCraft2 input — ${inspection.ready ? 'ready' : 'not ready'} · ${inspection.project_type ?? 'unknown format'}`);
  printData(`Primary: ${inspection.primary_file ?? 'unknown'}`);
  for (const file of inspection.files) {
    printData(`${file.filename} — ${file.roles.join(', ') || 'input'} · ${file.format}`);
    for (const target of file.targets) {
      const selectors = [selectorText('hotspots', target.hotspots), selectorText('coldspots', target.coldspots)].filter(Boolean);
      const record = target.selected_record ? ` · record ${target.selected_record}` : '';
      const selection = selectors.length ? ` · ${selectors.join(' · ')}` : '';
      printData(`  Target ${target.name ?? 'unnamed'} [${target.chains.join(',')}] (${target.objective ?? 'unknown'})${record}${selection}`);
    }
    for (const chain of file.chains ?? []) {
      const unresolved = chain.unresolved_region_count === null ? 'unresolved unknown' : `${chain.unresolved_region_count} unresolved region(s)`;
      printData(`  Chain ${chain.chain ?? 'unknown'} · ${shown(chain.sequence_length)} aa · ${chain.mapping_status ?? 'mapping unknown'} · ${unresolved}`);
    }
    if (file.chains_truncated) {
      printData(`  Chain preview: ${file.chains.length} of ${file.chain_count}; ${file.selected_chain_count} selected (selected chains shown first)`);
    }
    for (const record of file.records ?? []) printData(`  FASTA ${record.name} · ${shown(record.sequence_length)} aa`);
    if (file.scaffold) {
      printData(`  Scaffold edits: ${file.scaffold.mutate_positions ?? 'none'} (${file.scaffold.validated ? 'valid' : 'unverified'}, ${file.scaffold.residue_register ?? 'unknown register'})`);
    }
    for (const warning of file.warnings) printData(`  Warning: ${warning}`);
  }
  for (const warning of inspection.warnings) printData(`Review: ${warning}`);
}

export async function run(ctx) {
  const [action, ...extra] = ctx.positionals;
  if (!['inspect', 'prepare'].includes(action) || extra.length) {
    throw usageError('Usage: ariax inputs inspect (--input FILE | --input-dir DIR | --pdb ID) [-f job.json] [--full] [--details] | ariax inputs prepare (--input FILE | --input-dir DIR | --pdb ID) -f job.json --output DIR');
  }
  const allowed = action === 'inspect' ? ['input','input-dir','pdb','file','full','details'] : ['input','input-dir','pdb','file','output'];
  for (const flag of Object.keys(ctx.flags)) if (!allowed.includes(flag)) throw usageError(`inputs ${action}: unsupported flag --${flag}.`);
  if (action === 'prepare' && (!ctx.flags.file || !ctx.flags.output)) throw usageError('inputs prepare requires -f job.json and --output DIR.');
  const job = ctx.flags.file !== undefined ? readJob(String(ctx.flags.file)) : null;
  if (job && isBindcraft2(job.spec)) {
    if (ctx.flags.pdb !== undefined) throw usageError('BindCraft2 inputs use --input FILE or --input-dir DIR; RCSB bundle preparation is not supported.');
    const bundle = prepareBindcraft2Bundle({
      spec: job.spec,
      inputFile: ctx.flags.input,
      inputDir: ctx.flags['input-dir'],
    });
    bundle.manifest.prepared_by = {
      name: 'ariax-cli', version: ctx.currentBuild.version, channel: ctx.currentBuild.channel,
      source_revision: ctx.currentBuild.source_revision, source_dirty: ctx.currentBuild.source_dirty,
    };
    if (action === 'inspect') {
      outputBindcraft2Inspection(ctx, inspectBindcraft2Bundle(bundle, {
        full: ctx.flags.full === true,
        details: ctx.flags.details === true,
      }));
      return;
    }
    const directory = writeBindcraft2Bundle(String(ctx.flags.output), bundle);
    output(ctx, {
      output_directory: directory,
      job: path.join(directory, 'job.json'),
      manifest: path.join(directory, 'input-manifest.json'),
      primary_input: path.join(directory, bundle.primaryFilename),
      input_files: bundle.required.map((filename) => path.join(directory, filename)),
      project_type: bundle.projectType,
    });
    return;
  }
  if (ctx.flags['input-dir'] !== undefined) throw usageError('--input-dir is supported only with a BindCraft2 job file.');
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
