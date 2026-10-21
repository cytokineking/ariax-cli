#!/usr/bin/env node
// Remote-controller example. It calls the installed CLI and owns no allocation.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parseArgv, usageError } from '../../../../../../src/args.js';
import { atomicWrite } from '../../../../../../src/operations.js';
import { uuid } from '../../../../../../src/commands/forge.js';
import { printJson, printProgress } from '../../../../../../src/output.js';
import { EXIT } from '../../../../../../src/exit-codes.js';

const HARNESS = '8bb8684b2d3185381f4812c286e044d5679bfd6f';
const OPENDDE = 'ddfa1df8aff1babf1fddac4247b7d2351bd0ce9f';
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
const OPTIONS = {
  prepare: ['task-dir', 'run-dir', 'request', 'runner', 'session', 'project', 'output', 'state', 'max-items'],
  submit: ['state'], status: ['state'], stop: ['state'],
  continue: ['state', 'session', 'batch-state', 'items', 'resume'],
};

function regular(file) {
  if (typeof file !== 'string' || !file) throw usageError('A file path is required.');
  const absolute = path.resolve(file);
  for (let current = absolute; ; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw usageError('Paths cannot traverse symlinks.');
    if (path.dirname(current) === current) break;
  }
  return absolute;
}

function read(file) {
  file = regular(file);
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.size > 2 * 1024 * 1024) throw usageError('Expected a regular source/state file up to 2 MiB.');
  return new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file));
}

function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw usageError(`${label} must be a positive integer.`);
  return value;
}

function safeName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw usageError('Native task/item names must be safe file components.');
  return value;
}

function outputPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/workspace/') || value.includes('\\')
      || /[\x00-\x1f\x7f]/.test(value) || value.split('/').slice(1).some(p => !p || p === '.' || p === '..')) {
    throw usageError('Output must be a safe absolute path under /workspace.');
  }
  return value;
}

function noCredentials(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(authorization|token|.*api[_-]?key|.*password|.*secret|.*access[_-]?token)$/i.test(key)) {
      throw usageError('Credential fields cannot enter the scientific bundle.');
    }
    if (typeof child === 'string' && /^https?:\/\//i.test(child)) {
      const url = new URL(child);
      if (url.username || url.password || url.search) throw usageError('Credentialed or parameterized URLs cannot enter the scientific bundle.');
    }
    noCredentials(child);
  }
}

