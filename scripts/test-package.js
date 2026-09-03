/** Offline installation smoke test of the actual release packages, in a disposable prefix. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildInfo, PACKAGE_ROOT } from '../src/build-info.js';
import { verifyInstallation } from '../src/installation.js';
import { isUpdateAvailable } from '../src/update-check.js';

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
  for (const channel of ['github', 'npm']) {
    const artifact = execute(process.execPath, ['scripts/pack-release.js', channel, path.join(temporary, channel)]).trim();
    execute(npm, ['install', '--global', '--offline', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund', artifact], { shell: process.platform === 'win32' });
    const expected = { version: source.version, channel, source_revision: source.source_revision };
    const installed = await verifyInstallation({ ...expected, env });
    const root = execute(npm, ['root', '--global'], { shell: process.platform === 'win32' }).trim();
    const script = path.join(root, 'ariax-cli/bin/ariax.js');
    assert.match(execute(process.execPath, [script, 'help']), /ariax skills/);
    const skills = JSON.parse(execute(process.execPath, [script, 'skills', '--json']));
    assert.ok(JSON.stringify(skills).includes('ariax-boltzgen'));
    await fs.access(path.join(root, 'ariax-cli/agent-skills/skills/ariax-boltzgen/SKILL.md'));
    if (channel === 'github') githubBuild = installed.build;
    else {
      assert.equal(isUpdateAvailable(githubBuild.version, installed.build.version, githubBuild.channel), true);
      assert.equal(isUpdateAvailable(installed.build.version, installed.build.version, installed.build.channel), false);
    }
    console.log(`Packed ${channel} installation verified: ${installed.build.version} ${installed.build.source_revision}`);
  }
  // A different executable earlier on PATH must not be reported as a successful upgrade.
  const shadow = path.join(temporary, 'shadow');
  await fs.mkdir(shadow);
  await fs.writeFile(path.join(shadow, process.platform === 'win32' ? 'ariax.cmd' : 'ariax'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await assert.rejects(verifyInstallation({
    version: source.version, channel: 'npm', env: { ...env, PATH: `${shadow}${path.delimiter}${env.PATH}` },
  }), /PATH selects/);
  console.log('Same-version channel migration and shadowed-executable detection verified.');
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
