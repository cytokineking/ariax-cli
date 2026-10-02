import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { main } from '../src/main.js';

async function captureOutput(fn) {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = '';
  let stderr = '';
  process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
  process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
  try {
    return { value: await fn(), stdout, stderr };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

describe('bundled skills read-through', () => {
  it('keeps protocol path discovery and advertises finite reference identifiers', async () => {
    const out = await captureOutput(() => main(['skills', 'bindcraft-v1.5', '--json'], {}));
    assert.equal(out.value, 0);
    const data = JSON.parse(out.stdout).data;
    assert.equal(data.protocol, 'bindcraft-v1.5');
    assert.match(data.shared, /agent-skills\/SKILL\.md$/);
    assert.match(data.skill, /ariax-bindcraft\/SKILL\.md$/);
    assert.deepEqual(Object.keys(data.references), [
      'shared', 'campaigns', 'candidates', 'engine-choice', 'examples', 'feedback', 'interpretation',
      'raw-curl', 'recorded-settings', 'outputs',
    ]);
    assert.match(data.references.outputs, /ariax-bindcraft\/outputs\.md$/);
    assert.equal(out.stderr, '');

    const human = await captureOutput(() => main(['skills', 'boltzgen', '--no-json'], {}));
    assert.equal(human.value, 0);
    assert.match(human.stdout, /^.*ariax-boltzgen\/SKILL\.md\n$/);
    assert.equal(human.stdout.trim().split('\n').length, 1);
    assert.equal(human.stderr, '');
  });

  it('reads the shared and selected protocol guides in human and JSON modes', async () => {
    const shared = await captureOutput(() => main(['skills', '--read', '--no-json'], {}));
    assert.equal(shared.value, 0);
    assert.equal(shared.stdout, readFileSync(new URL('../agent-skills/SKILL.md', import.meta.url), 'utf8'));
    assert.equal(shared.stderr, '');

    const protocol = await captureOutput(() => main(['skills', 'boltzgen', '--read', '--json'], {}));
    assert.equal(protocol.value, 0);
    const data = JSON.parse(protocol.stdout).data;
    assert.deepEqual(
      { id: data.id, scope: data.scope, protocol: data.protocol },
      { id: 'skill', scope: 'protocol', protocol: 'boltzgen' },
    );
    assert.equal(
      data.content,
      readFileSync(new URL('../agent-skills/skills/ariax-boltzgen/SKILL.md', import.meta.url), 'utf8'),
    );
    assert.equal(data.size_bytes, Buffer.byteLength(data.content));
    assert.equal(protocol.stderr, '');
  });

  it('packages the dedicated BindCraft2 guide and output reference', async () => {
    const out = await captureOutput(() => main(['skills', 'bindcraft2', '--json'], {}));
    const data = JSON.parse(out.stdout).data;
    assert.equal(data.protocol, 'bindcraft2');
    assert.match(data.skill, /ariax-bindcraft2\/SKILL\.md$/);
    assert.match(data.references.outputs, /ariax-bindcraft2\/outputs\.md$/);
  });

  it('reads named core and protocol output references', async () => {
    const feedback = await captureOutput(() => main([
      'skills', '--reference', 'feedback', '--read', '--json',
    ], {}));
    assert.equal(feedback.value, 0);
    assert.equal(
      JSON.parse(feedback.stdout).data.content,
      readFileSync(new URL('../agent-skills/core/feedback.md', import.meta.url), 'utf8'),
    );

    const core = await captureOutput(() => main([
      'skills', '--reference', 'candidates', '--read', '--json',
    ], {}));
    assert.equal(core.value, 0);
    const coreData = JSON.parse(core.stdout).data;
    assert.equal(coreData.id, 'candidates');
    assert.equal(coreData.scope, 'core');
    assert.equal(
      coreData.content,
      readFileSync(new URL('../agent-skills/core/candidates.md', import.meta.url), 'utf8'),
    );

    const outputs = await captureOutput(() => main([
      'skills', 'pxdesign', '--reference', 'outputs', '--read', '--json',
    ], {}));
    assert.equal(outputs.value, 0);
    const outputData = JSON.parse(outputs.stdout).data;
    assert.equal(outputData.protocol, 'pxdesign');
    assert.equal(outputData.scope, 'protocol');
    assert.equal(
      outputData.content,
      readFileSync(new URL('../agent-skills/skills/ariax-pxdesign/outputs.md', import.meta.url), 'utf8'),
    );
  });

  it('discovers and reads Forge references and bundled examples through both platform names', async () => {
    for (const platform of ['forge', 'ariax-forge']) {
      const found = await captureOutput(() => main(['skills', platform, '--json'], {}));
      assert.equal(found.value, 0);
      assert.equal(found.stderr, '');
      const discovery = JSON.parse(found.stdout).data;
      assert.equal(discovery.platform, 'forge');
      for (const reference of ['outputs', 'base', 'ipsae', 'boltz2']) {
        const read = await captureOutput(() => main([
          'skills', platform, '--reference', reference, '--read', '--json',
        ], {}));
        assert.equal(read.value, 0);
        assert.equal(read.stderr, '');
        const guide = JSON.parse(read.stdout).data;
        assert.equal(guide.id, reference);
        assert.equal(guide.scope, 'platform');
        assert.equal(guide.platform, 'forge');
        assert.equal(guide.path, discovery.references[reference]);
        assert.equal(guide.content, readFileSync(discovery.references[reference], 'utf8'));
        assert.equal(guide.size_bytes, Buffer.byteLength(guide.content));
      }
      for (const [tool, filename] of Object.entries({ base: 'message.txt', ipsae: 'scores.json', boltz2: 'complex.yaml' })) {
        assert.equal(discovery.examples[tool], join(discovery.examples.root, tool));
        assert.ok(statSync(discovery.examples[tool]).isDirectory());
        assert.ok(readFileSync(join(discovery.examples[tool], filename)).length > 0);
      }
      const shared = await captureOutput(() => main([
        'skills', platform, '--reference', 'shared', '--read', '--json',
      ], {}));
      assert.equal(shared.value, 0);
      assert.equal(JSON.parse(shared.stdout).data.content, readFileSync(discovery.shared, 'utf8'));
      const core = await captureOutput(() => main([
        'skills', platform, '--reference', 'candidates', '--read', '--json',
      ], {}));
      assert.equal(core.value, 0);
      assert.equal(JSON.parse(core.stdout).data.content, readFileSync(discovery.references.candidates, 'utf8'));
    }
  });

  it('includes Forge reference paths in global discovery and keeps human reads available', async () => {
    const out = await captureOutput(() => main(['skills', '--json'], {}));
    assert.equal(out.value, 0);
    const discovery = JSON.parse(out.stdout).data;
    for (const reference of ['outputs', 'base', 'ipsae', 'boltz2']) {
      const read = await captureOutput(() => main([
        'skills', 'forge', '--reference', reference, '--read', '--no-json',
      ], {}));
      assert.equal(read.value, 0);
      assert.equal(read.stdout, readFileSync(discovery.platform_references.forge[reference], 'utf8'));
    }
    assert.ok(statSync(discovery.platform_examples.forge.root).isDirectory());
    const human = await captureOutput(() => main(['skills', '--no-json'], {}));
    assert.equal(human.value, 0);
    assert.match(human.stdout, /Forge references: outputs, base, ipsae, boltz2/);
    assert.ok(human.stdout.includes(discovery.platform_examples.forge.root));
  });

  it('documents the compact BindCraft2 candidate contract without losing target or completion semantics', () => {
    const candidates = readFileSync(new URL('../agent-skills/core/candidates.md', import.meta.url), 'utf8');
    const outputs = readFileSync(new URL('../agent-skills/skills/ariax-bindcraft2/outputs.md', import.meta.url), 'utf8');
    assert.match(candidates, /target_scores\.aligned_positive_target_mean_i_pDAE/);
    assert.match(candidates, /recorded `completed` state is not a rejection/);
    assert.match(candidates, /Other-engine `candidates` and status \| Released engine-specific payload remains the default/);
    assert.match(outputs, /Compact `target_scores\.targets` keeps target names, signed weights, and i_pDAE values/);
    assert.match(outputs, /`optimization\.state: "completed"` records successful native optimization and is not rejection evidence/);
  });

  it('treats canonical RTX6000PRO as primary on supported engines and excluded on PXDesign', () => {
    for (const name of ['ariax-bindcraft', 'ariax-bindcraft2', 'ariax-boltzgen', 'ariax-esmfold2-pipeline']) {
      const guide = readFileSync(new URL(`../agent-skills/skills/${name}/SKILL.md`, import.meta.url), 'utf8');
      assert.match(guide, /`RTX6000PRO`/i, name);
      assert.match(guide, /primary\/core/i, name);
    }
    const pxdesign = readFileSync(new URL('../agent-skills/skills/ariax-pxdesign/SKILL.md', import.meta.url), 'utf8');
    assert.match(pxdesign, /excludes[^.]*`RTX6000PRO`/i);
    assert.doesNotMatch(pxdesign, /`RTX6000PRO`[^.]*primary\/core/i);
  });

  it('rejects arbitrary paths and incomplete reference requests', async () => {
    for (const [argv, message] of [
      [['skills', '--reference', '../SKILL.md', '--read', '--json'], /Unknown skills reference/],
      [['skills', '--reference', 'outputs', '--read', '--json'], /requires a protocol/],
      [['skills', 'boltzgen', '--reference', 'outputs', '--json'], /requires --read/],
      [['skills', 'constructor', '--read', '--json'], /Unknown protocol/],
      [['skills', 'forge', '--reference', '../outputs.md', '--read', '--json'], /Unknown skills reference/],
      [['skills', 'ariax-forge', '--reference', 'constructor', '--read', '--json'], /Unknown skills reference/],
      [['skills', 'forge', '--reference', 'base', '--json'], /requires --read/],
      [['skills', 'boltzgen', '--reference', 'base', '--read', '--json'], /Unknown skills reference/],
    ]) {
      const out = await captureOutput(() => main(argv, {}));
      assert.equal(out.value, 1);
      assert.match(JSON.parse(out.stdout).error.message, message);
      assert.equal(out.stderr, '');
    }
  });
});
