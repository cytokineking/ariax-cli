/** `ariax upgrade [--check] [--yes]` — check npm or install the latest stable CLI. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

import { usageError } from '../args.js';
import { EXIT } from '../exit-codes.js';
import { printData, printJson, printProgress } from '../output.js';
import { fetchLatestVersion, isUpdateAvailable, parseVersion } from '../update-check.js';
import { verifyInstallation } from '../installation.js';

const RELEASES_URL = 'https://github.com/cytokineking/ariax-cli/releases';
const BOOTSTRAP_INSTRUCTION = 'No stable npm release has been published. To install a newer development build, rerun the GitHub installer documented at https://github.com/cytokineking/ariax-cli#install (optionally pin ARIAX_REVISION to a full commit SHA).';

/** @param {{ flags: Record<string, any>, positionals: string[], json: boolean }} ctx */
export async function run(ctx) {
  if (ctx.positionals.length > 0) throw usageError('upgrade: unexpected positional arguments.');
  const unknownFlags = Object.keys(ctx.flags).filter((name) => name !== 'check' && name !== 'yes');
  if (unknownFlags.length > 0) throw usageError(`upgrade: unknown flag --${unknownFlags[0]}.`);
  if (ctx.flags.check === true && ctx.flags.yes === true) {
    throw usageError('upgrade: --check and --yes cannot be used together.');
  }

  const currentVersion = ctx.currentVersion;
  const currentBuild = ctx.currentBuild ?? { channel: 'npm', source_revision: null };
  let latestVersion;
  try {
    latestVersion = await fetchLatestVersion({ fetchImpl: ctx.fetchImpl, timeoutMs: 5_000 });
  } catch (cause) {
    const error = new Error('Could not check npm for the latest Ariax CLI version.');
    error.code = 'update_check_failed';
    error.exitCode = EXIT.NETWORK;
    error.cause = cause;
    throw error;
  }

  const updateAvailable = isUpdateAvailable(currentVersion, latestVersion, currentBuild.channel);
  const status = {
    current_version: currentVersion,
    current_channel: currentBuild.channel,
    current_revision: currentBuild.source_revision,
    latest_version: latestVersion,
    update_available: updateAvailable,
    ...(latestVersion === null ? { status: 'unpublished', instruction: BOOTSTRAP_INSTRUCTION } : {}),
  };

  if (latestVersion === null) {
    if (ctx.json) printJson({ data: status });
    else printData(BOOTSTRAP_INSTRUCTION);
    return;
  }

  if (ctx.flags.check === true) {
    if (ctx.json) printJson({ data: status });
    else printStatus(status);
    return;
  }

  if (!updateAvailable) {
    if (ctx.json) printJson({ data: { ...status, updated: false } });
    else printData(`Ariax CLI ${currentVersion} is up to date.`);
    return;
  }

  if (!ctx.json) {
    printStatus(status);
    printData(`Release notes: ${RELEASES_URL}/tag/v${latestVersion}`);
  }

  if (ctx.flags.yes !== true) {
    if (!ctx.interactive) {
      throw usageError('upgrade: confirmation requires a terminal; rerun with --yes to upgrade.');
    }
    const confirmed = await (ctx.confirmUpgrade ?? confirmUpgrade)();
    if (!confirmed) {
      printData('Upgrade cancelled.');
      return;
    }
  }

  printProgress(`Installing ariax-cli@${latestVersion} with npm…`);
  await (ctx.installLatest ?? installLatest)({ version: latestVersion, quiet: ctx.json });
  const installed = await (ctx.verifyInstallation ?? verifyInstallation)({ version: latestVersion, channel: 'npm' });
  if (ctx.json) {
    printJson({ data: { ...status, updated: true, installed } });
  } else {
    printData(`Updated Ariax CLI: ${currentVersion} → ${latestVersion}`);
    printData(`Verified executable: ${installed.executable}`);
  }
}

function printStatus(status) {
  printData(`Current version: ${status.current_version}`);
  printData(`Latest version:  ${status.latest_version}`);
  printData(`Update available: ${status.update_available ? 'yes' : 'no'}`);
}

export async function confirmUpgrade({ input = process.stdin, output = process.stderr } = {}) {
  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question('Upgrade now? [y/N] ');
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

export async function installLatest({ version, quiet = false, spawnImpl = spawn, platform = process.platform } = {}) {
  if (!parseVersion(version) || parseVersion(version).prerelease.length) throw usageError('upgrade: a valid stable release version is required.');
  const executable = platform === 'win32' ? 'npm.cmd' : 'npm';
  await new Promise((resolve, reject) => {
    const child = spawnImpl(executable, ['install', '--global', `ariax-cli@${version}`, '--registry=https://registry.npmjs.org'], {
      shell: platform === 'win32',
      stdio: ['ignore', quiet ? 'ignore' : 'inherit', 'inherit'],
    });
    child.once('error', (cause) => reject(upgradeError(cause)));
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(upgradeError(new Error(`npm exited with status ${code}`)));
    });
  });
}

function upgradeError(cause) {
  const error = new Error(
    'npm could not update Ariax CLI. Run `npm install --global ariax-cli@latest` manually; do not use sudo.',
  );
  error.code = 'upgrade_failed';
  error.exitCode = EXIT.SERVER;
  error.cause = cause;
  return error;
}
