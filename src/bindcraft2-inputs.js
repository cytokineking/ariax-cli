/** Deterministic BindCraft2 input-bundle preparation. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { usageError } from './args.js';
import { EXIT } from './exit-codes.js';
import { MAX_INPUT_SIZE, validateInputBytes } from './input.js';
import { parseStructureInput } from './structure-input.js';
import { compactInspection, inspectChains } from './input-manifest.js';

const SAFE_INPUT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.(?:pdb|cif|fasta)$/;
const AMINO_ACIDS = /^[ACDEFGHIKLMNPQRSTVWY]+$/;
const PROJECT_TYPES = Object.freeze({
  binder: 'miniprotein', peptide: 'peptide', cyclic_peptide: 'cyclic-peptide',
  VHH: 'vhh', scFv: 'scfv', Fab: 'fab', ARP: 'arp',
  large_binder: 'protein', multidomain: 'protein', homo_oligomer: 'protein',
});
const LEGACY_MODALITIES = Object.freeze({ DARPin: 'ARP', darpin: 'ARP' });
const NATIVE_EDIT = /([A-Za-z]+)(\d+)(?:-(\d+))?(?:\(([0-9,\-]+)\))?((?:[+-][A-Za-z]+|[*!])*)/g;
const NATIVE_FLAGS = new Set([
  'NONE', 'DESIGN', 'TEMPLATE', 'SEQUENCE', 'CONTACT',
  'HOTSPOT', 'COLDSPOT', 'CYCLIC', 'PADDING',
]);

function invalid(message) {
  return Object.assign(new Error(message), { exitCode: EXIT.VALIDATION, code: 'validation_failed' });
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isBindcraft2(spec) {
  return String(spec?.protocol || '').trim().toLowerCase() === 'bindcraft2';
}

export function normalizeBindcraft2Spec(spec) {
  if (!isBindcraft2(spec)) throw invalid('Job JSON protocol must be bindcraft2.');
  const prepared = structuredClone(spec);
  const config = prepared.protocol_config;
  if (!isObject(config)) throw invalid('BindCraft2 protocol_config is required.');
  if (config.schema_version !== 1) throw invalid('BindCraft2 protocol_config.schema_version must be integer 1.');
  if (!Array.isArray(config.modality) || !config.modality.length) {
    throw invalid('BindCraft2 protocol_config.modality must identify a binder format.');
  }
  config.modality[0] = LEGACY_MODALITIES[config.modality[0]] || config.modality[0];
  if (!PROJECT_TYPES[config.modality[0]]) {
    throw invalid(`Unsupported BindCraft2 modality: ${String(config.modality[0])}.`);
  }
  if (!Array.isArray(config.targets) || !config.targets.length || config.targets.length > 8) {
    throw invalid('BindCraft2 protocol_config.targets must contain 1-8 targets.');
  }
  if (!isObject(config.binder)) throw invalid('BindCraft2 protocol_config.binder is required.');
  return prepared;
}

export function bindcraft2ProjectType(spec) {
  const prepared = normalizeBindcraft2Spec(spec);
  return PROJECT_TYPES[prepared.protocol_config.modality[0]];
}

export function requiredBindcraft2Inputs(spec) {
  const prepared = normalizeBindcraft2Spec(spec);
  const config = prepared.protocol_config;
  const names = [];
  for (const [index, target] of config.targets.entries()) {
    if (!isObject(target) || !SAFE_INPUT.test(String(target.input_file || ''))) {
      throw invalid(`BindCraft2 target ${index + 1} requires a safe .pdb, .cif, or .fasta input_file basename.`);
    }
    if (!Array.isArray(target.chains) || !target.chains.length
        || target.chains.some((chain) => !/^[A-Za-z0-9]+$/.test(String(chain)))
        || new Set(target.chains).size !== target.chains.length) {
      throw invalid(`BindCraft2 target ${index + 1} requires distinct alphanumeric chain IDs.`);
    }
    names.push(target.input_file);
  }
  if (!['input.pdb', 'input.cif'].includes(config.targets[0].input_file)) {
    throw invalid('BindCraft2 currently requires a structured primary target named input.pdb or input.cif.');
  }
  if (config.binder.scaffold_file !== undefined) {
    if (!SAFE_INPUT.test(String(config.binder.scaffold_file || ''))
        || String(config.binder.scaffold_file).endsWith('.fasta')) {
      throw invalid('BindCraft2 binder.scaffold_file must be a safe .pdb or .cif basename.');
    }
    names.push(config.binder.scaffold_file);
  }
  const unique = [...new Set(names)].sort();
  if (unique.length > 9) throw invalid('BindCraft2 input bundles may contain at most nine unique files.');
  return unique;
}

function readRegularFile(filename) {
  let stat;
  try { stat = fs.lstatSync(filename); }
  catch (error) { throw usageError(`Cannot read BindCraft2 input "${filename}": ${error.message}`); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw invalid(`BindCraft2 input must be a regular file, not a symlink: ${filename}.`);
  if (!stat.size) throw invalid(`BindCraft2 input is empty: ${filename}.`);
  if (stat.size > MAX_INPUT_SIZE) throw invalid(`BindCraft2 input exceeds the 10 MB per-file limit: ${filename}.`);
  return fs.readFileSync(filename);
}

function decodeText(bytes, filename) {
  if (bytes.includes(0)) throw invalid(`BindCraft2 input must be UTF-8 text: ${filename}.`);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw invalid(`BindCraft2 input must be UTF-8 text: ${filename}.`); }
}

function fastaRecords(text, filename) {
  const records = new Map();
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('>')) {
      current = line.slice(1).trim().split(/\s+/, 1)[0];
      if (!/^[A-Za-z0-9]+$/.test(current) || records.has(current)) {
        throw invalid(`BindCraft2 FASTA requires distinct alphanumeric record names: ${filename}.`);
      }
      records.set(current, '');
    } else {
      if (!current) throw invalid(`BindCraft2 FASTA sequence appears before a named record: ${filename}.`);
      records.set(current, records.get(current) + line.toUpperCase());
    }
  }
  if (!records.size || [...records.values()].some((sequence) => !sequence || !AMINO_ACIDS.test(sequence))) {
    throw invalid(`BindCraft2 FASTA requires nonempty standard amino-acid sequences: ${filename}.`);
  }
  return records;
}

function nativeSelections(value, chains, { scaffold, label }) {
  if (!value) return [];
  const original = String(value);
  if (scaffold) {
    if (!/^[A-Za-z0-9,*!()+\-]+$/.test(original)) {
      throw invalid(`${label} contains an invalid native residue/edit selection.`);
    }
  } else if (!/^[A-Za-z0-9,*()\-]+(?:,[A-Za-z0-9,*()\-]+)*$/.test(original)) {
    throw invalid(`${label} contains an invalid native residue selection.`);
  }

  // Match the platform/native convention: only target selections may omit a
  // chain, and each omitted chain resolves to the first explicitly selected one.
  const selection = scaffold
    ? original
    : original.split(',').map((span) => (/^[A-Za-z]/.test(span) ? span : `${chains[0]}${span}`)).join(',');
  const matcher = new RegExp(NATIVE_EDIT.source, 'g');
  const parsed = [];
  let position = 0;
  let match;
  while ((match = matcher.exec(selection)) !== null) {
    const separator = selection.slice(position, match.index);
    if ((parsed.length === 0 && separator) || (parsed.length > 0 && separator !== ',')) {
      throw invalid(`${label} contains an invalid native ${scaffold ? 'edit' : 'residue selection'}.`);
    }
    position = matcher.lastIndex;
    const [, chain, startText, endText, lengths, flags] = match;
    if (!scaffold && (lengths || flags)) {
      throw invalid(`${label} contains an invalid native residue selection; target spans cannot resize or edit residues.`);
    }
    const namedFlags = [...flags.matchAll(/[+-]([A-Za-z]+)/g)].map((entry) => entry[1]);
    if (namedFlags.some((flag) => !NATIVE_FLAGS.has(flag))) {
      throw invalid(`${label} contains an unknown native scaffold edit flag.`);
    }
    if (lengths) {
      if (!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(lengths)) {
        throw invalid(`${label} contains an invalid native edit.`);
      }
      const choices = [...lengths.matchAll(/\d+/g)].map((entry) => Number(entry[0]));
      if (choices.some((choice) => choice < 1 || choice > 2000)) {
        throw invalid(`${label} replacement lengths must be between 1 and 2000.`);
      }
    }
    const endpoints = [Number(startText), Number(endText || startText)].sort((left, right) => left - right);
    parsed.push({ token: match[0], chain, first: endpoints[0], last: endpoints[1] });
  }
  if (!parsed.length || selection.slice(position)) {
    throw invalid(`${label} contains an invalid native ${scaffold ? 'edit' : 'residue selection'}.`);
  }
  return parsed;
}

function validateSelections(value, chains, view, { scaffold = false, label }) {
  for (const selection of nativeSelections(value, chains, { scaffold, label })) {
    const { token, chain, first, last } = selection;
    if (!chains.includes(chain) || !view[chain]) {
      throw invalid(`${label} references an unselected or absent chain: ${chain}.`);
    }
    const present = new Set(view[chain].authorResidues);
    if (!present.has(first) || !present.has(last)) {
      throw invalid(`${label} references residues absent from chain ${chain}: ${token}.`);
    }
  }
}

function validateStructure(bytes, filename, chains, selections = {}) {
  const checked = validateInputBytes(bytes, filename);
  const parsed = parseStructureInput(checked.text, checked.targetFilename);
  for (const chain of chains) {
    if (!parsed.author[chain]) {
      throw invalid(`BindCraft2 selected chain ${chain} is absent from ${filename}. Detected: ${Object.keys(parsed.author).join(', ') || 'none'}.`);
    }
  }
  validateSelections(selections.hotspots, chains, parsed.author, { label: `BindCraft2 hotspots in ${filename}` });
  validateSelections(selections.coldspots, chains, parsed.author, { label: `BindCraft2 coldspots in ${filename}` });
  return { text: checked.text, format: checked.targetFilename.endsWith('.pdb') ? 'pdb' : 'cif', parsed };
}

function validateScaffoldSelection(value, view, filename) {
  validateSelections(value, Object.keys(view), view, {
    scaffold: true,
    label: `BindCraft2 scaffold edit in ${filename}`,
  });
}

function validateBundle(spec, files) {
  const config = spec.protocol_config;
  for (const target of config.targets) {
    const entry = files.find((item) => item.filename === target.input_file);
    if (entry.filename.endsWith('.fasta')) {
      const records = fastaRecords(entry.text, entry.filename);
      if (target.chains.length !== 1 || (records.size > 1 && !records.has(String(target.chains[0])))) {
        throw invalid(`BindCraft2 FASTA target ${entry.filename} requires one chain matching a record name.`);
      }
      if (target.hotspots || target.coldspots) {
        throw invalid(`BindCraft2 FASTA target ${entry.filename} cannot use structure-numbered hotspots or coldspots.`);
      }
    } else {
      validateStructure(entry.bytes, entry.filename, target.chains, target);
    }
  }
  if (config.binder.scaffold_file) {
    const scaffold = files.find((item) => item.filename === config.binder.scaffold_file);
    const validated = validateStructure(scaffold.bytes, scaffold.filename, []);
    validateScaffoldSelection(config.binder.mutate_positions, validated.parsed.author, scaffold.filename);
  }
}

/** Read each required source exactly once and retain the bytes used for all later work. */
export function prepareBindcraft2Bundle({ spec, inputDir, inputFile }) {
  if ((inputDir !== undefined) === (inputFile !== undefined)) {
    throw usageError('Choose exactly one BindCraft2 input source: --input-dir DIR or --input FILE.');
  }
  const preparedSpec = normalizeBindcraft2Spec(spec);
  const required = requiredBindcraft2Inputs(preparedSpec);
  const primaryFilename = preparedSpec.protocol_config.targets[0].input_file;
  const sources = [];
  const files = [];
  if (inputFile !== undefined) {
    if (required.length !== 1) throw usageError('BindCraft2 --input is available only when the job requires exactly one unique input file; use --input-dir.');
    const bytes = readRegularFile(path.resolve(String(inputFile)));
    const checked = validateInputBytes(bytes, String(inputFile));
    if (checked.targetFilename !== primaryFilename) {
      throw invalid(`BindCraft2 --input format does not match protocol_config primary input_file ${primaryFilename}.`);
    }
    sources.push({ path: path.resolve(String(inputFile)), sha256: digest(bytes) });
    files.push({ filename: primaryFilename, bytes, text: checked.text, format: checked.targetFilename.endsWith('.pdb') ? 'pdb' : 'cif' });
  } else {
    const directory = path.resolve(String(inputDir));
    let stat;
    try { stat = fs.lstatSync(directory); }
    catch (error) { throw usageError(`Cannot read BindCraft2 input directory: ${error.message}`); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw usageError('--input-dir must be a real directory, not a symlink.');
    for (const filename of required) {
      const sourcePath = path.join(directory, filename);
      const bytes = readRegularFile(sourcePath);
      const text = decodeText(bytes, filename);
      sources.push({ path: sourcePath, sha256: digest(bytes) });
      files.push({ filename, bytes, text, format: path.extname(filename).toLowerCase().replace('.', '') });
    }
  }
  validateBundle(preparedSpec, files);
  return {
    spec: preparedSpec,
    primaryFilename,
    projectType: bindcraft2ProjectType(preparedSpec),
    required,
    sources,
    files,
    manifest: {
      schema_version: 1,
      kind: 'ariax_bindcraft2_input_bundle',
      protocol: 'bindcraft2',
      primary_file: primaryFilename,
      project_type: bindcraft2ProjectType(preparedSpec),
      files: Object.fromEntries(files.map(({ filename, bytes }) => [filename, { bytes: bytes.length, sha256: digest(bytes) }])),
    },
  };
}

export function stableJson(value) {
  const ordered = (item) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw invalid('Job JSON contains a non-finite number.');
    if (Array.isArray(item)) return item.map(ordered);
    if (isObject(item)) return Object.fromEntries(Object.keys(item).sort().map((key) => [key, ordered(item[key])]));
    return item;
  };
  return `${JSON.stringify(ordered(value), null, 2)}\n`;
}

