/** Scientific provenance over the existing preparation parser, without file mutation. */
import { usageError } from './args.js';
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

/** Bound default console output; full per-residue mappings require --full or the written manifest. */
export function compactInspection(value, full = false) {
  if (full) return value;
  return {
    ...value,
    warning_count: value.warnings.length,
    warnings: value.warnings.slice(0, 50),
    warnings_truncated: value.warnings.length > 50,
    chain_count: value.chains.length,
    chains_truncated: value.chains.length > 50,
    chains: value.chains.slice(0, 50).map((chain) => {
      const { residues, sequence, ...rest } = chain;
      const list = Array.isArray(residues) ? residues : [];
      return {
        ...rest,
        sequence_sha256: sequence ? sha256(sequence) : null,
        unresolved_region_count: chain.unresolved_regions?.length ?? null,
        unresolved_regions: chain.unresolved_regions?.slice(0, 100) ?? null,
        unresolved_regions_truncated: (chain.unresolved_regions?.length || 0) > 100,
        residue_count: list.length,
        first_residue: list[0] ?? null,
        last_residue: list.length ? list[list.length - 1] : null,
        residues_omitted: list.length > 0,
      };
    }),
  };
}

const MAX_INSPECTED_RESIDUES = 500;
const MAX_RESOLVED_POSITIONS = 200;

function expandRangeToken(token, maxRemaining, label) {
  const trimmed = String(token || '').trim();
  if (!trimmed) return [];
  if (/^-?\d+$/.test(trimmed)) return [Number(trimmed)];
  const range = /^(\d+)(?:-|\.\.)(\d+)$/.exec(trimmed);
  if (!range) throw usageError(`${label}: invalid residue token "${trimmed}". Use e.g. A:56,115,121-123 or A:121..123.`);
  const first = Number(range[1]);
  const last = Number(range[2]);
  if (last < first) throw usageError(`${label}: descending residue range "${trimmed}".`);
  if (last - first + 1 > maxRemaining) {
    throw usageError(`${label}: selection exceeds the ${MAX_INSPECTED_RESIDUES}-residue inspection limit.`);
  }
  const out = [];
  for (let n = first; n <= last; n += 1) out.push(n);
  return out;
}

function parseResidueSpec(rawSpec, defaultChain) {
  const text = String(rawSpec ?? '').trim();
  if (!text) throw usageError('inputs inspect: --residues requires a nonempty residue specification (e.g. A:56,115,121-123).');
  const tokens = text.split(/[,;]+/).map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) throw usageError('inputs inspect: --residues requires at least one residue.');
  const requests = [];
  const seen = new Set();
  let currentChain = null;
  for (const token of tokens) {
    let chain = null;
    let body = token;
    const colon = /^([A-Za-z0-9]+):(.+)$/.exec(token);
    if (colon) {
      chain = colon[1];
      body = colon[2].trim();
      currentChain = chain;
    } else {
      const compact = /^([A-Za-z])(\d+(?:(?:-|\.\.)\d+)?)$/.exec(token);
      if (compact) {
        chain = compact[1];
        body = compact[2];
        currentChain = chain;
      } else {
        chain = currentChain ?? defaultChain;
      }
    }
    if (!chain) {
      throw usageError('inputs inspect: --residues requires a chain prefix (e.g. A:56,115,121-123) when the structure has multiple chains.');
    }
    const nums = expandRangeToken(body, MAX_INSPECTED_RESIDUES - requests.length, 'inputs inspect --residues');
    for (const num of nums) {
      const key = `${chain}:${num}`;
      if (seen.has(key)) continue;
      if (requests.length >= MAX_INSPECTED_RESIDUES) {
        throw usageError(`inputs inspect --residues: selection exceeds the ${MAX_INSPECTED_RESIDUES}-residue limit.`);
      }
      seen.add(key);
      requests.push({ chain, author_residue: num });
    }
  }
  return requests;
}

function findCanonicalPositionForAuthor(parsed, authorChain, residue) {
  if (!residue) return null;
  if (parsed.format === 'cif') {
    const labelToAuth = parsed.cif?.labelToAuth || {};
    const matchingLabel = Object.keys(labelToAuth).find((label) => labelToAuth[label] === authorChain) ?? authorChain;
    const labelView = parsed.canonical?.[matchingLabel];
    const mapped = labelView?.authorToCanonical?.[residue.author];
    if (Number.isSafeInteger(mapped)) return mapped;
    return Number.isSafeInteger(residue.register) ? residue.register : null;
  }
  const authorView = parsed.author?.[authorChain];
  const mapped = authorView?.authorToCanonical?.[residue.author];
  return Number.isSafeInteger(mapped) ? mapped : null;
}

