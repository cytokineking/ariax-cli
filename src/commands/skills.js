/** `ariax skills [protocol]` — locate or read agent guides bundled with this CLI. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
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
});
const FORGE_EXAMPLES = Object.freeze({
  root: join(FORGE_ROOT, 'tools', 'examples'),
  base: join(FORGE_ROOT, 'tools', 'examples', 'base'),
  ipsae: join(FORGE_ROOT, 'tools', 'examples', 'ipsae'),
  boltz2: join(FORGE_ROOT, 'tools', 'examples', 'boltz2'),
});
const CORE_REFERENCES = Object.freeze({
  campaigns: join(ROOT, 'core', 'campaigns.md'),
  candidates: join(ROOT, 'core', 'candidates.md'),
  'engine-choice': join(ROOT, 'core', 'engine-choice.md'),
  examples: join(ROOT, 'core', 'examples.md'),
  feedback: join(ROOT, 'core', 'feedback.md'),
  interpretation: join(ROOT, 'core', 'interpretation.md'),
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