function targetEvidence(target, { structure = true } = {}) {
  const selectorEvidence = (value) => structure ? {
    value: value || null,
    residue_register: 'author',
    validated: true,
  } : {
    value: null,
    residue_register: null,
    validation: 'not_applicable_for_fasta',
  };
  return {
    name: target.name,
    chains: target.chains,
    objective: target.objective,
    weight: target.weight,
    hotspots: selectorEvidence(target.hotspots),
    coldspots: selectorEvidence(target.coldspots),
  };
}

function compactSelector(selector) {
  if (selector?.validation === 'not_applicable_for_fasta') {
    return { value: null, residue_register: null, validation: 'not_applicable_for_fasta' };
  }
  return {
    value: selector?.value ?? null,
    residue_register: selector?.residue_register ?? null,
    validated: selector?.validated === true,
  };
}

function compactTargetInspection(target) {
  return {
    name: target.name ?? null,
    objective: target.objective ?? null,
    weight: target.weight ?? null,
    chains: Array.isArray(target.chains) ? target.chains : [],
    hotspots: compactSelector(target.hotspots),
    coldspots: compactSelector(target.coldspots),
    ...(target.selected_record ? { selected_record: target.selected_record } : {}),
  };
}

function compactChainInspection(chain, full) {
  const compact = {
    chain: chain.prepared_chain ?? chain.source_chain ?? null,
    source_chain: chain.source_chain ?? null,
    selected: chain.selected === true,
    sequence_length: chain.sequence_length ?? null,
    sequence_source: chain.sequence_source ?? null,
    mapping_status: chain.mapping_status ?? null,
    unresolved_region_count: chain.unresolved_region_count
      ?? (Array.isArray(chain.unresolved_regions) ? chain.unresolved_regions.length : null),
  };
  if (chain.mapping_note) compact.mapping_note = chain.mapping_note;
  if (full) {
    compact.sequence = chain.sequence ?? null;
    compact.residues = Array.isArray(chain.residues) ? chain.residues : [];
    compact.unresolved_regions = chain.unresolved_regions ?? null;
  }
  return compact;
}

