/** Catch an installed guide losing discovery or a linked file during packaging. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function exerciseAcceptedForgeDiscovery(discovery) {
  const references = [
    'capabilities', 'capabilities-matrix', 'catalog', 'genie3', 'mpnn', 'proteinmpnn', 'solublempnn', 'ligandmpnn', 'abmpnn',
    'mpnn-fixtures', 'af2', 'af2-msa', 'af2-fixtures', 'structure-tools',
    'foldseek', 'structure-tools-definitions', 'structure-tools-fixtures',
    'boltz2', 'boltz2-modes', 'boltz2-fixtures',
    'biohub-esm', 'biohub-esmfold2', 'biohub-esmfold2-fast',
    'esmc-300m', 'esmc-600m', 'esmc-6b', 'biohub-esm-fixtures',
    'absolute-stability', 'absolute-stability-esm3', 'absolute-stability-saprot',
    'absolute-stability-assets', 'absolute-stability-fixtures',
    'protenix-models', 'protenix-v2', 'protenix-models-fixtures',
    'interface-scores', 'interface-scores-adapters', 'interface-scores-fixtures',
    'opendde', 'fampnn', 'fampnn-fixtures',
    'rfantibody', 'rfantibody-fixtures',
    'custom-code', 'foundry', 'rfd3', 'rfd3na', 'rf3', 'foundry-outputs', 'foundry-fixtures',
    'rfd4', 'rfdiffusion4', 'rfd4-antibody', 'rfd4-inputs', 'rfd4-modes', 'rfd4-outputs', 'rfd4-recipes', 'rfd4-search', 'rfd4-fixtures',
    'mol1', 'mol-1', 'mol1-inputs', 'mol1-outputs', 'mol1-fixtures', 'mol1-notice',
    'jms-legacy', 'jms-legacy-fixtures', 'jms-components', 'jms-esm2',
    'jms-mpnn', 'jms-esmfold', 'jms-aggregate', 'jms-components-semantics', 'jms-components-fixtures',
    'openfold3', 'openbind-0', 'openfold3-preview2',
    'boltzgen', 'boltzgen-fixtures', 'proteina-complexa', 'proteina-complexa-fixtures',
    'esmfold2-pipeline', 'esmfold2-pipeline-native',
    'opendde-harness', 'opendde-harness-fixtures',
    'protein-hunter', 'protein-hunter-fixtures',
    'recovery', 'adaptyv', 'adaptyv-ordering',
    'freebindcraft-preflight', 'boltz2-affinity-check',
  ];
  const visitedTrees = new Set();
  // Every packaged guide must resolve all relative markdown links cleanly.
  for (const reference of new Set([...references, ...Object.keys(discovery.references)])) {
    const filename = discovery.references[reference];
    assert.equal(typeof filename, 'string', `${reference} must be discoverable`);
    const content = await readFile(filename, 'utf8');
    assert.ok(content.length > 0, `${reference} must be nonempty`);
    for (const [, target] of content.matchAll(/\]\(([^\s)]+)\)/g)) {
      if (/^[a-z]+:|^#/i.test(target)) continue;
      const linked = resolve(dirname(filename), target.split('#')[0]);
      const info = await stat(linked);
      if (info.isDirectory()) await readTree(linked);
      else {
        assert.ok(info.isFile(), `${reference} links a regular file ${target}`);
        assert.ok((await readFile(linked)).length > 0, `${reference} links ${target}`);
      }
    }
  }

  async function readTree(directory) {
    if (visitedTrees.has(directory)) return;
    visitedTrees.add(directory);
    const entries = await readdir(directory, { withFileTypes: true });
    assert.ok(entries.length > 0, `${directory} must not be empty`);
    for (const entry of entries) {
      const filename = join(directory, entry.name);
      if (entry.isDirectory()) await readTree(filename);
      else {
        assert.ok(entry.isFile(), `${filename} must be a regular packaged file`);
        assert.ok((await readFile(filename)).length > 0, filename);
      }
    }
  }

  for (const [alias, directory] of Object.entries(discovery.examples || {})) {
    assert.equal(typeof directory, 'string', `${alias} examples must be discoverable`);
    await readTree(directory);
  }

  assert.equal(discovery.references.rfdiffusion4, discovery.references.rfd4);
  assert.ok(discovery.references['rfd4-antibody'].endsWith('rfd4-antibody.md'));
  assert.equal(discovery.examples.rfd4, join(discovery.examples.root, 'rfd4'));
  assert.equal(discovery.examples.rfdiffusion4, discovery.examples.rfd4);
  assert.equal(discovery.examples['rfd4-antibody'], discovery.examples.rfd4);
  assert.ok((await readFile(join(discovery.examples.rfd4, 'baseline', 'LICENSE'))).length > 0);

  const packagedCap = discovery.examples.capabilities;
  const fixtureCap = fileURLToPath(new URL('../fixtures/forge-qa/tools/examples/capabilities', import.meta.url));
  const capDir = packagedCap && existsSync(join(packagedCap, 'inspect.mjs')) ? packagedCap : fixtureCap;
  if (existsSync(join(capDir, 'inspect.mjs')) && existsSync(join(capDir, 'catalog.json'))) {
    const observed = JSON.parse(execFileSync(process.execPath,
      [join(capDir, 'inspect.mjs'), join(capDir, 'catalog.json'), 'antibodies'], { encoding: 'utf8' }));
    assert.equal(observed.tools.length, 1);
    assert.deepEqual(observed.tools[0].models, [{ id: 'example-checkpoint', modes: ['sequence-design'] }]);
  }
}
