import { EXIT } from './exit-codes.js';
import { pxSequenceMappingError, effectiveSelectorsError, structureRecordsError, metadataSequenceError } from './structure-validation.js';

const AA3_TO_1 = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E',
  GLY: 'G', HIS: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F',
  PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V', MSE: 'M',
  // Match BoltzGen's CCD normalization so modified PCA stays in its polymer register.
  SEC: 'U', PYL: 'O', ASX: 'B', GLX: 'Z', HYP: 'X', PCA: 'Q', UNK: 'X',
};

const AA1_TO_3 = {
  A: 'ALA', R: 'ARG', N: 'ASN', D: 'ASP', C: 'CYS', Q: 'GLN', E: 'GLU',
  G: 'GLY', H: 'HIS', I: 'ILE', L: 'LEU', K: 'LYS', M: 'MET', F: 'PHE',
  P: 'PRO', S: 'SER', T: 'THR', W: 'TRP', Y: 'TYR', V: 'VAL', U: 'SEC',
  O: 'PYL', B: 'ASX', Z: 'GLX', X: 'UNK',
};
const STANDARD_SEQUENCE = /^[ACDEFGHIKLMNPQRSTVWY]+$/;
const PX_SEQUENCE = /^[A-Z]+$/;
const PDB_CHAIN_ID_POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz';
const ESMFOLD2_REQUIRED_ATOM_SITE_HEADERS = [
  '_atom_site.label_seq_id',
  '_atom_site.auth_seq_id',
  '_atom_site.label_asym_id',
  '_atom_site.label_entity_id',
  '_atom_site.auth_asym_id',
  '_atom_site.pdbx_PDB_ins_code',
  '_atom_site.auth_comp_id',
  '_atom_site.label_comp_id',
  '_atom_site.auth_atom_id',
  '_atom_site.label_atom_id',
];

function invalid(message) {
  const error = new Error(message);
  error.code = 'validation_failed';
  error.exitCode = EXIT.VALIDATION;
  return error;
}

function normalizeSequence(value) {
  return typeof value === 'string' ? value.toUpperCase().replace(/\s+/g, '') : '';
}

function tokenizeCifLine(line) {
  const tokens = [];
  let index = 0;
  while (index < line.length) {
    while (/\s/.test(line[index] || '') && index < line.length) index += 1;
    if (index >= line.length || line[index] === '#') break;
    const start = index;
    const quote = line[index] === "'" || line[index] === '"' ? line[index++] : null;
    if (quote) {
      while (index < line.length && !(line[index] === quote
        && (index + 1 === line.length || /\s/.test(line[index + 1])))) index += 1;
      if (index === line.length) throw invalid('mmCIF contains an unterminated quoted value.');
      index += 1;
    } else {
      while (index < line.length && !/\s/.test(line[index])) index += 1;
    }
    tokens.push(line.slice(start, index));
  }
  return tokens;
}

function cifValue(value) {
  if (value === undefined) return '';
  let normalized = String(value).trim();
  if (normalized.startsWith(';') && normalized.endsWith('\n;')) return normalized.slice(1, -2);
  if ((normalized.startsWith("'") && normalized.endsWith("'"))
    || (normalized.startsWith('"') && normalized.endsWith('"'))) {
    normalized = normalized.slice(1, -1);
  }
  return normalized === '.' || normalized === '?' ? '' : normalized;
}

