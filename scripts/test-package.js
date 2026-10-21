/** Offline installation smoke test of the actual release packages, in a disposable prefix. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildInfo, PACKAGE_ROOT } from '../src/build-info.js';
import { installGitHub, verifyInstallation } from '../src/installation.js';
import { releaseUpdateAvailable } from '../src/update-check.js';
import { exerciseForgeCli, exerciseForgeControls } from '../test/helpers/forge-http.js';
import { exerciseAcceptedForgeDiscovery } from '../test/helpers/forge-discovery.js';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ariax-package-smoke-'));
const prefix = path.join(temporary, 'prefix');
const bin = process.platform === 'win32' ? prefix : path.join(prefix, 'bin');
const env = {
  ...process.env,
  PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  npm_config_prefix: prefix,
  npm_config_cache: path.join(temporary, 'npm-cache'),
  NO_UPDATE_NOTIFIER: '1',
};
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const execute = (command, args, options = {}) => execFileSync(command, args, {
  encoding: 'utf8', cwd: PACKAGE_ROOT, env, ...options,
});
try {
  const source = buildInfo();
  let githubBuild;
  for (const [index, channel] of ['github', 'npm', 'github', 'source'].entries()) {
    let expectedRevision = source.source_revision;
    if (channel === 'source') {
      // Exercise the real shell installer using the independent customer tree.
      // Only archive retrieval is substituted while this candidate is private.
      const exported = JSON.parse(execute(process.execPath, ['scripts/export-customer-source.js',
        path.join(temporary, 'customer-source')]));
      expectedRevision = exported.source_revision;
      assert.equal(execute('git', ['rev-list', '--count', 'HEAD'], { cwd: exported.directory }).trim(), '1');
      const selection = JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, 'customer-source-files.json'), 'utf8'));
      assert.deepEqual(execute('git', ['ls-files', '-z'], { cwd: exported.directory }).split('\0').filter(Boolean).sort(),
        [...selection].sort());
      const archive = path.join(temporary, 'customer-source.tar.gz');
      execute('git', ['archive', '--format=tar.gz', `--prefix=ariax-cli-${expectedRevision}/`,
        '--output', archive, 'HEAD'], { cwd: exported.directory });
      const transport = path.join(temporary, 'customer-source-transport.mjs');
      const url = `https://github.com/cytokineking/ariax-cli/archive/${expectedRevision}.tar.gz`;
      await fs.writeFile(transport, `import fs from 'node:fs';
globalThis.fetch = async (url) => {
  if (String(url) !== ${JSON.stringify(url)}) throw new Error('Unexpected source request: ' + url);
  return new Response(fs.readFileSync(${JSON.stringify(archive)}));
};\n`);
      execute('sh', [path.join(exported.directory, 'install.sh')], { env: {
        ...env, ARIAX_CHANNEL: 'github', ARIAX_REVISION: expectedRevision, ARIAX_VERSION: '',
        NODE_OPTIONS: `--import=${transport}`, npm_config_offline: 'true',
        npm_config_omit: 'optional', npm_config_ignore_scripts: 'true',
        npm_config_audit: 'false', npm_config_fund: 'false',
      } });
    } else if (index === 2) {
      // Exercise the actual GitHub upgrader with an offline archive of this candidate.
      await installGitHub({
        revision: source.source_revision, quiet: true,
        env: { ...env, npm_config_offline: 'true', npm_config_omit: 'optional', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' },
        fetchImpl: async (url) => {
          assert.equal(url, `https://github.com/cytokineking/ariax-cli/archive/${source.source_revision}.tar.gz`);
          const archive = path.join(temporary, 'github-migration.tar.gz');
          execFileSync('git', ['archive', '--format=tar.gz', `--prefix=ariax-cli-${source.source_revision}/`, '--output', archive, 'HEAD'], { cwd: PACKAGE_ROOT });
          return new Response(await fs.readFile(archive));
        },
      });
    } else {
      const artifact = execute(process.execPath, ['scripts/pack-release.js', channel, path.join(temporary, channel)]).trim();
      execute(npm, ['install', '--global', '--offline', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund', artifact], { shell: process.platform === 'win32' });
    }
    const expected = { version: source.version, channel: channel === 'source' ? 'github' : channel,
      source_revision: expectedRevision };
    const installed = await verifyInstallation({ ...expected, env });
    const root = execute(npm, ['root', '--global'], { shell: process.platform === 'win32' }).trim();
    assert.equal((await fs.lstat(path.join(root, 'ariax-cli'))).isSymbolicLink(), false);
    const script = path.join(root, 'ariax-cli/bin/ariax.js');
    if (index < 2 || channel === 'source') {
      await exerciseForgeCli(script, env);
      await exerciseForgeControls(script, env);
      console.log(`Installed ${channel} Forge recovery, devices, caps and hold/resume controls verified at the local boundary.`);
    }
    assert.match(execute(process.execPath, [script, 'help']), /ariax skills/);
    const skills = JSON.parse(execute(process.execPath, [script, 'skills', '--json']));
    assert.ok(JSON.stringify(skills).includes('ariax-boltzgen'));
    assert.ok(JSON.stringify(skills).includes('ariax-bindcraft2'));
    await fs.access(path.join(root, 'ariax-cli/agent-skills/skills/ariax-boltzgen/SKILL.md'));
    await fs.access(path.join(root, 'ariax-cli/agent-skills/skills/ariax-bindcraft2/SKILL.md'));
    await fs.access(path.join(root, 'ariax-cli/agent-skills/skills/ariax-bindcraft2/outputs.md'));
    for (const platform of ['forge', 'ariax-forge']) {
      const forge = JSON.parse(execute(process.execPath, [script, 'skills', platform, '--json'])).data;
      assert.equal(forge.platform, 'forge');
      await exerciseAcceptedForgeDiscovery(forge);
      for (const reference of Object.keys(skills.data.platform_references.forge)) {
        const guide = JSON.parse(execute(process.execPath, [script, 'skills', platform,
          '--reference', reference, '--read', '--json'])).data;
        assert.equal(guide.path, forge.references[reference]);
        assert.equal(guide.scope, 'platform');
        assert.equal(guide.platform, 'forge');
        assert.equal(guide.content, await fs.readFile(forge.references[reference], 'utf8'));
        assert.equal(guide.size_bytes, Buffer.byteLength(guide.content));
      }
      for (const [tool, filename] of Object.entries({ base: 'message.txt', ipsae: 'scores.json', boltz2: 'complex.yaml', bindcraft2: 'settings.json', freebindcraft: 'settings.json' })) {
        assert.equal(forge.examples[tool], path.join(forge.examples.root, tool));
        assert.ok((await fs.readFile(path.join(forge.examples[tool], filename))).length > 0);
        if (['bindcraft2', 'freebindcraft'].includes(tool)) {
          for (const input of ['PDL1.pdb', 'check.py', ...(tool === 'freebindcraft' ? ['advanced.json', 'filters.json', 'check-limit.py'] : [])]) {
            assert.ok((await fs.readFile(path.join(forge.examples[tool], input))).length > 0);
          }
        }
      }
      assert.equal(forge.examples.root, skills.data.platform_examples.forge.root);
      const science = forge.examples.science;
      const checkedTarget = JSON.parse(execute('python3', [forge.references['freebindcraft-preflight'],
        '--settings', path.join(science, 'freebindcraft/target.json'),
        '--pdb', path.join(science, 'freebindcraft/target.pdb'), '--family', 'miniprotein']));
      assert.equal(checkedTarget.target_residues, 3);
      const checkedAffinity = JSON.parse(execute('python3', [forge.references['boltz2-affinity-check'],
        path.join(science, 'affinity/affinity_affinity.json'), '--record-id', 'affinity']));
      assert.equal(checkedAffinity.predicted_pIC50, 9);
      for (const predictor of ['boltz2']) {
        const handoff = JSON.parse(await fs.readFile(path.join(science, predictor, 'handoff.json'), 'utf8'));
        for (const file of Object.values(handoff.files)) {
          assert.ok((await fs.readFile(path.join(science, predictor, file))).length > 0);
        }
      }
    }
    // Exercise the managed output reader from the same installed package.
    const managedOutput = JSON.parse(execute(process.execPath, [script, 'skills', 'boltzgen',
      '--reference', 'outputs', '--read', '--json'])).data;
    assert.equal(managedOutput.scope, 'protocol');
    assert.equal(managedOutput.content, await fs.readFile(managedOutput.path, 'utf8'));
    console.log(`Installed ${channel} Forge reference discovery, reads, and native examples verified.`);
    for (const relative of [
      'agent-skills/skills/ariax-bindcraft2/SKILL.md',
      'agent-skills/skills/ariax-bindcraft2/outputs.md',
      'agent-skills/core/recorded-settings.md',
      'agent-skills/core/examples.md',
      'agent-skills/examples/bindcraft2-formats/cyclic-peptide.json',
      'agent-skills/examples/bindcraft2-formats/custom-scaffold.json',
    ]) {
      assert.deepEqual(await fs.readFile(path.join(root, 'ariax-cli', relative)),
        await fs.readFile(path.join(PACKAGE_ROOT, relative)), `Packaged content differs: ${relative}`);
    }
    if (channel === 'github') githubBuild = installed.build;
    else if (channel === 'npm') {
      const release = { channel: 'npm', latest_version: installed.build.version, latest_revision: null };
      assert.equal(releaseUpdateAvailable({ currentVersion: githubBuild.version, currentChannel: githubBuild.channel, release }), true);
      assert.equal(releaseUpdateAvailable({ currentVersion: installed.build.version, currentChannel: installed.build.channel, release }), false);
    }
    console.log(`Packed ${channel} installation verified: ${installed.build.version} ${installed.build.source_revision}`);
  }
  // A different executable earlier on PATH must not be reported as a successful upgrade.
  const shadow = path.join(temporary, 'shadow');
  await fs.mkdir(shadow);
  await fs.writeFile(path.join(shadow, process.platform === 'win32' ? 'ariax.cmd' : 'ariax'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await assert.rejects(verifyInstallation({
    version: source.version, channel: 'github', env: { ...env, PATH: `${shadow}${path.delimiter}${env.PATH}` },
  }), /PATH selects/);
  console.log('Same-version migration in both directions and shadowed-executable detection verified.');
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
