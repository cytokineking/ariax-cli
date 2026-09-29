import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { run } from '../src/commands/results.js';
import { bindcraft2ArchiveDownloadFilename, prepareDestPath } from '../src/download.js';

const remotePath = 'output/archives/bindcraft2-results.tar.gz';
const suffix = '-bindcraft2-results.tar.gz';
const projectId = '123e4567-e89b-12d3-a456-426614174000';
const secondProject = '123e4567-e89b-12d3-a456-426614174001';
const directories = [];
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
function directory() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-archive-name-')));
  directories.push(dir);
  return dir;
}
afterEach(() => directories.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function signedUrl(filename, fallback = 'project' + suffix) {
  const url = new URL('https://storage.example/archive');
  if (filename !== undefined) url.searchParams.set('response-content-disposition',
    `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  return url.href;
}
function fixture(dir, filename, content = 'archive', extra = {}) {
  let fetches = 0;
  const state = { filename, signs: 0 };
  const ctx = {
    client: {
      get: async () => ({ data: [{ path: remotePath, size: Buffer.byteLength(content), sha256: digest(content) }] }),
      post: async (_url, { body }) => {
        state.signs++;
        assert.deepEqual(body.paths, [remotePath]);
        return { data: [{ path: remotePath, url: signedUrl(state.filename) }] };
      },
    },
    flags: { download: dir }, positionals: [projectId], json: true,
    fetchImpl: async () => { fetches++; return new Response(content); },
    ...extra,
  };
  return { ctx, state, fetches: () => fetches };
}
async function quietly(ctx) {
  const output = [];
  const original = process.stdout.write;
  process.stdout.write = function (chunk, ...args) {
    if (typeof chunk === 'string') { output.push(chunk); return true; }
    return original.call(process.stdout, chunk, ...args);
  };
  try { return { result: await run(ctx), output: JSON.parse(output.join('')) }; }
  finally { process.stdout.write = original; }
}

describe('BindCraft2 webapp attachment names', () => {
  it('prefers UTF-8 filename* and validates only a safe bounded archive basename', () => {
    assert.equal(bindcraft2ArchiveDownloadFilename(signedUrl('研究-café' + suffix)), '研究-café' + suffix);
    const ascii = new URL('https://storage.example/archive');
    ascii.searchParams.set('response-content-disposition', 'attachment; filename="Campaign' + suffix + '"');
    assert.equal(bindcraft2ArchiveDownloadFilename(ascii.href), 'Campaign' + suffix);
    assert.equal(bindcraft2ArchiveDownloadFilename(signedUrl(undefined)), undefined);
    assert.equal(bindcraft2ArchiveDownloadFilename(signedUrl('bindcraft2-results.tar.gz')), undefined);
    ascii.searchParams.set('response-content-disposition', 'attachment; filename="bindcraft2-results.tar.gz"');
    assert.equal(bindcraft2ArchiveDownloadFilename(ascii.href), undefined);
    for (const name of ['../escape' + suffix, '/abs' + suffix, 'bad\\name' + suffix, '.hidden' + suffix,
      'bad:drive' + suffix, 'bad\0name' + suffix, 'bad\nname' + suffix, 'bad name' + suffix,
      '-leading' + suffix, 'trailing-' + suffix, 'wrong.zip', 'é'.repeat(81) + suffix]) {
      assert.throws(() => bindcraft2ArchiveDownloadFilename(signedUrl(name)), { name: 'UnsafePathError' });
    }
    assert.equal(bindcraft2ArchiveDownloadFilename(signedUrl('é'.repeat(80) + suffix)), 'é'.repeat(80) + suffix);
    const invalid = new URL('https://storage.example/archive');
    invalid.searchParams.set('response-content-disposition', "attachment; filename*=UTF-8''%FF");
    assert.throws(() => bindcraft2ArchiveDownloadFilename(invalid.href), { name: 'UnsafePathError' });
  });

  it('allows safe Unicode only as the selected archive basename, preserving remote-path validation', () => {
    const dir = directory();
    const filename = '研究' + suffix;
    assert.equal(prepareDestPath(dir, remotePath, { filename }), path.join(dir, 'output/archives', filename));
    assert.throws(() => prepareDestPath(dir, 'output/研究.txt'), { name: 'UnsafePathError' });
    assert.throws(() => prepareDestPath(dir, '../escape', { filename }), { name: 'UnsafePathError' });
    fs.symlinkSync(os.tmpdir(), path.join(dir, 'output/archives/link'));
    assert.throws(() => prepareDestPath(dir, 'output/archives/link/file.txt', { filename }), { name: 'UnsafePathError' });
  });

  it('downloads separate project names into one directory and resumes by remote identity', async () => {
    const dir = directory();
    const first = fixture(dir, 'First' + suffix, 'first');
    const second = fixture(dir, 'Second' + suffix, 'second', { positionals: [secondProject] });
    for (const [item, name, content] of [[first, 'First', 'first'], [second, 'Second', 'second']]) {
      const { result, output } = await quietly(item.ctx);
      const dest = path.join(dir, 'output/archives', name + suffix);
      assert.equal(result.downloaded, 1);
      assert.equal(result.downloads[0].path, remotePath);
      assert.equal(result.downloads[0].dest, dest);
      assert.equal(fs.readFileSync(dest, 'utf8'), content);
      assert.equal(output.data.files[0].dest, dest);
      const rerun = await quietly({ ...item.ctx, flags: { download: dir, overwrite: true } });
      assert.equal(rerun.result.resumed, 1);
      assert.equal(item.fetches(), 1);
      assert.equal(rerun.output.data.files[0].dest, dest);
      assert.equal(rerun.output.data.files[0].status, 'resumed');
      const journal = fs.readFileSync(fs.readdirSync(dir).filter((p) => p.startsWith('.ariax-download-')).map((p) => path.join(dir, p)).find((p) => fs.readFileSync(p, 'utf8').includes(content === 'first' ? projectId : secondProject)), 'utf8');
      assert.ok(journal.includes(remotePath));
      assert.ok(!journal.includes('storage.example'));
    }
  });

  it('keeps existing generic files untouched and reports named destinations when skipped', async () => {
    const dir = directory();
    const generic = prepareDestPath(dir, remotePath);
    fs.writeFileSync(generic, 'legacy');
    const item = fixture(dir, 'Campaign' + suffix);
    const dest = path.join(path.dirname(generic), 'Campaign' + suffix);
    await quietly(item.ctx);
    assert.equal(fs.readFileSync(generic, 'utf8'), 'legacy');
    fs.writeFileSync(dest, 'user local file');
    const { output } = await quietly(item.ctx);
    assert.equal(item.fetches(), 1);
    assert.equal(output.data.files[0].status, 'skipped_existing');
    assert.equal(output.data.files[0].dest, dest);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'user local file');
  });

  it('uses the current project name after rename, and leaves the previous archive intact', async () => {
    const dir = directory();
    const item = fixture(dir, 'Before' + suffix);
    await quietly(item.ctx);
    item.state.filename = 'After' + suffix;
    const { result } = await quietly(item.ctx);
    assert.equal(result.downloaded, 1);
    assert.equal(item.fetches(), 2);
    for (const name of ['Before', 'After']) assert.equal(fs.readFileSync(path.join(dir, 'output/archives', name + suffix), 'utf8'), 'archive');
  });

  it('falls back for older servers and keeps other engine names and loose paths unchanged', async () => {
    const dir = directory();
    const old = fixture(dir, undefined);
    await quietly(old.ctx);
    assert.equal(fs.readFileSync(path.join(dir, remotePath), 'utf8'), 'archive');
    old.state.filename = 'bindcraft2-results.tar.gz';
    const legacy = await quietly(old.ctx);
    assert.equal(legacy.result.resumed, 1);
    assert.equal(old.fetches(), 1);
    const generic = fixture(directory(), 'bindcraft2-results.tar.gz');
    const genericDownload = await quietly(generic.ctx);
    assert.equal(genericDownload.result.downloads[0].dest, path.join(generic.ctx.flags.download, remotePath));
    const other = ['archives/Project-results.tar.gz', 'output/summary.csv'];
    const ctx = {
      ...old.ctx,
      client: {
        get: async () => ({ data: other.map((rel) => ({ path: rel })) }),
        post: async (_url, { body }) => ({ data: body.paths.map((rel) => ({ path: rel, url: signedUrl('Unexpected' + suffix) })) }),
      },
    };
    const { result } = await quietly(ctx);
    assert.deepEqual(result.downloads.map(({ dest }) => path.relative(dir, dest)), other);
  });

  it('rejects unsafe attachment names before storage transfer', async () => {
    const item = fixture(directory(), '../escape' + suffix);
    await assert.rejects(quietly(item.ctx), (error) => error.details.failures[0].code === 'unsafe_artifact_path');
    assert.equal(item.fetches(), 0);
  });

  it('retains the initially selected name if a refreshed URL reflects a project rename', async () => {
    const dir = directory();
    const item = fixture(dir, 'Before' + suffix);
    let fetches = 0;
    item.ctx.fetchImpl = async () => {
      if (++fetches === 1) { item.state.filename = 'After' + suffix; return new Response('expired', { status: 403 }); }
      return new Response('archive');
    };
    const { result } = await quietly(item.ctx);
    assert.equal(result.downloads[0].dest, path.join(dir, 'output/archives/Before' + suffix));
    assert.equal(fs.existsSync(path.join(dir, 'output/archives/After' + suffix)), false);
    assert.equal(fetches, 2);
  });
});
