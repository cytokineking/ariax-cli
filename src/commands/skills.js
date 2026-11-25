/** `ariax skills` — discover, read, and install agent guides bundled with this CLI. */
import fs from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { printData, printJson, printProgress, printTable } from '../output.js';
import { usageError } from '../args.js';
import { buildInfo } from '../build-info.js';

const ROOT = fileURLToPath(new URL('../../agent-skills/', import.meta.url));
const MAX_READ_BYTES = 64 * 1024;
const MANAGED_MARKER_RE = /<!--\s*managed-by:\s*ariax-cli\s+version=([^\s]+)(?:\s+sha256=([a-f0-9]+))?\s*-->/;

const PROTOCOLS = Object.freeze({
  'bindcraft-v1.5': 'ariax-bindcraft',
  bindcraft: 'ariax-bindcraft',
  bindcraft2: 'ariax-bindcraft2',
  boltzgen: 'ariax-boltzgen',
  pxdesign: 'ariax-pxdesign',
  'esmfold2-pipeline': 'ariax-esmfold2-pipeline',
});
const CANONICAL_PROTOCOLS = Object.freeze([
  ['bindcraft2', 'ariax-bindcraft2'],
  ['boltzgen', 'ariax-boltzgen'],
  ['pxdesign', 'ariax-pxdesign'],
  ['bindcraft-v1.5', 'ariax-bindcraft'],
  ['esmfold2-pipeline', 'ariax-esmfold2-pipeline'],
]);
const PLATFORMS = Object.freeze({ forge: 'ariax-forge', 'ariax-forge': 'ariax-forge' });
const FORGE_ROOT = join(ROOT, 'skills', 'ariax-forge');

/** Explicit Forge tool & guide aliases pointing to canonical guide relative paths under FORGE_ROOT. */
const FORGE_ALIASES = Object.freeze({
  proteinmpnn: 'tools/mpnn.md',
  solublempnn: 'tools/mpnn.md',
  ligandmpnn: 'tools/mpnn.md',
  abmpnn: 'tools/mpnn.md',
  foldseek: 'tools/structure-tools.md',
  'biohub-esmfold2': 'tools/biohub-esm.md',
  'biohub-esmfold2-fast': 'tools/biohub-esm.md',
  'esmc-300m': 'tools/biohub-esm.md',
  'esmc-600m': 'tools/biohub-esm.md',
  'esmc-6b': 'tools/biohub-esm.md',
  'absolute-stability-esm3': 'tools/absolute-stability.md',
  'absolute-stability-saprot': 'tools/absolute-stability.md',
  'protenix-v2': 'tools/protenix-models.md',
  rfd3: 'tools/foundry.md',
  rfd3na: 'tools/foundry.md',
  rf3: 'tools/foundry.md',
  rfdiffusion4: 'tools/rfd4.md',
  'rfd4-antibody': 'tools/rfd4-antibody.md',
  'mol-1': 'tools/mol1.md',
  'jms-esm2': 'tools/jms-components.md',
  'jms-mpnn': 'tools/jms-components.md',
  'jms-esmfold': 'tools/jms-components.md',
  'jms-aggregate': 'tools/jms-components.md',
  'openbind-0': 'tools/openfold3.md',
  'openfold3-preview2': 'tools/openfold3.md',
  'pxdesign-native': 'tools/pxdesign.md',
  'esmfold2-pipeline-native': 'tools/esmfold2-pipeline.md',
  'campaign-consensus': 'tools/campaign-recipes.md',
  'campaign-consensus-formats': 'tools/campaign-recipes/formats.md',
  'campaign-recipes-history': 'references/campaign-recipes.md',
  'mmseqs2-gpu': 'tools/mmseqs2.md',
  'mmseqs2-uniref90': 'tools/mmseqs2.md',
  igmpnn: 'tools/igdesign.md',
  'soluble-caliby': 'tools/caliby.md',
  adaptyv: 'references/adaptyv-ordering.md',
});

const EXAMPLE_ALIASES = Object.freeze({
  'mol-1': 'mol1',
  'campaign-recipes': 'campaigns',
  proteinmpnn: 'mpnn',
  solublempnn: 'mpnn',
  ligandmpnn: 'mpnn',
  abmpnn: 'mpnn',
  foldseek: 'structure-tools',
  'biohub-esmfold2': 'biohub-esm',
  'biohub-esmfold2-fast': 'biohub-esm',
  'esmc-300m': 'biohub-esm',
  'esmc-600m': 'biohub-esm',
  'esmc-6b': 'biohub-esm',
  'absolute-stability-esm3': 'absolute-stability',
  'absolute-stability-saprot': 'absolute-stability',
  'protenix-v2': 'protenix-models',
  rfd3: 'foundry',
  rfd3na: 'foundry',
  rf3: 'foundry',
  rfdiffusion4: 'rfd4',
  'rfd4-antibody': 'rfd4',
  'jms-esm2': 'jms-components',
  'jms-mpnn': 'jms-components',
  'jms-esmfold': 'jms-components',
  'jms-aggregate': 'jms-components',
  'openbind-0': 'openfold3',
  'openfold3-preview2': 'openfold3',
  'esmfold2-pipeline-native': 'esmfold2-pipeline',
  'mmseqs2-gpu': 'mmseqs2',
  'mmseqs2-uniref90': 'mmseqs2',
  igmpnn: 'igdesign',
  'soluble-caliby': 'caliby',
});