function readCifTextField(lines, start) {
  const valueLines = [lines[start].slice(1)];
  let index = start + 1;
  while (index < lines.length && !lines[index].startsWith(';')) valueLines.push(lines[index++]);
  if (index === lines.length) throw invalid('mmCIF contains an unterminated semicolon text field.');
  if (!/^;\s*(?:#.*)?$/.test(lines[index])) {
    throw invalid('mmCIF text-field terminator must be on its own line.');
  }
  return { token: `;${valueLines.join('\n')}\n;`, nextLine: index + 1 };
}

function parseCifLoops(text) {
  const lines = text.split(/\r?\n/);
  const loops = [];
  let index = 0;
  while (index < lines.length) {
    // Scalar text values may contain words such as loop_ or apparent headers.
    if (lines[index].startsWith(';')) {
      index = readCifTextField(lines, index).nextLine;
      continue;
    }
    if (lines[index].trim() !== 'loop_') {
      index += 1;
      continue;
    }
    const start = index;
    index += 1;
    const headers = [];
    while (index < lines.length) {
      const header = lines[index].trim();
      if (!header || header.startsWith('#')) { index += 1; continue; }
      if (!header.startsWith('_')) break;
      headers.push(header);
      index += 1;
    }
    if (!headers.length) continue;
    const dataStart = index;
    const rows = [];
    let pending = [];
    while (index < lines.length) {
      const line = lines[index].trim();
      if (!line || line.startsWith('#')) {
        index += 1;
        continue;
      }
      // CIF text fields begin with a semicolon in column one, and are one token
      // even when their contents resemble loop headers or contain whitespace.
      if (lines[index].startsWith(';')) {
        const textField = readCifTextField(lines, index);
        pending.push(textField.token);
        index = textField.nextLine - 1;
      } else {
        if (line === 'loop_' || line.startsWith('_') || line.startsWith('data_')) break;
        pending.push(...tokenizeCifLine(line));
      }
      while (pending.length >= headers.length) {
        rows.push(pending.slice(0, headers.length));
        pending = pending.slice(headers.length);
      }
      index += 1;
    }
    loops.push({
      start,
      headers,
      rows,
      dataStart,
      dataEnd: index,
      incompleteTokenCount: pending.length,
    });
  }
  return { lines, loops };
}

function field(loop, row, ...names) {
  for (const name of names) {
    const index = loop.headers.indexOf(name);
    if (index >= 0) return cifValue(row[index]);
  }
  return '';
}

function loopsFor(parsed, category) {
  return parsed.loops.filter((loop) => loop.headers.some((header) => header.startsWith(`_${category}.`)));
}

function canonicalAuthorChainMap(parsed) {
  const authorChains = [];
  const seen = new Set();
  const labelOwners = {};
  for (const loop of loopsFor(parsed, 'atom_site')) {
    const authIndex = loop.headers.indexOf('_atom_site.auth_asym_id');
    if (authIndex < 0) continue;
    const labelIndex = loop.headers.indexOf('_atom_site.label_asym_id');
    for (const row of loop.rows) {
      const chain = cifValue(row[authIndex]);
      if (!chain) continue;
      if (!seen.has(chain)) {
        seen.add(chain);
        authorChains.push(chain);
      }
      if (labelIndex < 0) continue;
      const label = cifValue(row[labelIndex]);
      if (!label) continue;
      if (!labelOwners[label]) labelOwners[label] = new Set();
      labelOwners[label].add(chain);
    }
  }

  const hasForeignLabelOwner = (candidate, sourceChain) => (
    [...(labelOwners[candidate] || [])].some((owner) => owner !== sourceChain)
  );
  const requiresRename = (chain) => (
    !/^[A-Za-z0-9]$/.test(chain) || hasForeignLabelOwner(chain, chain)
  );
  const assigned = new Set(authorChains.filter((chain) => !requiresRename(chain)));
  const chainIdMap = {};
  for (const chain of authorChains) {
    if (!requiresRename(chain)) continue;
    const replacement = [...PDB_CHAIN_ID_POOL].find((candidate) => (
      !assigned.has(candidate) && !hasForeignLabelOwner(candidate, chain)
    ));
    if (!replacement) {
      throw invalid('ESMFold2 mmCIF has too many chains to assign unambiguous one-character chain IDs.');
    }
    chainIdMap[chain] = replacement;
    assigned.add(replacement);
  }
  return chainIdMap;
}

function normalizeEsmfold2Cif(text) {
  const parsed = parseCifLoops(text);
  const atomLoops = loopsFor(parsed, 'atom_site');
  const chainIdMap = canonicalAuthorChainMap(parsed);
  const lines = [...parsed.lines];
  let addedAuthAtomIds = false;

  for (const loop of [...atomLoops].sort((left, right) => right.start - left.start)) {
    if (loop.incompleteTokenCount) {
      throw invalid('ESMFold2 mmCIF _atom_site loop has an incomplete row; repair the file before upload.');
    }

    const headers = [...loop.headers];
    const labelAtomIndex = headers.indexOf('_atom_site.label_atom_id');
    let authAtomIndex = headers.indexOf('_atom_site.auth_atom_id');
    let loopAddedAuthAtomIds = false;
    if (authAtomIndex < 0) {
      if (labelAtomIndex < 0) {
        throw invalid(
          'ESMFold2 mmCIF must include _atom_site.label_atom_id; '
          + '_atom_site.auth_atom_id cannot be reconstructed safely without it.',
        );
      }
      authAtomIndex = headers.length;
      headers.push('_atom_site.auth_atom_id');
      loopAddedAuthAtomIds = true;
      addedAuthAtomIds = true;
    }

    const missingHeaders = ESMFOLD2_REQUIRED_ATOM_SITE_HEADERS.filter(
      (header) => !headers.includes(header),
    );
    if (missingHeaders.length) {
      throw invalid(
        `ESMFold2 mmCIF is missing required _atom_site fields: ${missingHeaders.join(', ')}.`,
      );
    }

    const authChainIndex = headers.indexOf('_atom_site.auth_asym_id');
    const rewroteChains = authChainIndex >= 0 && Object.keys(chainIdMap).length > 0;
    if (!loopAddedAuthAtomIds && !rewroteChains) continue;

    const rows = loop.rows.map((row) => {
      const next = [...row];
      if (loopAddedAuthAtomIds) {
        if (!cifValue(next[labelAtomIndex])) {
          throw invalid(
            'ESMFold2 mmCIF contains a missing label atom ID; '
            + 'author atom IDs cannot be reconstructed safely.',
          );
        }
        next[authAtomIndex] = next[labelAtomIndex];
      }
      if (rewroteChains) {
        const sourceChain = cifValue(next[authChainIndex]);
        if (chainIdMap[sourceChain]) next[authChainIndex] = chainIdMap[sourceChain];
      }
      return next.join(' ');
    });
    lines.splice(
      loop.start,
      loop.dataEnd - loop.start,
      'loop_',
      ...headers,
      ...rows,
    );
  }

  const changed = addedAuthAtomIds || Object.keys(chainIdMap).length > 0;
  return {
    text: changed ? lines.join('\n') : text,
    chainIdMap,
    addedAuthAtomIds,
  };
}

function remapChainRecord(record, chainIdMap, label) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  const remapped = {};
  for (const [sourceChain, value] of Object.entries(record)) {
    const chain = chainIdMap[sourceChain] || sourceChain;
    if (Object.prototype.hasOwnProperty.call(remapped, chain)) {
      throw invalid(`ESMFold2 ${label} becomes ambiguous after chain normalization at chain ${chain}.`);
    }
    remapped[chain] = value;
  }
  return remapped;
}

function remapHotspotSelector(selector, sourceChains, chainIdMap) {
  const text = String(selector).trim();
  const colon = text.indexOf(':');
  const sourceChain = colon >= 0
    ? text.slice(0, colon)
    : [...sourceChains].sort((left, right) => right.length - left.length)
      .find((chain) => text.startsWith(chain));
  if (!sourceChain || !chainIdMap[sourceChain]) return text;
  return colon >= 0
    ? `${chainIdMap[sourceChain]}:${text.slice(colon + 1)}`
    : `${chainIdMap[sourceChain]}${text.slice(sourceChain.length)}`;
}

function remapEsmfold2Target(target, sourceChains, chainIdMap) {
  if (!Object.keys(chainIdMap).length) return;
  if (Array.isArray(target.chains)) {
    target.chains = target.chains.map((chain) => chainIdMap[String(chain)] || String(chain));
  } else if (target.chains !== undefined) {
    target.chains = String(target.chains).split(',')
      .map((chain) => chain.trim())
      .filter(Boolean)
      .map((chain) => chainIdMap[chain] || chain)
      .join(',');
  }
  target.sequences = remapChainRecord(target.sequences, chainIdMap, 'target.sequences');
  target.crop = remapChainRecord(target.crop, chainIdMap, 'target.crop');
  if (Array.isArray(target.hotspots)) {
    target.hotspots = target.hotspots.map(
      (selector) => remapHotspotSelector(selector, sourceChains, chainIdMap),
    );
  } else if (target.hotspots !== undefined) {
    target.hotspots = String(target.hotspots).split(';')
      .filter(Boolean)
      .map((selector) => remapHotspotSelector(selector, sourceChains, chainIdMap))
      .join(';');
  }
}

function addResidue(target, chain, residue) {
  if (!chain) return;
  if (!target[chain]) target[chain] = new Map();
  const key = `${residue.register}:${residue.author}:${residue.insertion || ''}`;
  if (!target[chain].has(key)) target[chain].set(key, residue);
}

