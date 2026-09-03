import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildInfo, formatBuildInfo } from '../src/build-info.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ariax-identity-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'ariax-cli', version: '0.1.0' }));
  return root;
}

describe('build identity', () => {
  it('preserves embedded version/channel/revision and rejects mismatched metadata', async (t) => {
    const root = await fixture(t);
    const identity = { schema_version: 1, version: '0.1.0', channel: 'github', source_revision: 'a'.repeat(40), source_dirty: false };
    await fs.writeFile(path.join(root, 'build-info.json'), JSON.stringify(identity));
    assert.deepEqual(buildInfo(root), identity);
    assert.match(formatBuildInfo(identity), /github a{40}/);
    await fs.writeFile(path.join(root, 'build-info.json'), JSON.stringify({ ...identity, version: '0.2.0' }));
    assert.throws(() => buildInfo(root), /Invalid build identity/);
  });

  it('distinguishes clean source revisions and marks uncommitted changes', async (t) => {
    const root = await fixture(t);
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q');
    git('add', 'package.json');
    const commit = () => git('-c', 'user.name=Ariax Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture');
    commit();
    const first = buildInfo(root);
    assert.equal(first.channel, 'github');
    assert.equal(first.source_dirty, false);
    await fs.writeFile(path.join(root, 'change.txt'), 'another build');
    assert.equal(buildInfo(root).source_dirty, true);
    git('add', 'change.txt');
    commit();
    assert.notEqual(buildInfo(root).source_revision, first.source_revision);
    assert.equal(buildInfo(root).version, first.version);
  });

  it('does not borrow a parent repository identity for an unmarked installed package', async (t) => {
    const root = await fixture(t);
    assert.equal(buildInfo(root).channel, 'unknown');
  });
});
