/** Identity embedded in distributed packages; source checkouts identify their commit. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));

export function buildInfo(root = PACKAGE_ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  try {
    const info = JSON.parse(fs.readFileSync(path.join(root, 'build-info.json'), 'utf8'));
    if (info.schema_version !== 1 || info.version !== pkg.version
      || !['github', 'npm'].includes(info.channel)
      || !/^[a-f0-9]{40}$/.test(info.source_revision)
      || typeof info.source_dirty !== 'boolean') throw new Error('Invalid build identity');
    return info;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // Do not mistake an installed package inside someone else's repository for a checkout.
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (fs.realpathSync(git('rev-parse', '--show-toplevel')) === fs.realpathSync(root)) {
      return {
        schema_version: 1, version: pkg.version, channel: 'github',
        source_revision: git('rev-parse', 'HEAD'),
        source_dirty: git('status', '--porcelain').length > 0,
      };
    }
  } catch { /* An older installed package may have no build identity. */ }
  return { schema_version: 1, version: pkg.version, channel: 'unknown', source_revision: null, source_dirty: false };
}

export function formatBuildInfo(info) {
  const revision = info.source_revision ? ` ${info.source_revision}${info.source_dirty ? ' dirty' : ''}` : '';
  return `ariax ${info.version} (${info.channel}${revision})`;
}
