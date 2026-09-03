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
  boltzgen: 'ariax-boltzgen',
  pxdesign: 'ariax-pxdesign',
  'esmfold2-pipeline': 'ariax-esmfold2-pipeline',
});
const CORE_REFERENCES = Object.freeze({
  campaigns: join(ROOT, 'core', 'campaigns.md'),
  candidates: join(ROOT, 'core', 'candidates.md'),
  'engine-choice': join(ROOT, 'core', 'engine-choice.md'),
  examples: join(ROOT, 'core', 'examples.md'),
  interpretation: join(ROOT, 'core', 'interpretation.md'),
  'raw-curl': join(ROOT, 'core', 'raw-curl.md'),
  'recorded-settings': join(ROOT, 'core', 'recorded-settings.md'),
});

function protocolPaths() {
  return {
    'bindcraft-v1.5': join(ROOT, 'skills', 'ariax-bindcraft', 'SKILL.md'),
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
    examples: join(ROOT, 'examples'),
    references: { shared: join(ROOT, 'SKILL.md'), ...CORE_REFERENCES },
    protocol_references: { outputs: outputPaths() },
  };
}

function protocolSkill(requested) {
  if (!Object.prototype.hasOwnProperty.call(PROTOCOLS, requested)) {
    throw usageError(`Unknown protocol "${requested}". Run: ariax protocols`);
  }
  const skillName = PROTOCOLS[requested];
  return join(ROOT, 'skills', skillName, 'SKILL.md');
}

function readTarget(requested, reference, all) {
  if (!reference) {
    return requested
      ? { id: 'skill', scope: 'protocol', protocol: requested, path: protocolSkill(requested) }
      : { id: 'shared', scope: 'shared', path: all.shared };
  }
  if (reference === 'shared') return { id: reference, scope: 'shared', path: all.shared };
  if (Object.prototype.hasOwnProperty.call(CORE_REFERENCES, reference)) {
    return { id: reference, scope: 'core', path: CORE_REFERENCES[reference] };
  }
  if (reference === 'outputs') {
    if (!requested) {
      throw usageError('Reference "outputs" requires a protocol, for example: ariax skills boltzgen --reference outputs --read');
    }
    return {
      id: reference,
      scope: 'protocol',
      protocol: requested,
      path: join(ROOT, 'skills', PROTOCOLS[requested], 'outputs.md'),
    };
  }
  const names = ['shared', ...Object.keys(CORE_REFERENCES), 'outputs'].join(', ');
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
  printData(`Examples: ${all.examples}`);
  printData(`Readable references: ${Object.keys(all.references).join(', ')}`);
  printData('Protocol reference: outputs');
}