export function compactBindcraft2FileInspection(file, full = false) {
  const chains = Array.isArray(file.chains) ? file.chains : null;
  const chainCount = Number.isInteger(file.chain_count) ? file.chain_count : chains?.length;
  const selectedChains = Array.isArray(file.selected_chains)
    ? file.selected_chains
    : (chains?.filter((chain) => chain.selected === true)
      .map((chain) => chain.prepared_chain ?? chain.source_chain)
      .filter(Boolean) ?? []);
  return {
    filename: file.filename,
    format: file.format,
    roles: file.roles,
    targets: file.targets.map(compactTargetInspection),
    ...(chains ? {
      selected_chains: selectedChains,
      selected_chain_count: selectedChains.length,
      chain_count: chainCount,
      chains_truncated: file.chains_truncated === true || chains.length < chainCount,
      chains: chains.map((chain) => compactChainInspection(chain, full)),
    } : {}),
    ...(Array.isArray(file.records) ? {
      records: file.records.map((record) => ({
        name: record.name,
        sequence_length: record.sequence_length,
        ...(full ? { sequence: record.sequence ?? null } : {}),
      })),
    } : {}),
    ...(file.scaffold ? { scaffold: {
      mutate_positions: file.scaffold.mutate_positions,
      residue_register: file.scaffold.residue_register,
      validated: file.scaffold.validated === true,
    } } : {}),
    warnings: Array.isArray(file.warnings) ? file.warnings : [],
  };
}

