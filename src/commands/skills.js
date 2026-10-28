/** `ariax skills [protocol]` — locate or read agent guides bundled with this CLI. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { printData, printJson } from '../output.js';
import { usageError } from '../args.js';

const ROOT = fileURLToPath(new URL('../../agent-skills/', import.meta.url));
const MAX_READ_BYTES = 64 * 1024;
const PROTOCOLS = Object.freeze({
  'bindcraft-v1.5': 'ariax-bindcraft',
  bindcraft: 'ariax-bindcraft',
  bindcraft2: 'ariax-bindcraft2',
  boltzgen: 'ariax-boltzgen',
  pxdesign: 'ariax-pxdesign',
  'esmfold2-pipeline': 'ariax-esmfold2-pipeline',
});
const PLATFORMS = Object.freeze({ forge: 'ariax-forge', 'ariax-forge': 'ariax-forge' });
const FORGE_ROOT = join(ROOT, 'skills', 'ariax-forge');
const FORGE_REFERENCES = Object.freeze({
  outputs: join(FORGE_ROOT, 'outputs.md'),
  base: join(FORGE_ROOT, 'tools', 'base.md'),
  ipsae: join(FORGE_ROOT, 'tools', 'ipsae.md'),
  boltz2: join(FORGE_ROOT, 'tools', 'boltz2.md'),
  bindcraft2: join(FORGE_ROOT, 'tools', 'bindcraft2.md'),
  chai1: join(FORGE_ROOT, 'tools', 'chai1.md'),
  'chai1-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'chai1', 'README.md'),
  freebindcraft: join(FORGE_ROOT, 'tools', 'freebindcraft.md'),
  'freebindcraft-inputs': join(FORGE_ROOT, 'references', 'freebindcraft-inputs.md'),
  'freebindcraft-results': join(FORGE_ROOT, 'references', 'freebindcraft-results.md'),
  'boltz2-inputs': join(FORGE_ROOT, 'references', 'boltz2-inputs.md'),
  'boltz2-results': join(FORGE_ROOT, 'references', 'boltz2-results.md'),
  'boltz2-affinity': join(FORGE_ROOT, 'references', 'boltz2-affinity.md'),
  'ipsae-inputs': join(FORGE_ROOT, 'references', 'ipsae-inputs.md'),
  'ipsae-metrics': join(FORGE_ROOT, 'references', 'ipsae-metrics.md'),
  'bindcraft2-science': join(FORGE_ROOT, 'references', 'bindcraft2-science.md'),
  'science-checks': join(FORGE_ROOT, 'references', 'science-checks.md'),
  'freebindcraft-preflight': join(FORGE_ROOT, 'scripts', 'freebindcraft-preflight.py'),
  'ipsae-preflight': join(FORGE_ROOT, 'scripts', 'ipsae-preflight.py'),
  'boltz2-affinity-check': join(FORGE_ROOT, 'scripts', 'boltz2-affinity-check.py'),
  catalog: join(FORGE_ROOT, 'references', 'catalog.md'),
  capabilities: join(FORGE_ROOT, 'tools', 'capabilities.md'),
  'capabilities-matrix': join(FORGE_ROOT, 'tools', 'capabilities', 'matrix.md'),
  genie3: join(FORGE_ROOT, 'tools', 'genie3.md'),
  mpnn: join(FORGE_ROOT, 'tools', 'mpnn.md'),
  proteinmpnn: join(FORGE_ROOT, 'tools', 'mpnn.md'),
  solublempnn: join(FORGE_ROOT, 'tools', 'mpnn.md'),
  ligandmpnn: join(FORGE_ROOT, 'tools', 'mpnn.md'),
  abmpnn: join(FORGE_ROOT, 'tools', 'mpnn.md'),
  'mpnn-fixtures': join(FORGE_ROOT, 'tools', 'mpnn', 'README.md'),
  af2: join(FORGE_ROOT, 'tools', 'af2.md'),
  'af2-msa': join(FORGE_ROOT, 'tools', 'af2', 'msa.md'),
  'af2-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'af2', 'README.md'),
  'structure-tools': join(FORGE_ROOT, 'tools', 'structure-tools.md'),
  foldseek: join(FORGE_ROOT, 'tools', 'structure-tools.md'),
  'structure-tools-definitions': join(FORGE_ROOT, 'tools', 'structure-tools', 'definitions.md'),
  'structure-tools-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'structure-tools', 'README.md'),
  'boltz2-modes': join(FORGE_ROOT, 'tools', 'boltz2', 'modes.md'),
  'boltz2-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'boltz2', 'README.md'),
  'biohub-esm': join(FORGE_ROOT, 'tools', 'biohub-esm.md'),
  'biohub-esmfold2': join(FORGE_ROOT, 'tools', 'biohub-esm.md'),
  'biohub-esmfold2-fast': join(FORGE_ROOT, 'tools', 'biohub-esm.md'),
  'esmc-300m': join(FORGE_ROOT, 'tools', 'biohub-esm.md'),
  'esmc-600m': join(FORGE_ROOT, 'tools', 'biohub-esm.md'),
  'esmc-6b': join(FORGE_ROOT, 'tools', 'biohub-esm.md'),
  'biohub-esm-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'biohub-esm', 'README.md'),
  'absolute-stability': join(FORGE_ROOT, 'tools', 'absolute-stability.md'),
  'absolute-stability-esm3': join(FORGE_ROOT, 'tools', 'absolute-stability.md'),
  'absolute-stability-saprot': join(FORGE_ROOT, 'tools', 'absolute-stability.md'),
  'absolute-stability-assets': join(FORGE_ROOT, 'tools', 'absolute-stability', 'assets.md'),
  'absolute-stability-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'absolute-stability', 'README.md'),
  'protenix-models': join(FORGE_ROOT, 'tools', 'protenix-models.md'),
  'protenix-models-fixtures': join(FORGE_ROOT, 'tools', 'protenix-models', 'README.md'),
  'interface-scores': join(FORGE_ROOT, 'tools', 'interface-scores.md'),
  'interface-scores-adapters': join(FORGE_ROOT, 'tools', 'interface-scores', 'adapters.md'),
  'interface-scores-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'interface-scores', 'README.md'),
  'opendde': join(FORGE_ROOT, 'tools', 'opendde.md'),
  'fampnn': join(FORGE_ROOT, 'tools', 'fampnn.md'),
  'fampnn-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'fampnn', 'README.md'),
  'rfantibody': join(FORGE_ROOT, 'tools', 'rfantibody.md'),
  'rfantibody-fixtures': join(FORGE_ROOT, 'tools', 'rfantibody', 'README.md'),
  'custom-code': join(FORGE_ROOT, 'references', 'custom-code.md'),
  'foundry': join(FORGE_ROOT, 'tools', 'foundry.md'),
  'rfd3': join(FORGE_ROOT, 'tools', 'foundry.md'),
  'rfd3na': join(FORGE_ROOT, 'tools', 'foundry.md'),
  'rf3': join(FORGE_ROOT, 'tools', 'foundry.md'),
  'foundry-outputs': join(FORGE_ROOT, 'tools', 'foundry', 'outputs.md'),
  'foundry-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'foundry', 'README.md'),
  rfd4: join(FORGE_ROOT, 'tools', 'rfd4.md'),
  rfdiffusion4: join(FORGE_ROOT, 'tools', 'rfd4.md'),
  'rfd4-inputs': join(FORGE_ROOT, 'tools', 'rfd4', 'inputs.md'),
  'rfd4-modes': join(FORGE_ROOT, 'tools', 'rfd4', 'modes.md'),
  'rfd4-outputs': join(FORGE_ROOT, 'tools', 'rfd4', 'outputs.md'),
  'rfd4-recipes': join(FORGE_ROOT, 'tools', 'rfd4', 'recipes.md'),
  'rfd4-search': join(FORGE_ROOT, 'tools', 'rfd4', 'search.md'),
  'rfd4-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'rfd4', 'README.md'),
  mol1: join(FORGE_ROOT, 'tools', 'mol1.md'),
  'mol-1': join(FORGE_ROOT, 'tools', 'mol1.md'),
  'mol1-inputs': join(FORGE_ROOT, 'tools', 'mol1', 'inputs.md'),
  'mol1-outputs': join(FORGE_ROOT, 'tools', 'mol1', 'outputs.md'),
  'mol1-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'mol1', 'README.md'),
  'mol1-notice': join(FORGE_ROOT, 'tools', 'examples', 'mol1', 'NOTICE.md'),
  tmol: join(FORGE_ROOT, 'tools', 'tmol.md'),
  'tmol-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'tmol', 'README.md'),
  'jms-legacy': join(FORGE_ROOT, 'tools', 'jms-legacy.md'),
  'jms-legacy-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'jms-legacy', 'README.md'),
  'jms-components': join(FORGE_ROOT, 'tools', 'jms-components.md'),
  'jms-esm2': join(FORGE_ROOT, 'tools', 'jms-components.md'),
  'jms-mpnn': join(FORGE_ROOT, 'tools', 'jms-components.md'),
  'jms-esmfold': join(FORGE_ROOT, 'tools', 'jms-components.md'),
  'jms-aggregate': join(FORGE_ROOT, 'tools', 'jms-components.md'),
  'jms-components-semantics': join(FORGE_ROOT, 'tools', 'jms-components', 'semantics.md'),
  'jms-components-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'jms-components', 'README.md'),
  'openfold3': join(FORGE_ROOT, 'tools', 'openfold3.md'),
  'openbind-0': join(FORGE_ROOT, 'tools', 'openfold3.md'),
  'openfold3-preview2': join(FORGE_ROOT, 'tools', 'openfold3.md'),
  'boltzgen': join(FORGE_ROOT, 'tools', 'boltzgen.md'),
  'boltzgen-fixtures': join(FORGE_ROOT, 'tools', 'boltzgen', 'README.md'),
  'proteina-complexa': join(FORGE_ROOT, 'tools', 'proteina-complexa.md'),
  'proteina-complexa-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'proteina-complexa', 'README.md'),
  // Native guides retain each package's declared qualification scope.
  pxdesign: join(FORGE_ROOT, 'tools', 'pxdesign.md'),
  'pxdesign-native': join(FORGE_ROOT, 'tools', 'pxdesign.md'),
  'esmfold2-pipeline-native': join(FORGE_ROOT, 'tools', 'esmfold2-pipeline.md'),
  'esmfold2-pipeline': join(FORGE_ROOT, 'tools', 'esmfold2-pipeline.md'),
  'campaign-recipes': join(FORGE_ROOT, 'tools', 'campaign-recipes.md'),
  'campaign-recipes-history': join(FORGE_ROOT, 'references', 'campaign-recipes.md'),
  'campaign-consensus': join(FORGE_ROOT, 'tools', 'campaign-recipes.md'),
  'campaign-consensus-formats': join(FORGE_ROOT, 'tools', 'campaign-recipes', 'formats.md'),
  adaptyv: join(FORGE_ROOT, 'references', 'campaign-recipes.md'),
  'campaign-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'campaigns', 'README.md'),
  'opendde-harness': join(FORGE_ROOT, 'tools', 'opendde-harness.md'),
  'opendde-harness-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'opendde-harness', 'README.md'),
  'protein-hunter': join(FORGE_ROOT, 'tools', 'protein-hunter.md'),
  'protein-hunter-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'protein-hunter', 'README.md'),
  'antibody-qc': join(FORGE_ROOT, 'tools', 'antibody-qc.md'),
  'antibody-qc-methods': join(FORGE_ROOT, 'tools', 'antibody-qc', 'methods.md'),
  'antibody-qc-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'antibody-qc', 'README.md'),
  'design-qc': join(FORGE_ROOT, 'tools', 'design-qc.md'),
  'design-qc-formats': join(FORGE_ROOT, 'tools', 'design-qc', 'formats.md'),
  'design-qc-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'design-qc', 'README.md'),
  'mmseqs2': join(FORGE_ROOT, 'tools', 'mmseqs2.md'),
  'mmseqs2-gpu': join(FORGE_ROOT, 'tools', 'mmseqs2.md'),
  'mmseqs2-uniref90': join(FORGE_ROOT, 'tools', 'mmseqs2.md'),
  'mmseqs2-modes': join(FORGE_ROOT, 'tools', 'mmseqs2', 'modes.md'),
  'mmseqs2-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'mmseqs2', 'README.md'),
  igdesign: join(FORGE_ROOT, 'tools', 'igdesign.md'),
  igmpnn: join(FORGE_ROOT, 'tools', 'igdesign.md'),
  'igdesign-modes': join(FORGE_ROOT, 'tools', 'igdesign', 'modes.md'),
  'igdesign-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'igdesign', 'README.md'),
  caliby: join(FORGE_ROOT, 'tools', 'caliby.md'),
  'soluble-caliby': join(FORGE_ROOT, 'tools', 'caliby.md'),
  'caliby-modes': join(FORGE_ROOT, 'tools', 'caliby', 'modes.md'),
  'caliby-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'caliby', 'README.md'),
  spurs: join(FORGE_ROOT, 'tools', 'spurs.md'),
  'spurs-modes': join(FORGE_ROOT, 'tools', 'spurs', 'modes.md'),
  'spurs-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'spurs', 'README.md'),
  immunebuilder: join(FORGE_ROOT, 'tools', 'immunebuilder.md'),
  'immunebuilder-modes': join(FORGE_ROOT, 'tools', 'immunebuilder', 'modes.md'),
  'immunebuilder-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'immunebuilder', 'README.md'),
  'mpnn-acceleration': join(FORGE_ROOT, 'tools', 'mpnn-acceleration.md'),
  'mpnn-acceleration-modes': join(FORGE_ROOT, 'tools', 'mpnn-acceleration', 'modes.md'),
  'mpnn-acceleration-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'mpnn-acceleration', 'README.md'),
  'boltz2-acceleration': join(FORGE_ROOT, 'tools', 'boltz2-acceleration.md'),
  'boltz2-acceleration-modes': join(FORGE_ROOT, 'tools', 'boltz2-acceleration', 'modes.md'),
  'boltz2-acceleration-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'boltz2-acceleration', 'README.md'),
  'lab-feedback': join(FORGE_ROOT, 'tools', 'lab-feedback.md'),
  'lab-feedback-formats': join(FORGE_ROOT, 'tools', 'lab-feedback', 'formats.md'),
  'lab-feedback-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'lab-feedback', 'README.md'),
  'campaign-benchmark': join(FORGE_ROOT, 'tools', 'campaign-benchmark.md'),
  'campaign-benchmark-methods': join(FORGE_ROOT, 'tools', 'campaign-benchmark', 'methods.md'),
  'campaign-benchmark-fixtures': join(FORGE_ROOT, 'tools', 'examples', 'campaign-benchmark', 'README.md'),
});
const FORGE_EXAMPLES = Object.freeze({
  mol1: join(FORGE_ROOT, 'tools', 'examples', 'mol1'),
  'mol-1': join(FORGE_ROOT, 'tools', 'examples', 'mol1'),
  'campaign-benchmark': join(FORGE_ROOT, 'tools', 'examples', 'campaign-benchmark'),
  'campaign-recipes': join(FORGE_ROOT, 'tools', 'examples', 'campaigns'),
  'boltz2-acceleration': join(FORGE_ROOT, 'tools', 'examples', 'boltz2-acceleration'),
  spurs: join(FORGE_ROOT, 'tools', 'examples', 'spurs'),
  'lab-feedback': join(FORGE_ROOT, 'tools', 'examples', 'lab-feedback'),
  immunebuilder: join(FORGE_ROOT, 'tools', 'examples', 'immunebuilder'),
  capabilities: join(FORGE_ROOT, 'tools', 'examples', 'capabilities'),
  root: join(FORGE_ROOT, 'tools', 'examples'),
  base: join(FORGE_ROOT, 'tools', 'examples', 'base'),
  ipsae: join(FORGE_ROOT, 'tools', 'examples', 'ipsae'),
  boltz2: join(FORGE_ROOT, 'tools', 'examples', 'boltz2'),
  bindcraft2: join(FORGE_ROOT, 'tools', 'examples', 'bindcraft2'),
  chai1: join(FORGE_ROOT, 'tools', 'examples', 'chai1'),
  freebindcraft: join(FORGE_ROOT, 'tools', 'examples', 'freebindcraft'),
  science: join(FORGE_ROOT, 'tools', 'examples', 'science'),
  mpnn: join(FORGE_ROOT, 'tools', 'mpnn'),
  proteinmpnn: join(FORGE_ROOT, 'tools', 'mpnn'),
  solublempnn: join(FORGE_ROOT, 'tools', 'mpnn'),
  ligandmpnn: join(FORGE_ROOT, 'tools', 'mpnn'),
  abmpnn: join(FORGE_ROOT, 'tools', 'mpnn'),
  af2: join(FORGE_ROOT, 'tools', 'examples', 'af2'),
  'structure-tools': join(FORGE_ROOT, 'tools', 'examples', 'structure-tools'),
  foldseek: join(FORGE_ROOT, 'tools', 'examples', 'structure-tools'),
  'biohub-esm': join(FORGE_ROOT, 'tools', 'examples', 'biohub-esm'),
  'biohub-esmfold2': join(FORGE_ROOT, 'tools', 'examples', 'biohub-esm'),
  'biohub-esmfold2-fast': join(FORGE_ROOT, 'tools', 'examples', 'biohub-esm'),
  'esmc-300m': join(FORGE_ROOT, 'tools', 'examples', 'biohub-esm'),
  'esmc-600m': join(FORGE_ROOT, 'tools', 'examples', 'biohub-esm'),
  'esmc-6b': join(FORGE_ROOT, 'tools', 'examples', 'biohub-esm'),
  'absolute-stability': join(FORGE_ROOT, 'tools', 'examples', 'absolute-stability'),
  'absolute-stability-esm3': join(FORGE_ROOT, 'tools', 'examples', 'absolute-stability'),
  'absolute-stability-saprot': join(FORGE_ROOT, 'tools', 'examples', 'absolute-stability'),
  'protenix-models': join(FORGE_ROOT, 'tools', 'protenix-models'),
  'interface-scores': join(FORGE_ROOT, 'tools', 'examples', 'interface-scores'),
  'opendde': join(FORGE_ROOT, 'tools', 'examples', 'opendde'),
  'fampnn': join(FORGE_ROOT, 'tools', 'examples', 'fampnn'),
  'rfantibody': join(FORGE_ROOT, 'tools', 'rfantibody'),
  'custom-code': join(FORGE_ROOT, 'tools', 'examples', 'custom-code'),
  'foundry': join(FORGE_ROOT, 'tools', 'examples', 'foundry'),
  'rfd3': join(FORGE_ROOT, 'tools', 'examples', 'foundry'),
  'rfd3na': join(FORGE_ROOT, 'tools', 'examples', 'foundry'),
  'rf3': join(FORGE_ROOT, 'tools', 'examples', 'foundry'),
  rfd4: join(FORGE_ROOT, 'tools', 'examples', 'rfd4'),
  rfdiffusion4: join(FORGE_ROOT, 'tools', 'examples', 'rfd4'),
  tmol: join(FORGE_ROOT, 'tools', 'examples', 'tmol'),
  'jms-legacy': join(FORGE_ROOT, 'tools', 'examples', 'jms-legacy'),
  'jms-components': join(FORGE_ROOT, 'tools', 'examples', 'jms-components'),
  'jms-esm2': join(FORGE_ROOT, 'tools', 'examples', 'jms-components'),
  'jms-mpnn': join(FORGE_ROOT, 'tools', 'examples', 'jms-components'),
  'jms-esmfold': join(FORGE_ROOT, 'tools', 'examples', 'jms-components'),
  'jms-aggregate': join(FORGE_ROOT, 'tools', 'examples', 'jms-components'),
  'openfold3': join(FORGE_ROOT, 'tools', 'openfold3'),
  'openbind-0': join(FORGE_ROOT, 'tools', 'openfold3'),
  'openfold3-preview2': join(FORGE_ROOT, 'tools', 'openfold3'),
  'boltzgen': join(FORGE_ROOT, 'tools', 'boltzgen'),
  'proteina-complexa': join(FORGE_ROOT, 'tools', 'examples', 'proteina-complexa'),
  campaigns: join(FORGE_ROOT, 'tools', 'examples', 'campaigns'),
  'opendde-harness': join(FORGE_ROOT, 'tools', 'examples', 'opendde-harness'),
  'esmfold2-pipeline': join(FORGE_ROOT, 'tools', 'esmfold2-pipeline'),
  'esmfold2-pipeline-native': join(FORGE_ROOT, 'tools', 'esmfold2-pipeline'),
  'protein-hunter': join(FORGE_ROOT, 'tools', 'examples', 'protein-hunter'),
  'antibody-qc': join(FORGE_ROOT, 'tools', 'examples', 'antibody-qc'),
  'design-qc': join(FORGE_ROOT, 'tools', 'examples', 'design-qc'),
  'mmseqs2': join(FORGE_ROOT, 'tools', 'examples', 'mmseqs2'),
  'mmseqs2-gpu': join(FORGE_ROOT, 'tools', 'examples', 'mmseqs2'),
  'mmseqs2-uniref90': join(FORGE_ROOT, 'tools', 'examples', 'mmseqs2'),
  igdesign: join(FORGE_ROOT, 'tools', 'examples', 'igdesign'),
  caliby: join(FORGE_ROOT, 'tools', 'examples', 'caliby'),
  'mpnn-acceleration': join(FORGE_ROOT, 'tools', 'examples', 'mpnn-acceleration'),
});
const CORE_REFERENCES = Object.freeze({
  campaigns: join(ROOT, 'core', 'campaigns.md'),
  candidates: join(ROOT, 'core', 'candidates.md'),
  'engine-choice': join(ROOT, 'core', 'engine-choice.md'),
  examples: join(ROOT, 'core', 'examples.md'),
  feedback: join(ROOT, 'core', 'feedback.md'),
  interpretation: join(ROOT, 'core', 'interpretation.md'),
  'managed-projects': join(ROOT, 'core', 'managed-projects.md'),
  'raw-curl': join(ROOT, 'core', 'raw-curl.md'),
  'recorded-settings': join(ROOT, 'core', 'recorded-settings.md'),
});

function protocolPaths() {
  return {
    'bindcraft-v1.5': join(ROOT, 'skills', 'ariax-bindcraft', 'SKILL.md'),
    bindcraft2: join(ROOT, 'skills', 'ariax-bindcraft2', 'SKILL.md'),
    boltzgen: join(ROOT, 'skills', 'ariax-boltzgen', 'SKILL.md'),
    pxdesign: join(ROOT, 'skills', 'ariax-pxdesign', 'SKILL.md'),
    'esmfold2-pipeline': join(ROOT, 'skills', 'ariax-esmfold2-pipeline', 'SKILL.md'),
  };
}

function outputPaths() {
  return Object.fromEntries(Object.entries(protocolPaths()).map(([protocol, skillPath]) => (
    [protocol, join(skillPath, '..', 'outputs.md')]
  )));
}

function paths() {
  return {
    root: ROOT,
    shared: join(ROOT, 'SKILL.md'),
    protocols: protocolPaths(),
    platforms: { forge: join(ROOT, 'skills', 'ariax-forge', 'SKILL.md') },
    examples: join(ROOT, 'examples'),
    references: { shared: join(ROOT, 'SKILL.md'), ...CORE_REFERENCES },
    protocol_references: { outputs: outputPaths() },
    platform_references: { forge: FORGE_REFERENCES },
    platform_examples: { forge: FORGE_EXAMPLES },
  };
}

function forgeToolPaths(requestedTool) {
  if (typeof requestedTool !== 'string' || !requestedTool.trim()) {
    throw usageError('skills forge: --tool requires a guide ID.');
  }
  const tool = requestedTool.trim();
  // Guide aliases map to a top-level tool guide, or a documented example
  // family with its guide elsewhere. Subreferences are not tool selectors.
  const guides = Object.entries(FORGE_REFERENCES).filter(([id, path]) => (
    dirname(path) === join(FORGE_ROOT, 'tools') || Object.hasOwn(FORGE_EXAMPLES, id)
  ));
  const guide = guides.find(([id]) => id === tool)?.[1];
  if (!guide) throw usageError(`skills forge: unknown tool guide "${tool}". Use the catalog guide ID or the full index.`);
  const matchingGuide = id => guides
    .filter(([alias]) => id === alias || id.startsWith(`${alias}-`))
    .sort(([a], [b]) => b.length - a.length)[0]?.[1];
  const references = Object.fromEntries(Object.entries(FORGE_REFERENCES)
    .filter(([id, path]) => path === guide || matchingGuide(id) === guide));
  const examples = Object.fromEntries(Object.entries(FORGE_EXAMPLES)
    .filter(([id]) => matchingGuide(id) === guide));
  return { platform: 'forge', tool, skill: join(FORGE_ROOT, 'SKILL.md'), references, examples };
}

function protocolSkill(requested) {
  if (Object.hasOwn(PLATFORMS, requested)) return join(ROOT, 'skills', PLATFORMS[requested], 'SKILL.md');
  if (!Object.prototype.hasOwnProperty.call(PROTOCOLS, requested)) {
    throw usageError(`Unknown protocol "${requested}". Run: ariax protocols`);
  }
  const skillName = PROTOCOLS[requested];
  return join(ROOT, 'skills', skillName, 'SKILL.md');
}

function readTarget(requested, reference, all) {
  if (!reference) {
    return requested
      ? { id: 'skill', scope: Object.hasOwn(PLATFORMS, requested) ? 'platform' : 'protocol',
        ...(Object.hasOwn(PLATFORMS, requested) ? { platform: 'forge' } : { protocol: requested }), path: protocolSkill(requested) }
      : { id: 'shared', scope: 'shared', path: all.shared };
  }
  if (reference === 'shared') return { id: reference, scope: 'shared', path: all.shared };
  if (Object.prototype.hasOwnProperty.call(CORE_REFERENCES, reference)) {
    return { id: reference, scope: 'core', path: CORE_REFERENCES[reference] };
  }
  if (Object.hasOwn(PLATFORMS, requested) && Object.hasOwn(FORGE_REFERENCES, reference)) {
    return { id: reference, scope: 'platform', platform: 'forge', path: FORGE_REFERENCES[reference] };
  }
  if (reference === 'outputs') {
    if (!requested) {
      throw usageError('Reference "outputs" requires a protocol or platform, for example: ariax skills boltzgen --reference outputs --read');
    }
    return {
      id: reference,
      scope: 'protocol',
      protocol: requested,
      path: join(ROOT, 'skills', PROTOCOLS[requested], 'outputs.md'),
    };
  }
  const names = Object.keys({ ...all.references,
    ...(Object.hasOwn(PLATFORMS, requested) ? FORGE_REFERENCES : { outputs: null }),
  }).join(', ');
  throw usageError(`Unknown skills reference "${reference}". Available references: ${names}.`);
}

function readGuide(target) {
  const bytes = readFileSync(target.path);
  if (bytes.length > MAX_READ_BYTES) {
    throw usageError(`Bundled guide exceeds the ${MAX_READ_BYTES}-byte read limit.`);
  }
  return { ...target, size_bytes: bytes.length, content: bytes.toString('utf8') };
}

/** @param {{ positionals: string[], flags: Record<string, unknown>, json: boolean }} ctx */
export async function run(ctx) {
  const all = paths();
  const requested = ctx.positionals[0];
  if (requested) {
    protocolSkill(requested);
  }
  if (ctx.flags.reference !== undefined && !ctx.flags.read) {
    throw usageError('skills: --reference requires --read.');
  }
  if (ctx.flags.tool !== undefined) {
    if (!Object.hasOwn(PLATFORMS, requested)) throw usageError('skills: --tool requires the forge platform.');
    if (ctx.flags.read || ctx.flags.reference !== undefined) {
      throw usageError('skills forge: use --tool for discovery; use --reference ID --read to read a guide.');
    }
    const data = forgeToolPaths(ctx.flags.tool);
    if (ctx.json) printJson({ data });
    else {
      printData(`Forge guide: ${data.tool}`);
      for (const [id, path] of Object.entries(data.references)) printData(`Reference ${id}: ${path}`);
      for (const [id, path] of Object.entries(data.examples)) printData(`Examples ${id}: ${path}`);
    }
    return;
  }
  if (ctx.flags.read) {
    const data = readGuide(readTarget(requested, ctx.flags.reference, all));
    if (ctx.json) printJson({ data });
    else printData(data.content);
    return;
  }

  if (requested) {
    const path = protocolSkill(requested);
    if (Object.hasOwn(PLATFORMS, requested)) {
      if (ctx.json) printJson({ data: {
        platform: 'forge', shared: all.shared, skill: path,
        references: { ...all.references, ...FORGE_REFERENCES }, examples: FORGE_EXAMPLES,
      } });
      else printData(path);
      return;
    }
    const references = { ...all.references, outputs: join(path, '..', 'outputs.md') };
    if (ctx.json) {
      printJson({ data: { protocol: requested, shared: all.shared, skill: path, references } });
    } else {
      printData(path);
    }
    return;
  }

  if (ctx.json) {
    printJson({ data: all });
    return;
  }
  printData(`Shared: ${all.shared}`);
  for (const [protocol, path] of Object.entries(all.protocols)) {
    printData(`${protocol}: ${path}`);
  }
  for (const [platform, path] of Object.entries(all.platforms)) printData(`${platform}: ${path}`);
  printData(`Examples: ${all.examples}`);
  printData(`Readable references: ${Object.keys(all.references).join(', ')}`);
  printData('Protocol reference: outputs');
  printData(`Forge references: ${Object.keys(FORGE_REFERENCES).join(', ')}`);
  printData(`Forge examples: ${FORGE_EXAMPLES.root}`);
}
