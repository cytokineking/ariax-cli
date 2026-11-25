/**
 * Deterministic CI drift, context-budget, link/anchor, resolution, syntax, and
 * internal-leak gate for Ariax CLI's agent surface.
 *
 * Exits 0 on pass; exits 1 listing every violation found.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN_PATH = path.join(REPO_ROOT, 'bin', 'ariax.js');

const BUDGETS = Object.freeze({
  agentSkillsTotalBytes: 1_500_000,
  rootSkillMaxLines: 35,
  rootSkillMaxBytes: 3_500,
  forgeSkillMaxLines: 110,
  forgeSkillMaxBytes: 8_500,
  forgeToolGuideMaxBytes: 20_000,
  skillsJsonMaxBytes: 6_000,
  discoverJsonMaxBytes: 6_000,
});

const LEAK_PATTERNS = Object.freeze([
  { name: 'workstation storage policy', re: /workstation storage policy/i },
  { name: 'authorized remote host', re: /authorized remote host/i },
  { name: 'internal-development', re: /internal-development/i },
  { name: '/workspace/bNN', re: /\/workspace\/b[0-9]{2}\b/i },
  { name: 'coordinator review', re: /coordinator review/i },
]);

const STALE_TIMEOUT_RE = /forge (?:sync|watch|tools wait)[^\n]* --timeout\b/;
const FORGE_CLOSE_RE = /\bariax forge close\b/;
const ALLOWED_CLOSE_RE = /--force|\bemergency\b/i;

const PACK_GENERATED_FILES = new Set(['build-info.json']);

const CLI_ENV = {
  ...process.env,
  NO_UPDATE_NOTIFIER: '1',
  CI: 'true',
  ARIAX_AUTO_FEEDBACK: 'off',
};

const violations = [];
const metrics = {};

function fail(category, detail) {
  violations.push(`[${category}] ${detail}`);
}

function toPosix(relPath) {
  return relPath.split(path.sep).join('/');
}

function walkFiles(dirAbs, baseAbs = REPO_ROOT) {
  const out = [];
  if (!fs.existsSync(dirAbs)) return out;
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const full = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, baseAbs));
    } else if (entry.isFile()) {
      out.push(toPosix(path.relative(baseAbs, full)));
    }
  }
  return out.sort();
}

function isStrictCodePointSortedUnique(arr) {
  for (let i = 1; i < arr.length; i += 1) {
    if (!(arr[i - 1] < arr[i])) {
      return { ok: false, index: i, prev: arr[i - 1], curr: arr[i] };
    }
  }
  return { ok: true };
}

function stripFrontmatter(md) {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  return m ? m[1] : md;
}

function countNonEmptyOrBodyLines(text) {
  const trimmed = text.replace(/^\r?\n+/, '').replace(/\r?\n+$/, '');
  return trimmed ? trimmed.split(/\r?\n/).length : 0;
}

function slugifyHeading(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[`*_~]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function extractHeadingAnchors(md) {
  const anchors = new Set();
  const counts = new Map();
  let inFence = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const base = slugifyHeading(h[1]);
      if (base) {
        const n = counts.get(base) || 0;
        counts.set(base, n + 1);
        anchors.add(n === 0 ? base : `${base}-${n}`);
      }
    }
  }
  return anchors;
}

function runCli(args) {
  return execFileSync(process.execPath, [BIN_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: CLI_ENV,
    maxBuffer: 16 * 1024 * 1024,
  });
}

// 1. Manifest sync & package size ceiling
function checkManifestsAndSize() {
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  const csfPath = path.join(REPO_ROOT, 'customer-source-files.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const csf = JSON.parse(fs.readFileSync(csfPath, 'utf8'));

  if (!Array.isArray(pkg.files)) {
    fail('manifest', 'package.json "files" must be an array.');
    return;
  }
  if (!Array.isArray(csf)) {
    fail('manifest', 'customer-source-files.json must be an array.');
    return;
  }

  const pkgSort = isStrictCodePointSortedUnique(pkg.files);
  if (!pkgSort.ok) {
    fail('manifest', `package.json files is not strictly sorted/deduplicated at index ${pkgSort.index}: "${pkgSort.prev}" before "${pkgSort.curr}".`);
  }
  const csfSort = isStrictCodePointSortedUnique(csf);
  if (!csfSort.ok) {
    fail('manifest', `customer-source-files.json is not strictly sorted/deduplicated at index ${csfSort.index}: "${csfSort.prev}" before "${csfSort.curr}".`);
  }

  const pkgSet = new Set(pkg.files);
  const csfSet = new Set(csf);

  for (const entry of pkg.files) {
    if (PACK_GENERATED_FILES.has(entry)) continue;
    if (!fs.existsSync(path.join(REPO_ROOT, entry))) {
      fail('manifest', `package.json files entry missing on disk: ${entry}`);
    }
    if (!csfSet.has(entry)) {
      fail('manifest', `package.json files entry missing from customer-source-files.json: ${entry}`);
    }
  }

  for (const entry of csf) {
    if (!fs.existsSync(path.join(REPO_ROOT, entry))) {
      fail('manifest', `customer-source-files.json entry missing on disk: ${entry}`);
    }
    if ((entry.startsWith('src/') || entry.startsWith('agent-skills/')) && !pkgSet.has(entry)) {
      fail('manifest', `customer-source-files.json entry missing from package.json files: ${entry}`);
    }
  }

  for (const dir of ['src', 'agent-skills']) {
    const onDisk = walkFiles(path.join(REPO_ROOT, dir));
    for (const rel of onDisk) {
      if (!pkgSet.has(rel)) {
        fail('manifest', `Unmanifested file under ${dir}/ (missing from package.json files): ${rel}`);
      }
      if (!csfSet.has(rel)) {
        fail('manifest', `Unmanifested file under ${dir}/ (missing from customer-source-files.json): ${rel}`);
      }
    }
  }

  const skillFiles = walkFiles(path.join(REPO_ROOT, 'agent-skills'));
  const totalBytes = skillFiles.reduce((sum, rel) => sum + fs.statSync(path.join(REPO_ROOT, rel)).size, 0);
  metrics.agent_skills_files = skillFiles.length;
  metrics.agent_skills_total_bytes = totalBytes;
  if (totalBytes > BUDGETS.agentSkillsTotalBytes) {
    fail('size-ceiling', `agent-skills/ total size is ${totalBytes} bytes (ceiling ${BUDGETS.agentSkillsTotalBytes}).`);
  }
}

// 2. Context-budget ceilings
function checkContextBudgets() {
  const rootSkillPath = path.join(REPO_ROOT, 'agent-skills', 'SKILL.md');
  const rootSkillRaw = fs.readFileSync(rootSkillPath, 'utf8');
  const rootSkillLines = countNonEmptyOrBodyLines(stripFrontmatter(rootSkillRaw));
  const rootSkillBytes = Buffer.byteLength(rootSkillRaw, 'utf8');
  metrics.root_skill_lines = rootSkillLines;
  metrics.root_skill_bytes = rootSkillBytes;
  if (rootSkillLines > BUDGETS.rootSkillMaxLines) {
    fail('budget', `agent-skills/SKILL.md has ${rootSkillLines} non-frontmatter lines (ceiling ${BUDGETS.rootSkillMaxLines}).`);
  }
  if (rootSkillBytes > BUDGETS.rootSkillMaxBytes) {
    fail('budget', `agent-skills/SKILL.md is ${rootSkillBytes} bytes (ceiling ${BUDGETS.rootSkillMaxBytes}).`);
  }

  const forgeSkillPath = path.join(REPO_ROOT, 'agent-skills', 'skills', 'ariax-forge', 'SKILL.md');
  const forgeSkillRaw = fs.readFileSync(forgeSkillPath, 'utf8');
  const forgeSkillLines = countNonEmptyOrBodyLines(forgeSkillRaw);
  const forgeSkillBytes = Buffer.byteLength(forgeSkillRaw, 'utf8');
  metrics.forge_skill_lines = forgeSkillLines;
  metrics.forge_skill_bytes = forgeSkillBytes;
  if (forgeSkillLines > BUDGETS.forgeSkillMaxLines) {
    fail('budget', `agent-skills/skills/ariax-forge/SKILL.md has ${forgeSkillLines} lines (ceiling ${BUDGETS.forgeSkillMaxLines}).`);
  }
  if (forgeSkillBytes > BUDGETS.forgeSkillMaxBytes) {
    fail('budget', `agent-skills/skills/ariax-forge/SKILL.md is ${forgeSkillBytes} bytes (ceiling ${BUDGETS.forgeSkillMaxBytes}).`);
  }

  const toolsDir = path.join(REPO_ROOT, 'agent-skills', 'skills', 'ariax-forge', 'tools');
  let maxToolBytes = 0;
  let maxToolName = '';
  for (const entry of fs.readdirSync(toolsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const size = fs.statSync(path.join(toolsDir, entry.name)).size;
    if (size > maxToolBytes) {
      maxToolBytes = size;
      maxToolName = entry.name;
    }
    if (size > BUDGETS.forgeToolGuideMaxBytes) {
      fail('budget', `agent-skills/skills/ariax-forge/tools/${entry.name} is ${size} bytes (ceiling ${BUDGETS.forgeToolGuideMaxBytes}).`);
    }
  }
  metrics.max_forge_tool_guide = `${maxToolName} (${maxToolBytes} bytes)`;

  const skillsOut = runCli(['skills', '--json']);
  const skillsBytes = Buffer.byteLength(skillsOut, 'utf8');
  metrics.skills_json_bytes = skillsBytes;
  if (skillsBytes > BUDGETS.skillsJsonMaxBytes) {
    fail('budget', `ariax skills --json stdout is ${skillsBytes} bytes (ceiling ${BUDGETS.skillsJsonMaxBytes}).`);
  }

  const discoverOut = runCli([
    'discover',
    '--json',
    '--base-url', 'http://127.0.0.1:1',
    '--allow-custom-origin',
    '--timeout', '1000',
  ]);
  const discoverBytes = Buffer.byteLength(discoverOut, 'utf8');
  metrics.discover_json_bytes = discoverBytes;
  if (discoverBytes > BUDGETS.discoverJsonMaxBytes) {
    fail('budget', `ariax discover --json (offline fallback) stdout is ${discoverBytes} bytes (ceiling ${BUDGETS.discoverJsonMaxBytes}).`);
  }
}

// 3 & 4. Stale flags / anti-patterns + internal leak prevention
function checkStaleFlagsAndLeaks() {
  const mdFiles = walkFiles(path.join(REPO_ROOT, 'agent-skills')).filter((f) => f.endsWith('.md'));
  const srcFiles = walkFiles(path.join(REPO_ROOT, 'src')).filter((f) => f.endsWith('.js'));

  for (const rel of mdFiles) {
    const content = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (STALE_TIMEOUT_RE.test(line)) {
        fail('stale-flag', `${rel}:${i + 1}: uses deprecated --timeout on forge sync/watch/tools wait -> ${line.trim()}`);
      }
      if (FORGE_CLOSE_RE.test(line) && !ALLOWED_CLOSE_RE.test(line)) {
        fail('anti-pattern', `${rel}:${i + 1}: happy-path \`ariax forge close\` without --force/emergency -> ${line.trim()}`);
      }
      for (const pattern of LEAK_PATTERNS) {
        if (pattern.re.test(line)) {
          fail('leak', `${rel}:${i + 1}: matches blocked internal pattern "${pattern.name}" -> ${line.trim()}`);
        }
      }
    }
  }

  for (const rel of srcFiles) {
    const content = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const pattern of LEAK_PATTERNS) {
        if (pattern.re.test(line)) {
          fail('leak', `${rel}:${i + 1}: matches blocked internal pattern "${pattern.name}" -> ${line.trim()}`);
        }
      }
    }
  }
}

// 5. Zero broken relative markdown file links AND heading anchors across agent-skills/**/*.md
function checkMarkdownLinksAndAnchors() {
  const mdFiles = walkFiles(path.join(REPO_ROOT, 'agent-skills')).filter((f) => f.endsWith('.md'));
  const anchorCache = new Map();
  const getAnchors = (absPath) => {
    if (!anchorCache.has(absPath)) {
      anchorCache.set(absPath, extractHeadingAnchors(fs.readFileSync(absPath, 'utf8')));
    }
    return anchorCache.get(absPath);
  };

  let linkCount = 0;
  for (const rel of mdFiles) {
    const absFile = path.join(REPO_ROOT, rel);
    const lines = fs.readFileSync(absFile, 'utf8').split(/\r?\n/);
    let inFence = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const stripped = line.replace(/`[^`]*`/g, '');
      for (const match of stripped.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = match[1];
        if (/^(?:https?|mailto|tel|data):/i.test(target)) continue;
        linkCount += 1;
        const [filePart, hashPart] = target.split('#');
        const resolved = filePart ? path.resolve(path.dirname(absFile), filePart) : absFile;
        if (!fs.existsSync(resolved)) {
          fail('broken-link', `${rel}:${i + 1}: target does not exist -> ${target}`);
          continue;
        }
        if (hashPart) {
          const stat = fs.statSync(resolved);
          if (!stat.isFile() || !resolved.endsWith('.md')) {
            fail('broken-anchor', `${rel}:${i + 1}: anchor on non-markdown target -> ${target}`);
            continue;
          }
          const anchors = getAnchors(resolved);
          if (!anchors.has(hashPart.toLowerCase())) {
            fail('broken-anchor', `${rel}:${i + 1}: heading anchor "#${hashPart}" not found in ${toPosix(path.relative(REPO_ROOT, resolved))}`);
          }
        }
      }
    }
  }
  metrics.markdown_files_scanned = mdFiles.length;
  metrics.relative_links_verified = linkCount;
}

// 6. Tool-guide & core reference resolution
function checkGuideAndCoreResolution() {
  const matrixPath = path.join(REPO_ROOT, 'agent-skills', 'skills', 'ariax-forge', 'tools', 'capabilities', 'matrix.md');
  const matrix = fs.readFileSync(matrixPath, 'utf8');
  const tools = new Set();
  for (const line of matrix.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cols = line.split('|').map((s) => s.trim());
    if (cols.length < 4 || cols[1] === 'Task' || cols[1] === 'Status' || cols[1].startsWith('---')) continue;
    for (const match of cols[2].matchAll(/`([a-z0-9][a-z0-9._-]*)`/g)) {
      tools.add(match[1]);
    }
  }

  let resolvedTools = 0;
  for (const tool of [...tools].sort()) {
    try {
      const out = runCli(['skills', 'forge', '--tool', tool, '--read', '--json']);
      const parsed = JSON.parse(out);
      if (!parsed?.data?.content || !parsed?.data?.path) {
        fail('guide-resolution', `skills forge --tool ${tool} --read --json returned empty content or path.`);
      } else {
        resolvedTools += 1;
      }
    } catch (err) {
      fail('guide-resolution', `skills forge --tool ${tool} --read --json failed: ${err.message}`);
    }
  }
  metrics.matrix_tools_resolved = `${resolvedTools}/${tools.size}`;

  const coreDir = path.join(REPO_ROOT, 'agent-skills', 'core');
  const coreFiles = fs.readdirSync(coreDir).filter((f) => f.endsWith('.md')).sort();
  let resolvedCore = 0;
  for (const file of coreFiles) {
    const refName = file.slice(0, -3);
    try {
      const out = runCli(['skills', '--reference', refName, '--read', '--json']);
      const parsed = JSON.parse(out);
      const expected = path.join(coreDir, file);
      if (parsed?.data?.path !== expected || !parsed?.data?.content) {
        fail('core-resolution', `skills --reference ${refName} --read --json resolved to "${parsed?.data?.path}" (expected "${expected}").`);
      } else {
        resolvedCore += 1;
      }
    } catch (err) {
      fail('core-resolution', `skills --reference ${refName} --read --json failed: ${err.message}`);
    }
  }
  metrics.core_refs_resolved = `${resolvedCore}/${coreFiles.length}`;

  // Dual recovery disambiguation
  try {
    const forgeRecovery = JSON.parse(runCli(['skills', 'forge', '--reference', 'recovery', '--read', '--json']));
    const expectedForge = path.join(REPO_ROOT, 'agent-skills', 'skills', 'ariax-forge', 'references', 'recovery.md');
    if (forgeRecovery?.data?.path !== expectedForge) {
      fail('recovery-disambiguation', `skills forge --reference recovery resolved to "${forgeRecovery?.data?.path}", expected "${expectedForge}".`);
    }
  } catch (err) {
    fail('recovery-disambiguation', `skills forge --reference recovery failed: ${err.message}`);
  }
  try {
    const coreRecovery = JSON.parse(runCli(['skills', '--reference', 'recovery', '--read', '--json']));
    const expectedCore = path.join(REPO_ROOT, 'agent-skills', 'core', 'recovery.md');
    if (coreRecovery?.data?.path !== expectedCore) {
      fail('recovery-disambiguation', `skills --reference recovery resolved to "${coreRecovery?.data?.path}", expected "${expectedCore}".`);
    }
  } catch (err) {
    fail('recovery-disambiguation', `skills --reference recovery failed: ${err.message}`);
  }
}

// 7. Syntax check (`node --check`) across all .js files in bin/, src/, scripts/, test/
function checkJsSyntax() {
  const jsFiles = ['bin', 'src', 'scripts', 'test']
    .flatMap((dir) => walkFiles(path.join(REPO_ROOT, dir)))
    .filter((f) => f.endsWith('.js'));
  let okCount = 0;
  for (const rel of jsFiles) {
    try {
      execFileSync(process.execPath, ['--check', path.join(REPO_ROOT, rel)], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      });
      okCount += 1;
    } catch (err) {
      const stderr = err.stderr ? String(err.stderr).trim() : err.message;
      fail('syntax', `node --check ${rel} failed: ${stderr}`);
    }
  }
  metrics.js_files_checked = `${okCount}/${jsFiles.length}`;
}

checkManifestsAndSize();
checkContextBudgets();
checkStaleFlagsAndLeaks();
checkMarkdownLinksAndAnchors();
checkGuideAndCoreResolution();
checkJsSyntax();

console.log('Agent surface gate metrics:');
for (const [k, v] of Object.entries(metrics)) {
  console.log(`  ${k}: ${v}`);
}

if (violations.length > 0) {
  console.error(`\nFAILED with ${violations.length} violation(s):`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log('\nPASS: all agent surface, budget, leak, link/anchor, resolution, and syntax checks succeeded.');
