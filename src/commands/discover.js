/** `ariax discover` — public unified routing across managed protocols and Forge tools. */
import { usageError } from '../args.js';
import { ApiError, createClient, envelopeList } from '../http.js';
import { requireTrustedApiOrigin, supportsStoredCredentials } from '../config.js';
import { printData, printJson, printProgress, printTable } from '../output.js';

const TIER_ORDER = Object.freeze({
  recommended: 0,
  specialized: 1,
  experimental: 2,
  legacy: 3,
});

const MANAGED_CATALOG = Object.freeze([
  {
    id: 'bindcraft2',
    display_name: 'BindCraft2',
    recommended_for: 'Default for de novo miniproteins, linear/cyclic peptides, multi-target selectivity, and scaffold redesign.',
    constraints: 'Protein/peptide targets (PDB/mmCIF/FASTA); hotspots, coldspots, multi-target.',
    modalities: ['miniprotein', 'peptide', 'cyclic-peptide', 'protein-binder', 'scaffold', 'multi-target', 'nanobody', 'antibody'],
    tasks: ['binder-design', 'antibodies'],
    keywords: ['bindcraft', 'bindcraft2', 'de novo', 'binder', 'miniprotein', 'peptide', 'cyclic', 'hotspot', 'coldspot', 'multi-target', 'selectivity', 'scaffold', 'protein'],
  },
  {
    id: 'boltzgen',
    display_name: 'BoltzGen',
    recommended_for: 'Default for nanobody/antibody CDRs and small-molecule targets; also cyclic peptides and miniproteins.',
    constraints: 'mmCIF/PDB target (or SMILES/CCD ligand); nanobody/Fab scaffolds.',
    modalities: ['nanobody', 'antibody', 'vhh', 'small-molecule', 'cyclic-peptide', 'peptide', 'miniprotein', 'protein-binder'],
    tasks: ['binder-design', 'antibodies'],
    keywords: ['boltzgen', 'nanobody', 'vhh', 'antibody', 'cdr', 'fab', 'small-molecule', 'ligand', 'cyclic', 'peptide', 'miniprotein', 'binder', 'all-atom', 'diffusion'],
  },
  {
    id: 'pxdesign',
    display_name: 'PXDesign',
    recommended_for: 'Fast diffusion-based de novo miniprotein binders (preview/extended presets).',
    constraints: 'Protein targets (mmCIF/PDB + sequence); miniprotein binders only.',
    modalities: ['miniprotein', 'protein-binder'],
    tasks: ['binder-design'],
    keywords: ['pxdesign', 'de novo', 'miniprotein', 'binder', 'diffusion', 'fast', 'preview'],
  },
  {
    id: 'bindcraft-v1.5',
    display_name: 'BindCraft v1.5',
    recommended_for: 'Classic AF2 hallucination miniprotein/peptide binders (prefer bindcraft2 for new work).',
    constraints: 'PDB protein targets; single-target miniproteins and peptides.',
    modalities: ['miniprotein', 'peptide', 'protein-binder'],
    tasks: ['binder-design'],
    keywords: ['bindcraft', 'v1.5', 'af2', 'hallucination', 'miniprotein', 'peptide', 'binder'],
  },
  {
    id: 'esmfold2-pipeline',
    display_name: 'ESMFold2 Pipeline',
    recommended_for: 'High-throughput ESMFold2-guided miniprotein binder design and fast folding screen/triage.',
    constraints: 'Protein targets (mmCIF/PDB + sequences); miniprotein binders.',
    modalities: ['miniprotein', 'protein-binder'],
    tasks: ['binder-design'],
    keywords: ['esmfold', 'esmfold2', 'pipeline', 'high-throughput', 'fast', 'folding', 'triage', 'screen', 'miniprotein', 'binder'],
  },
]);

