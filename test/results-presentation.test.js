import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { presentArtifact, run } from '../src/commands/results.js';
import { main } from '../src/main.js';

const projectId = '123e4567-e89b-12d3-a456-426614174000';
const directories = [];
const digest = (content) => crypto.createHash('sha256').update(content).digest('hex');

function directory() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-results-presentation-'));
  directories.push(value);
  return value;
}

afterEach(() => directories.splice(0).forEach((value) => fs.rmSync(value, { recursive: true, force: true })));

async function capture(fn) {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = '';
  let stderr = '';
  process.stdout.write = function (chunk, ...args) {
    if (typeof chunk === 'string') { stdout += chunk; return true; }
    return stdoutWrite.call(process.stdout, chunk, ...args);
  };
  process.stderr.write = function (chunk, ...args) {
    if (typeof chunk === 'string') { stderr += chunk; return true; }
    return stderrWrite.call(process.stderr, chunk, ...args);
  };
  try { return { value: await fn(), stdout, stderr }; }
  finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

function listingClient(artifacts) {
  return {
    get: async () => ({
      data: artifacts,
      meta: {
        next_cursor: null,
        output_roots: ['output'],
        archive_manifest_url: `/api/v1/projects/${projectId}/artifacts/archive-manifest`,
      },
      requestId: 'results-request-id',
    }),
  };
}

function downloadClient(artifacts) {
  return {
    get: async () => ({ data: artifacts, meta: { next_cursor: null, archive_manifest_url: null }, requestId: 'results-request-id' }),
    post: async (_url, { body }) => ({
      data: body.paths.map((artifactPath) => ({ path: artifactPath, url: `https://storage.example/${artifactPath}` })),
    }),
  };
}

describe('compact results and download presentation', () => {
  it('surfaces recovery action through the top-level CLI JSON error contract', async () => {
    const result = await capture(() => main(['results', projectId, '--json'], {
      ARIAX_API_KEY: 'arx_testcredential', NO_UPDATE_NOTIFIER: '1',
    }, {
      fetchImpl: async () => Response.json({ data: { malformed: true } }),
    }));
    assert.equal(result.value, 10);
    const body = JSON.parse(result.stdout);
    assert.equal(body.error.code, 'results_invalid_response');
    assert.match(body.error.action, /Retry the read-only results command/);
    assert.equal(body.error.details.action, body.error.action);
  });

  it('projects stable roles and preserves unknown sizes', () => {
    assert.deepEqual(presentArtifact({ path: 'output/1_Trajectories/!_Trajectories.csv' }), {
      path: 'output/1_Trajectories/!_Trajectories.csv',
      role: 'trajectory_summary',
      size_bytes: null,
    });
    assert.equal(presentArtifact({ path: 'output/final/design.cif', size: 42 }).role, 'structure');
  });

  it('uses a compact JSON listing by default and preserves the raw listing with --details', async () => {
    const artifacts = [
      { path: 'output/1_Trajectories/!_Trajectories.csv', size: 120, sha256: 'a'.repeat(64), internal_id: 'hidden' },
      { path: 'output/final/design.cif', bytes: 456, sha256: 'b'.repeat(64) },
      { path: 'output/output-manifest.json', size: 90, sha256: 'c'.repeat(64) },
      { path: 'output/provenance.json', size: 30 },
    ];
    const compact = await capture(() => run({ client: listingClient(artifacts), flags: {}, positionals: [projectId], json: true }));
    const compactJson = JSON.parse(compact.stdout);
    assert.deepEqual(compactJson, { data: { artifacts: [
      { path: artifacts[0].path, role: 'trajectory_summary', size_bytes: 120 },
      { path: artifacts[1].path, role: 'structure', size_bytes: 456 },
    ], count: 2 } });
    assert.doesNotMatch(compact.stdout, /sha256|manifest|provenance|request-id|hidden/);

    const details = await capture(() => run({ client: listingClient(artifacts), flags: { details: true }, positionals: [projectId], json: true }));
    const detailsJson = JSON.parse(details.stdout);
    assert.deepEqual(detailsJson.data.artifacts, artifacts);
    assert.equal(detailsJson.request_id, 'results-request-id');
    assert.match(detailsJson.meta.archive_manifest_url, /archive-manifest$/);
  });

  it('keeps human defaults compact while --details restores hashes', async () => {
    const artifacts = [
      { path: 'output/summary.csv', size: 12, sha256: 'a'.repeat(64) },
      { path: 'output/output-manifest.json', size: 20, sha256: 'b'.repeat(64) },
    ];
    const compact = await capture(() => run({ client: listingClient(artifacts), flags: {}, positionals: [projectId], json: false }));
    assert.match(compact.stdout, /summary/);
    assert.doesNotMatch(compact.stdout, /sha256|manifest|aaaaaaaa/);

    const details = await capture(() => run({ client: listingClient(artifacts), flags: { details: true }, positionals: [projectId], json: false }));
    assert.match(details.stdout, /sha256/);
    assert.match(details.stdout, /output-manifest\.json/);
    assert.match(details.stdout, /aaaaaaaaaaaa/);
  });
  it('omits successful verification mechanics while retaining destination, roles and counts', async () => {
    const content = 'design';
    const artifacts = [
      { path: 'output/final/design.pdb', size: Buffer.byteLength(content), sha256: digest(content) },
      { path: 'output/output-manifest.json', size: Buffer.byteLength('manifest') },
    ];
    const outputDir = directory();
    const result = await capture(() => run({
      client: downloadClient(artifacts),
      flags: { download: outputDir, overwrite: true },
      positionals: [projectId],
      json: true,
      fetchImpl: async (url) => new Response(url.includes('design.pdb') ? content : 'manifest'),
    }));
    const json = JSON.parse(result.stdout);
    assert.deepEqual(json.data.counts, { downloaded: 2, resumed: 0, skipped: 0, failed: 0 });
    assert.equal(json.data.destination, path.resolve(outputDir));
    assert.deepEqual(json.data.files.map((file) => [file.path, file.role, file.status]), [
      ['output/final/design.pdb', 'structure', 'downloaded'],
    ]);
    assert.doesNotMatch(result.stdout, /sha256|checkpoint|verification|manifest|request-id/);
    assert.equal(result.stderr, '');
  });

  it('restores download verification and recovery mechanics with --details', async () => {
    const content = 'design';
    const outputDir = directory();
    const result = await capture(() => run({
      client: downloadClient([{ path: 'output/final/design.pdb', size: content.length, sha256: digest(content) }]),
      flags: { download: outputDir, overwrite: true, details: true },
      positionals: [projectId],
      json: true,
      fetchImpl: async () => new Response(content),
    }));
    const json = JSON.parse(result.stdout);
    assert.equal(json.request_id, 'results-request-id');
    assert.equal(json.data.downloaded[0].sha256, digest(content));
    assert.equal(json.data.downloaded[0].checksum_verified, true);
    assert.match(json.data.checkpoint, /\.ariax-download-/);
    assert.equal(json.data.archive_verification, 'not_advertised');
    assert.match(result.stderr, /downloading output\/final\/design\.pdb/);
  });

  it('reports each transient failure with safe resume guidance', async () => {
    const outputDir = directory();
    await assert.rejects(
      () => run({
        client: downloadClient([
          { path: 'output/a.txt', size: 1, sha256: digest('a') },
          { path: 'output/b.txt', size: 1, sha256: digest('b') },
        ]),
        flags: { download: outputDir, overwrite: true },
        positionals: [projectId],
        json: true,
        fetchImpl: async (url) => {
          if (url.endsWith('/b.txt')) throw new Error('connection lost');
          return new Response('a');
        },
      }),
      (error) => {
        assert.equal(error.code, 'artifact_download_failed');
        assert.equal(error.retryable, true);
        assert.equal(error.exitCode, 10);
        assert.deepEqual(error.details.counts, { downloaded: 1, resumed: 0, skipped: 0, failed: 1 });
        assert.deepEqual(error.details.failures, [{
          path: 'output/b.txt',
          exit_code: 10,
          reason: 'The artifact transfer was interrupted.',
          code: 'download_interrupted',
          retryable: true,
          action: 'Rerun the same command; completed files will resume.',
        }]);
        assert.equal(error.details.resumable, true);
        return true;
      },
    );
    assert.equal(fs.readFileSync(path.join(outputDir, 'output/a.txt'), 'utf8'), 'a');
  });

  it('does not advise blind retry after an integrity mismatch', async () => {
    const outputDir = directory();
    await assert.rejects(
      () => run({
        client: downloadClient([{ path: 'output/design.pdb', size: 8, sha256: digest('expected') }]),
        flags: { download: outputDir, overwrite: true },
        positionals: [projectId],
        json: true,
        fetchImpl: async () => new Response('wrong'),
      }),
      (error) => {
        assert.equal(error.exitCode, 10);
        assert.equal(error.retryable, false);
        assert.equal(error.details.failures[0].code, 'artifact_integrity_mismatch');
        assert.match(error.details.failures[0].action, /Do not use.*Contact Ariax support/);
        assert.doesNotMatch(error.details.failures[0].action, /[Rr]erun|[Rr]etry/);
        return true;
      },
    );
    assert.equal(fs.existsSync(path.join(outputDir, 'output/design.pdb')), false);
  });

  it('returns one authorization failure per affected path when presigning is denied', async () => {
    const outputDir = directory();
    const denied = Object.assign(new Error('Project access denied.'), { exitCode: 3, status: 403, code: 'forbidden', retryable: false });
    const client = downloadClient([{ path: 'output/a.txt' }, { path: 'output/b.txt' }]);
    client.post = async () => { throw denied; };
    await assert.rejects(
      () => run({ client, flags: { download: outputDir }, positionals: [projectId], json: true }),
      (error) => {
        assert.equal(error.exitCode, 3);
        assert.equal(error.retryable, false);
        assert.deepEqual(error.details.failures.map((failure) => [failure.path, failure.code, failure.action]), [
          ['output/a.txt', 'download_not_authorized', 'Check authentication and project access, then rerun the same command.'],
          ['output/b.txt', 'download_not_authorized', 'Check authentication and project access, then rerun the same command.'],
        ]);
        return true;
      },
    );
  });
});
