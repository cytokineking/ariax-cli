import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { installGitHub } from '../src/installation.js';

describe('GitHub upgrade installation', () => {
  it('packages the selected commit, embeds its identity, and replaces the npm-managed package', async () => {
    const revision = 'b'.repeat(40);
    let temporary;
    const calls = [];
    const expected = { version: '0.1.0', channel: 'github', source_revision: revision };
    const installed = await installGitHub({
      revision, quiet: true, platform: 'linux',
      fetchImpl: async (url, options) => {
        assert.equal(url, `https://github.com/cytokineking/ariax-cli/archive/${revision}.tar.gz`);
        assert.equal(options.headers.authorization, undefined);
        return new Response('archive');
      },
      exec: async (command, args, options) => {
        calls.push([command, args]);
        if (command === 'tar') {
          temporary = args.at(-1);
          const source = path.join(temporary, `ariax-cli-${revision}`);
          await fs.mkdir(source);
          await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({
            name: 'ariax-cli', version: '0.1.0', files: ['src/'], scripts: { prepack: 'should not run' },
          }));
        } else if (args[0] === 'pack') {
          const pkg = JSON.parse(await fs.readFile(path.join(options.cwd, 'package.json'), 'utf8'));
          assert.equal(pkg.scripts, undefined);
          assert.ok(pkg.files.includes('build-info.json'));
          assert.deepEqual(JSON.parse(await fs.readFile(path.join(options.cwd, 'build-info.json'), 'utf8')),
            { schema_version: 1, ...expected, source_dirty: false });
          assert.ok(args.includes('--ignore-scripts'));
          return { stdout: JSON.stringify([{ filename: 'ariax-cli-0.1.0.tgz' }]) };
        } else {
          assert.equal(command, 'npm');
          assert.deepEqual(args, ['install', '--global', './ariax-cli-0.1.0.tgz', '--registry=https://registry.npmjs.org']);
          assert.equal(options.cwd, temporary);
          assert.equal(options.shell, false);
        }
        return { stdout: '', stderr: '' };
      },
    });
    assert.deepEqual(installed, expected);
    assert.deepEqual(calls.map(([cmd, args]) => cmd === 'tar' ? cmd : args[0]), ['tar', 'pack', 'install']);
    await assert.rejects(fs.access(temporary), { code: 'ENOENT' });
  });

  it('cleans up temporary files on failure and never installs a missing archive', async () => {
    let temporary;
    let installed = false;
    await assert.rejects(installGitHub({
      revision: 'a'.repeat(40),
      fetchImpl: async () => new Response('archive'),
      exec: async (command, args) => {
        if (command === 'tar') {
          temporary = args.at(-1);
          throw new Error('bad archive');
        }
        installed = true;
      },
    }), (error) => error.code === 'upgrade_failed' && /bad archive/.test(error.message));
    assert.equal(installed, false);
    await assert.rejects(fs.access(temporary), { code: 'ENOENT' });
    await assert.rejects(installGitHub({
      revision: 'a'.repeat(40), fetchImpl: async () => new Response('', { status: 404 }),
      exec: async () => { throw new Error('must not execute'); },
    }), /HTTP 404/);
  });
});