const OFFLINE_FORGE_TOOLS = Object.freeze([
  { tool: 'boltz2', tier: 'recommended', summary: 'Primary all-atom biomolecular complex structure predictor and small-molecule affinity estimator.', gpu: true, min_vram_gib: 24, modalities: ['protein', 'antibody', 'vhh', 'peptide', 'ligand', 'nucleic-acid', 'small-molecule', 'affinity'], tasks: ['molecular-prediction', 'validation-search'] },
  { tool: 'protenix-models', tier: 'recommended', summary: 'Multi-checkpoint AF3-class structure predictor for proteins, ligands, DNA/RNA, templates, and constraints.', gpu: true, min_vram_gib: 48, modalities: ['protein', 'antibody', 'vhh', 'peptide', 'ligand', 'nucleic-acid', 'small-molecule'], tasks: ['molecular-prediction', 'validation-search'] },
  { tool: 'rfd4-antibody', tier: 'recommended', summary: 'Framework-conditioned VHH joint sequence and structure diffusion generator for nanobody binders.', gpu: true, min_vram_gib: 24, modalities: ['nanobody', 'vhh', 'antibody'], tasks: ['antibodies', 'binder-design'] },
  { tool: 'rfd4', tier: 'recommended', summary: 'Joint sequence and all-atom structure diffusion generator for proteins, binders, motifs, ligands, and DNA.', gpu: true, min_vram_gib: 24, modalities: ['protein', 'antibody', 'vhh', 'ligand', 'nucleic-acid', 'small-molecule', 'motif-scaffold'], tasks: ['binder-design'] },
  { tool: 'bindcraft2', tier: 'recommended', summary: 'AF2-guided binder design with SolubleMPNN redesign across proteins, peptides, and VHH/scFv antibodies.', gpu: true, min_vram_gib: 24, modalities: ['protein', 'miniprotein', 'peptide', 'cyclic-peptide', 'nanobody', 'vhh', 'antibody'], tasks: ['binder-design', 'antibodies'] },
  { tool: 'boltzgen', tier: 'recommended', summary: 'All-atom diffusion design for protein, peptide, nanobody/antibody, and small-molecule binders.', gpu: true, min_vram_gib: 24, modalities: ['protein', 'nanobody', 'vhh', 'antibody', 'peptide', 'cyclic-peptide', 'ligand', 'small-molecule'], tasks: ['binder-design', 'antibodies'] },
  { tool: 'proteinmpnn', tier: 'recommended', summary: 'Standard fixed-backbone protein sequence design and log-likelihood scoring.', gpu: true, min_vram_gib: 8, modalities: ['protein', 'miniprotein', 'peptide'], tasks: ['sequence-optimization'] },
  { tool: 'solublempnn', tier: 'recommended', summary: 'Soluble-protein-biased fixed-backbone sequence design to improve expression and solubility.', gpu: true, min_vram_gib: 8, modalities: ['protein', 'miniprotein', 'peptide'], tasks: ['sequence-optimization'] },
  { tool: 'ligandmpnn', tier: 'recommended', summary: 'All-atom sequence design conditioned on bound small molecules, ions, and nucleic acids.', gpu: true, min_vram_gib: 8, modalities: ['protein', 'ligand', 'small-molecule', 'nucleic-acid'], tasks: ['sequence-optimization'] },
  { tool: 'abmpnn', tier: 'recommended', summary: 'Antibody-specialized fixed-backbone CDR sequence design for paired VH/VL, VHH, and scFv.', gpu: true, min_vram_gib: 8, modalities: ['antibody', 'nanobody', 'vhh'], tasks: ['antibodies', 'sequence-optimization'] },
  { tool: 'interface-scores', tier: 'recommended', summary: 'Unified CPU multi-predictor interface confidence scorer (ipSAE, pDockQ, pDockQ2, LIS) for AF2, Boltz-2, Protenix, RF3, OpenDDE, and OpenFold3.', gpu: false, min_vram_gib: 0, modalities: ['protein', 'antibody', 'nanobody', 'vhh', 'peptide'], tasks: ['validation-search'] },
  { tool: 'tmol', tier: 'recommended', summary: 'GPU-accelerated Rosetta-like all-atom protein energy scoring, interface energy, and minimization.', gpu: true, min_vram_gib: 8, modalities: ['protein', 'antibody', 'vhh', 'peptide'], tasks: ['validation-search'] },
  { tool: 'af2', tier: 'recommended', summary: 'ColabFold/AlphaFold2 monomer and multimer prediction for independent orthogonal refolding.', gpu: true, min_vram_gib: 16, modalities: ['protein', 'antibody', 'vhh', 'peptide'], tasks: ['molecular-prediction', 'validation-search'] },
  { tool: 'structure-tools', tier: 'recommended', summary: 'CPU structural utility suite for PDB/mmCIF cleaning, preparation, superposition, RMSD, and contacts.', gpu: false, min_vram_gib: 0, modalities: ['protein', 'antibody', 'vhh', 'peptide', 'ligand', 'nucleic-acid'], tasks: ['validation-search'] },
  { tool: 'foldseek', tier: 'recommended', summary: 'Fast CPU 3D structural similarity search, clustering, and 3Di encoding against PDB/AFDB.', gpu: false, min_vram_gib: 0, modalities: ['protein', 'antibody', 'vhh'], tasks: ['validation-search'] },
  { tool: 'mmseqs2', tier: 'recommended', summary: 'CPU protein sequence search, clustering, redundancy filtering, and alignment.', gpu: false, min_vram_gib: 0, modalities: ['protein', 'antibody', 'vhh', 'peptide', 'msa'], tasks: ['validation-search'] },
  { tool: 'design-qc', tier: 'recommended', summary: 'CPU design QC for DSSP secondary structure, DockQ pose comparison, and interface score tables.', gpu: false, min_vram_gib: 0, modalities: ['protein', 'antibody', 'vhh', 'peptide'], tasks: ['validation-search'] },
  { tool: 'antibody-qc', tier: 'recommended', summary: 'CPU antibody developability QC for IMGT numbering, CDR liability alerts, and BioPhi OASis humanness.', gpu: false, min_vram_gib: 0, modalities: ['antibody', 'nanobody', 'vhh'], tasks: ['antibodies', 'validation-search'] },
  { tool: 'immunebuilder', tier: 'recommended', summary: 'Fast GPU variable-domain structure prediction for paired antibodies (ABodyBuilder2), VHH, and TCRs.', gpu: true, min_vram_gib: 8, modalities: ['antibody', 'nanobody', 'vhh', 'tcr'], tasks: ['antibodies', 'molecular-prediction'] },
  { tool: 'biohub-esmfold2', tier: 'recommended', summary: 'Single-sequence and MSA-assisted ESMFold2 protein structure prediction.', gpu: true, min_vram_gib: 16, modalities: ['protein', 'peptide'], tasks: ['molecular-prediction', 'validation-search'] },
  { tool: 'esmc-600m', tier: 'recommended', summary: 'Balanced ESM-C 600M protein language model for embeddings and masked log-likelihood scoring.', gpu: true, min_vram_gib: 16, modalities: ['protein', 'antibody', 'vhh', 'peptide'], tasks: ['sequence-optimization', 'validation-search'] },
  { tool: 'rfantibody', tier: 'specialized', summary: 'Integrated RFdiffusion antibody/nanobody backbone generation, ProteinMPNN CDR sequencing, and RF2 prediction.', gpu: true, min_vram_gib: 44, modalities: ['antibody', 'nanobody', 'vhh', 'cdr'], tasks: ['antibodies', 'binder-design'] },
  { tool: 'absolute-stability-esm3', tier: 'specialized', summary: 'ESM3-based learned folding stability (dG) predictor for monomers, complexes, and mutation scans.', gpu: true, min_vram_gib: 24, modalities: ['protein', 'peptide', 'stability'], tasks: ['sequence-optimization', 'validation-search'] },
  { tool: 'chai1', tier: 'specialized', summary: 'Chai-1 v2 multi-modal multimer complex structure predictor with local MSAs, templates, and contact/pocket restraints.', gpu: true, min_vram_gib: 24, modalities: ['protein', 'antibody', 'vhh', 'ligand', 'small-molecule', 'nucleic-acid'], tasks: ['molecular-prediction', 'validation-search'] },
  { tool: 'fampnn', tier: 'specialized', summary: 'Full-atom sequence design, sidechain packing, and single/multi-mutation scoring.', gpu: true, min_vram_gib: 16, modalities: ['protein'], tasks: ['sequence-optimization'] },
  { tool: 'mol1', tier: 'specialized', summary: 'Prepared-JSON all-atom biomolecular structure prediction (Mol-1).', gpu: true, min_vram_gib: 24, modalities: ['protein', 'ligand', 'small-molecule', 'nucleic-acid'], tasks: ['molecular-prediction'] },
  { tool: 'ipsae', tier: 'legacy', superseded_by: 'interface-scores', summary: 'Legacy standalone AF2-focused ipSAE v3 CPU interface scorer; superseded by interface-scores.', gpu: false, min_vram_gib: 0, modalities: ['protein', 'antibody', 'vhh', 'peptide'], tasks: ['validation-search'] },
]);

