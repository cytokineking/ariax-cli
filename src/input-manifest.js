/** Scientific provenance over the existing preparation parser, without file mutation. */
import { parseStructureInput, protocolId, selectedChains } from './structure-input.js';
import { structureRecordsError } from './structure-validation.js';
import { sha256 } from './input-source.js';
import { EXIT } from './exit-codes.js';

export function stableJson(value) {
  function ordered(item) {
    if (typeof item === 'number' && !Number.isFinite(item)) {
      throw Object.assign(new Error('Job JSON contains a non-finite number.'), {exitCode: EXIT.VALIDATION, code: 'validation_failed'});
    }
    if (Array.isArray(item)) return item.map(ordered);
    if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().map(key => [key, ordered(item[key])]));
    return item;
  }
  return JSON.stringify(ordered(value), null, 2) + '\n';
}

// A unique subsequence has the same earliest and latest embedding. This is linear
// in sequence length, and follows the preparation core's direct-author-first rule.
export function sequencePositions(sequence, residues, labelPositions = false) {
  if (!sequence || !residues.length || residues.some(residue => residue.insertion)) return null;
  const positions = residues.map(residue => (labelPositions ? residue.register : residue.author));
  if (new Set(positions).size === positions.length && residues.every((residue, index) => (
    positions[index] > 0 && positions[index] <= sequence.length && sequence[positions[index] - 1] === residue.aminoAcid
  ))) return positions;
  if (labelPositions) return null;
  const first = [];
  let cursor = 0;
  for (const residue of residues) {
    cursor = sequence.indexOf(residue.aminoAcid, cursor);
    if (cursor < 0) return null;
    first.push(cursor++ + 1);
  }
  cursor = sequence.length - 1;
  for (let index = residues.length - 1; index >= 0; index--) {
    cursor = sequence.lastIndexOf(residues[index].aminoAcid, cursor);
    if (cursor + 1 !== first[index]) return null;
    cursor--;
  }
  return first;
}

function unresolvedRegions(sequence, positions) {
  if (!positions) return null;
  const observed = new Set(positions);
  const regions = [];
  for (let position = 1; position <= sequence.length; position++) {
    if (observed.has(position)) continue;
    const start = position;
    while (position + 1 <= sequence.length && !observed.has(position + 1)) position++;
    regions.push({start, end: position});
  }
  return regions;
}

function selectedSequence(spec, protocol, chain) {
  return protocol === 'pxdesign' ? spec?.sequence_by_chain?.[chain]
    : protocol === 'esmfold2-pipeline' ? spec?.protocol_config?.target?.sequences?.[chain] : undefined;
}

