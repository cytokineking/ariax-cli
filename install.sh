#!/bin/sh
set -eu

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo 'Ariax CLI requires Node.js 20 or newer and npm: https://nodejs.org/' >&2
  exit 1
fi
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$node_major" -lt 20 ]; then
  echo "Ariax CLI requires Node.js 20 or newer (found $(node --version))." >&2
  exit 1
fi

# A self-contained bootstrap: registry failures never select a different channel.
node --input-type=module <<'JS'
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const registry = 'https://registry.npmjs.org';
const repository = 'cytokineking/ariax-cli';
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const requestedVersion = process.env.ARIAX_VERSION;
const requestedRevision = process.env.ARIAX_REVISION;
if (requestedVersion && requestedRevision) throw new Error('Choose ARIAX_VERSION or ARIAX_REVISION, not both.');
if (requestedVersion && !stableVersion.test(requestedVersion)) throw new Error('ARIAX_VERSION must be an exact stable version, such as 0.1.0.');
if (requestedRevision && !/^[a-f0-9]{40}$/.test(requestedRevision)) throw new Error('ARIAX_REVISION must be a full lowercase 40-character Git commit SHA.');

async function get(url) {
  return fetch(url, { headers: { accept: 'application/json', 'user-agent': 'ariax-cli-installer' }, signal: AbortSignal.timeout(30_000) });
}
function npm(args, options = {}) {
  return execFileSync('npm', args, { encoding: 'utf8', ...options });
}

let version;
if (!requestedRevision) {
  const response = await get(`${registry}/ariax-cli/${requestedVersion || 'latest'}`);
  if (response.status === 404) {
    if (requestedVersion) throw new Error(`ariax-cli@${requestedVersion} is not published on npm; no other version will be installed.`);
  } else {
    if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}; no fallback installation was attempted.`);
    const release = await response.json();
    if (!stableVersion.test(release.version) || (requestedVersion && release.version !== requestedVersion)) {
      throw new Error('npm registry returned an invalid release version.');
    }
    version = release.version;
  }
}

let expected;
let temporary;
try {
  if (version) {
    console.error(`Installing stable ariax-cli@${version} from npm…`);
    npm(['install', '--global', `ariax-cli@${version}`, `--registry=${registry}`], { stdio: 'inherit' });
    expected = { version, channel: 'npm' };
  } else {
    let revision = requestedRevision;
    if (!revision) {
      const response = await get(`https://api.github.com/repos/${repository}/commits/main`);
      if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}; no installation was attempted.`);
      revision = (await response.json()).sha;
    }
    if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('GitHub returned an invalid source revision.');
    console.error(`Installing GitHub development build ${revision} (npm is ${requestedRevision ? 'not selected' : 'not yet published'})…`);
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ariax-install-'));
    const response = await get(`https://github.com/${repository}/archive/${revision}.tar.gz`);
    if (!response.ok) throw new Error(`GitHub archive returned HTTP ${response.status}.`);
    const archive = path.join(temporary, 'source.tar.gz');
    await fs.writeFile(archive, Buffer.from(await response.arrayBuffer()));
    execFileSync('tar', ['-xzf', archive, '-C', temporary]);
    const source = path.join(temporary, `ariax-cli-${revision}`);
    const pkgPath = path.join(source, 'package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
    if (pkg.name !== 'ariax-cli' || !stableVersion.test(pkg.version)) throw new Error('Unexpected source package identity.');
    expected = { version: pkg.version, channel: 'github', source_revision: revision };
    await fs.writeFile(path.join(source, 'build-info.json'), JSON.stringify({ schema_version: 1, ...expected, source_dirty: false }));
    pkg.files = [...new Set([...(pkg.files || []), 'build-info.json'])];
    delete pkg.scripts;
    await fs.writeFile(pkgPath, JSON.stringify(pkg));
    const packed = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: source }));
    // Install a package, not a symlink to the temporary source directory.
    npm(['install', '--global', path.join(temporary, packed[0].filename), `--registry=${registry}`], { stdio: 'inherit' });
  }
  const root = npm(['root', '--global']).trim();
  const { verifyInstallation } = await import(pathToFileURL(path.join(root, 'ariax-cli/src/installation.js')));
  const installed = await verifyInstallation(expected);
  console.log(`Verified ${installed.executable}`);
  console.log(JSON.stringify(installed.build));
} finally {
  if (temporary) await fs.rm(temporary, { recursive: true, force: true });
}
JS

echo 'Ariax CLI installed. Create an API key at https://www.ariax.bio/settings/api-keys'
echo 'Then run: ariax login'
