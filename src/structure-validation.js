/**
 * Pure preparation rules shared verbatim with the Ariax browser.
 * PXDesign reference: e0539ea4b8f4764318d707f19493121fec9064c9.
 * Its PDB converter numbers observed residues 1..N; direct CIF retains labels.
 */

/**
 * @param {{format: string, chain: string, sequence: string, metadataSequence?: string,
 * observed: Array<{authorResidue: number, aminoAcid: string}>}} input
 * @returns {string | null}
 */
export function pxSequenceMappingError({ format, chain, sequence, metadataSequence, observed }) {
  if (metadataSequence && sequence !== metadataSequence) {
    return `PXDesign sequence for chain ${chain} disagrees with the structure's polymer metadata. Provide a matching structure and full sequence.`;
  }
  if (format === 'pdb') {
    if (sequence !== observed.map((residue) => residue.aminoAcid).join('')) {
      return `PXDesign cannot preserve the full sequence/register of PDB chain ${chain}: its converter compacts observed residues. Provide a canonical mmCIF with the full polymer sequence and matching label/author IDs; do not remove missing residues from the sequence.`;
    }
  } else if (observed.some(({ authorResidue, aminoAcid }) => (
    authorResidue < 1 || authorResidue > sequence.length || sequence[authorResidue - 1] !== aminoAcid
  ))) {
    return `PXDesign chain ${chain} coordinates do not match the full sequence at their canonical mmCIF positions. Provide matching polymer metadata and coordinates.`;
  }
  return null;
}

/** @param {{protocol: string, chain: string, observed: number[], crop?: number[], hotspots?: number[]}} input */
export function effectiveSelectorsError({ protocol, chain, observed, crop, hotspots = [] }) {
  if (!crop) return null;
  const retained = new Set(observed.filter((residue) => crop.includes(residue)));
  if (!retained.size) return `${protocol} crop for chain ${chain} retains no observed protein residues.`;
  const outside = hotspots.filter((residue) => !retained.has(residue));
  return outside.length ? `${protocol} hotspots on chain ${chain} are removed by the crop: ${outside.join(', ')}.` : null;
}

/**
 * Validate normalized atom rows from the existing PDB/CIF parsers. Only selected
 * protein chains in the first model affect validation.
 * @param {{protocol: string, format: string, chains: string[], atoms: Array<{
 * chain: string, labelChain?: string, author: string, label?: string, entity?: string,
 * group: string, aminoAcid: string, residueName: string, atomName: string,
 * insertion: string, model?: string, xyz: string[], element?: string,
 * }>}} input
 */
export function structureRecordsError({ protocol, format, chains, atoms }) {
  const firstModel = atoms.find((atom) => atom.model)?.model;
  const seen = new Map();
  const labels = new Map();
  const lastAuthor = new Map();
  for (const atom of atoms) {
    if (firstModel && atom.model && atom.model !== firstModel) continue;
    if (!chains.includes(atom.chain) || !atom.aminoAcid) continue;
    if (!['ATOM', 'HETATM'].includes(atom.group)) return `${protocol} chain ${atom.chain} requires a valid mmCIF group_PDB value (ATOM or HETATM).`;
    if (protocol === 'ESMFold2' && (atom.group !== 'ATOM' || !/^[ACDEFGHIKLMNPQRSTVWY]$/.test(atom.aminoAcid))) continue;
    if (atom.insertion) return `${protocol} chain ${atom.chain} has author insertion codes; provide unambiguous renumbered coordinates before upload.`;
    if (!/^-?\d+$/.test(atom.author) || !Number.isSafeInteger(Number(atom.author))) {
      return `${protocol} chain ${atom.chain} has an invalid author residue number.`;
    }
    if (!atom.atomName || atom.xyz.some((value) => !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value)))) {
      return `${protocol} chain ${atom.chain} requires atom names and finite x, y, z coordinates (Cartn_x, Cartn_y, Cartn_z in mmCIF).`;
    }
    if (format === 'cif' && (!atom.element || !atom.labelChain || !atom.entity || !/^\d+$/.test(atom.label || '') || Number(atom.label) < 1)) {
      return `${protocol} chain ${atom.chain} requires valid mmCIF type_symbol, label_asym_id, label_entity_id, and positive label_seq_id values.`;
    }
    const key = `${atom.chain}:${atom.author}`;
    const signature = `${atom.residueName}:${atom.labelChain || ''}:${atom.label || ''}`;
    if (seen.has(key) && seen.get(key) !== signature) return `${protocol} chain ${atom.chain} has ambiguous residue identities at author residue ${atom.author}.`;
    if (!seen.has(key) && format === 'pdb') {
      const last = lastAuthor.get(atom.chain);
      if (last !== undefined && Number(atom.author) <= last) return `${protocol} PDB chain ${atom.chain} has unordered author residues; provide a consistently ordered structure.`;
      lastAuthor.set(atom.chain, Number(atom.author));
    }
    seen.set(key, signature);
    if (format === 'cif') {
      const labelKey = `${atom.labelChain}:${atom.label}`;
      if (labels.has(labelKey) && labels.get(labelKey) !== key) return `${protocol} has ambiguous canonical mmCIF residue ${labelKey}.`;
      labels.set(labelKey, key);
    }
  }
  return null;
}

