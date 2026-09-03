import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  safeDestPath,
  prepareDestPath,
  declaredSha256,
  streamToFile,
  downloadUrl,
  UnsafePathError,
  ChecksumMismatchError,
  OverwriteRefusedError,
} from '../src/download.js';

const tmpRoots = [];
function makeTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-dl-'));
  tmpRoots.push(dir);
  return dir;
}
afterEach(() => {
  while (tmpRoots.length) {
    const d = tmpRoots.pop();
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

describe('safeDestPath: accepts safe relative paths', () => {
  it('resolves simple filenames under destDir', () => {
    const base = makeTmp();
    const dest = safeDestPath(base, 'results.json');
    assert.equal(dest, path.resolve(base, 'results.json'));
  });
  it('resolves nested paths and creates no files', () => {
    const base = makeTmp();
    const dest = safeDestPath(base, 'a/b-c_d+e.f');
    assert.equal(dest, path.resolve(base, 'a', 'b-c_d+e.f'));
  });
});

describe('safeDestPath: rejects unsafe paths', () => {
  it('rejects empty paths', () => {
    assert.throws(() => safeDestPath(makeTmp(), ''), (e) => e instanceof UnsafePathError && e.exitCode === 5);
  });
  it('rejects absolute paths', () => {
    assert.throws(() => safeDestPath(makeTmp(), '/etc/passwd'), UnsafePathError);
  });
  it('rejects parent traversal', () => {
    assert.throws(() => safeDestPath(makeTmp(), '../escape.txt'), UnsafePathError);
    assert.throws(() => safeDestPath(makeTmp(), 'a/../../b.txt'), UnsafePathError);
  });
  it('rejects backslashes', () => {
    assert.throws(() => safeDestPath(makeTmp(), 'a\\b.txt'), UnsafePathError);
  });
  it('rejects NUL bytes', () => {
    assert.throws(() => safeDestPath(makeTmp(), 'a\0b.txt'), UnsafePathError);
  });
  it('rejects dot segments and empty segments', () => {
    assert.throws(() => safeDestPath(makeTmp(), './a.txt'), UnsafePathError);
    assert.throws(() => safeDestPath(makeTmp(), 'a//b.txt'), UnsafePathError);
  });
  it('rejects unsafe filename characters', () => {
    assert.throws(() => safeDestPath(makeTmp(), 'a b.txt'), UnsafePathError);
    assert.throws(() => safeDestPath(makeTmp(), '-lead.txt'), UnsafePathError);
    assert.throws(() => safeDestPath(makeTmp(), '.hidden'), UnsafePathError);
  });
  it('UnsafePathError maps to exit 5', () => {
    try {
      safeDestPath(makeTmp(), '/abs');
      assert.fail('should throw');
    } catch (e) {
      assert.equal(e.exitCode, 5);
    }
  });

  it('rejects a symlinked parent beneath the download root', () => {
    const base = makeTmp();
    const outside = makeTmp();
    fs.symlinkSync(outside, path.join(base, 'linked'));
    assert.throws(() => prepareDestPath(base, 'linked/escape.txt'), UnsafePathError);
  });
});

describe('declaredSha256', () => {
  const hex = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  it('reads sha256 fields and lowercases', () => {
    assert.equal(declaredSha256({ sha256: hex.toUpperCase() }), hex);
    assert.equal(declaredSha256({ sha_256: hex }), hex);
    assert.equal(declaredSha256({ checksum_sha256: hex }), hex);
    assert.equal(declaredSha256({ checksum: hex }), hex);
  });
  it('reads nested checksum objects', () => {
    assert.equal(declaredSha256({ checksum: { sha256: hex } }), hex);
  });
  it('returns null when absent or invalid', () => {
    assert.equal(declaredSha256({}), null);
    assert.equal(declaredSha256(null), null);
    assert.equal(declaredSha256('string'), null);
    assert.equal(declaredSha256({ sha256: 'not-hex' }), null);
    assert.equal(declaredSha256({ sha256: 'abc' }), null);
  });
});

describe('streamToFile: atomic checksummed writes', () => {
  it('writes bytes and returns digest', async () => {
    const dir = makeTmp();
    const dest = path.join(dir, 'out.txt');
    const body = 'hello world';
    const res = new Response(body);
    const out = await streamToFile(res, dest, {});
    assert.equal(out.path, dest);
    assert.equal(out.bytes, Buffer.byteLength(body));
    assert.equal(out.sha256, sha256Hex(body));
    assert.equal(fs.readFileSync(dest, 'utf8'), body);
    assert.equal(fs.statSync(dest).mode & 0o777, 0o600);
    const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.part-'));
    assert.deepEqual(leftovers, []);
  });
  it('verifies a matching expected checksum', async () => {
    const dir = makeTmp();
    const dest = path.join(dir, 'a.bin');
    const body = 'data-123';
    await streamToFile(new Response(body), dest, { expectedSha256: sha256Hex(body) });
    assert.equal(fs.readFileSync(dest, 'utf8'), body);
  });
  it('rejects mismatched checksums and cleans up', async () => {
    const dir = makeTmp();
    const dest = path.join(dir, 'b.bin');
    const wrong = '0'.repeat(64);
    await assert.rejects(streamToFile(new Response('real'), dest, { expectedSha256: wrong }), (e) => {
      assert.equal(e instanceof ChecksumMismatchError, true);
      assert.equal(e.exitCode, 10);
      return true;
    });
    assert.equal(fs.existsSync(dest), false);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.part-')), []);
  });
  it('refuses to overwrite without explicit flag', async () => {
    const dir = makeTmp();
    const dest = path.join(dir, 'c.txt');
    fs.writeFileSync(dest, 'original');
    await assert.rejects(streamToFile(new Response('new'), dest, {}), (e) => {
      assert.equal(e instanceof OverwriteRefusedError, true);
      assert.equal(e.exitCode, 7);
      return true;
    });
    assert.equal(fs.readFileSync(dest, 'utf8'), 'original');
    const out = await streamToFile(new Response('new'), dest, { overwrite: true });
    assert.equal(fs.readFileSync(dest, 'utf8'), 'new');
    assert.equal(out.bytes, 3);
  });
  it('creates parent directories and rejects missing bodies', async () => {
    const dir = makeTmp();
    const dest = path.join(dir, 'sub', 'deep', 'f.txt');
    await streamToFile(new Response('x'), dest, {});
    assert.equal(fs.readFileSync(dest, 'utf8'), 'x');
    await assert.rejects(streamToFile({}, dest, { overwrite: true }), /no body/);
  });
});

describe('downloadUrl', () => {
  it('downloads via fetch and writes the file', async () => {
    const dir = makeTmp();
    const dest = path.join(dir, 'f.txt');
    const body = 'payload';
    const fetchImpl = async () => new Response(body, { status: 200 });
    const out = await downloadUrl(fetchImpl, 'https://cdn.example/f', dest, { expectedSha256: sha256Hex(body) });
    assert.equal(fs.readFileSync(dest, 'utf8'), body);
    assert.equal(out.sha256, sha256Hex(body));
  });
  it('rejects insecure remote download URLs before fetching', async () => {
    const dir = makeTmp();
    let called = false;
    const fetchImpl = async () => { called = true; return new Response('x'); };
    await assert.rejects(downloadUrl(fetchImpl, 'http://cdn.example/f', path.join(dir, 'f.txt')), /HTTPS/);
    assert.equal(called, false);
  });
  it('throws on non-ok responses', async () => {
    const dir = makeTmp();
    const fetchImpl = async () => new Response('gone', { status: 404 });
    await assert.rejects(downloadUrl(fetchImpl, 'https://cdn.example/f', path.join(dir, 'g.txt'), {}), /HTTP 404/);
  });
  it('maps aborts to timeout errors', async () => {
    const dir = makeTmp();
    const err = new Error('aborted');
    err.name = 'AbortError';
    const fetchImpl = async () => { throw err; };
    await assert.rejects(downloadUrl(fetchImpl, 'https://cdn.example/f', path.join(dir, 'h.txt'), {}), (e) => {
      assert.ok(!(e instanceof ChecksumMismatchError));
      return true;
    });
  });
});