function isContiguous(residues) {
  return residues.every((residue, index) => (
    index === 0 || residue.register === residues[index - 1].register + 1
  ));
}

function finalizeView(residueMaps, metadataSequences = {}, { rebase = true } = {}) {
  const chains = {};
  for (const [chain, residueMap] of Object.entries(residueMaps)) {
    const residues = [...residueMap.values()].sort((left, right) => (
      left.register - right.register || left.author - right.author
    ));
    const metadataSequence = metadataSequences[chain] || '';
    let sequence = '';
    let sequenceSource = 'manual';
    if (metadataSequence) {
      sequence = metadataSequence;
      sequenceSource = 'polymer_metadata';
    } else if (residues.length && isContiguous(residues)) {
      sequence = residues.map((residue) => residue.aminoAcid).join('');
      sequenceSource = 'atom_site';
    }

    const firstRegister = residues[0]?.register ?? 1;
    const canonicalToAuthor = {};
    const authorToCanonical = {};
    const canonicalResidues = [];
    for (const residue of residues) {
      const canonical = rebase ? residue.register - firstRegister + 1 : residue.register;
      canonicalResidues.push(canonical);
      canonicalToAuthor[canonical] = residue.author;
      authorToCanonical[residue.author] = canonical;
    }
    chains[chain] = {
      residues,
      authorResidues: [...new Set(residues.map((residue) => residue.author))].sort((a, b) => a - b),
      canonicalResidues: [...new Set(canonicalResidues)].sort((a, b) => a - b),
      canonicalToAuthor,
      authorToCanonical,
      sequence,
      sequenceSource,
      metadataSequence,
      firstRegister,
      hasInsertionCodes: residues.some((residue) => Boolean(residue.insertion)),
    };
  }
  return chains;
}

function parsePdb(text, esmOnly = false) {
  const atoms = [];
  const metadataIssues = {};
  const metadataLengths = {};
  const residues = {};
  const metadata = {};
  let hasModels = false;
  let inFirstModel = true;
  let firstModelSeen = false;
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const record = line.substring(0, 6).trim();
    if (record === 'MODEL') {
      hasModels = true;
      inFirstModel = !firstModelSeen;
      firstModelSeen = true;
      continue;
    }
    if (record === 'ENDMDL') {
      inFirstModel = false;
      continue;
    }
    if (record === 'SEQRES') {
      const chain = line.charAt(11).trim();
      if (!chain) continue;
      const declaredLength = Number(line.substring(13, 17).trim());
      if (metadataLengths[chain] !== undefined && metadataLengths[chain] !== declaredLength) {
        metadataIssues[chain] = 'PDB SEQRES rows disagree on the sequence count.';
      }
      metadataLengths[chain] = declaredLength;
      const sequence = line.substring(19).trim().split(/\s+/)
        .map((name) => AA3_TO_1[name.toUpperCase()] || 'X').join('');
      metadata[chain] = (metadata[chain] || '') + sequence;
      continue;
    }
    if (hasModels && !inFirstModel) continue;
    if (record !== 'ATOM' && record !== 'HETATM') continue;
    if (line.length < 27) continue;
    const residueName = line.substring(17, 20).trim().toUpperCase();
    const aminoAcid = AA3_TO_1[residueName];
    if (!aminoAcid) continue;
    const chain = line.charAt(21).trim();
    atoms.push({ chain, author: line.substring(22, 26).trim(), group: record,
      aminoAcid, residueName, atomName: line.substring(12, 16).trim(), insertion: line.charAt(26).trim(),
      xyz: [line.substring(30, 38), line.substring(38, 46), line.substring(46, 54)].map((value) => value.trim()),
    });
    if (esmOnly && (record !== 'ATOM' || !STANDARD_SEQUENCE.test(aminoAcid))) continue;
    const author = Number.parseInt(line.substring(22, 26).trim(), 10);
    if (!chain || !Number.isSafeInteger(author)) continue;
    addResidue(residues, chain, {
      author,
      register: author,
      insertion: line.charAt(26).trim(),
      aminoAcid,
    });
  }
  for (const [chain, length] of Object.entries(metadataLengths)) {
    if (!Number.isInteger(length) || length !== metadata[chain].length) metadataIssues[chain] = 'PDB SEQRES count disagrees with its sequence.';
  }
  const view = finalizeView(residues, metadata);
  return { format: 'pdb', author: view, px: view, canonical: view, cif: null, atoms, metadataIssues };
}

function orderedSequence(items) {
  if (!items?.length) return '';
  return [...items]
    .sort((left, right) => left.order - right.order)
    .map((item) => item.aminoAcid).join('');
}

