/** Verify the package AND the executable a subsequent shell command will find. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EXIT } from './exit-codes.js';
import { isRevision, parseVersion } from './update-check.js';

const execute = promisify(execFile);

/** Install the selected immutable GitHub snapshot into the same package slot as npm. */
export async function installGitHub({ revision, quiet = false, fetchImpl = globalThis.fetch, exec = execute, env = process.env, platform = process.platform }) {
  if (!isRevision(revision)) throw new Error('A full GitHub commit SHA is required');
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ariax-upgrade-'));
  try {
    const response = await fetchImpl(`https://github.com/cytokineking/ariax-cli/archive/${revision}.tar.gz`, {
      headers: { 'user-agent': 'ariax-cli' }, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub archive returned HTTP ${response.status}`);
    const archive = path.join(temporary, 'source.tar.gz');
    await fs.promises.writeFile(archive, Buffer.from(await response.arrayBuffer()));
    await exec('tar', ['-xzf', archive, '-C', temporary], { env });
    const source = path.join(temporary, `ariax-cli-${revision}`);
    const pkgPath = path.join(source, 'package.json');
    const pkg = JSON.parse(await fs.promises.readFile(pkgPath, 'utf8'));
    const parsed = parseVersion(pkg.version);
    if (pkg.name !== 'ariax-cli' || !parsed || parsed.prerelease.length) throw new Error('Unexpected source package identity');
    const expected = { version: pkg.version, channel: 'github', source_revision: revision };
    await fs.promises.writeFile(path.join(source, 'build-info.json'), JSON.stringify({ schema_version: 1, ...expected, source_dirty: false }));
    pkg.files = [...new Set([...(pkg.files || []), 'build-info.json'])];
    delete pkg.scripts;
    await fs.promises.writeFile(pkgPath, JSON.stringify(pkg));
    const npm = platform === 'win32' ? 'npm.cmd' : 'npm';
    const options = { env, shell: platform === 'win32' };
    // Relative paths avoid passing temp-directory spaces or shell metacharacters to npm.cmd.
    const packed = await exec(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', '..'], { ...options, cwd: source });
    const artifact = JSON.parse(packed.stdout)[0].filename;
    if (typeof artifact !== 'string' || !/^[\w.+-]+\.tgz$/.test(artifact)) throw new Error('npm returned an invalid package filename');
    const result = await exec(npm, ['install', '--global', `./${artifact}`, '--registry=https://registry.npmjs.org'], { ...options, cwd: temporary });
    if (!quiet && result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return expected;
  } catch (cause) {
    const error = new Error(`Could not install GitHub build ${revision}: ${cause.message}`);
    error.code = 'upgrade_failed';
    error.exitCode = EXIT.SERVER;
    error.cause = cause;
    throw error;
  } finally {
    await fs.promises.rm(temporary, { recursive: true, force: true });
  }
}

export async function verifyInstallation({ version, channel, source_revision, env = process.env, platform = process.platform, exec = execute }) {
  try {
    const npm = platform === 'win32' ? 'npm.cmd' : 'npm';
    const { stdout } = await exec(npm, ['root', '--global'], { env, shell: platform === 'win32' });
    const root = stdout.trim();
    if (!path.isAbsolute(root)) throw new Error('npm returned an invalid global package directory');
    const expectedScript = fs.realpathSync(path.join(root, 'ariax-cli', 'bin', 'ariax.js'));
    const names = platform === 'win32' ? ['ariax.cmd', 'ariax.exe', 'ariax'] : ['ariax'];
    let executable;
    for (const directory of (env.PATH || '').split(path.delimiter)) {
      for (const name of names) {
        const candidate = path.resolve(directory || '.', name);
        try {
          fs.accessSync(candidate, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
          if (fs.statSync(candidate).isFile()) { executable = candidate; break; }
        } catch { /* Search the next PATH entry. */ }
      }
      if (executable) break;
    }
    const expectedExecutable = platform === 'win32'
      ? path.join(path.dirname(root), 'ariax.cmd')
      : expectedScript;
    if (!executable || fs.realpathSync(executable) !== fs.realpathSync(expectedExecutable)) {
      throw new Error(`The installed CLI is ${expectedScript}, but PATH selects ${executable || 'no ariax executable'}. Update PATH or remove the shadowing command, then verify ariax --version --json.`);
    }
    const checked = await exec(process.execPath, [expectedScript, '--version', '--json'], { env });
    const identity = JSON.parse(checked.stdout).data;
    if (identity?.version !== version || identity?.channel !== channel
      || identity?.source_dirty !== false
      || (source_revision && identity?.source_revision !== source_revision)) {
      throw new Error('The installed build identity does not match the selected release');
    }
    return { executable, build: identity };
  } catch (cause) {
    const error = new Error(`Ariax was installed but verification failed: ${cause.message}`);
    error.code = 'upgrade_verification_failed';
    error.exitCode = EXIT.SERVER;
    error.cause = cause;
    throw error;
  }
}
