import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/main.js';

const project = '11111111-1111-4111-8111-111111111111';
const mutations = [['submit', '-f', 'job.json', '--name', 'example'], ...['restart', 'pause', 'abort'].map(command => [command, project])];

async function capture(fn) {
  const out = process.stdout.write, err = process.stderr.write;
  let text = '';
  process.stdout.write = process.stderr.write = chunk => { text += chunk; return true; };
  try { return { code: await fn(), text }; }
  finally { process.stdout.write = out; process.stderr.write = err; }
}

it('rejects mutation options and surplus operands before credentials, prompts, HTTP, uploads, or journal writes', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-args-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let effects = 0;
  const forbidden = async () => { effects++; throw new Error('unexpected side effect'); };
  const runtime = {
    interactive: true, fetchImpl: forbidden,
    credentialStore: { read: forbidden, storeSecure: forbidden, remove: forbidden },
    promptApiKey: forbidden, confirmFileStorage: forbidden, readTokenFromStdin: forbidden,
  };
  for (const argv of mutations) {
    for (const suffix of [['--dry-run=true'], ['--dry-run', 'true'], ['--dry-run'], ['--typo=value'], ['--__proto__=true'], ['--constructor=true'], ['--toString=true'], ['--', 'surplus']]) {
      for (const mode of ['--json', '--no-json']) {
        const result = await capture(() => main([...argv, ...suffix, mode, '--root-dir', root], {}, runtime));
        assert.equal(result.code, 1, `${argv} ${suffix}: ${result.text}`);
        assert.match(result.text, /unsupported flag|requires a value|unexpected positional/);
        assert.equal(effects, 0);
        assert.deepEqual(fs.readdirSync(root), []);
      }
    }
  }
});

it('validates all command surfaces before credential access or network', async () => {
  const commands = ['me', 'protocols', 'schema', 'skills', 'validate', 'submit', 'projects', 'jobs', 'status', 'logs', 'pause', 'restart', 'abort', 'operations', 'recover', 'gpu-preferences', 'runs', 'candidates', 'results', 'upgrade', 'login', 'logout'];
  let effects = 0;
  const forbidden = async () => { effects++; throw new Error('unexpected side effect'); };
  for (const command of commands) {
    const result = await capture(() => main([command, '--unsupported=value', '--json'], {}, {
      credentialStore: { read: forbidden, remove: forbidden }, fetchImpl: forbidden,
    }));
    assert.equal(result.code, 1, command);
    assert.match(result.text, /unsupported flag/);
  }
  for (const argv of [['inputs', 'inspect', '--output=x'], ['inputs', 'prepare', '--full'], ['projects', 'export', project, '--all']]) {
    const result = await capture(() => main([...argv, '--json'], {}, { fetchImpl: forbidden, credentialStore: { read: forbidden } }));
    assert.equal(result.code, 1);
    assert.match(result.text, /unsupported flag/);
  }
  for (const command of commands) {
    const result = await capture(() => main([command, 'one', 'two', 'three', '--json'], {}, {
      credentialStore: { read: forbidden, remove: forbidden }, fetchImpl: forbidden,
    }));
    assert.equal(result.code, 1, command);
    assert.match(result.text, /unexpected positional/);
  }
  for (const command of ['constructor', 'toString', '__proto__']) {
    const result = await capture(() => main([command], {}, { fetchImpl: forbidden }));
    assert.equal(result.code, 1);
    assert.match(result.text, /unknown command/);
  }
  assert.equal(effects, 0);
});

it('preserves supported authenticated options and existing aliases at dispatch', async () => {
  const cases = [
    ['submit', '--file=job.json', '--name=test', '--input=input.pdb', '--input-upload-intent-id=id', '--wait', '--resume', '--poll-interval=2', '--wait-timeout=4'],
    ['submit', '--f=job.json'], ['validate', '-f', 'job.json', '--input=input.pdb'], ['validate', '--f=job.json'],
    ['status', '--resume', '--wait', '--poll-interval=2', '--wait-timeout=4'],
    ['restart', project, '--wait', '--poll-interval=2', '--wait-timeout=4'],
    ['recover', 'operation-id', '--wait', '--poll-interval=2', '--wait-timeout=4'],
    ['projects', '--status=running', '--protocol=boltzgen', '--name=x', '--limit=5', '--cursor=x', '--all'],
    ['projects', 'export', project, '-o', 'job.json'],
    ['jobs', '--project=x', '--status=running', '--limit=5', '--cursor=x', '--all'],
    ['logs', project, '--tail=10', '--log-ref=run.log'],
    ['gpu-preferences', project, '-f', 'preferences.json'],
    ['runs', project, '--job=id', '--limit=5', '--cursor=x', '--all'],
    ['candidates', project, '--view=final', '--limit=5', '--cursor=x', '--all', '--eligible', '--output=x', '--overwrite'],
    ['results', project, '--path=x', '--download=x', '--overwrite', '--limit=5'],
  ];
  for (const argv of cases) {
    let reads = 0;
    const result = await capture(() => main([...argv, '--json'], {}, {
      credentialStore: { read: async () => { reads++; throw Object.assign(new Error('dispatch accepted'), { exitCode: 3 }); } },
    }));
    assert.equal(reads, 1, `${argv}: ${result.text}`);
    assert.equal(result.code, 3);
  }
});

it('process invocations reject dry-run=true and extras with no HTTP or journal activity', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-process-args-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let requests = 0;
  const server = http.createServer((_req, res) => { requests++; res.end('{}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const bin = fileURLToPath(new URL('../bin/ariax.js', import.meta.url));
  for (const argv of mutations) {
    for (const suffix of [['--dry-run=true'], ['surplus']]) {
      try {
        await promisify(execFile)(process.execPath, [bin, ...argv, ...suffix, '--json', '--root-dir', root, '--base-url', `http://127.0.0.1:${server.address().port}`, '--allow-custom-origin'], {
          env: { ...process.env, ARIAX_API_KEY: 'arx_testcredential', NO_UPDATE_NOTIFIER: '1' },
        });
        assert.fail('expected usage exit');
      } catch (error) {
        assert.equal(error.code, 1);
        assert.equal(JSON.parse(error.stdout).error.code, 'ARIAX_USAGE');
        assert.match(JSON.parse(error.stdout).error.message, /unsupported flag|unexpected positional/);
      }
      assert.equal(requests, 0);
      assert.deepEqual(fs.readdirSync(root), []);
    }
  }
});
