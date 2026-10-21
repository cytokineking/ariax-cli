/** File-level transfer checkpoints. No credentials or signed URLs are persisted. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { declaredSha256, UnsafePathError } from './download.js';

function identity(artifact) {
  const sha256 = declaredSha256(artifact);
  if (sha256) return { sha256 };
  const size = artifact.size ?? artifact.bytes;
  const modified = artifact.lastModified ?? artifact.last_modified;
  // Without a remote content identity, --overwrite must fetch again.
  if (!Number.isSafeInteger(size) || size < 0 || typeof modified !== 'string' || !modified) return null;
  return { size, modified };
}

export function openDownloadState(directory, projectId, origin) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const base = fs.realpathSync(directory);
  const context = JSON.stringify([origin, projectId]);
  const key = crypto.createHash('sha256').update(context).digest('hex');
  const journal = path.join(base, `.ariax-download-${key}.jsonl`);
  if (fs.existsSync(journal) && !fs.lstatSync(journal).isFile()) {
    throw new UnsafePathError('Download checkpoint must be a regular file.');
  }
  const fd = fs.openSync(journal, fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW, 0o600);
  const completed = new Map();
  for (const line of fs.readFileSync(fd, 'utf8').split('\n')) {
    try {
      const record = JSON.parse(line);
      if (record.context === context && typeof record.path === 'string') completed.set(record.path, record);
    } catch { /* An interrupted append can leave a partial last record. */ }
  }
  return {
    path: journal,
    async matches(artifact, destination, signal) {
      const record = completed.get(artifact.path);
      const remote = identity(artifact);
      if (!remote || !record || JSON.stringify(record.remote) !== JSON.stringify(remote)) return false;
      let stat;
      try { stat = fs.lstatSync(destination); } catch { return false; }
      if (!stat.isFile() || stat.size !== record.bytes) return false;
      const hash = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(destination, { signal })) hash.update(chunk);
      return hash.digest('hex') === record.sha256;
    },
    record(artifact, downloaded) {
      const record = {
        context, path: artifact.path, remote: identity(artifact),
        bytes: downloaded.bytes, sha256: downloaded.sha256,
      };
      // A leading newline prevents a killed process's partial record from
      // corrupting the next successful append.
      fs.writeSync(fd, `\n${JSON.stringify(record)}\n`);
      fs.fsyncSync(fd);
      completed.set(record.path, record);
    },
    close() { fs.closeSync(fd); },
  };
}