function parseCif(text, esmOnly = false) {
  const atoms = [];
  const metadataIssues = {};
  const parsed = parseCifLoops(text);
  const authorResidues = {};
  const pxResidues = {};
  const labelResidues = {};
  const labelToAuth = {};
  const labelToEntity = {};
  const authorToEntity = {};
  let firstModel = null;

  for (const loop of loopsFor(parsed, 'atom_site')) {
    for (const row of loop.rows) {
      const model = field(loop, row, '_atom_site.pdbx_PDB_model_num');
      if (model) {
        if (firstModel === null) firstModel = model;
        if (model !== firstModel) continue;
      }
      const group = field(loop, row, '_atom_site.group_PDB').toUpperCase();
      if (group && group !== 'ATOM' && group !== 'HETATM') continue;
      const residueName = field(
        loop, row, '_atom_site.auth_comp_id', '_atom_site.label_comp_id',
      ).toUpperCase();
      const aminoAcid = AA3_TO_1[residueName];
      if (!aminoAcid) continue;
      const labelChain = field(loop, row, '_atom_site.label_asym_id');
      const authChain = field(loop, row, '_atom_site.auth_asym_id');
      atoms.push({ chain: authChain || labelChain, authorChain: authChain || null, labelChain,
        author: field(loop, row, '_atom_site.auth_seq_id'), label: field(loop, row, '_atom_site.label_seq_id'),
        entity: field(loop, row, '_atom_site.label_entity_id'), group, model, aminoAcid, residueName,
        atomName: field(loop, row, '_atom_site.auth_atom_id', '_atom_site.label_atom_id'),
        insertion: field(loop, row, '_atom_site.pdbx_PDB_ins_code'), element: field(loop, row, '_atom_site.type_symbol'),
        xyz: ['x', 'y', 'z'].map((axis) => field(loop, row, `_atom_site.Cartn_${axis}`)),
      });
      if (esmOnly && (group !== 'ATOM' || !STANDARD_SEQUENCE.test(aminoAcid))) continue;
      const labelNumber = Number.parseInt(field(loop, row, '_atom_site.label_seq_id'), 10);
      const authNumber = Number.parseInt(field(
        loop, row, '_atom_site.auth_seq_id', '_atom_site.label_seq_id',
      ), 10);
      if (!Number.isSafeInteger(authNumber) && !Number.isSafeInteger(labelNumber)) continue;
      const author = Number.isSafeInteger(authNumber) ? authNumber : labelNumber;
      const register = Number.isSafeInteger(labelNumber) ? labelNumber : author;
      const insertion = field(loop, row, '_atom_site.pdbx_PDB_ins_code');
      const residue = { author, register, insertion, aminoAcid };
      addResidue(authorResidues, authChain || labelChain, residue);
      addResidue(pxResidues, authChain || labelChain, { ...residue, register: author });
      addResidue(labelResidues, labelChain || authChain, residue);
      if (labelChain && authChain) labelToAuth[labelChain] = authChain;
      const entity = field(loop, row, '_atom_site.label_entity_id');
      if (entity) {
        if (labelChain) labelToEntity[labelChain] = entity;
        if (authChain) authorToEntity[authChain] = entity;
      }
    }
  }

  for (const loop of loopsFor(parsed, 'struct_asym')) {
    for (const row of loop.rows) {
      const label = field(loop, row, '_struct_asym.id');
      const entity = field(loop, row, '_struct_asym.entity_id');
      if (label && entity) labelToEntity[label] = entity;
    }
  }

  const schemeSequences = {};
  for (const loop of loopsFor(parsed, 'pdbx_poly_seq_scheme')) {
    for (const row of loop.rows) {
      const label = field(loop, row, '_pdbx_poly_seq_scheme.asym_id');
      const residueName = field(
        loop, row,
        '_pdbx_poly_seq_scheme.mon_id',
        '_pdbx_poly_seq_scheme.pdb_mon_id',
        '_pdbx_poly_seq_scheme.auth_mon_id',
      ).toUpperCase();
      const aminoAcid = AA3_TO_1[residueName];
      if (!label) continue;
      const rawOrder = Number(field(
        loop, row, '_pdbx_poly_seq_scheme.seq_id', '_pdbx_poly_seq_scheme.ndb_seq_num',
      ));
      if (!schemeSequences[label]) schemeSequences[label] = [];
      schemeSequences[label].push({
        order: rawOrder,
        aminoAcid,
      });
    }
  }

  const entitySequences = {};
  for (const loop of loopsFor(parsed, 'entity_poly_seq')) {
    for (const row of loop.rows) {
      const entity = field(loop, row, '_entity_poly_seq.entity_id');
      const aminoAcid = AA3_TO_1[field(loop, row, '_entity_poly_seq.mon_id').toUpperCase()];
      if (!entity) continue;
      const rawOrder = Number(field(loop, row, '_entity_poly_seq.num'));
      if (!entitySequences[entity]) entitySequences[entity] = [];
      entitySequences[entity].push({
        order: rawOrder,
        aminoAcid,
      });
    }
  }

  const labelMetadata = {};
  for (const chain of Object.keys(labelResidues)) {
    labelMetadata[chain] = orderedSequence(schemeSequences[chain])
      || orderedSequence(entitySequences[labelToEntity[chain]]);
  }
  const authorMetadata = {};
  for (const chain of Object.keys(authorResidues)) {
    const label = Object.keys(labelToAuth).find((candidate) => labelToAuth[candidate] === chain);
    const scheme = schemeSequences[label];
    const entity = entitySequences[authorToEntity[chain] || labelToEntity[label]];
    const issue = metadataSequenceError(scheme) || metadataSequenceError(entity);
    const schemeSequence = orderedSequence(scheme);
    const entitySequence = orderedSequence(entity);
    if (issue) metadataIssues[chain] = issue;
    else if (schemeSequence && entitySequence && schemeSequence !== entitySequence) {
      metadataIssues[chain] = 'mmCIF polymer scheme and entity sequences disagree.';
    }
    authorMetadata[chain] = schemeSequence || entitySequence;
  }

  return {
    format: 'cif', atoms, metadataIssues,
    author: finalizeView(authorResidues, authorMetadata),
    px: finalizeView(pxResidues, authorMetadata),
    // BoltzGen consumes absolute mmCIF label_seq_id positions.
    canonical: finalizeView(labelResidues, labelMetadata, { rebase: false }),
    cif: { parsed, labelToAuth, labelToEntity, authorToEntity },
  };
}

// Recognition uses the same tokenized fields as preparation: CIF column order is arbitrary.
export function hasCifProteinAtoms(text) {
  return loopsFor(parseCifLoops(text), 'atom_site').some((loop) => loop.rows.some((row) => {
    const group = field(loop, row, '_atom_site.group_PDB').toUpperCase();
    const residue = field(loop, row, '_atom_site.auth_comp_id', '_atom_site.label_comp_id').toUpperCase();
    return ['ATOM', 'HETATM'].includes(group) && Boolean(AA3_TO_1[residue]);
  }));
}

export function parseStructureInput(text, targetFilename, esmOnly = false) {
  return targetFilename === 'input.pdb' ? parsePdb(text, esmOnly) : parseCif(text, esmOnly);
}

export function protocolId(protocol) {
  const value = String(protocol || '').trim().toLowerCase();
  if (value === 'bindcraft-v1.5' || value.startsWith('bindcraft v1')) return 'bindcraft';
  if (value === 'boltzgen' || value === 'pxdesign' || value === 'esmfold2-pipeline') return value;
  return null;
}

export function selectedChains(spec, protocol) {
  const raw = protocol === 'esmfold2-pipeline'
    ? spec.protocol_config?.target?.chains
    : spec.chains;
  const values = Array.isArray(raw) ? raw : String(raw || '').split(',');
  return values.map((chain) => String(chain).trim()).filter(Boolean);
}

function requireChains(chains, view, protocol) {
  if (!chains.length) throw invalid(`${protocol}: select at least one target chain.`);
  const missing = chains.filter((chain) => !view[chain]);
  if (missing.length) {
    throw invalid(
      `${protocol}: selected chain(s) not found in the input structure: ${missing.join(', ')}. `
      + `Detected protein chains: ${Object.keys(view).join(', ') || 'none'}.`,
    );
  }
}

