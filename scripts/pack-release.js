/** Build a package in temporary staging; never rewrite the source checkout. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildInfo, PACKAGE_ROOT } from '../src/build-info.js';

const args = process.argv.slice(2);
const channel = args[0];
if (!['github', 'npm'].includes(channel) || args.length > 2) {
  throw new Error('Usage: node scripts/pack-release.js github|npm [output-directory]');
}
const output = path.resolve(args[1] || '.');
const info = buildInfo();
if (!info.source_revision || info.source_dirty) {
  throw new Error('Release packages require a clean committed source checkout. Commit changes before packing.');
}
const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'ariax-pack-'));
try {
  const pkg = JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  for (const entry of ['package.json', ...pkg.files.filter((entry) => entry !== 'build-info.json')]) {
    const destination = path.join(staging, entry);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(path.join(PACKAGE_ROOT, entry), destination, { recursive: true });
  }
  await fs.writeFile(path.join(staging, 'build-info.json'), `${JSON.stringify({ ...info, channel }, null, 2)}\n`);
  // The staged package intentionally excludes development scripts and tests.
  delete pkg.scripts;
  await fs.writeFile(path.join(staging, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  await fs.mkdir(output, { recursive: true });
  const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], {
    cwd: staging, encoding: 'utf8', env: { ...process.env, npm_config_cache: path.join(staging, '.npm-cache') },
  }));
  process.stdout.write(`${path.join(output, packed[0].filename)}\n`);
} finally {
  await fs.rm(staging, { recursive: true, force: true });
}
