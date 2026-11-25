/** Offline installation smoke test of the actual release packages, in a disposable prefix. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { AGENT_SHELL_ENV_VARS } from '../src/agent-env.js';
import { buildInfo, PACKAGE_ROOT } from '../src/build-info.js';
import { installGitHub, verifyInstallation } from '../src/installation.js';
import { releaseUpdateAvailable } from '../src/update-check.js';
import { exerciseConnectivityCli, exerciseForgeCli, exerciseForgeControls, exerciseForgeBatch } from '../test/helpers/forge-http.js';
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
    if (index < 2) await exerciseAgentUpdateNotice(script, channel);
    if (index < 2 || channel === 'source') {
      await exerciseConnectivityCli(script, env);
      await exerciseForgeCli(script, env);
      await exerciseForgeControls(script, env);
      await exerciseForgeBatch(script, env);
      console.log(`Installed ${channel} Forge recovery, devices, caps and hold/resume controls verified at the local boundary.`);
    }
    assert.match(execute(process.execPath, [script, 'help']), /ariax skills/);
    const skillsCompactRaw = execute(process.execPath, [script, 'skills', '--json']);
    assert.ok(Buffer.byteLength(skillsCompactRaw) < 6000, 'default skills --json must stay compact');
    const skillsCompact = JSON.parse(skillsCompactRaw);
    assert.ok(JSON.stringify(skillsCompact).includes('ariax-boltzgen'));
    assert.ok(JSON.stringify(skillsCompact).includes('ariax-bindcraft2'));
    const skills = JSON.parse(execute(process.execPath, [script, 'skills', '--paths', '--json']));
    await fs.access(path.join(root, 'ariax-cli/agent-skills/skills/ariax-boltzgen/SKILL.md'));
    await fs.access(path.join(root, 'ariax-cli/agent-skills/skills/ariax-bindcraft2/SKILL.md'));
    await fs.access(path.join(root, 'ariax-cli/agent-skills/skills/ariax-bindcraft2/outputs.md'));
    for (const platform of ['forge', 'ariax-forge']) {
      const forge = JSON.parse(execute(process.execPath, [script, 'skills', platform, '--paths', '--json'])).data;
      assert.equal(forge.platform, 'forge');
      await exerciseAcceptedForgeDiscovery(forge);
      const oneCall = JSON.parse(execute(process.execPath, [script, 'skills', platform, '--tool', 'boltz2', '--read', '--json'])).data;
      assert.equal(oneCall.content, await fs.readFile(forge.references.boltz2, 'utf8'));
      for (const reference of Object.keys(skills.data.platform_references.forge)) {
        const guide = JSON.parse(execute(process.execPath, [script, 'skills', platform,
          '--reference', reference, '--read', '--json'])).data;
        assert.equal(guide.path, forge.references[reference]);
        assert.equal(guide.scope, 'platform');
        assert.equal(guide.platform, 'forge');
        assert.equal(guide.content, await fs.readFile(forge.references[reference], 'utf8'));
        assert.equal(guide.size_bytes, Buffer.byteLength(guide.content));
      }
      assert.equal(forge.examples.root, skills.data.platform_examples.forge.root);
      assert.ok((await fs.readFile(forge.references['freebindcraft-preflight'])).length > 0);
      assert.ok((await fs.readFile(forge.references['boltz2-affinity-check'])).length > 0);
    }
    // Exercise the managed output reader and Phase 6 skills/schema/help UX from the same installed package.
    const managedOutput = JSON.parse(execute(process.execPath, [script, 'skills', 'boltzgen',
      '--reference', 'outputs', '--read', '--json'])).data;
    assert.equal(managedOutput.scope, 'protocol');
    assert.equal(managedOutput.content, await fs.readFile(managedOutput.path, 'utf8'));
    const docImplicit = JSON.parse(execute(process.execPath, [script, 'skills', 'boltzgen',
      '--doc', 'outputs', '--json'])).data;
    assert.equal(docImplicit.content, managedOutput.content);
    const refImplicit = JSON.parse(execute(process.execPath, [script, 'skills',
      '--reference', 'managed-projects', '--json'])).data;
    assert.match(refImplicit.content, /\.\/prepared\/input\.pdb/);
    assert.ok(!refImplicit.content.includes('./prepared/target.pdb'));
    const schemaEx = JSON.parse(execute(process.execPath, [script, 'schema', 'boltzgen',
      '--example', 'vhh', '--json'])).data;
    assert.equal(schemaEx.protocol, 'boltzgen');
    assert.equal(schemaEx.project_type, 'vhh');
    assert.equal(schemaEx.example?.protocol, 'boltzgen');
    const installCheckDir = path.join(temporary, `skills-install-${channel}-${index}`);
    await fs.mkdir(installCheckDir, { recursive: true });
    execute(process.execPath, [script, 'skills', 'install', '--target', 'codex', '--scope', 'project', '--json'], { cwd: installCheckDir });
    await fs.access(path.join(installCheckDir, '.codex/skills/ariax/SKILL.md'));
    await fs.access(path.join(installCheckDir, '.codex/skills/ariax/core/interpretation.md'));
    let unknownHelpCode = 0;
    try {
      execute(process.execPath, [script, 'help', 'nonexistent-subcommand', '--json']);
    } catch (err) {
      unknownHelpCode = err.status;
    }
    assert.equal(unknownHelpCode, 1, 'ariax help <unknown> must exit 1');
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

async function exerciseAgentUpdateNotice(script, channel) {
  const dir = await fs.mkdtemp(path.join(temporary, `agent-updates-${channel}-`));
  const transport = path.join(dir, 'release-source.mjs');
  const checks = path.join(dir, 'checks');
  const url = channel === 'github'
    ? 'https://api.github.com/repos/cytokineking/ariax-cli/commits/main'
    : 'https://registry.npmjs.org/ariax-cli/latest';
  const release = channel === 'github' ? { sha: 'b'.repeat(40) } : { version: '999.0.0' };
  await fs.writeFile(transport, `import fs from 'node:fs';
globalThis.fetch = async (url) => {
  if (String(url) !== ${JSON.stringify(url)}) throw new Error('Unexpected release source');
  fs.appendFileSync(${JSON.stringify(checks)}, 'check\\n');
  return Response.json(${JSON.stringify(release)});
};
Date.now = () => ${Date.now()};\n`);
  const run = promisify(execFile);
  const clearedAgents = Object.fromEntries(AGENT_SHELL_ENV_VARS.map((name) => [name, '']));
  const skills = (overrides = {}) => run(process.execPath, ['--import', pathToFileURL(transport).href, script, 'skills', '--json'], {
    env: { ...env, CI: 'false', NO_UPDATE_NOTIFIER: '0', ...clearedAgents,
      TMPDIR: dir, TMP: dir, TEMP: dir, ...overrides },
  });
  const codex = { CODEX_THREAD_ID: 'package-smoke' };
  const claude = { CLAUDECODE: '1' };
  const baseline = await skills();
  assert.ok(JSON.parse(baseline.stdout).data);
  for (const result of [baseline, await skills({ ...codex, CI: 'true' }), await skills({ ...claude, NO_UPDATE_NOTIFIER: '1' })]) {
    assert.equal(result.stderr, '');
  }
  for (const marker of [codex, claude]) {
    const results = await Promise.all([skills(marker), skills(marker)]);
    for (const result of results) assert.equal(result.stdout, baseline.stdout);
    const notices = results.flatMap(({ stderr }) => stderr.trim() ? [JSON.parse(stderr).notice] : []);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].code, 'cli_update_available');
    assert.equal(notices[0].channel, channel);
    assert.equal(notices[0].command, 'ariax upgrade');
    assert.equal(channel === 'github' ? notices[0].latest_revision : notices[0].latest_version,
      channel === 'github' ? release.sha : release.version);
  }
  assert.equal(await fs.readFile(checks, 'utf8'), 'check\ncheck\n');
}
