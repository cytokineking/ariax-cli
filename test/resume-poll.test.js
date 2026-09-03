import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resumePath,
  saveResume,
  loadResume,
  clearResume,
  resumeHint,
  RESUME_VERSION,
} from '../src/resume.js';
import {
  TERMINAL_STATES,
  isTerminalState,
  projectStatusOf,
  waitForProject,
} from '../src/poll.js';
import { ApiError } from '../src/http.js';

const tmpRoots = [];
function mkRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariax-resume-'));
  tmpRoots.push(dir);
  return dir;
}
afterEach(() => {
  while (tmpRoots.length) {
    const d = tmpRoots.pop();
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

describe('resumePath', () => {
  it('lives at <rootDir>/.ariax/resume.json', () => {
    const root = mkRoot();
    assert.equal(resumePath(root), path.join(path.resolve(root), '.ariax', 'resume.json'));
  });
  it('resolves relative roots', () => {
    const p = resumePath('.');
    assert.ok(p.endsWith(path.join('.ariax', 'resume.json')));
    assert.ok(path.isAbsolute(p));
  });
});

describe('saveResume/loadResume/clearResume', () => {
  it('round-trips project and job ids with version and timestamps', async () => {
    const root = mkRoot();
    const file = await saveResume(root, { projectId: 'p-1', jobId: 'j-1' });
    assert.equal(file, resumePath(root));
    const loaded = await loadResume(root);
    assert.equal(loaded.version, RESUME_VERSION);
    assert.equal(loaded.projectId, 'p-1');
    assert.equal(loaded.jobId, 'j-1');
    assert.ok(loaded.createdAt);
    assert.ok(loaded.updatedAt);
  });
  it('preserves createdAt across updates', async () => {
    const root = mkRoot();
    await saveResume(root, { projectId: 'p-1' });
    const first = await loadResume(root);
    await new Promise((r) => setTimeout(r, 5));
    await saveResume(root, { projectId: 'p-2' });
    const second = await loadResume(root);
    assert.equal(first.createdAt, second.createdAt);
    assert.equal(second.projectId, 'p-2');
  });
  it('keeps prior projectId when only jobId is saved', async () => {
    const root = mkRoot();
    await saveResume(root, { projectId: 'p-1', jobId: 'j-1' });
    await saveResume(root, { jobId: 'j-2' });
    const loaded = await loadResume(root);
    assert.equal(loaded.projectId, 'p-1');
    assert.equal(loaded.jobId, 'j-2');
  });
  it('returns null when no resume file exists', async () => {
    assert.equal(await loadResume(mkRoot()), null);
  });
  it('returns null for corrupt JSON instead of throwing', async () => {
    const root = mkRoot();
    const file = resumePath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'not-json{{{');
    assert.equal(await loadResume(root), null);
  });
  it('leaves no temp files behind (atomic write)', async () => {
    const root = mkRoot();
    await saveResume(root, { projectId: 'p-1' });
    const entries = fs.readdirSync(path.join(root, '.ariax'));
    assert.deepEqual(entries, ['resume.json']);
  });
  it('clearResume removes the file and reports removal', async () => {
    const root = mkRoot();
    await saveResume(root, { projectId: 'p-1' });
    assert.equal(await clearResume(root), true);
    assert.equal(await loadResume(root), null);
    assert.equal(await clearResume(root), true);
  });
  it('resume files never contain secrets', async () => {
    const root = mkRoot();
    await saveResume(root, { projectId: 'p-1', jobId: 'j-1' });
    const raw = fs.readFileSync(resumePath(root), 'utf8');
    assert.ok(!raw.toLowerCase().includes('arx_'));
    assert.ok(!raw.toLowerCase().includes('bearer'));
    assert.ok(!raw.toLowerCase().includes('api_key'));
    assert.ok(!raw.toLowerCase().includes('apikey'));
  });
});

describe('resumeHint', () => {
  it('points at the project wait command', () => {
    const msg = resumeHint({ projectId: 'p-123', rootDir: process.cwd() });
    assert.ok(msg.includes('ariax status p-123 --wait'));
    assert.ok(msg.includes('NOT aborted'));
  });
  it('falls back to --resume without a project id', () => {
    const msg = resumeHint({ rootDir: process.cwd() });
    assert.ok(msg.includes('ariax status --resume'));
  });
  it('includes --root-dir for non-cwd roots', () => {
    const msg = resumeHint({ projectId: 'p-1', rootDir: '/tmp/custom' });
    assert.ok(msg.includes('--root-dir /tmp/custom'));
  });
  it('omits --root-dir for the cwd', () => {
    const msg = resumeHint({ projectId: 'p-1', rootDir: process.cwd() });
    assert.ok(!msg.includes('--root-dir'));
  });
});

describe('isTerminalState', () => {
  it('treats completed/failed/paused/aborted as terminal', () => {
    for (const s of ['completed', 'failed', 'paused', 'aborted']) {
      assert.equal(isTerminalState(s), true);
    }
  });
  it('is case-insensitive', () => {
    assert.equal(isTerminalState('Completed'), true);
    assert.equal(isTerminalState('FAILED'), true);
    assert.equal(isTerminalState('Paused'), true);
    assert.equal(isTerminalState('ABORTED'), true);
  });
  it('rejects running and unknown states', () => {
    assert.equal(isTerminalState('running'), false);
    assert.equal(isTerminalState('queued'), false);
    assert.equal(isTerminalState('pending'), false);
    assert.equal(isTerminalState(''), false);
  });
  it('rejects non-strings', () => {
    assert.equal(isTerminalState(undefined), false);
    assert.equal(isTerminalState(null), false);
    assert.equal(isTerminalState(42), false);
  });
  it('TERMINAL_STATES is frozen with four entries', () => {
    assert.deepEqual([...TERMINAL_STATES].sort(), ['aborted', 'completed', 'failed', 'paused']);
    assert.equal(Object.isFrozen(TERMINAL_STATES), true);
  });
});

describe('projectStatusOf', () => {
  it('reads status/state/lifecycle_state', () => {
    assert.equal(projectStatusOf({ status: 'running' }), 'running');
    assert.equal(projectStatusOf({ state: 'paused' }), 'paused');
    assert.equal(projectStatusOf({ lifecycle_state: 'failed' }), 'failed');
  });
  it('reads nested project objects', () => {
    assert.equal(projectStatusOf({ project: { status: 'completed' } }), 'completed');
    assert.equal(projectStatusOf({ project: { state: 'aborted' } }), 'aborted');
  });
  it('returns undefined for missing or non-object payloads', () => {
    assert.equal(projectStatusOf({}), undefined);
    assert.equal(projectStatusOf(null), undefined);
    assert.equal(projectStatusOf('running'), undefined);
  });
});

describe('waitForProject', () => {
  function clientReturning(statuses) {
    let i = 0;
    return {
      calls: 0,
      async get() {
        this.calls += 1;
        const s = statuses[Math.min(i, statuses.length - 1)];
        i += 1;
        return { data: { status: s } };
      },
    };
  }

  it('returns immediately for an already-terminal project', async () => {
    const client = clientReturning(['completed']);
    const sleeps = [];
    const out = await waitForProject(client, 'p-1', {
      pollIntervalMs: 250,
      sleepImpl: async (ms) => { sleeps.push(ms); },
    });
    assert.equal(out.status, 'completed');
    assert.equal(out.timedOut, false);
    assert.equal(out.stopped, false);
    assert.equal(client.calls, 1);
    assert.deepEqual(sleeps, []);
  });

  it('polls until a terminal state', async () => {
    const client = clientReturning(['running', 'running', 'completed']);
    const ticks = [];
    const out = await waitForProject(client, 'p-1', {
      pollIntervalMs: 250,
      maxIntervalMs: 500,
      sleepImpl: async () => {},
      onTick: (t) => { ticks.push(t.status); },
    });
    assert.equal(out.status, 'completed');
    assert.equal(client.calls, 3);
    assert.deepEqual(ticks, ['running', 'running']);
  });

  it('times out and keeps the last status', async () => {
    let now = 1000;
    const client = clientReturning(['running']);
    const out = await waitForProject(client, 'p-1', {
      pollIntervalMs: 250,
      maxIntervalMs: 300,
      timeoutMs: 400,
      sleepImpl: async (ms) => { now += ms; },
      nowImpl: () => now,
    });
    assert.equal(out.timedOut, true);
    assert.equal(out.status, 'running');
  });

  it('stops early when shouldStop fires', async () => {
    const client = clientReturning(['running']);
    const out = await waitForProject(client, 'p-1', {
      pollIntervalMs: 250,
      sleepImpl: async () => {},
      shouldStop: () => true,
    });
    assert.equal(out.stopped, true);
    assert.equal(out.timedOut, false);
  });

  it('honors Retry-After on 429 then continues', async () => {
    let calls = 0;
    const waits = [];
    const client = {
      async get() {
        calls += 1;
        if (calls === 1) throw new ApiError({ status: 429, message: 'slow', retryAfterMs: 1200 });
        return { data: { status: 'completed' } };
      },
    };
    const out = await waitForProject(client, 'p-1', {
      pollIntervalMs: 250,
      maxIntervalMs: 5000,
      sleepImpl: async (ms) => { waits.push(ms); },
    });
    assert.equal(out.status, 'completed');
    assert.deepEqual(waits, [1200]);
  });

  it('caps Retry-After waits at maxIntervalMs', async () => {
    let calls = 0;
    const waits = [];
    const client = {
      async get() {
        calls += 1;
        if (calls === 1) throw new ApiError({ status: 503, message: 'busy', retryAfterMs: 60000 });
        return { data: { status: 'completed' } };
      },
    };
    await waitForProject(client, 'p-1', {
      pollIntervalMs: 250,
      maxIntervalMs: 800,
      sleepImpl: async (ms) => { waits.push(ms); },
    });
    assert.deepEqual(waits, [800]);
  });

  it('rethrows non-retryable errors', async () => {
    const client = {
      async get() {
        throw new ApiError({ status: 404, message: 'gone' });
      },
    };
    await assert.rejects(waitForProject(client, 'p-1', { pollIntervalMs: 250, sleepImpl: async () => {} }), (e) => {
      assert.equal(e.status, 404);
      return true;
    });
  });
});