function listDirSafe(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function discoverCoreReferences() {
  const refs = {};
  const coreDir = join(ROOT, 'core');
  for (const entry of listDirSafe(coreDir)) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      refs[entry.name.slice(0, -3)] = join(coreDir, entry.name);
    }
  }
  return refs;
}

function discoverForgeReferences() {
  const refs = {};
  const addIfExists = (id, fullPath) => {
    if (fs.existsSync(fullPath)) refs[id] = fullPath;
  };

  // 1. Platform outputs guide
  addIfExists('outputs', join(FORGE_ROOT, 'outputs.md'));

  // 2. Top-level tools/*.md
  const toolsDir = join(FORGE_ROOT, 'tools');
  for (const entry of listDirSafe(toolsDir)) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      refs[entry.name.slice(0, -3)] = join(toolsDir, entry.name);
    }
  }

  // 3. Sub-guides under tools/<subdir>/*.md (excluding examples/)
  for (const entry of listDirSafe(toolsDir)) {
    if (!entry.isDirectory() || entry.name === 'examples') continue;
    const subDir = join(toolsDir, entry.name);
    for (const child of listDirSafe(subDir)) {
      if (!child.isFile() || !child.name.endsWith('.md')) continue;
      const stem = child.name.slice(0, -3);
      const id = stem.toLowerCase() === 'readme' ? `${entry.name}-fixtures` : `${entry.name}-${stem}`;
      if (!Object.hasOwn(refs, id)) refs[id] = join(subDir, child.name);
    }
  }

  // 4. References under references/*.md
  const refsDir = join(FORGE_ROOT, 'references');
  for (const entry of listDirSafe(refsDir)) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const stem = entry.name.slice(0, -3);
    if (stem === 'campaign-recipes') {
      refs['campaign-recipes-history'] = join(refsDir, entry.name);
      continue;
    }
    if (!Object.hasOwn(refs, stem)) refs[stem] = join(refsDir, entry.name);
  }

  // 5. Remaining customer-facing scripts under scripts/*.py
  const scriptsDir = join(FORGE_ROOT, 'scripts');
  for (const entry of listDirSafe(scriptsDir)) {
    if (entry.isFile() && entry.name.endsWith('.py')) {
      const stem = entry.name.slice(0, -3);
      if (!Object.hasOwn(refs, stem)) refs[stem] = join(scriptsDir, entry.name);
    }
  }

  // 6. Any remaining markdown guides under tools/examples/<dir>/*.md
  const examplesDir = join(toolsDir, 'examples');
  for (const entry of listDirSafe(examplesDir)) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const stem = entry.name.slice(0, -3);
      const id = stem.toLowerCase() === 'readme' ? 'examples-index' : `examples-${stem}`;
      if (!Object.hasOwn(refs, id)) refs[id] = join(examplesDir, entry.name);
      continue;
    }
    if (!entry.isDirectory()) continue;
    const sub = join(examplesDir, entry.name);
    const prefix = entry.name === 'campaigns' ? 'campaign' : entry.name;
    for (const child of listDirSafe(sub)) {
      if (child.isFile() && child.name.endsWith('.md')) {
        const stem = child.name.slice(0, -3);
        const id = stem.toLowerCase() === 'readme'
          ? `${prefix}-fixtures`
          : `${prefix}-${stem.toLowerCase()}`;
        if (!Object.hasOwn(refs, id)) refs[id] = join(sub, child.name);
      } else if (child.isDirectory()) {
        const nested = join(sub, child.name);
        for (const grand of listDirSafe(nested)) {
          if (grand.isFile() && grand.name.endsWith('.md')) {
            const stem = grand.name.slice(0, -3);
            const id = stem.toLowerCase() === 'readme'
              ? `${prefix}-${child.name}-readme`
              : `${prefix}-${child.name}-${stem.toLowerCase()}`;
            if (!Object.hasOwn(refs, id)) refs[id] = join(nested, grand.name);
          }
        }
      }
    }
  }

  // 7. Explicit tool/guide aliases (only when target file exists)
  for (const [alias, relTarget] of Object.entries(FORGE_ALIASES)) {
    const full = join(FORGE_ROOT, relTarget);
    if (fs.existsSync(full)) {
      refs[alias] = full;
    } else if (alias === 'adaptyv') {
      const fallback = join(FORGE_ROOT, 'references', 'campaign-recipes.md');
      if (fs.existsSync(fallback)) refs[alias] = fallback;
    }
  }

  return refs;
}

function discoverForgeExamples() {
  const examples = {};
  const toolsDir = join(FORGE_ROOT, 'tools');
  const examplesDir = join(toolsDir, 'examples');
  if (fs.existsSync(examplesDir)) {
    examples.root = examplesDir;
    for (const entry of listDirSafe(examplesDir)) {
      if (entry.isDirectory()) {
        examples[entry.name] = join(examplesDir, entry.name);
      }
    }
  }
  // Subdirectories directly under tools/ that hold fixtures/examples (non-md files or README)
  for (const dirName of ['genie3', 'mpnn', 'protenix-models', 'rfantibody', 'openfold3', 'boltzgen', 'esmfold2-pipeline']) {
    const full = join(toolsDir, dirName);
    if (fs.existsSync(full) && !Object.hasOwn(examples, dirName)) {
      examples[dirName] = full;
    }
  }
  if (examples.campaigns && !examples['campaign-recipes']) {
    examples['campaign-recipes'] = examples.campaigns;
  }
  for (const [alias, target] of Object.entries(EXAMPLE_ALIASES)) {
    if (Object.hasOwn(examples, target)) examples[alias] = examples[target];
  }
  return examples;
}