function parseDashMask(value, label, { signedSingles = false, rejectDescending = false } = {}) {
  const residues = new Set();
  const tokens = Array.isArray(value) ? value : String(value || '').split(',');
  for (const raw of tokens) {
    if (Number.isSafeInteger(raw) && (signedSingles || raw > 0)) {
      residues.add(raw);
      continue;
    }
    const token = String(raw).trim();
    if (!token) continue;
    if ((signedSingles ? /^-?\d+$/ : /^\d+$/).test(token)) {
      residues.add(Number(token));
      continue;
    }
    const range = token.match(/^(\d+)-(\d+)$/);
    if (!range) throw invalid(`${label} contains an invalid residue token: ${token}.`);
    const first = Number(range[1]);
    const last = Number(range[2]);
    if (rejectDescending && last < first) throw invalid(`${label} range ${token} is descending.`);
    const [start, end] = first <= last ? [first, last] : [last, first];
    if (end - start > 100_000) throw invalid(`${label} selects too many residues.`);
    for (let residue = start; residue <= end; residue += 1) residues.add(residue);
  }
  return residues;
}

function missingResidues(values, available) {
  const allowed = new Set(available);
  return [...values].filter((value) => !allowed.has(value)).sort((a, b) => a - b);
}

function validateBindCraft(spec, view, chains) {
  const hotspots = String(spec.hotspots || '').trim();
  if (!hotspots) return;
  const missing = [];
  for (const raw of hotspots.split(',')) {
    const token = raw.trim().toUpperCase();
    if (!token) continue;
    if (/^[A-Z0-9]$/.test(token)) {
      if (!chains.includes(token)) throw invalid(`BindCraft hotspot chain ${token} is not selected.`);
      continue;
    }
    const match = token.match(/^([A-Z0-9])(\d+)(?:-(\d+))?$/);
    if (!match) throw invalid(`BindCraft hotspot has invalid syntax: ${token}.`);
    const chain = match[1];
    if (!chains.includes(chain)) throw invalid(`BindCraft hotspot chain ${chain} is not selected.`);
    const start = Number(match[2]);
    const end = match[3] ? Number(match[3]) : start;
    if (end < start) throw invalid(`BindCraft hotspot range ${token} is descending.`);
    const absent = missingResidues(
      Array.from({ length: end - start + 1 }, (_, index) => start + index),
      view[chain].authorResidues,
    );
    missing.push(...absent.map((residue) => `${chain}:${residue}`));
  }
  if (missing.length) {
    throw invalid(`BindCraft hotspot author residues are absent from the input: ${missing.join(', ')}.`);
  }
}

function parseBoltzMask(value, available, label) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return new Set();
  if (text === 'all') return new Set(available);
  const residues = new Set();
  for (const raw of text.split(',')) {
    const token = raw.trim();
    if (!token) continue;
    const range = token.match(/^(\d+)\.\.(\d+)$/);
    if (range) {
      const first = Number(range[1]);
      const last = Number(range[2]);
      const [start, end] = first <= last ? [first, last] : [last, first];
      if (end - start > 100_000) throw invalid(`${label} selects too many residues.`);
      for (let residue = start; residue <= end; residue += 1) residues.add(residue);
    } else if (/^\d+$/.test(token)) {
      residues.add(Number(token));
    } else {
      throw invalid(`${label} contains invalid token ${token}; use canonical positions like 1,5..10 or all.`);
    }
  }
  return residues;
}

function hasNumericGaps(values) {
  return values.some((value, index) => index > 0 && value !== values[index - 1] + 1);
}

function validateBoltzGen(spec, view, chains, messages) {
  for (const chain of chains) {
    const data = view[chain];
    if (hasNumericGaps(data.canonicalResidues) && !data.metadataSequence) {
      throw invalid(
        `BoltzGen chain ${chain} has sequence-position gaps but no polymer sequence metadata. `
        + 'Add SEQRES/_entity_poly_seq (for example with Prep Inputs) before using canonical hotspot positions.',
      );
    }
    const authorAtOne = data.canonicalToAuthor[1];
    if (Number.isSafeInteger(authorAtOne) && authorAtOne !== 1) {
      messages.push(
        `BoltzGen chain ${chain} uses canonical positions: author residue ${authorAtOne} maps to canonical 1.`,
      );
    }
  }

  const rules = Array.isArray(spec.binding_rules) ? spec.binding_rules : [];
  for (const rule of rules) {
    const chain = String(rule?.id || '').trim();
    if (!chains.includes(chain)) throw invalid(`BoltzGen binding rule chain ${chain || '(empty)'} is not selected.`);
    const available = view[chain].canonicalResidues;
    const binding = parseBoltzMask(rule.binding, available, `BoltzGen binding rule for chain ${chain}`);
    const notBinding = parseBoltzMask(
      rule.not_binding, available, `BoltzGen not_binding rule for chain ${chain}`,
    );
    const missingBinding = missingResidues(binding, available);
    const missingNotBinding = missingResidues(notBinding, available);
    const missing = [...new Set([...missingBinding, ...missingNotBinding])];
    if (missing.length) {
      const authorHint = view[chain].authorResidues.includes(missing[0])
        ? ` ${missing[0]} is an author number; BoltzGen rules use canonical sequence positions.`
        : '';
      throw invalid(
        `BoltzGen rule residues are absent from canonical chain ${chain}: ${missing.join(', ')}.${authorHint}`,
      );
    }
    const overlap = [...binding].filter((residue) => notBinding.has(residue));
    if (overlap.length) throw invalid(`BoltzGen binding and not_binding overlap on chain ${chain}: ${overlap.join(', ')}.`);
  }
}

function sequenceAlignmentError(sequence, residues) {
  const direct = residues.every(({ author, aminoAcid }) => (
    author > 0 && author <= sequence.length && sequence[author - 1] === aminoAcid
  ));
  if (direct) return null;
  const ways = Array(residues.length + 1).fill(0);
  ways[0] = 1;
  for (const aminoAcid of sequence) {
    for (let index = residues.length - 1; index >= 0; index -= 1) {
      if (residues[index].aminoAcid === aminoAcid) {
        ways[index + 1] = Math.min(2, ways[index + 1] + ways[index]);
      }
    }
  }
  if (ways[residues.length] === 1) return null;
  return ways[residues.length] === 0
    ? 'does not contain the observed coordinate residues in order'
    : 'cannot be aligned unambiguously to the observed coordinate residues';
}

