import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const installer = fileURLToPath(new URL('../install.sh', import.meta.url));

async function runInstaller(t, scenario, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ariax-installer-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, 'global', 'ariax-cli');
  await fs.mkdir(path.join(packageRoot, 'src'), { recursive: true });
  await fs.writeFile(path.join(packageRoot, 'package.json'), '{"type":"module"}');
  await fs.writeFile(path.join(packageRoot, 'src/installation.js'), `
    export async function verifyInstallation(expected) {
      return { executable: '/test/bin/ariax', build: expected };
    }
  `);
  const preload = path.join(root, 'mock.mjs');
  await fs.writeFile(preload, `
    import fs from 'node:fs';
    import path from 'node:path';
    import child from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const root = process.env.INSTALLER_TEST_ROOT;
    const scenario = process.env.INSTALLER_TEST_SCENARIO;
    const record = (entry) => fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify(entry)+'\\n');
    globalThis.fetch = async (url) => {
      record({url});
      if (url.startsWith('https://registry.npmjs.org/')) {
        if (scenario === 'outage') return new Response('', {status:503});
        if (scenario === 'missing') return new Response('', {status:404});
        return new Response(JSON.stringify({version:'0.1.0'}));
      }
      if (url.endsWith('/commits/main')) return new Response(JSON.stringify({sha:'a'.repeat(40)}));
      if (url.endsWith('.tar.gz')) return new Response('mock archive');
      throw new Error('Unexpected network request '+url);
    };
    child.execFileSync = (command, args) => {
      record({command,args});
      if (command === 'tar') {
        const source = path.join(args.at(-1), 'ariax-cli-'+(process.env.ARIAX_REVISION || 'a'.repeat(40)));
        fs.mkdirSync(source, {recursive:true});
        fs.writeFileSync(path.join(source,'package.json'), JSON.stringify({name:'ariax-cli',version:'0.1.0',files:['src/']}));
        return '';
      }
      if (command === 'npm' && args[0] === 'pack') return JSON.stringify([{filename:'ariax-cli-0.1.0.tgz'}]);
      if (command === 'npm' && args[0] === 'install') return '';
      if (command === 'npm' && args[0] === 'root') return path.join(root,'global');
      throw new Error('Unexpected subprocess '+command+' '+args);
    };
    syncBuiltinESMExports();
  `);
  const env = { ...process.env, ARIAX_VERSION: '', ARIAX_REVISION: '', ...overrides,
    INSTALLER_TEST_ROOT: root, INSTALLER_TEST_SCENARIO: scenario,
    NODE_OPTIONS: `--import=${preload}`,
  };
  let result;
  try { result = { ...await execute('sh', [installer], { env }), code: 0 }; }
  catch (error) { result = error; }
  const calls = (await fs.readFile(path.join(root, 'calls.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);
  return { result, calls };
}

describe('public installer', { skip: process.platform === 'win32' }, () => {
  it('installs the exact stable version selected by the registry and verifies it', async (t) => {
    const { result, calls } = await runInstaller(t, 'stable');
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(calls.find((call) => call.args?.[0] === 'install').args,
      ['install', '--global', 'ariax-cli@0.1.0', '--registry=https://registry.npmjs.org']);
    assert.equal(calls.some((call) => call.url?.includes('github.com')), false);
    assert.match(result.stdout, /Verified/);
  });

  it('resolves missing npm to a pinned GitHub commit and installs a package, not a directory', async (t) => {
    const { result, calls } = await runInstaller(t, 'missing');
    assert.equal(result.code, 0, result.stderr);
    assert.ok(calls.some((call) => call.url === `https://github.com/cytokineking/ariax-cli/archive/${'a'.repeat(40)}.tar.gz`));
    assert.ok(calls.find((call) => call.args?.[0] === 'install').args[2].endsWith('.tgz'));
    assert.match(result.stdout, /"channel":"github"/);
  });

  it('does not fall back or install anything on registry outage', async (t) => {
    const { result, calls } = await runInstaller(t, 'outage');
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /HTTP 503; no fallback/);
    assert.equal(calls.some((call) => call.command || call.url?.includes('github.com')), false);
  });

  it('honors an explicit source revision without consulting npm or main', async (t) => {
    const revision = 'b'.repeat(40);
    const { result, calls } = await runInstaller(t, 'outage', { ARIAX_REVISION: revision });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(calls.filter((call) => call.url).map((call) => call.url),
      [`https://github.com/cytokineking/ariax-cli/archive/${revision}.tar.gz`]);
    assert.match(result.stdout, new RegExp(revision));
  });

  it('does not replace an unavailable explicitly pinned npm version with another build', async (t) => {
    const { result, calls } = await runInstaller(t, 'missing', { ARIAX_VERSION: '0.1.0' });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /no other version will be installed/);
    assert.equal(calls.some((call) => call.command), false);
  });
});