const FORGE_ONLY_TASKS = new Set(['molecular-prediction', 'sequence-optimization', 'validation-search']);
const FORGE_ONLY_RE = /\b(fold|refold|predict|prediction|structure prediction|dock|docking|affinity|ic50|pic50|mpnn|inverse fold|sequence design|sequence optimization|stability|ddg|thermostability|ipsae|scoring|score|qc|humanness|developability|foldseek|msa|mmseqs|search|cluster|custom|pipeline|multi-stage|rfd3|rfd4|rfdiffusion|rfantibody|boltz2|boltz-2|protenix|chai|af2|alphafold|esmfold|esm-c|mol1|mol-1|immunebuilder|fampnn|caliby|spurs|motif|enzyme|dna|rna|nucleic)\b/i;
const MANAGED_FRIENDLY_RE = /\b(binder|miniprotein|peptide|cyclic|nanobody|vhh|antibody|de novo|design|campaign|bindcraft|boltzgen|pxdesign)\b/i;
const ANTIBODY_RE = /\b(nanobody|vhh|antibody|cdr|fab|scfv|ig)\b/i;

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9.+-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

const GENERIC_TOKENS = new Set(['binder', 'binders', 'design', 'protein', 'proteins', 'tool', 'tools', 'model', 'models', 'for', 'with', 'and', 'the']);

