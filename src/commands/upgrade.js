/** Check or update the current channel, or explicitly switch distributions. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

import { usageError } from '../args.js';
import { EXIT } from '../exit-codes.js';
import { printData, printJson, printProgress } from '../output.js';
import { fetchLatestRelease, releaseUpdateAvailable, parseVersion, updateChannel } from '../update-check.js';
import { installGitHub, verifyInstallation } from '../installation.js';

const RELEASES_URL = 'https://github.com/cytokineking/ariax-cli/releases';
const BOOTSTRAP_INSTRUCTION = 'No stable npm release has been published. To select the GitHub development channel, run: ariax upgrade --channel github';

/** @param {{ flags: Record<string, any>, positionals: string[], json: boolean }} ctx */
export async function run(ctx) {
  if (ctx.positionals.length > 0) throw usageError('upgrade: unexpected positional arguments.');
  const unknownFlags = Object.keys(ctx.flags).filter((name) => !['check', 'yes', 'channel'].includes(name));
  if (unknownFlags.length > 0) throw usageError(`upgrade: unknown flag --${unknownFlags[0]}.`);
  if (ctx.flags.check === true && ctx.flags.yes === true) {
    throw usageError('upgrade: --check and --yes cannot be used together.');
  }

  const currentVersion = ctx.currentVersion;
  const currentBuild = ctx.currentBuild ?? { channel: 'npm', source_revision: null };
  const channel = ctx.flags.channel ?? updateChannel(currentBuild.channel);
  if (!['github', 'npm'].includes(channel)) throw usageError('upgrade: --channel must be github or npm.');
  let release;
  try {
    release = await fetchLatestRelease({ channel, fetchImpl: ctx.fetchImpl, timeoutMs: 5_000 });
  } catch (cause) {
    const error = new Error(`Could not check ${channel === 'github' ? 'GitHub' : 'npm'} for the latest Ariax CLI build.`);
    error.code = 'update_check_failed';
    error.exitCode = EXIT.NETWORK;
    error.cause = cause;
    throw error;
  }

  const latestVersion = release.latest_version;
  const updateAvailable = releaseUpdateAvailable({ currentVersion, currentChannel: currentBuild.channel, currentRevision: currentBuild.source_revision, release });
  const status = {
    current_version: currentVersion,
    current_channel: currentBuild.channel,
    current_revision: currentBuild.source_revision,
    latest_version: latestVersion,
    latest_channel: channel,
    latest_revision: release.latest_revision,
    update_available: updateAvailable,
    ...(channel === 'npm' && latestVersion === null ? { status: 'unpublished', instruction: BOOTSTRAP_INSTRUCTION } : {}),
  };

  if (channel === 'npm' && latestVersion === null) {
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
    printData(channel === 'github'
      ? `Source: https://github.com/cytokineking/ariax-cli/commit/${release.latest_revision}`
      : `Release notes: ${RELEASES_URL}/tag/v${latestVersion}`);
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

  let expected;
  if (channel === 'github') {
    printProgress(`Installing Ariax CLI GitHub build ${release.latest_revision} with npm…`);
    expected = await (ctx.installGitHub ?? installGitHub)({ revision: release.latest_revision, quiet: ctx.json, fetchImpl: ctx.fetchImpl });
  } else {
    printProgress(`Installing ariax-cli@${latestVersion} with npm…`);
    await (ctx.installLatest ?? installLatest)({ version: latestVersion, quiet: ctx.json });
    expected = { version: latestVersion, channel: 'npm' };
  }
  const installed = await (ctx.verifyInstallation ?? verifyInstallation)(expected);
  if (ctx.json) {
    printJson({ data: { ...status, updated: true, installed } });
  } else {
    printData(`Updated Ariax CLI: ${currentVersion} (${currentBuild.channel}) → ${expected.version} (${channel}${expected.source_revision ? ` ${expected.source_revision}` : ''})`);
    printData(`Verified executable: ${installed.executable}`);
  }
}

function printStatus(status) {
  printData(`Current version: ${status.current_version} (${status.current_channel}${status.current_revision ? ` ${status.current_revision}` : ''})`);
  printData(status.latest_channel === 'github'
    ? `Latest GitHub main: ${status.latest_revision}`
    : `Latest npm version: ${status.latest_version}`);
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