/** @param {Array<{order: number, aminoAcid: string}> | undefined} residues */
export function metadataSequenceError(residues) {
  if (!residues?.length) return null;
  const ordered = [...residues].sort((a,b) => a.order - b.order);
  return ordered.some((item, index) => item.order !== index + 1 || !item.aminoAcid || item.aminoAcid === 'X')
    ? 'Polymer metadata must contain one known residue at each consecutive canonical position starting at 1.' : null;
}

/**
 * Compatibility fence for deployed ESMFold2 runtimes with the author fallback
 * bug. Remove only after every selectable runtime preserves missing label slots.
 * Run before cropping: the engine builds the full register first.
 * @param {{chain: string, atoms: Array<{chain: string, labelChain?: string,
 * author: string, label?: string, entity?: string, insertion: string,
 * group: string, aminoAcid: string, model?: string}>,
 * loops: Array<{headers: string[], rows: string[][]}>}} input
 * @returns {string | null}
 */
export function esmfold2RegisterCompatibilityError({ chain, atoms, loops }) {
  const firstModel = atoms.find((atom) => atom.model)?.model;
  const selected = atoms.filter((atom) => atom.chain === chain && atom.group === 'ATOM'
    && /^[ACDEFGHIKLMNPQRSTVWY]$/.test(atom.aminoAcid)
    && (!firstModel || !atom.model || atom.model === firstModel));
  const clean = (value) => {
    const text = String(value ?? '').replace(/^(['"])(.*)\1$/, '$2');
    return text === '.' || text === '?' ? '' : text;
  };
  const rows = (category) => loops.flatMap((loop) => loop.headers.some((header) => header.startsWith(`_${category}.`))
    ? loop.rows.map((row) => Object.fromEntries(loop.headers.map((header, index) => [header, clean(row[index])]))) : []);
  const schemes = rows('pdbx_poly_seq_scheme');
  const entities = rows('entity_poly_seq');
  const protein = /^(ALA|ARG|ASN|ASP|CYS|GLN|GLU|GLY|HIS|ILE|LEU|LYS|MET|PHE|PRO|SER|THR|TRP|TYR|VAL|MSE)$/;
  const labelKey = (atom) => JSON.stringify([atom.labelChain, atom.label]);
  const authorKey = (atom) => JSON.stringify([atom.chain, atom.author, atom.insertion || '']);
  const sources = new Map(selected.map((atom) => [JSON.stringify([atom.labelChain, atom.entity]), atom]));
  for (const source of sources.values()) {
    const observed = selected.filter((atom) => atom.labelChain === source.labelChain && atom.entity === source.entity);
    const byLabel = new Set(observed.map(labelKey));
    const byAuthor = new Map(observed.map((atom) => [authorKey(atom), atom]));
    const scheme = schemes.filter((row) => row['_pdbx_poly_seq_scheme.asym_id'] === source.labelChain
      && protein.test((row['_pdbx_poly_seq_scheme.mon_id'] || row['_pdbx_poly_seq_scheme.pdb_mon_id'] || row['_pdbx_poly_seq_scheme.auth_mon_id'] || '').toUpperCase()));
    const templates = scheme.length ? scheme.map((row, index) => {
      const label = row['_pdbx_poly_seq_scheme.seq_id'] || row['_pdbx_poly_seq_scheme.ndb_seq_num'] || String(index + 1);
      return { labelChain: source.labelChain, label,
        chain: row['_pdbx_poly_seq_scheme.pdb_strand_id'] || row['_pdbx_poly_seq_scheme.auth_asym_id'] || source.labelChain,
        author: row['_pdbx_poly_seq_scheme.auth_seq_num'] || row['_pdbx_poly_seq_scheme.pdb_seq_num'] || label,
        insertion: row['_pdbx_poly_seq_scheme.pdb_ins_code'] || '' };
    }) : entities.filter((row) => row['_entity_poly_seq.entity_id'] === source.entity
      && protein.test((row['_entity_poly_seq.mon_id'] || '').toUpperCase()))
      .map((_, index) => ({ labelChain: source.labelChain, label: String(index + 1),
        chain, author: String(index + 1), insertion: '' }));
    for (const template of templates) {
      if (byLabel.has(labelKey(template))) continue;
      const fallback = byAuthor.get(authorKey(template));
      if (fallback && labelKey(fallback) !== labelKey(template)) {
        return 'This target\'s residue numbering is incompatible with the deployed ESMFold2 runtime. '
          + 'Provide a mmCIF with consistent explicit polymer residue mapping, or contact support before submitting.';
      }
    }
  }
  return null;
}