function scoreTextMatch(tokens, haystackParts, { id = '', primary = '' } = {}) {
  if (!tokens.length) return { score: 1, specificHits: 0, specificTotal: 0, exactId: 0 };
  const hay = haystackParts.filter(Boolean).join(' ').toLowerCase();
  const normId = String(id || '').toLowerCase();
  const normPrimary = String(primary || '').toLowerCase();
  const specificTokens = tokens.filter((t) => !GENERIC_TOKENS.has(t));
  let score = 0;
  let specificHits = 0;
  let exactId = 0;
  for (const tok of tokens) {
    const isSpecific = !GENERIC_TOKENS.has(tok);
    const weight = isSpecific ? 3 : 1;
    if (normId && (tok === normId || (tok.length >= 4 && normId.startsWith(tok)))) {
      exactId += 1;
      score += 10;
    }
    if (hay.includes(tok)) {
      score += weight;
      if (isSpecific) {
        specificHits += 1;
        if (normPrimary && normPrimary.includes(tok)) score += 2;
      }
    } else if (tok.endsWith('s') && tok.length > 3 && hay.includes(tok.slice(0, -1))) {
      score += weight * 0.8;
      if (isSpecific) {
        specificHits += 1;
        if (normPrimary && normPrimary.includes(tok.slice(0, -1))) score += 1.5;
      }
    }
  }
  return { score, specificHits, specificTotal: specificTokens.length, exactId };
}