function selectedChainsFirst(inspection) {
  const selected = inspection.chains.filter((chain) => chain.selected === true);
  const other = inspection.chains.filter((chain) => chain.selected !== true);
  return { ...inspection, chains: [...selected, ...other] };
}

/** Build structure/sequence evidence from the exact bytes already validated for a BC2 bundle. */
export function inspectBindcraft2Bundle(bundle, { full = false, details = false } = {}) {
  const config = bundle.spec.protocol_config;
  const fileInspections = bundle.files.map((entry) => {
    const targets = config.targets.filter((target) => target.input_file === entry.filename);
    const scaffold = config.binder.scaffold_file === entry.filename;
    const roles = [...(targets.length ? ['target'] : []), ...(scaffold ? ['scaffold'] : [])];
    if (entry.filename.endsWith('.fasta')) {
      const records = fastaRecords(entry.text, entry.filename);
      return {
        filename: entry.filename,
        format: 'fasta',
        roles,
        targets: targets.map((target) => {
          const selectedRecord = records.has(String(target.chains[0]))
            ? String(target.chains[0])
            : records.keys().next().value;
          return { ...targetEvidence(target, { structure: false }), selected_record: selectedRecord };
        }),
        records: [...records].map(([name, sequence]) => ({
          name,
          sequence_length: sequence.length,
          sequence_sha256: digest(sequence),
          ...(full ? { sequence } : {}),
        })),
        warnings: [],
      };
    }

    const parsed = parseStructureInput(entry.text, `input.${entry.format}`);
    const targetChains = [...new Set(targets.flatMap((target) => target.chains))];
    const selected = scaffold ? Object.keys(parsed.author).sort() : targetChains;
    const syntheticSpec = {
      protocol: 'bindcraft2',
      protocol_config: { targets: [{ chains: selected }] },
    };
    const completeInspection = inspectChains({
      text: entry.text,
      targetFilename: `input.${entry.format}`,
    }, { spec: syntheticSpec });
    const inspection = full
      ? completeInspection
      : compactInspection(selectedChainsFirst(completeInspection), false);
    return {
      filename: entry.filename,
      format: entry.format,
      roles,
      selected_chains: selected,
      targets: targets.map(targetEvidence),
      ...(scaffold ? {
        scaffold: {
          mutate_positions: config.binder.mutate_positions || null,
          residue_register: 'author',
          validated: true,
        },
      } : {}),
      ...inspection,
    };
  });

  const diagnostic = {
    ready: true,
    ...bundle.manifest,
    required_files: bundle.required,
    inspection_scope: {
      residue_register: 'author',
      structure_evidence: 'coordinate and polymer metadata from the supplied files',
      scientific_limit: 'This inspection does not determine biological assembly or target accessibility.',
      full,
    },
    file_inspections: fileInspections,
  };
  if (details) return diagnostic;
  return {
    ready: true,
    protocol: 'bindcraft2',
    project_type: bundle.projectType,
    primary_file: bundle.primaryFilename,
    files: fileInspections.map((file) => compactBindcraft2FileInspection(file, full)),
    warnings: [diagnostic.inspection_scope.scientific_limit],
  };
}