export function inspectChains(input, { spec, sourceSpec, sourceInput, selectedOnly = false } = {}) {
  const protocol = protocolId(spec?.protocol);
  const parsed = parseStructureInput(input.text, input.targetFilename, protocol === 'esmfold2-pipeline');
  const viewName = protocol === 'boltzgen' ? 'canonical' : 'author';
  const views = parsed[viewName];
  const selected = spec ? selectedChains(spec, protocol) : Object.keys(views);
  const sourceSelected = sourceSpec ? selectedChains(sourceSpec, protocol) : selected;
  const original = sourceInput ? parseStructureInput(sourceInput.text, sourceInput.targetFilename, protocol === 'esmfold2-pipeline') : parsed;
  const chainIds = selectedOnly ? selected : Object.keys(views).sort();
  const atomKey = (chain, author, label, insertion) => JSON.stringify([chain, author, label, insertion]);
  const atomLookup = new Map();
  for (const atom of parsed.atoms) {
    const key = atomKey(protocol === 'boltzgen' && parsed.format === 'cif' ? atom.labelChain : atom.chain, Number(atom.author), parsed.format === 'cif' ? Number(atom.label) : null, atom.insertion);
    if (!atomLookup.has(key)) atomLookup.set(key, atom);
  }
  const warnings = [];
  const chains = [];
  for (const chain of chainIds) {
    const view = views[chain];
    if (!view) { warnings.push(`Selected chain ${chain} is absent from the input.`); continue; }
    const sourceChain = sourceSelected[selected.indexOf(chain)] || chain;
    const originalView = original[viewName][sourceChain];
    const supplied = selectedSequence(spec, protocol, chain);
    const sequence = typeof supplied === 'string' ? supplied.replace(/\s+/g, '').toUpperCase() : view.sequence;
    const originallySupplied = selectedSequence(sourceSpec || spec, protocol, sourceChain);
    const sequenceSource = typeof originallySupplied === 'string' ? 'job.json' : (originalView || view).sequenceSource;
    const recordChains = protocol === 'boltzgen' && parsed.format === 'cif'
      ? [...new Set(parsed.atoms.filter(atom => atom.labelChain === chain).map(atom => atom.chain))] : [chain];
    const metadataIssue = recordChains.map(id => parsed.metadataIssues[id]).find(Boolean);
    const problem = structureRecordsError({protocol: protocol === 'esmfold2-pipeline' ? 'ESMFold2' : protocol === 'pxdesign' ? 'PXDesign' : 'Input', format: parsed.format, chains:recordChains, atoms:parsed.atoms});
    if (problem) warnings.push(problem);
    if (metadataIssue) warnings.push(`Chain ${chain}: ${metadataIssue}`);
    if (sequenceSource === 'atom_site') warnings.push(`Chain ${chain}: sequence comes from observed coordinates; unresolved terminal residues cannot be inferred.`);
    const metadataMismatch = view.metadataSequence && sequence !== view.metadataSequence;
    if (metadataMismatch) warnings.push(`Chain ${chain}: supplied sequence disagrees with polymer metadata.`);
    const useLabels = parsed.format === 'cif' && Boolean(view.metadataSequence);
    const positions = problem || metadataIssue || metadataMismatch ? null : sequencePositions(sequence, view.residues, useLabels);
    if (!positions) warnings.push(`Chain ${chain}: a unique full-sequence mapping is unavailable.`);
    const residues = view.residues.map((residue, index) => {
      const atom = atomLookup.get(atomKey(chain, residue.author, parsed.format === 'cif' ? residue.register : null, residue.insertion));
      return {
        author_chain: parsed.format === 'cif' ? atom?.authorChain || null : atom?.chain || null,
        author_residue: residue.author, label_chain: parsed.format === 'cif' ? atom?.labelChain || null : null,
        label_residue: parsed.format === 'cif' && atom?.label && Number.isSafeInteger(Number(atom.label)) ? Number(atom.label) : null,
        insertion_code: residue.insertion || '', amino_acid: residue.aminoAcid,
        sequence_position: positions?.[index] ?? null,
      };
    });
    chains.push({
      source_chain: sourceChain, prepared_chain: chain, chain_id_type:protocol === 'boltzgen' && parsed.format === 'cif' ? 'label' : 'author', selected: selected.includes(chain),
      sequence: sequence || null, sequence_length: sequence.length, sequence_source: sequenceSource,
      residues, unresolved_regions: unresolvedRegions(sequence, positions),
      mapping_status: positions ? 'verified' : 'unavailable',
      ...(positions ? {} : {mapping_note:'No unique sequence/register mapping was established; null positions must not be inferred.'}),
    });
  }
  return {chains, warnings:[...new Set(warnings)]};
}

export function inputManifest(input, prepared, sourceSpec, sourceJobBytes, build) {
  const preparedBytes = Buffer.from(prepared.text, 'utf8');
  const jobBytes = Buffer.from(stableJson(prepared.spec));
  const protocol = protocolId(prepared.spec.protocol);
  const inspection = inspectChains({...input, text:prepared.text}, {
    spec:prepared.spec, sourceSpec, sourceInput:input, selectedOnly:true,
  });
  return {
    schema_version:1, kind:'ariax_input',
    prepared_by:{name:'ariax-cli', version:build.version, channel:build.channel, source_revision:build.source_revision, source_dirty:build.source_dirty},
    source:input.source,
    prepared:{file:input.targetFilename, format:input.source.format, sha256:sha256(preparedBytes), size_bytes:preparedBytes.length},
    job:{file:'job.json', source_sha256:sha256(sourceJobBytes), sha256:sha256(jobBytes), protocol:protocol === 'bindcraft' ? 'bindcraft-v1.5' : protocol},
    selected_chains:selectedChains(prepared.spec, protocol),
    chains:inspection.chains, transforms:prepared.transforms || [], preparation_notes:prepared.messages,
    warnings:inspection.warnings,
  };
}

/** Bound default console output; full mappings remain in the written manifest. */
export function compactInspection(value, full = false) {
  if (full) return value;
  let remaining = 200;
  return {...value, warning_count:value.warnings.length, warnings:value.warnings.slice(0,50), warnings_truncated:value.warnings.length > 50,
    chain_count:value.chains.length, chains_truncated:value.chains.length > 50,
    chains:value.chains.slice(0, 50).map(chain => {
      const residues = chain.residues.slice(0, remaining);
      remaining -= residues.length;
      return {...chain, sequence:undefined, sequence_sha256:chain.sequence ? sha256(chain.sequence) : null,
        unresolved_region_count:chain.unresolved_regions?.length ?? null,
        unresolved_regions:chain.unresolved_regions?.slice(0,100) ?? null, unresolved_regions_truncated:(chain.unresolved_regions?.length || 0) > 100,
        residue_count:chain.residues.length, residues, residues_truncated:residues.length < chain.residues.length};
    }),
  };
}