function minVramOf(tool) {
  if (typeof tool.min_vram_gib === 'number') return tool.min_vram_gib;
  const res = tool.resources;
  if (typeof res?.min_vram_gib_per_gpu === 'number') return res.min_vram_gib_per_gpu;
  if (typeof res?.min_vram_gib === 'number') return res.min_vram_gib;
  if (Array.isArray(tool.models)) {
    const vals = tool.models
      .map((m) => m?.resources?.min_vram_gib_per_gpu ?? m?.resources?.min_vram_gib)
      .filter((v) => typeof v === 'number');
    if (vals.length) return Math.min(...vals);
  }
  return tool.gpu === false ? 0 : null;
}

function normalizeManagedProtocol(raw) {
  const id = String(raw.id ?? raw.protocol ?? '').trim();
  const bundled = MANAGED_CATALOG.find((p) => p.id === id);
  return {
    id,
    display_name: raw.display_name ?? raw.name ?? raw.title ?? bundled?.display_name ?? id,
    recommended_for: bundled?.recommended_for ?? String(raw.description ?? raw.summary ?? '').slice(0, 180),
    constraints: bundled?.constraints ?? (typeof raw.constraints === 'string' ? raw.constraints : 'See `ariax schema <id>` for exact input and parameter rules.'),
    next_command: `ariax schema ${id}`,
    _modalities: bundled?.modalities ?? [],
    _tasks: bundled?.tasks ?? ['binder-design'],
    _keywords: [id, raw.name, raw.display_name, raw.description, ...(bundled?.keywords ?? [])],
  };
}

function normalizeForgeTool(raw) {
  const tool = String(raw.tool ?? '').trim();
  const tier = raw.tier ?? (['recommended', 'specialized', 'experimental', 'legacy'].includes(raw.capabilities?.tier) ? raw.capabilities.tier : 'specialized');
  const fullSummary = String(raw.summary ?? raw.description ?? raw.name ?? tool);
  const modalities = Array.isArray(raw.modalities) ? raw.modalities : [];
  const tasks = Array.isArray(raw.capabilities?.tasks) ? raw.capabilities.tasks : (Array.isArray(raw.tasks) ? raw.tasks : []);
  return {
    tool,
    tier,
    summary: fullSummary.length > 145 ? `${fullSummary.slice(0, 142)}...` : fullSummary,
    ...(raw.superseded_by ? { superseded_by: raw.superseded_by } : {}),
    gpu: Boolean(raw.gpu),
    min_vram_gib: minVramOf(raw),
    modalities: modalities.slice(0, 5),
    next_command: `ariax forge catalog --tool ${tool} --with-guide --json`,
    _fullSummary: fullSummary,
    _tasks: tasks,
    _inputs: Array.isArray(raw.inputs) ? raw.inputs : [],
    _outputs: Array.isArray(raw.outputs) ? raw.outputs : [],
    _name: raw.name ?? '',
  };
}