export function writeBindcraft2Bundle(outputDirectory, bundle) {
  const target = path.resolve(String(outputDirectory));
  const outputFiles = Object.fromEntries([
    ...bundle.files.map(({ filename, bytes }) => [filename, bytes]),
    ['job.json', Buffer.from(stableJson(bundle.spec))],
    ['input-manifest.json', Buffer.from(stableJson(bundle.manifest))],
  ]);
  let replaceEmptyDirectory = false;
  if (fs.existsSync(target)) {
    const targetStat = fs.lstatSync(target);
    if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) throw usageError('--output must be a real directory.');
    const names = fs.readdirSync(target).sort();
    const expected = Object.keys(outputFiles).sort();
    const identical = names.length === expected.length && names.every((name, index) => name === expected[index])
      && expected.every((name) => fs.lstatSync(path.join(target, name)).isFile()
        && fs.readFileSync(path.join(target, name)).equals(outputFiles[name]));
    if (identical) return target;
    if (names.length) {
      throw Object.assign(new Error('Output directory already exists with different content.'), { exitCode: EXIT.CONFLICT, code: 'input_output_conflict' });
    }
    replaceEmptyDirectory = true;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(target), '.ariax-bindcraft2-'));
  try {
    for (const [filename, bytes] of Object.entries(outputFiles)) fs.writeFileSync(path.join(staging, filename), bytes, { flag: 'wx', mode: 0o600 });
    if (replaceEmptyDirectory) fs.rmdirSync(target);
    fs.renameSync(staging, target);
  } catch (error) {
    if (replaceEmptyDirectory && !fs.existsSync(target)) fs.mkdirSync(target);
    throw error;
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  }
  return target;
}