// Only the two one-shot argv shapes emitted by the pinned StructurePredictor.
function savedCommand(meta, options, placement) {
  const command = meta.docker_cmd;
  if (meta.backend !== 'opendde' || !Array.isArray(command) || command.some(value => typeof value !== 'string')) throw usageError('Original native one-shot metadata is required.');
  const environment = new Map();
  const assignment = value => {
    const split = value.indexOf('=');
    if (split < 1 || !value.slice(split + 1) || environment.has(value.slice(0, split))) throw usageError('Invalid or repeated native environment setting.');
    environment.set(value.slice(0, split), value.slice(split + 1));
  };
  const mode = options.execution_mode ?? 'local';
  let index = 0;
  if (mode === 'local' && command[index++] === 'env') {
    while (command[index]?.includes('=')) assignment(command[index++]);
    if (!path.posix.isAbsolute(command[index] ?? '') || !/^python(?:3(?:\.12)?)?$/.test(path.posix.basename(command[index++] ?? ''))
        || !path.posix.isAbsolute(command[index] ?? '') || !command[index++].endsWith('/runner/inference.py')
        || environment.get('CUDA_VISIBLE_DEVICES') !== '0') throw usageError('Require the native local single-GPU Python command.');
  } else if (mode === 'docker' && path.posix.basename(command[0] ?? '') === 'docker' && command[1] === 'run') {
    index = 2;
    const header = new Map();
    while (command[index]?.startsWith('-')) {
      const flag = command[index++];
      if (flag === '--rm') {
        if (header.has(flag)) throw usageError('Repeated native Docker flag.');
        header.set(flag, true);
        continue;
      }
      if (!['--gpus', '--network', '--ipc', '--shm-size', '-e', '-v', '-w'].includes(flag) || !command[index]) throw usageError('Unsupported native Docker command setting.');
      const value = command[index++];
      if (flag === '-e') assignment(value);
      else if (flag !== '-v') {
        if (header.has(flag)) throw usageError('Repeated native Docker setting.');
        header.set(flag, value);
      }
    }
    if (header.get('--rm') !== true || header.get('--gpus') !== '"device=0"' || header.get('--network') !== 'host'
        || header.get('--ipc') !== 'host' || header.get('--shm-size') !== '512g' || header.get('-w') !== '/workspace/OpenDDE'
        || !command[index++] || command[index++] !== 'python3' || command[index++] !== 'runner/inference.py') throw usageError('Require the native Docker single-GPU Python command.');
  } else throw usageError('Unsupported native execution mode or one-shot command shape.');

  const allowedEnvironment = ['NCCL_SOCKET_IFNAME', 'NCCL_IB_DISABLE', 'NCCL_ASYNC_ERROR_HANDLING',
    'OPENDDE_ROOT_DIR', 'TRAINING_DATA_ROOT', 'PYTHONPATH', 'PYTHONHASHSEED', 'CUBLAS_WORKSPACE_CONFIG',
    ...(mode === 'local' ? ['CUDA_VISIBLE_DEVICES'] : [])];
  if ([...environment.keys()].some(key => !allowedEnvironment.includes(key))
      || environment.get('NCCL_SOCKET_IFNAME') !== 'lo' || environment.get('NCCL_IB_DISABLE') !== '1'
      || environment.get('NCCL_ASYNC_ERROR_HANDLING') !== '1'
      || ['OPENDDE_ROOT_DIR', 'TRAINING_DATA_ROOT', 'PYTHONPATH'].some(key => !environment.get(key))) throw usageError('Unsupported or missing native environment/CP setting.');
  const harnessDeterministic = options.deterministic ?? true;
  if (typeof harnessDeterministic !== 'boolean'
      || (harnessDeterministic ? environment.get('PYTHONHASHSEED') !== '0' || environment.get('CUBLAS_WORKSPACE_CONFIG') !== ':4096:8'
        : environment.has('PYTHONHASHSEED') || environment.has('CUBLAS_WORKSPACE_CONFIG'))) throw usageError('Native deterministic environment differs from the FoldRequest.');
  const gpuSpec = value => typeof value === 'string' && ['0', 'all', 'device=0'].includes(value.trim().replace(/^["']|["']$/g, ''));
  if (!gpuSpec(meta.gpus) || (options.gpus !== undefined && !gpuSpec(options.gpus))
      || (options.cp_degree !== undefined && options.cp_degree !== 1)
      || (placement?.cp_degree !== undefined && placement.cp_degree !== 1)
      || (placement?.fold !== undefined && !isDeepStrictEqual(placement.fold, [0]))
      || (options.device !== undefined && !['auto', 'cuda'].includes(options.device))) throw usageError('Native request must select one CUDA GPU at index 0 without CP.');

  const allowed = ['--model_name', '--device', '--seeds', '--dump_dir', '--input_json_path', '--model.N_cycle',
    '--sample_diffusion.N_sample', '--sample_diffusion.N_step', '--use_msa', '--use_template', '--need_atom_confidence',
    '--load_checkpoint_path', ...(mode === 'local' ? ['--data.ccd_components_file', '--data.ccd_components_rdkit_mol_file'] : [])];
  const values = new Map();
  while (index < command.length) {
    const flag = command[index++], value = command[index++];
    if (!allowed.includes(flag) || values.has(flag) || !value) throw usageError('Unsupported, missing or repeated native inference option.');
    values.set(flag, value);
  }
  if (allowed.some(flag => !values.has(flag)) || values.get('--model_name') !== 'opendde_v1' || values.get('--device') !== 'cuda'
      || values.get('--use_msa') !== 'false' || values.get('--use_template') !== 'false' || values.get('--need_atom_confidence') !== 'true') throw usageError('Recorded device/MSA/template/atom-confidence settings conflict with the bounded native request.');
  const input = values.get('--input_json_path'), dump = values.get('--dump_dir');
  if (!path.posix.isAbsolute(input) || !input.endsWith('/input/batch_input.json')
      || dump !== path.posix.join(path.posix.dirname(path.posix.dirname(input)), 'output')
      || (mode === 'docker' && input !== '/workspace/work/input/batch_input.json')
      || (mode === 'local' && (path.posix.basename(values.get('--data.ccd_components_file')) !== 'components.cif'
        || path.posix.basename(values.get('--data.ccd_components_rdkit_mol_file')) !== 'components.cif.rdkit_mol.pkl'))) throw usageError('Recorded native input/output/common-file layout is unsupported.');
  // The builder omits dtype, RNA-MSA, CP and OpenDDE's deterministic flag.
  // Their immutable OpenDDE defaults are fp32, false, single/1 and false.
  if (['dtype', 'use_rna_msa', 'use_template', 'foldcp_mode', 'foldcp_size_cp', 'foldcp_size_dp', 'foldcp_devices'].some(key => options[key] !== undefined)) throw usageError('Unsupported native request override for an omitted inference setting.');
  return { values, harnessDeterministic };
}

function nativeBundle(flags) {
  const files = {};
  for (const name of ['workflow.json', 'snapshot.json', 'control.json']) files[name] = read(path.join(flags['task-dir'], name));
  files['fold-request.json'] = read(flags.request);
  files['batch_input.json'] = read(path.join(flags['run-dir'], 'input', 'batch_input.json'));
  files['meta.json'] = read(path.join(flags['run-dir'], 'meta.json'));
  const data = Object.fromEntries(Object.entries(files).map(([key, text]) => [key, JSON.parse(text)]));
  noCredentials(data);
  const workflow = data['workflow.json'], snapshot = data['snapshot.json'], request = data['fold-request.json'];
  const control = data['control.json'], jobs = data['batch_input.json'], options = request.options ?? {};
  const meta = data['meta.json'];
  const task = safeName(snapshot.task_id);
  if (request.task_id !== task || request.backend !== 'opendde' || workflow.fold_backend !== 'opendde') throw usageError('Native task/backend identities disagree.');
  if (control.stop_requested !== false || Object.keys(control.adjustments ?? {}).length) throw usageError('Native stop/adjustments need explicit review before preparing another batch.');
  if (['use_templates', 'enable_msa_search', 'need_atom_confidence', 'deterministic', 'enable_batch_inference'].some(key => options[key] !== undefined && typeof options[key] !== 'boolean')
      || (options.need_atom_confidence !== undefined && options.need_atom_confidence !== true)
      || options.enable_batch_inference === false
      || (options.subprocess_timeout_seconds !== undefined && options.subprocess_timeout_seconds !== 7200)) throw usageError('Unsupported native boolean/batch/timeout setting.');
  if (!['local', 'docker'].includes(options.execution_mode ?? 'local') || options.use_msa !== false
      || options.enable_msa_search || options.use_templates || options.need_atom_confidence === false
      || (request.placement?.cp_degree !== undefined && request.placement.cp_degree !== 1)
      || (request.placement?.fold !== undefined && !isDeepStrictEqual(request.placement.fold, [0]))) {
    throw usageError('This saved-batch scope requires one GPU, explicit use_msa=false, atom confidence and no API/search/templates.');
  }
  const { values, harnessDeterministic } = savedCommand(meta, options, request.placement);
  const checkpointFile = values.get('--load_checkpoint_path');
  if (typeof checkpointFile !== 'string' || !['opendde.pt', 'opendde_abag.pt'].includes(path.basename(checkpointFile))) throw usageError('Record the actual native checkpoint path before bridging this batch.');
  const checkpoint = path.basename(checkpointFile) === 'opendde_abag.pt' ? 'abag' : 'general';
  if ((options.checkpoint_path && path.basename(options.checkpoint_path) !== path.basename(checkpointFile))
      || ((options.design_type ?? workflow.design_type) === 'minibinder' && checkpoint !== 'general')) throw usageError('Checkpoint choice differs from the native model request.');
  const settings = { checkpoint, cycle: positive(options.recycling_cycles === undefined ? 10 : options.recycling_cycles, 'cycles'),
    step: positive(options.diffusion_steps === undefined ? 200 : options.diffusion_steps, 'steps'),
    samples: positive(options.diffusion_samples === undefined ? 1 : options.diffusion_samples, 'samples'),
    dtype: 'fp32', use_msa: false, use_template: false, use_rna_msa: false, deterministic: false };
  for (const [flag, value] of [['--model.N_cycle', settings.cycle], ['--sample_diffusion.N_step', settings.step], ['--sample_diffusion.N_sample', settings.samples]]) {
    if (values.get(flag) !== String(value)) throw usageError('Recorded native inference settings differ from the FoldRequest.');
  }
  const seeds = options.seeds ?? [42];
  if (!Array.isArray(seeds) || !seeds.length || seeds.some(seed => !Number.isSafeInteger(seed))
      || values.get('--seeds') !== seeds.join(',')) throw usageError('Recorded native seeds differ from the explicit FoldRequest seeds.');
  if (!Array.isArray(jobs) || !jobs.length || !Array.isArray(request.candidates) || jobs.length !== request.candidates.length
      || meta.num_inputs !== jobs.length) throw usageError('Native request order and prepared batch metadata must have the same item count.');
  const ids = new Set();
  jobs.forEach((job, index) => {
    if (job.name !== `input_${String(index).padStart(4, '0')}`) throw usageError('Prepared native batch input order changed.');
    safeName(job.name);
    const candidate = request.candidates[index];
    if (typeof candidate.candidate_id !== 'string' || !candidate.candidate_id || ids.has(candidate.candidate_id)) throw usageError('Original distinct candidate IDs are required.');
    ids.add(candidate.candidate_id);
    if (!Array.isArray(job.modelSeeds) || !job.modelSeeds.length || job.modelSeeds.some(seed => !Number.isSafeInteger(seed))
        || new Set(job.modelSeeds).size !== job.modelSeeds.length || !isDeepStrictEqual(job.modelSeeds, options.seeds ?? [42])) throw usageError('Preserve the original explicit native seeds; symbolic random seeds need separate readiness work.');
    const binderIds = options.binder_chain_ids ?? workflow.binder_chain_ids;
    let chains = candidate.chains ?? candidate.metadata?.chains;
    if (!chains || !Object.keys(chains).length) {
      if (!Array.isArray(binderIds) || binderIds.length !== 1) throw usageError('Paired binders require original per-chain sequences.');
      chains = { [binderIds[0]]: candidate.sequence };
    }
    const expected = { ...(options.target_chains ?? workflow.target_chains), ...chains };
    const sequence = value => typeof value === 'string' ? value : value?.sequence;
    const actual = Object.fromEntries(job.sequences.map(entity => {
      const protein = entity.proteinChain;
      if (!protein || protein.id?.length !== 1 || protein.count !== 1 || protein.unpairedMsa || protein.pairedMsa) throw usageError('Only original one-copy protein chain inputs without MSA are in this scope.');
      return [protein.id[0], protein.sequence];
    }));
    if (!isDeepStrictEqual(Object.fromEntries(Object.entries(expected).map(([id, value]) => [id, sequence(value)])), actual)
        || Object.keys(actual).length !== job.sequences.length || job.covalent_bonds?.length) throw usageError('Candidate/target chains differ from the native prepared batch.');
  });
  return { harness_source: HARNESS, task_id: task, files, settings, harness_deterministic: harnessDeterministic };
}

function cli(root, args, allowMissing = false) {
  let stdout;
  try { stdout = execFileSync('ariax', ['--root-dir', root, '--json', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 2 * 1024 * 1024 }); }
  catch (error) {
    if (allowMissing && error.status === EXIT.NOT_FOUND) return null;
    // The CLI's envelope is safe; arbitrary subprocess diagnostics are not retained.
    let body;
    try { body = JSON.parse(String(error.stdout)); } catch { /* use a bounded generic error */ }
    const failure = new Error(body?.error?.message ?? `Installed ariax failed with exit ${error.status ?? 'unknown'}; inspect the same IDs.`);
    failure.exitCode = error.status ?? EXIT.SERVER;
    throw failure;
  }
  const body = JSON.parse(stdout);
  if (!body.data) throw new Error('Installed CLI returned no data envelope.');
  return body.data;
}

function argv(record, attempt) {
  return ['forge', 'run', attempt.session_id, '--tool', 'opendde', '--gpus', '0', '--command-id', attempt.command_id,
    '--timeout-seconds', '7200', '--', 'python', `/inputs/${attempt.prefix}/native_batch.py`, 'run',
    '--bundle', `/inputs/${attempt.prefix}/bundle.json`, '--output', record.output, '--command-id', attempt.command_id,
    ...(attempt.items ? ['--continue', '--items', ...attempt.items] : []),
    ...(attempt.max_items ? ['--max-items', String(attempt.max_items)] : [])];
}

function checkSession(record, sessionId) {
  const session = cli(record.root_dir, ['forge', 'status', sessionId]);
  if (session.project_id !== record.project_id || session.state !== 'available'
      || session.control?.human_resume_required !== false || !session.tools?.some(tool => tool.tool === 'opendde' && tool.state === 'ready')) throw usageError('An available same-project session with cleared human hold and ready OpenDDE is required.');
}

function submit(record, attempt) {
  const accepted = cli(record.root_dir, ['forge', 'command', attempt.session_id, attempt.command_id], true);
  if (accepted) return accepted;
  const nativeControl = JSON.parse(read(path.join(record.native_task_dir, 'control.json')));
  if (!attempt.items && (nativeControl.stop_requested !== false || Object.keys(nativeControl.adjustments ?? {}).length)) throw usageError('Native task control changed; inspect it before another submission.');
  checkSession(record, attempt.session_id);
  for (const [name, file, id] of [['bundle.json', record.bundle_file, attempt.bundle_input_id], ['native_batch.py', record.runner_file, attempt.runner_input_id]]) {
    const input = cli(record.root_dir, ['forge', 'inputs', 'add', attempt.session_id, '--file', file, '--path', `${attempt.prefix}/${name}`, '--input-id', id]);
    if (input.state === 'failed') throw new Error('Input import failed; inspect its existing input ID.');
    if (input.state !== 'ready') return { state: 'input_pending', input_id: id, command_id: attempt.command_id };
  }
  return cli(record.root_dir, argv(record, attempt));
}

function attempt(session, task, items, maxItems) {
  const id = randomUUID();
  return { session_id: uuid(session, 'session ID'), command_id: id, prefix: `harness/${task}/${id}`,
    bundle_input_id: randomUUID(), runner_input_id: randomUUID(), ...(items ? { items } : {}), ...(maxItems ? { max_items: maxItems } : {}) };
}

function main() {
  const { command, flags, globals, positionals, passthrough } = parseArgv(process.argv.slice(2));
  if (!OPTIONS[command] || positionals.length || passthrough || Object.keys(flags).some(flag => !OPTIONS[command].includes(flag))
      || Object.keys(globals).some(flag => !['root-dir', 'json'].includes(flag))) throw usageError('Use prepare, submit, status, stop or continue with the documented flags.');
  const stateFile = regular(flags.state);
  if (command === 'prepare') {
    const bundle = nativeBundle(flags);
    const root = regular(globals['root-dir'] ?? path.dirname(stateFile));
    const record = { harness_source: HARNESS, project_id: uuid(flags.project, 'project ID'), root_dir: root,
      output: outputPath(flags.output), native_task_dir: regular(flags['task-dir']),
      bundle_file: `${stateFile}.bundle.json`, runner_file: `${stateFile}.runner.py`,
      attempts: [attempt(flags.session, bundle.task_id, null, flags['max-items'] === undefined ? null : positive(Number(flags['max-items']), 'max-items'))] };
    if (fs.existsSync(stateFile) || fs.existsSync(record.bundle_file) || fs.existsSync(record.runner_file)) throw usageError('Use the existing state and IDs; preparation never replaces an earlier intent.');
    const bundleText = JSON.stringify(bundle, null, 2) + '\n';
    if (Buffer.byteLength(bundleText) > 2 * 1024 * 1024) throw usageError('The saved-batch source bundle exceeds 2 MiB.');
    atomicWrite(record.bundle_file, bundleText, true);
    atomicWrite(record.runner_file, read(flags.runner), true);
    atomicWrite(stateFile, JSON.stringify(record, null, 2) + '\n', true);
    return { state: 'prepared', command_id: record.attempts[0].command_id, scope: 'saved_fold_batch', native_campaign_complete: false };
  }
  const record = JSON.parse(read(stateFile));
  if (record.harness_source !== HARNESS) throw usageError('State belongs to another source revision.');
  if (globals['root-dir'] && regular(globals['root-dir']) !== record.root_dir) throw usageError('Keep the original CLI root directory.');
  let current = record.attempts.at(-1);
  if (command === 'status') return cli(record.root_dir, ['forge', 'command', current.session_id, current.command_id], true) ?? { state: 'not_submitted', command_id: current.command_id };
  if (command === 'stop') return cli(record.root_dir, ['forge', 'cancel', current.session_id, current.command_id]);
  if (command === 'continue') {
    if (!flags.resume) throw usageError('Continuation requires an explicit --resume choice.');
    const previous = cli(record.root_dir, ['forge', 'command', current.session_id, current.command_id]);
    if (!TERMINAL.has(previous.state)) throw usageError('Prior command is active or uncertain; inspect its existing ID before another attempt.');
    const bundle = JSON.parse(read(record.bundle_file)), batch = JSON.parse(read(flags['batch-state']));
    if (batch.source_commit !== OPENDDE || !isDeepStrictEqual(batch.settings, bundle.settings)
        || !isDeepStrictEqual(batch.input_jobs, JSON.parse(bundle.files['batch_input.json']))) throw usageError('Saved continuation state differs from original inputs/settings/source.');
    const items = String(flags.items ?? '').split(',').map(safeName);
    if (new Set(items).size !== items.length || items.some(name => !batch.items?.some(item => item.name === name && item.state !== 'succeeded'))) throw usageError('Name distinct unfinished native items explicitly.');
    checkSession(record, uuid(flags.session, 'session ID'));
    current = attempt(flags.session, bundle.task_id, items);
    record.attempts.push(current);
    atomicWrite(stateFile, JSON.stringify(record, null, 2) + '\n');
  }
  return submit(record, current);
}

try { printJson({ data: main() }); }
catch (error) { printProgress(`Harness batch bridge: ${error.message}`); process.exitCode = error.exitCode ?? EXIT.USAGE; }
