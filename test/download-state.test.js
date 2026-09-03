import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDownloadState } from '../src/download-state.js';

it('recovers file checkpoints without server checksums and ignores an interrupted append', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-state-'));
  const item = { path: 'a.txt', size: 1, lastModified: '2026-09-04T00:00:00Z' };
  const dest = path.join(dir, 'a.txt');
  fs.writeFileSync(dest, 'a');
  const state = openDownloadState(dir, 'project', 'https://www.ariax.bio');
  try {
    state.record(item, { bytes: 1, sha256: crypto.createHash('sha256').update('a').digest('hex') });
  } finally { state.close(); }
  fs.appendFileSync(state.path, '{"incomplete":');
  const resumed = openDownloadState(dir, 'project', 'https://www.ariax.bio');
  try {
    assert.equal(await resumed.matches(item, dest), true);
    assert.equal(await resumed.matches({ ...item, lastModified: '2026-09-05T00:00:00Z' }, dest), false);
    assert.equal(await resumed.matches({ path: item.path }, dest), false);
  } finally { resumed.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

it('refuses symlinked checkpoint files without changing the target', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-state-'));
  const state = openDownloadState(dir, 'project', 'https://www.ariax.bio');
  state.close();
  const target = path.join(dir, 'user.txt');
  fs.writeFileSync(target, 'unchanged');
  fs.rmSync(state.path);
  fs.symlinkSync(target, state.path);
  try {
    assert.throws(() => openDownloadState(dir, 'project', 'https://www.ariax.bio'), /regular file/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'unchanged');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
