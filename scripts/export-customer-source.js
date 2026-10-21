/** Export the customer tree into an independent, single-commit release source. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PACKAGE_ROOT } from '../src/build-info.js';

const target = path.resolve(process.argv[2] || '');
if (!process.argv[2] || target === PACKAGE_ROOT || target.startsWith(PACKAGE_ROOT + path.sep)) {
  throw new Error('Choose a fresh output directory outside the checkout');
}
await fs.mkdir(target);
const files = JSON.parse(execFileSync('git', ['show', 'HEAD:customer-source-files.json'], { cwd: PACKAGE_ROOT, encoding: 'utf8' }));
const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD'], { cwd: PACKAGE_ROOT, encoding: 'utf8' });
const modes = new Map(tree.trim().split('\n').map(line => { const [info, name] = line.split('\t'); return [name, info.split(' ')[0]]; }));
for (const entry of files) {
  if (typeof entry !== 'string' || entry.startsWith('/') || entry.split('/').some(p => !p || p === '..') || !modes.has(entry)) {
    throw new Error('Customer source selection must name committed relative files');
  }
  const destination = path.join(target, entry);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, execFileSync('git', ['show', `HEAD:${entry}`], { cwd: PACKAGE_ROOT, maxBuffer: 100 * 1024 * 1024 }),
    { mode: modes.get(entry) === '100755' ? 0o755 : 0o644 });
}
const git = (...args) => execFileSync('git', args, { cwd: target, encoding: 'utf8' }).trim();
git('init', '--quiet', '--initial-branch=main');
git('add', '--all');
git('-c', 'user.name=Ariax release candidate', '-c', 'user.email=release-candidate@example.invalid',
  'commit', '--quiet', '-m', 'Prepare customer source release');
if (git('rev-list', '--count', 'HEAD') !== '1') throw new Error('Customer export must have a single root commit');
process.stdout.write(JSON.stringify({ directory: target, source_revision: git('rev-parse', 'HEAD') }) + '\n');