function recommendExecution({ execution, query, task, modality, managedCount, forgeCount }) {
  if (execution === 'managed') {
    return {
      recommended_execution: 'managed',
      rationale: 'Filtered to managed turnkey protocols (--execution managed).',
    };
  }
  if (execution === 'forge') {
    return {
      recommended_execution: 'forge',
      rationale: 'Filtered to interactive Forge tools (--execution forge).',
    };
  }
  const combined = `${query || ''} ${modality || ''}`.trim();
  if (
    managedCount > 0
    && /\besmfold(?:2)?(?:-pipeline)?\b/i.test(combined)
    && !/\bbiohub\b/i.test(combined)
    && /\b(triage|screen|pipeline|binder|design)\b/i.test(combined)
  ) {
    return {
      recommended_execution: 'either',
      rationale: 'Use managed esmfold2-pipeline for turnkey high-throughput folding triage/binder design, or Forge biohub-esmfold2 for standalone structure prediction.',
    };
  }
  if ((task && FORGE_ONLY_TASKS.has(task)) || (FORGE_ONLY_RE.test(combined) && !MANAGED_FRIENDLY_RE.test(combined))) {
    return {
      recommended_execution: 'forge',
      rationale: 'Structure prediction, inverse folding, scoring/QC, and custom multi-stage workflows run on Forge.',
    };
  }
  if (FORGE_ONLY_RE.test(combined) && MANAGED_FRIENDLY_RE.test(combined)) {
    return {
      recommended_execution: 'forge',
      rationale: 'Combining design with custom prediction, scoring, or specialized Forge tools is best run in a Forge workspace.',
    };
  }
  if (ANTIBODY_RE.test(combined) || task === 'antibodies') {
    return {
      recommended_execution: 'either',
      rationale: 'Use managed BoltzGen/BindCraft2 for turnkey campaigns, or Forge (rfd4-antibody, rfantibody, abmpnn, antibody-qc) for custom VHH/Fv pipelines.',
    };
  }
  if (managedCount > 0 && (MANAGED_FRIENDLY_RE.test(combined) || task === 'binder-design')) {
    return {
      recommended_execution: 'managed',
      rationale: 'Standard de novo binder campaigns fit managed turnkey protocols first; use Forge if you need custom stages or extra scoring tools.',
    };
  }
  if (managedCount > 0 && forgeCount > 0) {
    return {
      recommended_execution: 'either',
      rationale: 'Start with a managed protocol for turnkey binder design, or choose Forge for prediction, sequence optimization, QC, and custom pipelines.',
    };
  }
  if (managedCount > 0) {
    return { recommended_execution: 'managed', rationale: 'Matched managed turnkey protocols.' };
  }
  return { recommended_execution: 'forge', rationale: 'Matched interactive Forge workspace tools.' };
}