async function requireSequence({
  chain, data, existing, fieldName, protocol, promptSequence, standardOnly,
}) {
  const alphabet = standardOnly ? STANDARD_SEQUENCE : PX_SEQUENCE;
  if (existing !== undefined) {
    const supplied = normalizeSequence(existing);
    if (!supplied || !alphabet.test(supplied)) {
      throw invalid(`${fieldName}.${chain} must contain only ${standardOnly ? 'standard amino acid codes' : 'amino acid letters'}.`);
    }
    return { sequence: supplied, source: 'job.json' };
  }

  const automatic = normalizeSequence(data.sequence);
  if (automatic && alphabet.test(automatic)) {
    return { sequence: automatic, source: data.sequenceSource };
  }
  if (!promptSequence) {
    throw invalid(
      `${protocol} chain ${chain} sequence cannot be reconstructed safely from polymer metadata or contiguous coordinates. `
      + `Add ${fieldName}.${chain} to job.json, or run submit in an interactive terminal to enter it.`,
    );
  }
  const answer = normalizeSequence(await promptSequence({ chain, protocol, fieldName }));
  if (!answer || !alphabet.test(answer)) {
    throw invalid(`Sequence entered for ${protocol} chain ${chain} is empty or contains unsupported amino acid codes.`);
  }
  return { sequence: answer, source: 'prompt' };
}

function validatePxResidues(spec, view, chains) {
  for (const [chain, raw] of Object.entries(spec.hotspots_by_chain || {})) {
    if (!chains.includes(chain)) throw invalid(`PXDesign hotspot chain ${chain} is not selected.`);
    const residues = parseDashMask(raw, `PXDesign hotspots_by_chain.${chain}`);
    const missing = missingResidues(residues, view[chain].authorResidues);
    if (missing.length) {
      throw invalid(`PXDesign hotspot author residues are absent from chain ${chain}: ${missing.join(', ')}.`);
    }
  }
  for (const [chain, raw] of Object.entries(spec.crop_by_chain || {})) {
    if (!chains.includes(chain)) throw invalid(`PXDesign crop chain ${chain} is not selected.`);
    const residues = parseDashMask(raw, `PXDesign crop_by_chain.${chain}`);
    const missing = missingResidues(residues, view[chain].authorResidues);
    if (missing.length) {
      throw invalid(`PXDesign crop author residues are absent from chain ${chain}: ${missing.join(', ')}.`);
    }
  }
}

function normalizePxCropValues(raw, label) {
  const values = Array.isArray(raw) ? raw : String(raw || '').split(',');
  const normalized = [];
  for (const rawValue of values) {
    if (Number.isSafeInteger(rawValue) && rawValue > 0) {
      normalized.push(String(rawValue));
      continue;
    }
    const token = String(rawValue).trim();
    const match = token.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw invalid(`${label} contains an invalid residue range: ${token}.`);
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (start <= 0 || end < start) throw invalid(`${label} contains an invalid residue range: ${token}.`);
    normalized.push(start === end ? String(start) : `${start}-${end}`);
  }
  return [...new Set(normalized)];
}

function normalizePxSpec(spec, chains) {
  spec.chains = chains.join(',');
  if (spec.hotspots_by_chain) {
    spec.hotspots_by_chain = Object.fromEntries(
      Object.entries(spec.hotspots_by_chain).map(([chain, raw]) => [
        chain,
        [...parseDashMask(raw, `PXDesign hotspots_by_chain.${chain}`)].sort((a, b) => a - b),
      ]),
    );
  }
  if (spec.crop_by_chain) {
    spec.crop_by_chain = Object.fromEntries(
      Object.entries(spec.crop_by_chain).map(([chain, raw]) => [
        chain,
        normalizePxCropValues(raw, `PXDesign crop_by_chain.${chain}`),
      ]),
    );
  }
}

function pxCifIdentifierMismatch(parsed, selectedChains) {
  if (parsed.format !== 'cif' || !parsed.cif) return null;
  const selected = new Set(selectedChains);
  for (const [labelChain, authorChain] of Object.entries(parsed.cif.labelToAuth || {})) {
    if (!selected.has(labelChain) && !selected.has(authorChain)) continue;
    if (labelChain !== authorChain) {
      return `label chain ${labelChain} maps to author chain ${authorChain}`;
    }
    const labelView = parsed.canonical[labelChain];
    for (const [labelPosition, authorPosition] of Object.entries(labelView?.canonicalToAuthor || {})) {
      if (Number(labelPosition) !== authorPosition) {
        return `label position ${labelPosition} maps to author residue ${authorPosition} on chain ${labelChain}`;
      }
    }
  }
  return null;
}

function validateEsmResidues(target, view, chains) {
  const byChain = {};
  const selectors = Array.isArray(target.hotspots)
    ? target.hotspots
    : String(target.hotspots || '').split(';').filter(Boolean);
  for (const selector of selectors) {
    const text = String(selector).trim();
    const colon = text.indexOf(':');
    const chain = colon >= 0
      ? text.slice(0, colon)
      : [...chains].sort((a, b) => b.length - a.length).find((item) => text.startsWith(item));
    const mask = colon >= 0 ? text.slice(colon + 1) : text.slice(chain?.length || 0);
    if (!chain || !chains.includes(chain)) throw invalid(`ESMFold2 hotspot has an unselected chain: ${text}.`);
    const residues = parseDashMask(mask, `ESMFold2 hotspot ${chain}`, {
      signedSingles: true,
      rejectDescending: true,
    });
    byChain[chain] = [...(byChain[chain] || []), ...residues];
    const missing = missingResidues(residues, view[chain].authorResidues);
    if (missing.length) {
      throw invalid(`ESMFold2 hotspot author residues are absent from chain ${chain}: ${missing.join(', ')}.`);
    }
  }
  for (const [chain, raw] of Object.entries(target.crop || {})) {
    if (!chains.includes(chain)) throw invalid(`ESMFold2 crop chain ${chain} is not selected.`);
    const residues = parseDashMask(raw, `ESMFold2 crop.${chain}`, { rejectDescending: true });
    const span = view[chain].authorResidues;
    const minimum = Math.min(...span);
    const maximum = Math.max(...span);
    const outside = [...residues].filter((residue) => residue < minimum || residue > maximum);
    if (outside.length) {
      throw invalid(`ESMFold2 crop for chain ${chain} is outside the author residue span ${minimum}-${maximum}.`);
    }
    const issue = effectiveSelectorsError({ protocol: 'ESMFold2', chain, observed: span, crop: [...residues], hotspots: byChain[chain] || [] });
    if (issue) throw invalid(issue);
  }
}

