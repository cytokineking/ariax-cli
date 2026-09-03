/** Bounded, credential-free input acquisition. The only remote source is RCSB. */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readAndValidateInput, validateInputBytes, MAX_INPUT_SIZE } from './input.js';
import { EXIT } from './exit-codes.js';
import { usageError } from './args.js';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function failure(message, exitCode, code = 'validation_failed') {
  return Object.assign(new Error(message), { exitCode, code });
}

export async function loadInputSource(flags, fetchImpl, timeoutMs = 30_000, format = 'cif') {
  if ((flags.input !== undefined) === (flags.pdb !== undefined)) throw usageError('Choose exactly one input source: --input FILE or --pdb ID.');
  if (flags.input !== undefined) {
    const input = readAndValidateInput(String(flags.input));
    return { ...input, source: sourceIdentity(input, { kind: 'local', name: path.basename(String(flags.input)) }) };
  }
  const pdbId = String(flags.pdb).toUpperCase();
  if (!/^[1-9][A-Z0-9]{3}$/.test(pdbId)) throw usageError('--pdb requires a four-character RCSB PDB ID, such as 1ABC.');
  if (!['pdb', 'cif'].includes(format)) throw usageError('RCSB format must be pdb or cif.');
  const filename = `${pdbId}.${format}`;
  const url = `https://files.rcsb.org/download/${filename}`;
  const controller = new AbortController();
  const timeoutError = failure('RCSB input download timed out.', EXIT.NETWORK, 'network_error');
  let abortHandler;
  const aborted = new Promise((_, reject) => {
    abortHandler = () => reject(timeoutError);
    controller.signal.addEventListener('abort', abortHandler, { once: true });
  });
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 30_000));
  let reader;
  let response;
  try {
    response = await Promise.race([fetchImpl(url, {
      method: 'GET', redirect: 'error', signal: controller.signal,
      headers: { Accept: format === 'cif' ? 'chemical/x-cif,text/plain' : 'chemical/x-pdb,text/plain' },
    }), aborted]);
    if (response.redirected) throw failure('RCSB input download unexpectedly redirected.', EXIT.NETWORK, 'rcsb_download_failed');
    if (!response.ok) {
      throw failure(`RCSB input download failed (HTTP ${response.status}).`,
        response.status === 404 ? EXIT.NOT_FOUND : EXIT.NETWORK, 'rcsb_download_failed');
    }
    if (Number(response.headers.get('content-length')) > MAX_INPUT_SIZE) {
      throw failure('RCSB structure exceeds the 10 MB limit.', EXIT.VALIDATION);
    }
    if (!response.body?.getReader) throw failure('RCSB returned no readable structure body.', EXIT.NETWORK, 'rcsb_download_failed');
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_INPUT_SIZE) throw failure('RCSB structure exceeds the 10 MB limit.', EXIT.VALIDATION);
      chunks.push(Buffer.from(value));
    }
    const input = validateInputBytes(Buffer.concat(chunks), filename);
    return { ...input, source: sourceIdentity(input, { kind: 'rcsb', name: filename, pdb_id: pdbId }) };
  } catch (error) {
    controller.abort();
    if (reader) Promise.resolve(reader.cancel()).catch(() => {});
    else if (response?.body) Promise.resolve(response.body.cancel()).catch(() => {});
    if (error.exitCode) throw error;
    throw failure('RCSB input download failed or timed out.', EXIT.NETWORK, 'network_error');
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', abortHandler);
  }
}

function sourceIdentity(input, source) {
  return { ...source, format: input.targetFilename === 'input.pdb' ? 'pdb' : 'cif',
    sha256: sha256(input.body), size_bytes: input.body.length };
}