/** @param {{ client: any, flags: Record<string, any>, positionals: string[], json: boolean }} ctx */
export async function run(ctx) {
  const { flags } = ctx;
  const query = flags.query !== undefined ? String(flags.query).trim() : undefined;
  const task = flags.task !== undefined ? String(flags.task).trim() : undefined;
  const modality = flags.modality !== undefined ? String(flags.modality).trim().toLowerCase() : undefined;
  const execution = flags.execution !== undefined ? String(flags.execution).trim().toLowerCase() : 'all';
  const includeAll = flags.all === true;

  if (!['managed', 'forge', 'all'].includes(execution)) {
    throw usageError('discover: --execution must be managed, forge, or all.');
  }

  const tokens = tokenize(query);

  // For multi-token queries (e.g. "nanobody binder"), omit `q` from the backend
  // summary fetch so generic words do not over-filter tools before weighted
  // specific-token ranking runs client-side.
  const catalogQuery = {
    view: 'summary',
    ...(task ? { task } : {}),
    ...(query && tokens.length <= 1 ? { q: query } : {}),
    ...(modality ? { modality } : {}),
    ...(includeAll ? { include_all: 'true' } : {}),
  };

  const wantManaged = execution === 'managed' || execution === 'all';
  const wantForge = execution === 'forge' || execution === 'all';

  async function getCatalogWithLegacyFallback() {
    try {
      return await ctx.client.get('/api/v1/forge/catalog', { query: catalogQuery, attempts: 1 });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      let apiKey = ctx.config?.apiKey;
      if (!apiKey && ctx.credentialStore && supportsStoredCredentials(ctx.config?.baseUrl)) {
        try { apiKey = (await ctx.credentialStore.read())?.apiKey || ''; } catch { apiKey = ''; }
      }
      if (!apiKey) throw error;
      requireTrustedApiOrigin(ctx.config);
      const authClient = createClient({
        baseUrl: ctx.config.baseUrl,
        apiKey,
        timeoutMs: ctx.timeoutMs,
        fetchImpl: ctx.fetchImpl,
        telemetry: ctx.telemetry,
      });
      return authClient.get('/api/v1/forge/catalog', { query: catalogQuery, attempts: 1 });
    }
  }

  const [protocolsSettled, catalogSettled] = await Promise.allSettled([
    wantManaged ? ctx.client.get('/api/v1/protocols', { attempts: 1 }) : Promise.resolve(null),
    wantForge ? getCatalogWithLegacyFallback() : Promise.resolve(null),
  ]);

  let liveProtocols = false;
  let rawProtocols = [];
  if (wantManaged) {
    if (protocolsSettled.status === 'fulfilled' && protocolsSettled.value) {
      const { list } = envelopeList(protocolsSettled.value.raw ?? protocolsSettled.value.data, ['protocols', 'items']);
      if (list.length) {
        rawProtocols = list;
        liveProtocols = true;
      }
    }
    if (!rawProtocols.length) rawProtocols = [...MANAGED_CATALOG];
  }

  let liveForge = false;
  let rawTools = [];
  let hiddenExperimental = 0;
  let hiddenLegacy = 0;
  if (wantForge) {
    if (catalogSettled.status === 'fulfilled' && catalogSettled.value) {
      const res = catalogSettled.value;
      const tools = Array.isArray(res.data?.tools) ? res.data.tools : [];
      rawTools = tools;
      liveForge = true;
      hiddenExperimental = Number.isInteger(res.meta?.hidden_experimental_count) ? res.meta.hidden_experimental_count : 0;
      hiddenLegacy = Number.isInteger(res.meta?.hidden_legacy_count) ? res.meta.hidden_legacy_count : 0;
    } else {
      rawTools = [...OFFLINE_FORGE_TOOLS];
    }
  }

  // Filter and score managed protocols
  let managed = rawProtocols.map(normalizeManagedProtocol);
  if (task) {
    managed = managed.filter((p) => p._tasks.includes(task));
  }
  if (modality) {
    managed = managed.filter((p) =>
      p._modalities.some((m) => m.toLowerCase().includes(modality))
      || p.recommended_for.toLowerCase().includes(modality)
      || p.id.toLowerCase().includes(modality));
  }
  if (tokens.length) {
    let scored = managed
      .map((p) => ({
        item: p,
        ...scoreTextMatch(
          tokens,
          [p.id, p.display_name, p.recommended_for, p.constraints, ...p._modalities, ...p._keywords],
          { id: p.id, primary: p.recommended_for },
        ),
      }))
      .filter((entry) => entry.score > 0);
    if (scored.some((entry) => entry.specificHits > 0)) {
      scored = scored.filter((entry) => entry.specificHits > 0);
    }
    scored.sort((a, b) => b.exactId - a.exactId || b.specificHits - a.specificHits || b.score - a.score);
    managed = scored.map((entry) => entry.item);
  }
  const managedOut = managed.map(({ id, display_name, recommended_for, constraints, next_command }) => ({
    id, display_name, recommended_for, constraints, next_command,
  }));

  // Filter, tier-filter, and rank Forge tools (handles older servers or offline fallback too)
  let forgeTools = rawTools.map(normalizeForgeTool);
  if (!includeAll) {
    const visible = [];
    for (const item of forgeTools) {
      if (item.tier === 'experimental') { hiddenExperimental = Math.max(hiddenExperimental, 1); continue; }
      if (item.tier === 'legacy') { hiddenLegacy = Math.max(hiddenLegacy, 1); continue; }
      visible.push(item);
    }
    if (!liveForge || (hiddenExperimental === 0 && hiddenLegacy === 0)) {
      const expCount = forgeTools.filter((t) => t.tier === 'experimental').length;
      const legCount = forgeTools.filter((t) => t.tier === 'legacy').length;
      if (expCount) hiddenExperimental = expCount;
      if (legCount) hiddenLegacy = legCount;
    }
    forgeTools = visible;
  }
  if (task) {
    forgeTools = forgeTools.filter((t) => !t._tasks.length || t._tasks.includes(task));
  }
  if (modality) {
    forgeTools = forgeTools.filter((t) =>
      t.modalities.some((m) => m.toLowerCase().includes(modality))
      || t._tasks.some((tk) => tk.toLowerCase().includes(modality))
      || t.summary.toLowerCase().includes(modality)
      || t.tool.toLowerCase().includes(modality));
  }
  if (tokens.length) {
    let scored = forgeTools
      .map((t) => ({
        item: t,
        ...scoreTextMatch(
          tokens,
          [t.tool, t._name, t._fullSummary, ...t.modalities, ...t._tasks, ...t._inputs, ...t._outputs],
          { id: t.tool, primary: t._fullSummary },
        ),
      }))
      .filter((entry) => entry.score > 0);
    if (scored.some((entry) => entry.specificHits > 0)) {
      scored = scored.filter((entry) => entry.specificHits > 0);
    }
    scored.sort((a, b) =>
      b.exactId - a.exactId
      || b.specificHits - a.specificHits
      || (TIER_ORDER[a.item.tier] ?? 9) - (TIER_ORDER[b.item.tier] ?? 9)
      || b.score - a.score
      || a.item.tool.localeCompare(b.item.tool));
    forgeTools = scored.map((entry) => entry.item);
  } else {
    forgeTools.sort((a, b) =>
      (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9)
      || a.tool.localeCompare(b.tool));
  }

  const maxForge = includeAll ? 16 : (tokens.length || task || modality ? 6 : 4);
  const totalMatchedForge = forgeTools.length;
  const forgeOut = forgeTools.slice(0, maxForge).map(({ tool, tier, summary, superseded_by, gpu, min_vram_gib, modalities, next_command }) => ({
    tool, tier, summary, ...(superseded_by ? { superseded_by } : {}), gpu, min_vram_gib, modalities, next_command,
  }));

  const routing = recommendExecution({
    execution,
    query,
    task,
    modality,
    managedCount: managedOut.length,
    forgeCount: forgeOut.length,
  });

  const payload = {
    data: {
      recommended_execution: routing.recommended_execution,
      rationale: routing.rationale,
      managed_protocols: managedOut,
      forge_tools: forgeOut,
    },
    meta: {
      hidden_experimental_count: hiddenExperimental,
      hidden_legacy_count: hiddenLegacy,
      ...(totalMatchedForge > forgeOut.length ? { returned_forge_tools: forgeOut.length, total_matched_forge_tools: totalMatchedForge } : {}),
      sources: {
        managed: !wantManaged ? 'skipped' : (liveProtocols ? 'live' : 'offline_fallback'),
        forge: !wantForge ? 'skipped' : (liveForge ? 'live' : 'offline_fallback'),
      },
    },
  };

  if (ctx.json) {
    printJson(payload);
    return payload;
  }

  printData(`Recommended execution: ${routing.recommended_execution}`);
  printData(`Rationale: ${routing.rationale}`);
  if (managedOut.length) {
    printData('');
    printData('Managed protocols:');
    printTable(
      ['id', 'name', 'recommended_for'],
      managedOut.map((p) => [p.id, p.display_name, p.recommended_for]),
    );
  }
  if (forgeOut.length) {
    printData('');
    printData('Forge tools:');
    printTable(
      ['tool', 'tier', 'vram_gib', 'summary'],
      forgeOut.map((t) => [t.tool, t.tier, t.min_vram_gib ?? '-', t.summary]),
    );
  }
  if (!managedOut.length && !forgeOut.length) {
    printData('No matching protocols or Forge tools found.');
  }
  if (hiddenExperimental || hiddenLegacy) {
    printProgress(`Hidden: ${hiddenExperimental} experimental, ${hiddenLegacy} legacy (pass --all to include).`);
  }
  if ((wantManaged && !liveProtocols) || (wantForge && !liveForge)) {
    printProgress('Note: used bundled offline metadata because the live API was unreachable.');
  }
  return payload;
}