/** Targeted author-to-canonical residue lookup without dumping full residue arrays. */
export function inspectResidues(input, residueSpec, { spec } = {}) {
  const protocol = protocolId(spec?.protocol);
  const parsed = parseStructureInput(input.text, input.targetFilename, protocol === 'esmfold2-pipeline');
  const selected = spec ? selectedChains(spec, protocol) : [];
  const availableAuthorChains = Object.keys(parsed.author);
  const defaultChain = selected.length === 1
    ? selected[0]
    : (availableAuthorChains.length === 1 ? availableAuthorChains[0] : null);
  const requests = parseResidueSpec(residueSpec, defaultChain);

  return requests.map(({ chain, author_residue }) => {
    const authorView = parsed.author[chain] ?? null;
    const residue = authorView?.residues?.find((r) => r.author === author_residue) ?? null;
    if (residue) {
      return {
        author_chain: chain,
        author_residue,
        canonical_position: findCanonicalPositionForAuthor(parsed, chain, residue),
        amino_acid: residue.aminoAcid ?? null,
        missing: false,
      };
    }
    return {
      author_chain: chain,
      author_residue,
      canonical_position: null,
      amino_acid: null,
      missing: true,
    };
  });
}

function expandBoltzMaskPositions(value, available) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return [];
  if (text === 'all') return (available || []).slice(0, MAX_RESOLVED_POSITIONS);
  const out = [];
  const seen = new Set();
  for (const raw of text.split(',')) {
    const token = raw.trim();
    if (!token) continue;
    const range = /^(\d+)\.\.(\d+)$/.exec(token);
    if (range) {
      const start = Math.min(Number(range[1]), Number(range[2]));
      const end = Math.max(Number(range[1]), Number(range[2]));
      for (let pos = start; pos <= end && out.length < MAX_RESOLVED_POSITIONS; pos += 1) {
        if (!seen.has(pos)) { seen.add(pos); out.push(pos); }
      }
    } else if (/^\d+$/.test(token)) {
      const pos = Number(token);
      if (!seen.has(pos) && out.length < MAX_RESOLVED_POSITIONS) { seen.add(pos); out.push(pos); }
    }
  }
  return out;
}

function expandSimpleDashMask(raw) {
  const out = [];
  const seen = new Set();
  const tokens = Array.isArray(raw) ? raw : String(raw || '').split(',');
  for (const item of tokens) {
    if (out.length >= MAX_RESOLVED_POSITIONS) break;
    if (Number.isSafeInteger(item)) {
      if (!seen.has(item)) { seen.add(item); out.push(item); }
      continue;
    }
    const token = String(item || '').trim();
    if (!token) continue;
    if (/^-?\d+$/.test(token)) {
      const n = Number(token);
      if (!seen.has(n)) { seen.add(n); out.push(n); }
      continue;
    }
    const m = /^(\d+)-(\d+)$/.exec(token);
    if (m) {
      const start = Math.min(Number(m[1]), Number(m[2]));
      const end = Math.max(Number(m[1]), Number(m[2]));
      for (let n = start; n <= end && out.length < MAX_RESOLVED_POSITIONS; n += 1) {
        if (!seen.has(n)) { seen.add(n); out.push(n); }
      }
    }
  }
  return out;
}

