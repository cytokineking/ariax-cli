/** Verify the package AND the executable a subsequent shell command will find. */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EXIT } from './exit-codes.js';

const execute = promisify(execFile);

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