function valueForEntityPoly(header, target) {
  const name = header.replace('_entity_poly.', '');
  if (name === 'entity_id') return target.entity;
  if (name === 'type') return 'polypeptide(L)';
  if (name === 'nstd_linkage' || name === 'nstd_monomer') return 'no';
  if (name === 'pdbx_seq_one_letter_code' || name === 'pdbx_seq_one_letter_code_can') return target.sequence;
  if (name === 'pdbx_strand_id') return target.chain;
  return '?';
}

function valueForEntityPolySeq(header, target, index) {
  const name = header.replace('_entity_poly_seq.', '');
  if (name === 'entity_id') return target.entity;
  if (name === 'num') return String(index + 1);
  if (name === 'mon_id') return AA1_TO_3[target.sequence[index]] || 'UNK';
  if (name === 'hetero') return 'n';
  return '?';
}

function repairPxCif(text, parsedStructure, chains, sequences) {
  const { parsed, labelToAuth, labelToEntity, authorToEntity } = parsedStructure.cif;
  const entityPoly = loopsFor(parsed, 'entity_poly')[0];
  const entityPolySeq = loopsFor(parsed, 'entity_poly_seq')[0];
  const presentPoly = new Set(entityPoly?.rows.map((row) => field(entityPoly, row, '_entity_poly.entity_id')));
  const presentSeq = new Set(entityPolySeq?.rows.map((row) => field(entityPolySeq, row, '_entity_poly_seq.entity_id')));
  const targets = [];
  for (const chain of chains) {
    if (!sequences[chain]) continue;
    const label = Object.keys(labelToAuth).find((candidate) => labelToAuth[candidate] === chain);
    const entity = authorToEntity[chain] || labelToEntity[label];
    if (!entity) throw invalid(`PXDesign cannot repair mmCIF polymer metadata for chain ${chain}: no entity mapping was found.`);
    targets.push({ chain, entity, sequence: sequences[chain] });
  }
  const needPoly = targets.filter((target) => !presentPoly.has(target.entity));
  const needSeq = targets.filter((target) => !presentSeq.has(target.entity));
  if (!needPoly.length && !needSeq.length) return { text, repairedChains: [] };

  const insertions = [];
  if (needPoly.length && entityPoly
    && entityPoly.headers.includes('_entity_poly.entity_id')
    && entityPoly.headers.includes('_entity_poly.type')) {
    insertions.push({
      at: entityPoly.dataEnd,
      rows: needPoly.map((target) => entityPoly.headers.map((header) => valueForEntityPoly(header, target)).join(' ')),
    });
  } else if (needPoly.length) {
    insertions.push({
      at: parsed.loops.find((loop) => loop.headers.some((header) => header.startsWith('_atom_site.')))?.start ?? 1,
      rows: ['#', 'loop_', '_entity_poly.entity_id', '_entity_poly.type',
        ...needPoly.map((target) => `${target.entity} polypeptide(L)`), '#'],
    });
  }
  if (needSeq.length && entityPolySeq
    && entityPolySeq.headers.includes('_entity_poly_seq.entity_id')
    && entityPolySeq.headers.includes('_entity_poly_seq.num')
    && entityPolySeq.headers.includes('_entity_poly_seq.mon_id')) {
    const rows = [];
    for (const target of needSeq) {
      for (let index = 0; index < target.sequence.length; index += 1) {
        rows.push(entityPolySeq.headers.map(
          (header) => valueForEntityPolySeq(header, target, index),
        ).join(' '));
      }
    }
    insertions.push({ at: entityPolySeq.dataEnd, rows });
  } else if (needSeq.length) {
    const rows = ['#', 'loop_', '_entity_poly_seq.entity_id', '_entity_poly_seq.num',
      '_entity_poly_seq.mon_id', '_entity_poly_seq.hetero'];
    for (const target of needSeq) {
      for (let index = 0; index < target.sequence.length; index += 1) {
        rows.push(`${target.entity} ${index + 1} ${AA1_TO_3[target.sequence[index]] || 'UNK'} n`);
      }
    }
    rows.push('#');
    insertions.push({
      at: parsed.loops.find((loop) => loop.headers.some((header) => header.startsWith('_atom_site.')))?.start ?? 1,
      rows,
    });
  }
  const lines = [...parsed.lines];
  for (const insertion of insertions.sort((left, right) => right.at - left.at)) {
    lines.splice(insertion.at, 0, ...insertion.rows);
  }
  return { text: lines.join('\n'), repairedChains: [...new Set([...needPoly, ...needSeq].map((item) => item.chain))] };
}

/**
 * Apply only file-dependent setup rules before a direct object-storage upload. The REST
 * schema remains authoritative for all other protocol and billing fields.
 */
