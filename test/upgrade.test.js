import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { installLatest, run as upgrade } from '../src/commands/upgrade.js';

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

function context(overrides = {}) {
  return {
    flags: {},
    positionals: [],
    json: false,
    interactive: false,
    currentVersion: '1.0.0',
    fetchImpl: async () => new Response(JSON.stringify({ version: '1.1.0' })),
    verifyInstallation: async () => ({ executable: '/test/bin/ariax', build: { version: '1.1.0', channel: 'npm' } }),
    ...overrides,
  };
}

describe('upgrade command', () => {
  it('returns a successful bootstrap status when npm is unpublished, without installing', async () => {
    const out = await captureOutput(() => upgrade(context({
      flags: { check: true }, json: true,
      currentVersion: '0.1.0', currentBuild: { channel: 'github', source_revision: 'a'.repeat(40) },
      fetchImpl: async () => new Response('', { status: 404 }),
      installLatest: async () => { throw new Error('must not install'); },
    })));
    const result = JSON.parse(out.stdout).data;
    assert.equal(result.status, 'unpublished');
    assert.equal(result.latest_version, null);
    assert.equal(result.update_available, false);
    assert.match(result.instruction, /ARIAX_REVISION/);
  });

  it('migrates a same-version GitHub build to npm and verifies before reporting success', async () => {
    const calls = [];
    const out = await captureOutput(() => upgrade(context({
      flags: { yes: true }, json: true,
      currentVersion: '0.1.0', currentBuild: { channel: 'github', source_revision: 'a'.repeat(40) },
      fetchImpl: async () => new Response(JSON.stringify({ version: '0.1.0' })),
      installLatest: async (options) => calls.push(['install', options]),
      verifyInstallation: async (options) => { calls.push(['verify', options]); return { executable: '/test/bin/ariax' }; },
    })));
    assert.deepEqual(calls, [
      ['install', { version: '0.1.0', quiet: true }],
      ['verify', { version: '0.1.0', channel: 'npm' }],
    ]);
    assert.equal(JSON.parse(out.stdout).data.updated, true);
  });

  it('never reports success if executable verification fails', async () => {
    const out = await captureOutput(() => assert.rejects(upgrade(context({
      flags: { yes: true }, json: true,
      installLatest: async () => {},
      verifyInstallation: async () => { throw new Error('shadowed executable'); },
    })), /shadowed executable/));
    assert.equal(out.stdout, '');
  });
  it('checks without an API key or mutation and supports JSON', async () => {
    let installed = false;
    const out = await captureOutput(() => upgrade(context({
      flags: { check: true },
      json: true,
      installLatest: async () => { installed = true; },
    })));
    assert.equal(installed, false);
    assert.deepEqual(JSON.parse(out.stdout), {
      data: {
        current_version: '1.0.0',
        current_channel: 'npm',
        current_revision: null,
        latest_version: '1.1.0',
        update_available: true,
      },
    });
    assert.equal(out.stderr, '');
  });

  it('reports when the installed version is current', async () => {
    const out = await captureOutput(() => upgrade(context({
      fetchImpl: async () => new Response(JSON.stringify({ version: '1.0.0' })),
    })));
    assert.equal(out.stdout, 'Ariax CLI 1.0.0 is up to date.\n');
    assert.equal(out.stderr, '');
  });

  it('requires explicit confirmation outside a terminal', async () => {
    const out = await captureOutput(() => assert.rejects(upgrade(context()), /rerun with --yes/));
    assert.match(out.stdout, /Update available: yes/);
  });

  it('honors an interactive decline without installing', async () => {
    let installed = false;
    const out = await captureOutput(() => upgrade(context({
      interactive: true,
      confirmUpgrade: async () => false,
      installLatest: async () => { installed = true; },
    })));
    assert.equal(installed, false);
    assert.match(out.stdout, /Upgrade cancelled/);
  });

  it('upgrades non-interactively only with --yes and preserves JSON stdout', async () => {
    let options;
    const out = await captureOutput(() => upgrade(context({
      flags: { yes: true },
      json: true,
      installLatest: async (value) => { options = value; },
    })));
    assert.deepEqual(options, { version: '1.1.0', quiet: true });
    assert.deepEqual(JSON.parse(out.stdout), {
      data: {
        current_version: '1.0.0',
        current_channel: 'npm',
        current_revision: null,
        latest_version: '1.1.0',
        update_available: true,
        updated: true,
        installed: { executable: '/test/bin/ariax', build: { version: '1.1.0', channel: 'npm' } },
      },
    });
    assert.match(out.stderr, /Installing ariax-cli@1\.1\.0 with npm/);
  });

  it('rejects conflicting, unknown, and positional input', async () => {
    await assert.rejects(upgrade(context({ flags: { check: true, yes: true } })), /cannot be used together/);
    await assert.rejects(upgrade(context({ flags: { unexpected: true } })), /unknown flag/);
    await assert.rejects(upgrade(context({ positionals: ['extra'] })), /unexpected positional/);
  });

  it('maps explicit registry failures to the network exit code', async () => {
    await assert.rejects(
      upgrade(context({ fetchImpl: async () => { throw new Error('offline'); } })),
      (error) => error.code === 'update_check_failed' && error.exitCode === 9,
    );
  });
});

describe('npm upgrade process', () => {
  it('uses fixed arguments without a shell', async () => {
    let invocation;
    const spawnImpl = (command, args, options) => {
      invocation = { command, args, options };
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    };
    await installLatest({ version: '1.1.0', quiet: true, spawnImpl, platform: 'linux' });
    assert.deepEqual(invocation, {
      command: 'npm',
      args: ['install', '--global', 'ariax-cli@1.1.0', '--registry=https://registry.npmjs.org'],
      options: { shell: false, stdio: ['ignore', 'ignore', 'inherit'] },
    });
  });

  it('reports npm failures without suggesting sudo', async () => {
    const spawnImpl = () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('close', 1));
      return child;
    };
    await assert.rejects(
      installLatest({ version: '1.1.0', spawnImpl }),
      (error) => error.code === 'upgrade_failed'
        && error.exitCode === 10
        && error.message.includes('do not use sudo'),
    );
  });
});