function parseFrontmatterAndBody(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) return { frontmatter: {}, body: content };
  const raw = match[1];
  const body = match[2];
  const fm = {};
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (val === '>' || val === '|' || val === '>-' || val === '|-') {
      const chunks = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
        i += 1;
        chunks.push(lines[i].trim());
      }
      val = chunks.join(' ');
    } else if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fm[key] = val;
  }
  return { frontmatter: fm, body };
}

function extractDescription(filePath) {
  let text;
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(2048);
      const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
      text = buf.subarray(0, bytes).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
  const { frontmatter, body } = parseFrontmatterAndBody(text);
  if (typeof frontmatter.description === 'string' && frontmatter.description.trim()) {
    return truncateOneLine(frontmatter.description.trim());
  }
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  let heading = '';
  for (const line of lines) {
    if (!line || line.startsWith('<!--')) continue;
    if (line.startsWith('#')) {
      if (!heading) heading = line.replace(/^#+\s*/, '').trim();
      continue;
    }
    if (line.startsWith('```') || line.startsWith('|') || line.startsWith('- ') || line.startsWith('>')) continue;
    return truncateOneLine(line);
  }
  return truncateOneLine(heading);
}

function truncateOneLine(text, maxLen = 120) {
  const clean = String(text || '').replace(/\s+/g, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen - 3)}...` : clean;
}

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
  const coreRefs = discoverCoreReferences();
  const forgeRefs = discoverForgeReferences();
  const forgeExamples = discoverForgeExamples();
  return {
    root: ROOT,
    shared: join(ROOT, 'SKILL.md'),
    protocols: protocolPaths(),
    platforms: { forge: join(ROOT, 'skills', 'ariax-forge', 'SKILL.md') },
    examples: join(ROOT, 'examples'),
    references: { shared: join(ROOT, 'SKILL.md'), ...coreRefs },
    protocol_references: { outputs: outputPaths() },
    platform_references: { forge: forgeRefs },
    platform_examples: { forge: forgeExamples },
  };
}

function dirHasBundledFixtures(dirPath) {
  try {
    const stack = [dirPath];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of listDirSafe(current)) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile()) {
          const lower = entry.name.toLowerCase();
          if (!lower.endsWith('.md') && !lower.startsWith('license') && !lower.startsWith('notice')) {
            return true;
          }
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

function closestMatches(query, candidates, limit = 5) {
  const normQuery = String(query ?? '')
    .trim()
    .toLowerCase()
    .split('#')[0]
    .replace(/\\/g, '/')
    .replace(/^(?:\.\.?\/)+/, '')
    .replace(/^(?:references|tools\/examples|tools|core|scripts|examples)\//, '')
    .replace(/\.(?:md|py)$/, '')
    .replace(/\//g, '-');
  if (!normQuery) return candidates.slice(0, limit);
  const queryTokens = new Set(normQuery.split(/[-_./]+/).filter(Boolean));
  const scored = [];
  const seen = new Set();
  for (const name of candidates) {
    if (seen.has(name)) continue;
    seen.add(name);
    const lower = name.toLowerCase();
    const candTokens = lower.split(/[-_./]+/).filter(Boolean);
    let overlap = 0;
    for (const tok of candTokens) {
      if (queryTokens.has(tok)) overlap += 1;
    }
    const dist = levenshtein(normQuery, lower);
    const maxLen = Math.max(normQuery.length, lower.length, 1);
    const sim = 1 - (dist / maxLen);
    const substringBonus = (lower.includes(normQuery) || normQuery.includes(lower)) ? 0.35 : 0;
    const suffixBonus = lower.endsWith(`-${normQuery}`) || lower.startsWith(`${normQuery}-`) ? 0.25 : 0;
    const tokenBonus = queryTokens.size > 0 ? (overlap / Math.max(queryTokens.size, candTokens.length)) * 0.4 : 0;
    const score = sim + substringBonus + suffixBonus + tokenBonus;
    scored.push({ name, score, dist });
  }
  scored.sort((a, b) => b.score - a.score || a.dist - b.dist || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map((item) => item.name);
}

function forgeToolPaths(requestedTool, forgeRefs, forgeExamples) {
  if (typeof requestedTool !== 'string' || !requestedTool.trim()) {
    throw usageError('skills forge: --tool requires a guide ID.');
  }
  const tool = requestedTool.trim();
  const guides = Object.entries(forgeRefs).filter(([id, filePath]) => (
    fs.existsSync(filePath) && (dirname(filePath) === join(FORGE_ROOT, 'tools') || Object.hasOwn(forgeExamples, id))
  ));
  const guide = guides.find(([id]) => id === tool)?.[1] ?? (fs.existsSync(forgeRefs[tool]) ? forgeRefs[tool] : null);
  if (!guide) {
    const suggestions = closestMatches(tool, Object.keys(forgeRefs), 5);
    const hint = suggestions.length ? ` Closest matches: ${suggestions.join(', ')}.` : '';
    throw usageError(`skills forge: unknown tool guide "${tool}".${hint} Run ariax skills --list (or ariax skills forge --json) to browse all references.`);
  }
  const matchingGuide = (id) => guides
    .filter(([alias]) => id === alias || id.startsWith(`${alias}-`))
    .sort(([a], [b]) => b.length - a.length)[0]?.[1];
  const references = Object.fromEntries(Object.entries(forgeRefs)
    .filter(([id, filePath]) => fs.existsSync(filePath) && (filePath === guide || matchingGuide(id) === guide)));
  const examples = Object.fromEntries(Object.entries(forgeExamples)
    .filter(([id, dirPath]) => matchingGuide(id) === guide && fs.existsSync(dirPath) && dirHasBundledFixtures(dirPath)));
  return { platform: 'forge', tool, guide, skill: join(FORGE_ROOT, 'SKILL.md'), references, examples };
}

/** Read one Forge tool guide directly (used by `skills forge --tool X --read` and `forge catalog --tool X --with-guide`). */
export function readForgeToolGuide(requestedTool) {
  const forgeRefs = discoverForgeReferences();
  const forgeExamples = discoverForgeExamples();
  const scoped = forgeToolPaths(requestedTool, forgeRefs, forgeExamples);
  const bytes = fs.readFileSync(scoped.guide);
  if (bytes.length > MAX_READ_BYTES) {
    throw usageError(`Bundled guide exceeds the ${MAX_READ_BYTES}-byte read limit.`);
  }
  return {
    ...scoped,
    id: scoped.tool,
    scope: 'platform',
    path: scoped.guide,
    size_bytes: bytes.length,
    content: bytes.toString('utf8'),
  };
}

function protocolSkill(requested) {
  if (Object.hasOwn(PLATFORMS, requested)) return join(ROOT, 'skills', PLATFORMS[requested], 'SKILL.md');
  if (!Object.prototype.hasOwnProperty.call(PROTOCOLS, requested)) {
    throw usageError(`Unknown protocol "${requested}". Run: ariax protocols`);
  }
  const skillName = PROTOCOLS[requested];
  return join(ROOT, 'skills', skillName, 'SKILL.md');
}

function buildReferenceCandidates(reference) {
  const raw = String(reference).trim();
  const withoutAnchor = raw.split('#')[0].trim().replace(/\\/g, '/');
  const strippedRelative = withoutAnchor.replace(/^(?:\.\.?\/)+/, '').replace(/^\/+/, '');
  const prefersCore = /^core\//i.test(strippedRelative);
  const stripExt = (value) => value.replace(/\.(?:md|py)$/i, '');
  const list = [];
  const push = (value) => {
    if (value && !list.includes(value)) list.push(value);
  };
  const addForms = (value) => {
    const clean = stripExt(value).replace(/\/+$/, '');
    if (!clean) return;
    push(clean);
    const lower = clean.toLowerCase();
    push(lower);
    if (clean.includes('/')) {
      const dashed = clean.replace(/\//g, '-');
      push(dashed);
      push(dashed.toLowerCase());
      if (/\/readme$/i.test(clean)) {
        const prefix = clean.slice(0, -'/readme'.length).replace(/\//g, '-');
        push(`${prefix}-fixtures`);
        push(`${prefix.toLowerCase()}-fixtures`);
      }
    }
  };
  push(raw);
  addForms(withoutAnchor);
  addForms(strippedRelative);
  for (const prefix of ['references/', 'tools/examples/', 'tools/', 'core/', 'scripts/', 'examples/']) {
    if (strippedRelative.toLowerCase().startsWith(prefix)) {
      addForms(strippedRelative.slice(prefix.length));
    }
  }
  return { raw, strippedRelative, prefersCore, candidates: list };
}

function resolveBundledRelativeFile(strippedRelative, searchBases) {
  if (!strippedRelative || !strippedRelative.includes('/')) return null;
  const rel = strippedRelative.replace(/^\/+/, '');
  for (const base of searchBases) {
    const resolvedBase = resolve(base);
    const candidate = resolve(resolvedBase, rel);
    if (!candidate.startsWith(`${resolvedBase}/`) && !candidate.startsWith(`${resolvedBase}\\`)) continue;
    for (const full of [candidate, `${candidate}.md`, `${candidate}.py`]) {
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
      } catch { /* ignore */ }
    }
  }
  return null;
}

function readTarget(requested, reference, all) {
  const coreRefs = discoverCoreReferences();
  const forgeRefs = all.platform_references.forge;
  if (!reference) {
    return requested
      ? {
        id: 'skill',
        scope: Object.hasOwn(PLATFORMS, requested) ? 'platform' : 'protocol',
        ...(Object.hasOwn(PLATFORMS, requested) ? { platform: 'forge' } : { protocol: requested }),
        path: protocolSkill(requested),
      }
      : { id: 'shared', scope: 'shared', path: all.shared };
  }
  const { strippedRelative, prefersCore, candidates } = buildReferenceCandidates(reference);
  if (candidates.includes('shared')) return { id: 'shared', scope: 'shared', path: all.shared };
  if (prefersCore) {
    for (const key of candidates) {
      if (Object.hasOwn(coreRefs, key)) {
        return { id: key, scope: 'core', path: coreRefs[key] };
      }
    }
  }
  if (Object.hasOwn(PLATFORMS, requested)) {
    for (const key of candidates) {
      if (Object.hasOwn(forgeRefs, key)) {
        return { id: key, scope: 'platform', platform: 'forge', path: forgeRefs[key] };
      }
    }
    const directForgeFile = resolveBundledRelativeFile(strippedRelative, [FORGE_ROOT, join(FORGE_ROOT, 'tools')]);
    if (directForgeFile) {
      const matchedId = Object.entries(forgeRefs).find(([, p]) => p === directForgeFile)?.[0]
        ?? basename(directForgeFile).replace(/\.(?:md|py)$/i, '');
      return { id: matchedId, scope: 'platform', platform: 'forge', path: directForgeFile };
    }
  }
  if (requested && Object.hasOwn(PROTOCOLS, requested)) {
    for (const key of candidates) {
      if (/^[A-Za-z0-9_-]+$/.test(key)) {
        const subDocPath = join(ROOT, 'skills', PROTOCOLS[requested], `${key}.md`);
        if (fs.existsSync(subDocPath)) {
          return {
            id: key,
            scope: 'protocol',
            protocol: requested,
            path: subDocPath,
          };
        }
      }
    }
  }
  if (candidates.includes('outputs')) {
    if (!requested) {
      throw usageError('Reference "outputs" requires a protocol or platform, for example: ariax skills boltzgen --doc outputs');
    }
    return {
      id: 'outputs',
      scope: 'protocol',
      protocol: requested,
      path: join(ROOT, 'skills', PROTOCOLS[requested], 'outputs.md'),
    };
  }
  for (const key of candidates) {
    if (Object.hasOwn(coreRefs, key)) {
      return { id: key, scope: 'core', path: coreRefs[key] };
    }
  }
  // If a bare relative filename like ./esmc-capacity.md uniquely matches a single Forge reference file, resolve it.
  if (Object.hasOwn(PLATFORMS, requested) && !strippedRelative.includes('/')) {
    const stem = strippedRelative.replace(/\.(?:md|py)$/i, '').toLowerCase();
    const byBasename = new Map();
    for (const [id, filePath] of Object.entries(forgeRefs)) {
      const fileStem = basename(filePath).replace(/\.(?:md|py)$/i, '').toLowerCase();
      if (fileStem === stem && !byBasename.has(filePath)) {
        byBasename.set(filePath, id);
      }
    }
    if (byBasename.size === 1) {
      const [[filePath, id]] = [...byBasename.entries()];
      return { id, scope: 'platform', platform: 'forge', path: filePath };
    }
  }
  const availableNames = Object.keys({
    ...all.references,
    ...(Object.hasOwn(PLATFORMS, requested) ? forgeRefs : { outputs: null }),
  });
  const suggestions = closestMatches(reference, availableNames, 5);
  const suggestionText = suggestions.length ? ` Closest matches: ${suggestions.join(', ')}.` : '';
  throw usageError(
    `Unknown skills reference "${reference}".${suggestionText} Run ariax skills --list (or ariax skills forge --json) to browse all references.`,
  );
}

function readGuide(target) {
  const bytes = fs.readFileSync(target.path);
  if (bytes.length > MAX_READ_BYTES) {
    throw usageError(`Bundled guide exceeds the ${MAX_READ_BYTES}-byte read limit.`);
  }
  return { ...target, size_bytes: bytes.length, content: bytes.toString('utf8') };
}

function compactRootIndex(all) {
  const coreRefs = discoverCoreReferences();
  const forgeRefs = all.platform_references.forge;
  const uniqueForgeGuides = new Set(
    Object.values(forgeRefs).filter((p) => dirname(p) === join(FORGE_ROOT, 'tools')),
  );
  return {
    shared: {
      id: 'shared',
      description: extractDescription(all.shared),
      read_command: 'ariax skills --read',
    },
    protocols: CANONICAL_PROTOCOLS.map(([id, skillDir]) => ({
      id,
      skill: skillDir,
      description: extractDescription(all.protocols[id]),
      read_command: `ariax skills ${id} --read`,
    })),
    platforms: [
      {
        id: 'forge',
        skill: 'ariax-forge',
        description: extractDescription(all.platforms.forge),
        guide_count: uniqueForgeGuides.size,
        read_command: 'ariax skills forge --read',
      },
    ],
    core_references: Object.entries(coreRefs).map(([id, filePath]) => ({
      id,
      description: extractDescription(filePath),
    })),
    hint: 'Read a Forge tool guide in one call: ariax skills forge --tool <id> --read. Pass --paths for raw filesystem paths.',
  };
}

function compactForgeIndex(all) {
  const forgeRefs = all.platform_references.forge;
  const byFile = new Map();
  for (const [id, filePath] of Object.entries(forgeRefs)) {
    if (!byFile.has(filePath)) byFile.set(filePath, []);
    byFile.get(filePath).push(id);
  }
  const guides = [];
  const platformReferences = [];
  const subrefsByTool = new Map();
  const toolsDir = join(FORGE_ROOT, 'tools');
  const refsDir = join(FORGE_ROOT, 'references');

  for (const [filePath, ids] of byFile.entries()) {
    const dir = dirname(filePath);
    if (dir === toolsDir) {
      const canonical = basename(filePath, '.md');
      const aliases = ids.filter((id) => id !== canonical);
      guides.push({
        id: canonical,
        ...(aliases.length ? { aliases } : {}),
        description: truncateOneLine(extractDescription(filePath), 90),
      });
    } else if (filePath === join(FORGE_ROOT, 'outputs.md') || dir === refsDir) {
      const canonical = ids[0];
      const aliases = ids.filter((id) => id !== canonical);
      platformReferences.push({
        id: canonical,
        ...(aliases.length ? { aliases } : {}),
        description: truncateOneLine(extractDescription(filePath), 90),
      });
    } else {
      const rel = relative(toolsDir, filePath).split(/[\\/]/);
      const owner = rel[0] === 'examples' ? rel[1] : rel[0];
      if (owner) {
        if (!subrefsByTool.has(owner)) subrefsByTool.set(owner, []);
        subrefsByTool.get(owner).push(ids[0]);
      }
    }
  }
  for (const g of guides) {
    const subs = subrefsByTool.get(g.id);
    if (subs?.length) g.references = subs.sort();
  }
  guides.sort((a, b) => a.id.localeCompare(b.id));
  platformReferences.sort((a, b) => a.id.localeCompare(b.id));
  return {
    platform: 'forge',
    skill: 'ariax-forge',
    description: truncateOneLine(extractDescription(all.platforms.forge), 100),
    guides,
    references: platformReferences,
    hint: 'Read one guide in a single call: ariax skills forge --tool <id> --read. Pass --paths for raw filesystem paths.',
  };
}

const INSTALL_TARGETS = ['claude', 'codex', 'cursor', 'antigravity'];

function targetDestination(target, scope, { home, cwd }) {
  const resolvedScope = scope || (target === 'cursor' ? 'project' : 'user');
  if (target === 'claude') {
    return {
      target,
      scope: resolvedScope,
      path: resolvedScope === 'project'
        ? join(cwd, '.claude', 'skills', 'ariax', 'SKILL.md')
        : join(home, '.claude', 'skills', 'ariax', 'SKILL.md'),
    };
  }
  if (target === 'codex') {
    return {
      target,
      scope: resolvedScope,
      path: resolvedScope === 'project'
        ? join(cwd, '.codex', 'skills', 'ariax', 'SKILL.md')
        : join(home, '.codex', 'skills', 'ariax', 'SKILL.md'),
    };
  }
  if (target === 'antigravity') {
    return {
      target,
      scope: resolvedScope,
      path: resolvedScope === 'project'
        ? join(cwd, '.agent', 'skills', 'ariax', 'SKILL.md')
        : join(home, '.gemini', 'config', 'skills', 'ariax', 'SKILL.md'),
    };
  }
  if (target === 'cursor') {
    return {
      target,
      scope: resolvedScope,
      path: resolvedScope === 'project'
        ? join(cwd, '.cursor', 'rules', 'ariax.mdc')
        : join(home, '.cursor', 'rules', 'ariax.mdc'),
    };
  }
  throw usageError(`skills: unknown target "${target}". Use claude, codex, cursor, antigravity, or all.`);
}

function renderInstallContent(target, version) {
  const raw = fs.readFileSync(join(ROOT, 'SKILL.md'), 'utf8');
  const { frontmatter, body } = parseFrontmatterAndBody(raw);
  const cleanBody = body.trimStart();
  const hash = createHash('sha256').update(cleanBody).digest('hex').slice(0, 12);
  const marker = `<!-- managed-by: ariax-cli version=${version} sha256=${hash} -->`;
  const description = frontmatter.description
    || 'Ariax Bio CLI and Forge guidance for protein design, structure prediction, and biomolecular workflows.';
  if (target === 'cursor') {
    return `---\ndescription: ${description}\nalwaysApply: false\n---\n${marker}\n\n${cleanBody}`;
  }
  const name = frontmatter.name || 'ariax';
  return `---\nname: ${name}\ndescription: ${description}\n---\n${marker}\n\n${cleanBody}`;
}

function inspectInstalledFile(filePath, expectedContent) {
  if (!fs.existsSync(filePath)) {
    return { status: 'missing', managed: false, installed_version: null };
  }
  let existing;
  try {
    existing = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { status: 'unreadable', managed: false, installed_version: null };
  }
  const match = MANAGED_MARKER_RE.exec(existing);
  if (!match) {
    return { status: 'unmanaged', managed: false, installed_version: null };
  }
  const installedVersion = match[1];
  const upToDate = existing === expectedContent;
  return {
    status: upToDate ? 'installed' : 'outdated',
    managed: true,
    installed_version: installedVersion,
  };
}

function resolveTargets(rawTarget) {
  if (rawTarget === undefined || rawTarget === 'all') return [...INSTALL_TARGETS];
  const t = String(rawTarget).trim().toLowerCase();
  if (t === 'all') return [...INSTALL_TARGETS];
  if (!INSTALL_TARGETS.includes(t)) {
    throw usageError(`skills: unknown --target "${rawTarget}". Use claude, codex, cursor, antigravity, or all.`);
  }
  return [t];
}

function resolveScope(rawScope) {
  if (rawScope === undefined) return undefined;
  const s = String(rawScope).trim().toLowerCase();
  if (!['user', 'project'].includes(s)) {
    throw usageError(`skills: --scope must be user or project (got "${rawScope}").`);
  }
  return s;
}

function inspectCoreBundle(destPath, coreRefs) {
  const coreDir = join(dirname(destPath), 'core');
  const entries = Object.entries(coreRefs);
  let synced = 0;
  for (const [id, srcPath] of entries) {
    const destFile = join(coreDir, `${id}.md`);
    try {
      const expected = fs.readFileSync(srcPath, 'utf8');
      const existing = fs.readFileSync(destFile, 'utf8');
      if (existing === expected) synced += 1;
    } catch {
      // Missing or unreadable file counts as unsynced.
    }
  }
  return {
    coreDir,
    total: entries.length,
    synced,
    allSynced: synced === entries.length,
  };
}

function writeCoreBundle(destPath, coreRefs) {
  const coreDir = join(dirname(destPath), 'core');
  fs.mkdirSync(coreDir, { recursive: true });
  let count = 0;
  for (const [id, srcPath] of Object.entries(coreRefs)) {
    const destFile = join(coreDir, `${id}.md`);
    fs.writeFileSync(destFile, fs.readFileSync(srcPath, 'utf8'), 'utf8');
    count += 1;
  }
  return { coreDir, count };
}

function runSkillsInstall(ctx) {
  const version = ctx.currentVersion || buildInfo().version;
  const targets = resolveTargets(ctx.flags.target);
  const scope = resolveScope(ctx.flags.scope);
  const dryRun = ctx.flags['dry-run'] === true;
  const yes = ctx.flags.yes === true;
  const home = ctx.env?.HOME || os.homedir();
  const cwd = process.cwd();
  const coreRefs = discoverCoreReferences();

  const results = [];
  for (const target of targets) {
    const dest = targetDestination(target, scope, { home, cwd });
    const content = renderInstallContent(target, version);
    const current = inspectInstalledFile(dest.path, content);
    const supportsCoreDir = dest.target !== 'cursor';
    const coreInfo = supportsCoreDir ? inspectCoreBundle(dest.path, coreRefs) : null;
    let action;
    let written = false;
    let coreFilesWritten = 0;

    if (current.status === 'missing') {
      action = 'create';
    } else if (current.status === 'installed') {
      action = supportsCoreDir && !coreInfo.allSynced ? 'update' : 'unchanged';
    } else if (current.status === 'outdated') {
      action = 'update';
    } else if (current.status === 'unmanaged') {
      action = yes ? 'overwrite' : 'skipped_unmanaged';
    } else {
      action = 'skipped_unreadable';
    }

    if (!dryRun && ['create', 'update', 'overwrite'].includes(action)) {
      fs.mkdirSync(dirname(dest.path), { recursive: true });
      fs.writeFileSync(dest.path, content, 'utf8');
      written = true;
      if (supportsCoreDir) {
        coreFilesWritten = writeCoreBundle(dest.path, coreRefs).count;
      }
    }

    results.push({
      target: dest.target,
      scope: dest.scope,
      path: dest.path,
      previous_status: current.status,
      action: dryRun && ['create', 'update', 'overwrite'].includes(action) ? `would_${action}` : action,
      written,
      size_bytes: Buffer.byteLength(content),
      ...(supportsCoreDir ? {
        core_dir: coreInfo.coreDir,
        core_files: coreInfo.total,
        core_files_written: coreFilesWritten,
      } : {}),
      ...(action === 'skipped_unmanaged' ? { note: 'Existing file is not managed by ariax-cli; pass --yes to overwrite.' } : {}),
    });
  }

  const payload = {
    data: {
      cli_version: version,
      dry_run: dryRun,
      targets: results,
    },
  };
  if (ctx.json) {
    printJson(payload);
    return payload;
  }
  printTable(
    ['target', 'scope', 'action', 'path'],
    results.map((r) => [r.target, r.scope, r.action, r.path]),
  );
  if (results.some((r) => r.action === 'skipped_unmanaged')) {
    printProgress('Some existing non-Ariax files were skipped; pass --yes to overwrite them.');
  }
  return payload;
}

function runSkillsStatus(ctx) {
  const version = ctx.currentVersion || buildInfo().version;
  const targets = resolveTargets(ctx.flags.target);
  const scope = resolveScope(ctx.flags.scope);
  const home = ctx.env?.HOME || os.homedir();
  const cwd = process.cwd();
  const coreRefs = discoverCoreReferences();

  const entries = targets.map((target) => {
    const dest = targetDestination(target, scope, { home, cwd });
    const expected = renderInstallContent(target, version);
    const info = inspectInstalledFile(dest.path, expected);
    const supportsCoreDir = dest.target !== 'cursor';
    const coreInfo = supportsCoreDir ? inspectCoreBundle(dest.path, coreRefs) : null;
    const status = info.status === 'installed' && supportsCoreDir && !coreInfo.allSynced
      ? 'outdated'
      : info.status;
    return {
      target: dest.target,
      scope: dest.scope,
      path: dest.path,
      status,
      managed: info.managed,
      installed_version: info.installed_version,
      current_version: version,
      ...(supportsCoreDir ? {
        core_dir: coreInfo.coreDir,
        core_files_synced: coreInfo.allSynced,
        core_files: coreInfo.total,
      } : {}),
    };
  });

  const payload = { data: { cli_version: version, targets: entries } };
  if (ctx.json) {
    printJson(payload);
    return payload;
  }
  printTable(
    ['target', 'scope', 'status', 'installed_version', 'path'],
    entries.map((e) => [e.target, e.scope, e.status, e.installed_version ?? '-', e.path]),
  );
  return payload;
}

/** @param {{ positionals: string[], flags: Record<string, unknown>, json: boolean, currentVersion?: string, env?: NodeJS.ProcessEnv }} ctx */
export async function run(ctx) {
  const requested = ctx.positionals[0];

  if (requested === 'install') {
    for (const key of Object.keys(ctx.flags)) {
      if (!['target', 'scope', 'dry-run', 'yes'].includes(key)) {
        throw usageError(`skills install: unsupported flag --${key}.`);
      }
    }
    return runSkillsInstall(ctx);
  }
  if (requested === 'status') {
    for (const key of Object.keys(ctx.flags)) {
      if (!['target', 'scope'].includes(key)) {
        throw usageError(`skills status: unsupported flag --${key}.`);
      }
    }
    return runSkillsStatus(ctx);
  }
  for (const key of Object.keys(ctx.flags)) {
    if (!['read', 'reference', 'doc', 'tool', 'paths', 'details', 'list'].includes(key)) {
      throw usageError(`skills: unsupported flag --${key}.`);
    }
  }

  const all = paths();
  const forgeRefs = all.platform_references.forge;
  const forgeExamples = all.platform_examples.forge;
  const includePaths = ctx.flags.paths === true || ctx.flags.details === true;

  if (requested) {
    protocolSkill(requested);
  }
  if (ctx.flags.doc !== undefined && ctx.flags.reference !== undefined) {
    throw usageError('skills: use either --doc NAME or --reference NAME, not both.');
  }
  const docOrRef = ctx.flags.doc !== undefined ? ctx.flags.doc : ctx.flags.reference;
  const shouldRead = ctx.flags.read === true || docOrRef !== undefined;
  const explicitJson = ctx.config ? ctx.config.jsonForced === true : ctx.json === true;
  if (ctx.flags.list === true && (shouldRead || ctx.flags.tool !== undefined)) {
    throw usageError('skills: --list cannot be combined with --read, --reference, --doc, or --tool.');
  }
  if (ctx.flags.tool !== undefined) {
    if (!Object.hasOwn(PLATFORMS, requested)) throw usageError('skills: --tool requires the forge platform.');
    if (docOrRef !== undefined) {
      throw usageError('skills forge: use either --tool ID [--read] or --reference/--doc ID, not both.');
    }
    if (ctx.flags.read) {
      const data = readForgeToolGuide(ctx.flags.tool);
      if (explicitJson) printJson({ data });
      else printData(data.content);
      return data;
    }
    const data = forgeToolPaths(ctx.flags.tool, forgeRefs, forgeExamples);
    if (ctx.json) printJson({ data });
    else {
      printData(`Forge guide: ${data.tool}`);
      for (const [id, filePath] of Object.entries(data.references)) printData(`Reference ${id}: ${filePath}`);
      for (const [id, filePath] of Object.entries(data.examples)) printData(`Examples ${id}: ${filePath}`);
    }
    return data;
  }
  if (shouldRead) {
    const data = readGuide(readTarget(requested, docOrRef, all));
    if (explicitJson) printJson({ data });
    else printData(data.content);
    return data;
  }

  if (requested) {
    const skillPath = protocolSkill(requested);
    if (Object.hasOwn(PLATFORMS, requested)) {
      if (ctx.json) {
        if (includePaths) {
          printJson({
            data: {
              platform: 'forge',
              shared: all.shared,
              skill: skillPath,
              references: { ...all.references, ...forgeRefs },
              examples: forgeExamples,
            },
          });
        } else {
          printJson({ data: compactForgeIndex(all) });
        }
      } else {
        printData(skillPath);
      }
      return;
    }
    const references = { ...all.references, outputs: join(skillPath, '..', 'outputs.md') };
    if (ctx.json) {
      if (includePaths) {
        printJson({ data: { protocol: requested, shared: all.shared, skill: skillPath, references } });
      } else {
        printJson({
          data: {
            protocol: requested,
            skill: PROTOCOLS[requested],
            description: extractDescription(skillPath),
            references: Object.entries(references).map(([id, filePath]) => ({
              id,
              description: extractDescription(filePath),
            })),
            read_command: `ariax skills ${requested} --read`,
          },
        });
      }
    } else {
      printData(skillPath);
    }
    return;
  }

  if (ctx.json) {
    printJson({ data: includePaths ? all : compactRootIndex(all) });
    return;
  }
  printData(`Shared: ${all.shared}`);
  for (const [protocol, filePath] of Object.entries(all.protocols)) {
    printData(`${protocol}: ${filePath}`);
  }
  for (const [platform, filePath] of Object.entries(all.platforms)) printData(`${platform}: ${filePath}`);
  printData(`Examples: ${all.examples}`);
  printData(`Readable references: ${Object.keys(all.references).join(', ')}`);
  printData('Protocol reference: outputs');
  printData(`Forge references: ${Object.keys(forgeRefs).join(', ')}`);
  if (forgeExamples.root) printData(`Forge examples: ${forgeExamples.root}`);
}