export async function prepareStructureInput({ spec, text, targetFilename, promptSequence }) {
  const protocol = protocolId(spec.protocol);
  if (!protocol) return { spec, text, messages: [] };
  if (protocol === 'bindcraft' && targetFilename === 'input.cif') {
    throw invalid('BindCraft currently requires PDB input; CIF/mmCIF is not supported.');
  }
  const messages = [];
  const transforms = [];
  let prepared = structuredClone(spec);
  let uploadText = text;

  if (protocol === 'esmfold2-pipeline') {
    const target = prepared.protocol_config?.target;
    if (!target || typeof target !== 'object') throw invalid('ESMFold2 protocol_config.target is required.');
    if (target.source === 'rcsb') {
      target.source = 'upload';
      delete target.pdb_id;
      transforms.push({ kind: 'rcsb_snapshot_upload', description: 'Use the prepared structure snapshot as an upload instead of fetching the RCSB entry again during compute.' });
      messages.push('ESMFold2 RCSB target converted to the prepared upload snapshot.');
    }
    // The upload intent binds the actual filename. Keep private storage keys
    // out of this public job document so it validates against the raw schema.
    delete target.object_key;
  }

  if (protocol === 'esmfold2-pipeline' && targetFilename === 'input.cif') {
    const target = prepared.protocol_config?.target;
    if (!target || typeof target !== 'object') {
      throw invalid('ESMFold2 protocol_config.target is required.');
    }
    const sourceChains = selectedChains(prepared, protocol);
    const normalized = normalizeEsmfold2Cif(uploadText);
    uploadText = normalized.text;
    remapEsmfold2Target(target, sourceChains, normalized.chainIdMap);
    if (normalized.addedAuthAtomIds) {
      transforms.push({ kind: 'cif_auth_atom_id_fill', description: 'Filled missing author atom IDs from label atom IDs in the prepared copy.' });
      messages.push(
        'ESMFold2 mmCIF added missing _atom_site.auth_atom_id values from '
        + '_atom_site.label_atom_id in the upload copy; the local file was not changed.',
      );
    }
    if (Object.keys(normalized.chainIdMap).length) {
      transforms.push({ kind: 'cif_author_chain_remap', description: 'Normalized author chain IDs and matching job selectors to supported single-character IDs.' });
      const summary = Object.entries(normalized.chainIdMap)
        .map(([source, destination]) => `${source} -> ${destination}`)
        .join(', ');
      messages.push(`ESMFold2 mmCIF author chain IDs and target selectors normalized for upload: ${summary}.`);
    }
  }

  const parsed = parseStructureInput(uploadText, targetFilename, protocol === 'esmfold2-pipeline');
  const chains = selectedChains(prepared, protocol);
  if (protocol === 'pxdesign' && parsed.format === 'cif') {
    const mismatch = pxCifIdentifierMismatch(parsed, chains);
    if (mismatch) {
      throw invalid(
        `PXDesign direct mmCIF input requires matching label and author identifiers; ${mismatch}. `
        + 'Use an equivalent PDB file or a mmCIF whose label_asym_id/label_seq_id values match its auth identifiers.',
      );
    }
  }
  const view = protocol === 'boltzgen'
    ? parsed.canonical
    : (protocol === 'pxdesign' ? parsed.px : parsed.author);
  requireChains(chains, view, protocol);
  if (protocol === 'pxdesign' || protocol === 'esmfold2-pipeline') {
    const label = protocol === 'pxdesign' ? 'PXDesign' : 'ESMFold2';
    if (parsed.cif?.parsed.loops.some((loop) => loop.incompleteTokenCount)) {
      throw invalid(`${label} mmCIF has an incomplete loop row.`);
    }
    const issue = structureRecordsError({ protocol: label, format: parsed.format, chains, atoms: parsed.atoms });
    if (issue) throw invalid(issue);
    for (const chain of chains) {
      if (parsed.metadataIssues[chain]) throw invalid(`${label} chain ${chain}: ${parsed.metadataIssues[chain]}`);
    }
  }

  if (protocol === 'bindcraft') {
    validateBindCraft(prepared, view, chains);
  } else if (protocol === 'boltzgen') {
    validateBoltzGen(prepared, view, chains, messages);
  } else if (protocol === 'pxdesign') {
    validatePxResidues(prepared, view, chains);
    normalizePxSpec(prepared, chains);
    for (const chain of chains) {
      const issue = effectiveSelectorsError({ protocol: 'PXDesign', chain, observed: view[chain].authorResidues,
        crop: prepared.crop_by_chain?.[chain] ? [...parseDashMask(prepared.crop_by_chain[chain], `PXDesign crop ${chain}`)] : undefined,
        hotspots: prepared.hotspots_by_chain?.[chain] || [],
      });
      if (issue) throw invalid(issue);
    }
    const sequences = { ...(prepared.sequence_by_chain || {}) };
    for (const chain of chains) {
      const existing = Object.prototype.hasOwnProperty.call(sequences, chain)
        ? sequences[chain]
        : undefined;
      const resolved = await requireSequence({
        chain,
        data: view[chain],
        existing,
        fieldName: 'sequence_by_chain',
        protocol: 'PXDesign',
        promptSequence,
        standardOnly: false,
      });
      const mappingError = pxSequenceMappingError({
        format: parsed.format,
        chain,
        sequence: resolved.sequence,
        metadataSequence: view[chain].metadataSequence,
        observed: view[chain].residues.map(({ author, aminoAcid }) => ({ authorResidue: author, aminoAcid })),
      });
      if (mappingError) throw invalid(mappingError);
      // PDB-to-CIF conversion ignores SEQRES. Always pass the resolved full
      // sequence explicitly so MSA preparation and design receive the same input.
      sequences[chain] = resolved.sequence;
      messages.push(`PXDesign sequence_by_chain.${chain} prepared from ${resolved.source}.`);
    }
    if (Object.keys(sequences).length) prepared.sequence_by_chain = sequences;
    if (parsed.format === 'cif') {
      const repaired = repairPxCif(uploadText, parsed, chains, sequences);
      uploadText = repaired.text;
      if (repaired.repairedChains.length) {
        transforms.push({ kind: 'cif_polymer_metadata_fill', description: `Filled missing polymer metadata for selected chain(s): ${repaired.repairedChains.join(', ')}.` });
        messages.push(`PXDesign mmCIF polymer metadata repaired for chain(s): ${repaired.repairedChains.join(', ')}.`);
      }
    }
  } else if (protocol === 'esmfold2-pipeline') {
    const target = prepared.protocol_config?.target;
    if (!target || typeof target !== 'object') throw invalid('ESMFold2 protocol_config.target is required.');
    validateEsmResidues(target, view, chains);
    const sequences = { ...(target.sequences || {}) };
    for (const chain of chains) {
      if (view[chain].hasInsertionCodes) {
        throw invalid(`ESMFold2 chain ${chain} has author insertion codes; renumber residues before upload.`);
      }
      const existing = Object.prototype.hasOwnProperty.call(sequences, chain)
        ? sequences[chain]
        : undefined;
      const resolved = await requireSequence({
        chain,
        data: view[chain],
        existing,
        fieldName: 'protocol_config.target.sequences',
        protocol: 'ESMFold2',
        promptSequence,
        standardOnly: true,
      });
      const metadata = view[chain].metadataSequence;
      if (metadata && metadata !== resolved.sequence) throw invalid(`ESMFold2 sequence for chain ${chain} disagrees with polymer metadata.`);
      const metadataPositions = parsed.format === 'cif' && metadata;
      const alignmentError = metadataPositions
        ? (view[chain].residues.some(({ register, aminoAcid }) => resolved.sequence[register - 1] !== aminoAcid)
          ? 'does not match polymer metadata at the coordinate label positions' : null)
        : sequenceAlignmentError(resolved.sequence, view[chain].residues);
      if (alignmentError) throw invalid(`ESMFold2 sequence for chain ${chain} ${alignmentError}.`);
      sequences[chain] = resolved.sequence;
      messages.push(`ESMFold2 target sequence ${chain} prepared from ${resolved.source}.`);
    }
    target.sequences = sequences;
  }

  return { spec: prepared, text: uploadText, messages, transforms };
}
