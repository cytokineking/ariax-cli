/** Catch an installed guide losing discovery or a linked fixture during packaging. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export async function exerciseAcceptedForgeDiscovery(discovery) {
  const references = [
    'capabilities', 'capabilities-matrix', 'catalog',  'genie3', 'mpnn', 'proteinmpnn', 'solublempnn', 'ligandmpnn', 'abmpnn',
    'mpnn-fixtures', 'af2', 'af2-msa', 'af2-fixtures', 'structure-tools',
    'foldseek', 'structure-tools-definitions', 'structure-tools-fixtures',
    'boltz2-modes', 'boltz2-fixtures',
    'biohub-esm', 'biohub-esmfold2', 'biohub-esmfold2-fast',
    'esmc-300m', 'esmc-600m', 'esmc-6b',  'biohub-esm-fixtures',
    'absolute-stability', 'absolute-stability-esm3', 'absolute-stability-saprot',
    'absolute-stability-assets',  'absolute-stability-fixtures',
    'protenix-models',

    'protenix-models-fixtures',
    'interface-scores',
    'interface-scores-adapters',

    'interface-scores-fixtures',
    'opendde',
    'fampnn',  'fampnn-fixtures',
    'rfantibody',

    'rfantibody-fixtures',
    'custom-code', 'foundry', 'rfd3', 'rfd3na',
    'rf3', 'foundry-outputs', 'foundry-fixtures',
    'rfd4', 'rfdiffusion4', 'rfd4-inputs', 'rfd4-modes', 'rfd4-outputs', 'rfd4-fixtures',
    'jms-legacy', 'jms-legacy-fixtures', 'jms-components', 'jms-esm2',
    'jms-mpnn', 'jms-esmfold', 'jms-aggregate', 'jms-components-semantics',
    'jms-components-fixtures', 'openfold3', 'openbind-0', 'openfold3-preview2',
    'boltzgen', 'boltzgen-fixtures',  'proteina-complexa',
    'proteina-complexa-fixtures',
    'esmfold2-pipeline', 'esmfold2-pipeline-native',
    'opendde-harness', 'opendde-harness-fixtures',
    'protein-hunter', 'protein-hunter-fixtures',
  ];
  const visitedTrees = new Set();
  // New contributions must have their linked inputs checked by this same
  // installed-package smoke, without maintaining another guide inventory.
  for (const reference of new Set([...references, ...Object.keys(discovery.references)])) {
    const filename = discovery.references[reference];
    assert.equal(typeof filename, 'string', `${reference} must be discoverable`);
    const content = await readFile(filename, 'utf8');
    assert.ok(content.length > 0);
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
    assert.ok(entries.length > 0, `${directory} must include fixtures`);
    for (const entry of entries) {
      const filename = join(directory, entry.name);
      if (entry.isDirectory()) await readTree(filename);
      else {
        assert.ok(entry.isFile(), `${filename} must be a regular packaged file`);
        assert.ok((await readFile(filename)).length > 0, filename);
      }
    }
  }
  const directories = new Set();
  for (const tool of ['capabilities', 'boltz2', 'mpnn', 'proteinmpnn', 'solublempnn', 'ligandmpnn', 'abmpnn', 'af2', 'structure-tools', 'foldseek',
    'biohub-esm', 'biohub-esmfold2', 'biohub-esmfold2-fast', 'esmc-300m', 'esmc-600m', 'esmc-6b',
    'absolute-stability', 'absolute-stability-esm3', 'absolute-stability-saprot',
    'protenix-models', 'interface-scores', 'opendde', 'fampnn', 'rfantibody',
    'custom-code', 'foundry', 'rfd3', 'rfd3na', 'rf3', 'jms-components', 'jms-esm2', 'jms-mpnn', 'jms-esmfold', 'jms-aggregate', 'openfold3', 'openbind-0', 'openfold3-preview2', 'boltzgen', 'proteina-complexa',
    'esmfold2-pipeline', 'esmfold2-pipeline-native', 'opendde-harness', 'jms-legacy', 'protein-hunter']) {
    assert.equal(typeof discovery.examples[tool], 'string', `${tool} fixtures must be discoverable`);
    directories.add(discovery.examples[tool]);
  }
  for (const [alias, directory] of Object.entries(discovery.examples)) {
    assert.equal(typeof directory, 'string', `${alias} examples must be discoverable`);
    directories.add(directory);
  }
  for (const directory of directories) await readTree(directory);

  // The specs refer to adjacent compressed structures, so merely walking the
  // installed tree cannot detect a companion omitted from the release package.
  assert.equal(discovery.references.rfdiffusion4, discovery.references.rfd4);
  assert.equal(discovery.examples.rfd4, join(discovery.examples.root, 'rfd4'));
  assert.equal(discovery.examples.rfdiffusion4, discovery.examples.rfd4);
  for (const name of ['baseline/monomer.yaml', 'baseline/binder.yaml', 'partial/resolved_seed.yaml']) {
    const directory = dirname(join(discovery.examples.rfd4, name));
    const spec = await readFile(join(discovery.examples.rfd4, name), 'utf8');
    const inputs = [...spec.matchAll(/^[ \t]*input:[ \t]*(\S+)[ \t]*$/gm)];
    assert.equal(inputs.length, 1, `${name} must identify its companion structure`);
    const companion = resolve(directory, inputs[0][1]);
    assert.equal(dirname(companion), directory, `${name} must keep its adjacent input`);
    assert.ok((await readFile(companion)).length > 0, `${name} companion must be packaged`);
  }
  assert.ok((await readFile(join(discovery.examples.rfd4, 'baseline', 'LICENSE'))).length > 0);

  const example = discovery.examples.capabilities;
  const observed = JSON.parse(execFileSync(process.execPath,
    [join(example, 'inspect.mjs'), join(example, 'catalog.json'), 'antibodies'], { encoding: 'utf8' }));
  assert.equal(observed.tools.length, 1);
  assert.deepEqual(observed.tools[0].capabilities.qualification.map(row =>
    [row.native, row.installation, row.restoration]), [['passed', 'held', 'untested']]);
}