/** Resolve configured BoltzGen binding_rules or protocol hotspots to exact residue mappings. */
export function resolveSpecResidueMappings(spec, text, targetFilename) {
  if (!spec || typeof spec !== 'object' || typeof text !== 'string') return {};
  const protocol = protocolId(spec.protocol);
  if (!protocol) return {};
  let parsed;
  try {
    parsed = parseStructureInput(text, targetFilename, protocol === 'esmfold2-pipeline');
  } catch {
    return {};
  }

  const lookupAuthor = (chain, authorRes) => {
    const view = parsed.author?.[chain];
    const residue = view?.residues?.find((r) => r.author === authorRes) ?? null;
    return {
      chain,
      canonical_position: residue ? findCanonicalPositionForAuthor(parsed, chain, residue) : null,
      author_residue: authorRes,
      amino_acid: residue?.aminoAcid ?? null,
    };
  };

  if (protocol === 'boltzgen') {
    const rules = Array.isArray(spec.binding_rules) ? spec.binding_rules : [];
    if (!rules.length) return {};
    const resolved = [];
    for (const rule of rules) {
      const chain = String(rule?.id || '').trim();
      const view = parsed.canonical?.[chain];
      if (!chain || !view) continue;
      const byCanonical = new Map();
      const firstRegister = view.firstRegister ?? 1;
      const rebased = parsed.format !== 'cif';
      for (const r of view.residues || []) {
        const canonicalPos = rebased ? (r.register - firstRegister + 1) : r.register;
        if (!byCanonical.has(canonicalPos)) byCanonical.set(canonicalPos, r);
      }
      for (const [fieldName, role] of [['binding', 'binding'], ['not_binding', 'not_binding']]) {
        if (!rule[fieldName]) continue;
        const positions = expandBoltzMaskPositions(rule[fieldName], view.canonicalResidues);
        for (const pos of positions) {
          if (resolved.length >= MAX_RESOLVED_POSITIONS) break;
          const r = byCanonical.get(pos) ?? null;
          resolved.push({
            chain,
            canonical_position: pos,
            author_residue: r?.author ?? (Number.isSafeInteger(view.canonicalToAuthor?.[pos]) ? view.canonicalToAuthor[pos] : null),
            amino_acid: r?.aminoAcid ?? null,
            ...(role === 'not_binding' ? { rule: 'not_binding' } : {}),
          });
        }
      }
    }
    return resolved.length ? { resolved_binding_rules: resolved } : {};
  }

  const hotspots = [];
  const pushHotspot = (entry) => {
    if (hotspots.length < MAX_RESOLVED_POSITIONS) hotspots.push(entry);
  };

  if (protocol === 'bindcraft') {
    const raw = String(spec.hotspots || '').trim();
    for (const token of raw.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean)) {
      const m = /^([A-Z0-9])(\d+)(?:-(\d+))?$/.exec(token);
      if (!m) continue;
      const chain = m[1];
      const start = Number(m[2]);
      const end = m[3] ? Number(m[3]) : start;
      for (let pos = start; pos <= end && hotspots.length < MAX_RESOLVED_POSITIONS; pos += 1) {
        pushHotspot(lookupAuthor(chain, pos));
      }
    }
  } else if (protocol === 'bindcraft2') {
    const targets = Array.isArray(spec.protocol_config?.targets) ? spec.protocol_config.targets : [];
    for (const target of targets) {
      if (!target || typeof target.hotspots !== 'string' || !target.hotspots.trim()) continue;
      if (target.input_file && targetFilename && target.input_file !== targetFilename) continue;
      const defaultChain = Array.isArray(target.chains) && target.chains.length ? String(target.chains[0]) : null;
      for (const rawTok of target.hotspots.split(',').map((t) => t.trim()).filter(Boolean)) {
        const tok = /^[A-Za-z]/.test(rawTok) ? rawTok : (defaultChain ? `${defaultChain}${rawTok}` : rawTok);
        const m = /^([A-Za-z]+)(\d+)(?:-(\d+))?$/.exec(tok);
        if (!m) continue;
        const chain = m[1];
        const start = Math.min(Number(m[2]), Number(m[3] || m[2]));
        const end = Math.max(Number(m[2]), Number(m[3] || m[2]));
        for (let pos = start; pos <= end && hotspots.length < MAX_RESOLVED_POSITIONS; pos += 1) {
          pushHotspot(lookupAuthor(chain, pos));
        }
      }
    }
  } else if (protocol === 'pxdesign') {
    for (const [chain, raw] of Object.entries(spec.hotspots_by_chain || {})) {
      for (const pos of expandSimpleDashMask(raw)) pushHotspot(lookupAuthor(chain, pos));
    }
  } else if (protocol === 'esmfold2-pipeline') {
    const target = spec.protocol_config?.target;
    const chains = selectedChains(spec, protocol);
    const selectors = Array.isArray(target?.hotspots)
      ? target.hotspots
      : String(target?.hotspots || '').split(';').filter(Boolean);
    for (const sel of selectors) {
      const textSel = String(sel).trim();
      const colon = textSel.indexOf(':');
      const chain = colon >= 0
        ? textSel.slice(0, colon)
        : [...chains].sort((a, b) => b.length - a.length).find((c) => textSel.startsWith(c));
      const mask = colon >= 0 ? textSel.slice(colon + 1) : textSel.slice(chain?.length || 0);
      if (!chain) continue;
      for (const pos of expandSimpleDashMask(mask)) pushHotspot(lookupAuthor(chain, pos));
    }
  }

  return hotspots.length ? { resolved_hotspots: hotspots } : {};
}
