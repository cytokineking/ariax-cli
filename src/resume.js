/**
 * Persistent resume state for `--wait` / `--resume`.
 *
 * State lives beneath `--root-dir` (default: cwd) at:
 *   <rootDir>/.ariax/waits/<project-id>.json for new status waits;
 *   <rootDir>/.ariax/resume.json remains readable for existing installations.
 *
 * Shape: { version, projectId, jobId?, createdAt, updatedAt, ...extra }
 * Atomic writes (temp file + rename). Resume files never contain secrets.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isUUID } from './uuid.js';
import { usageError } from './args.js';

export const RESUME_VERSION = 1;

/** @param {string} rootDir */
export function resumePath(rootDir) {
  return path.join(path.resolve(rootDir), '.ariax', 'resume.json');
}

/**
 * @param {string} rootDir
 * @param {{ projectId?: string, jobId?: string|null }} state
 * @returns {Promise<string>} path written
 */
export async function saveResume(rootDir, state, { separate = false } = {}) {
  if (separate && !isUUID(state.projectId)) throw usageError('Wait state requires a valid project ID.');
  const file = separate ? path.join(path.dirname(resumePath(rootDir)), 'waits', `${state.projectId}.json`) : resumePath(rootDir);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const now = new Date().toISOString();
  let prev = null;
  try {
    prev = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    prev = null;
  }
  const body = {
    version: RESUME_VERSION,
    projectId: state.projectId ?? prev?.projectId,
    jobId: state.jobId !== undefined ? state.jobId : (prev?.jobId ?? null),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(body, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fs.rename(tmp, file);
  return file;
}

/** @param {string} rootDir @returns {Promise<null|{version:number,projectId?:string,jobId?:string|null,createdAt?:string,updatedAt?:string}>} */
export async function loadResume(rootDir) {
  const file = resumePath(rootDir);
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      const waits = path.join(path.dirname(file), 'waits');
      let names;
      try { names = (await fs.readdir(waits)).filter((name) => isUUID(name.slice(0, -5)) && name.endsWith('.json')); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      if (!names.length) return null;
      if (names.length > 1) throw usageError('Several saved waits exist. Use ariax status <project-id> --wait for the desired project.');
      raw = await fs.readFile(path.join(waits, names[0]), 'utf8');
    } else {
      throw err;
    }
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** @param {string} rootDir @returns {Promise<boolean>} true when a file was removed */
export async function clearResume(rootDir, projectId) {
  const file = resumePath(rootDir);
  try {
    if (projectId) {
      if (isUUID(projectId)) await fs.rm(path.join(path.dirname(file), 'waits', `${projectId}.json`), { force: true });
      let legacy;
      try { legacy = JSON.parse(await fs.readFile(file, 'utf8')); } catch { return true; }
      if (legacy.projectId !== projectId) return true;
    }
    await fs.rm(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Human instructions printed when a wait is interrupted so the user can resume.
 * @param {{ projectId?: string, rootDir: string }} opts
 */
export function resumeHint({ projectId, rootDir }) {
  const where = rootDir && rootDir !== process.cwd() ? ` --root-dir ${rootDir}` : '';
  const what = projectId ? `ariax status ${projectId} --wait${where}` : `ariax status --resume${where}`;
  return `Remote work was NOT aborted. Resume with: ${what}`;
}
