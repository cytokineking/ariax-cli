/** Offline installation smoke test of the actual release packages, in a disposable prefix. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildInfo, PACKAGE_ROOT } from '../src/build-info.js';
import { installGitHub, verifyInstallation } from '../src/installation.js';
import { releaseUpdateAvailable } from '../src/update-check.js';

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
  for (const [index, channel] of ['github', 'npm', 'github'].entries()) {
    if (index === 2) {
      // Exercise the actual GitHub upgrader with an offline archive of this candidate.
      await installGitHub({
        revision: source.source_revision, quiet: true,
        env: { ...env, npm_config_offline: 'true', npm_config_omit: 'optional', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' },
        fetchImpl: async (url) => {
          assert.equal(url, `https://github.com/cytokineking/ariax-cli/archive/${source.source_revision}.tar.gz`);
          return new Response(execFileSync('git', ['archive', '--format=tar.gz', `--prefix=ariax-cli-${source.source_revision}/`, 'HEAD'], { cwd: PACKAGE_ROOT }));
        },
      });
    } else {
      const artifact = execute(process.execPath, ['scripts/pack-release.js', channel, path.join(temporary, channel)]).trim();
      execute(npm, ['install', '--global', '--offline', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund', artifact], { shell: process.platform === 'win32' });
    }
    const expected = { version: source.version, channel, source_revision: source.source_revision };
    const installed = await verifyInstallation({ ...expected, env });
    const root = execute(npm, ['root', '--global'], { shell: process.platform === 'win32' }).trim();
    assert.equal((await fs.lstat(path.join(root, 'ariax-cli'))).isSymbolicLink(), false);
    const script = path.join(root, 'ariax-cli/bin/ariax.js');
    assert.match(execute(process.execPath, [script, 'help']), /ariax skills/);
    const skills = JSON.parse(execute(process.execPath, [script, 'skills', '--json']));
    assert.ok(JSON.stringify(skills).includes('ariax-boltzgen'));
    assert.ok(JSON.stringify(skills).includes('ariax-bindcraft2'));
    await fs.access(path.join(root, 'ariax-cli/agent-skills/skills/ariax-boltzgen/SKILL.md'));
    await fs.access(path.join(root, 'ariax-cli/agent-skills/skills/ariax-bindcraft2/SKILL.md'));
    await fs.access(path.join(root, 'ariax-cli/agent-skills/skills/ariax-bindcraft2/outputs.md'));
    if (channel === 'github') githubBuild = installed.build;
    else {
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
