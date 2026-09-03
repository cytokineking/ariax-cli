/** Small interactive secret/confirmation prompts used by CLI authentication. */
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';

export async function promptHidden(
  question,
  { input = process.stdin, output = process.stderr } = {},
) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('A terminal is required for hidden input.');
  }
  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const readline = createInterface({ input, output: muted, terminal: true });
  output.write(question);
  try {
    return (await readline.question('')).trim();
  } finally {
    readline.close();
    output.write('\n');
  }
}

export async function promptConfirm(
  question,
  { input = process.stdin, output = process.stderr } = {},
) {
  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question(question);
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

export async function readSecretFromStdin(input = process.stdin, maxBytes = 16_384) {
  if (input.isTTY) {
    throw new Error('--with-token reads from redirected standard input, not an interactive terminal.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > maxBytes) throw new Error('Token input is too large.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}
