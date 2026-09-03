import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isUsageError } from '../src/args.js';
import { collectArtifacts, presignAll, run } from '../src/commands/results.js';

describe('results command contract', () => {
  const projectId = '123e4567-e89b-12d3-a456-426614174000';

  it('follows meta.next_cursor while discovering artifacts', async () => {
    const queries = [];
    const client = {
      get: async (_path, options) => {
        queries.push(options.query);
        return queries.length === 1
          ? { data: [{ path: 'output/a.txt' }], meta: { next_cursor: 'opaque' } }
          : { data: [{ path: 'output/b.txt' }], meta: { next_cursor: null } };
      },
    };
    const out = await collectArtifacts(client, projectId);
    assert.deepEqual(queries.map((query) => query.cursor), [undefined, 'opaque']);
    assert.equal(queries.every((query) => !Object.hasOwn(query, 'path')), true);
    assert.deepEqual(out.map((item) => item.path), ['output/a.txt', 'output/b.txt']);
  });

  it('passes --path on every paginated artifact request', async () => {
    const queries = [];
    const client = {
      get: async (_path, options) => {
        queries.push(options.query);
        return queries.length === 1
          ? { data: [{ path: 'final_designs/a.pdb' }], meta: { next_cursor: 'page-2' } }
          : { data: [{ path: 'final_designs/b.pdb' }], meta: { next_cursor: null } };
      },
    };
    const out = await collectArtifacts(client, projectId, undefined, 'final_designs');
    assert.equal(queries.length, 2);
    assert.deepEqual(queries.map((query) => query.path), ['final_designs', 'final_designs']);
    assert.deepEqual(queries.map((query) => query.cursor), [undefined, 'page-2']);
    assert.deepEqual(out.map((item) => item.path), ['final_designs/a.pdb', 'final_designs/b.pdb']);
  });

  it('rejects an empty --path value', async () => {
    await assert.rejects(
      () => run({
        client: { get: async () => { throw new Error('should not request artifacts'); } },
        flags: { path: '' },
        positionals: [projectId],
        json: true,
      }),
      (err) => isUsageError(err) && /--path requires an artifact prefix/.test(err.message),
    );
  });

  it('chunks presign requests and streams every discovered artifact', async () => {
    const paths = Array.from({ length: 101 }, (_, i) => `output/file-${i}.txt`);
    const presignSizes = [];
    const client = {
      post: async (_path, options) => {
        presignSizes.push(options.body.paths.length);
        return {
          data: options.body.paths.map((artifactPath) => ({
            path: artifactPath,
            url: `https://download.example/${artifactPath}`,
          })),
        };
      },
    };
    const out = await presignAll(client, projectId, paths);
    assert.deepEqual(presignSizes, [100, 1]);
    assert.equal(out.size, 101);
    assert.equal(out.get('output/file-100.txt'), 'https://download.example/output/file-100.txt');
  });
});
