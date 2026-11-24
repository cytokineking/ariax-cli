import { createInterface } from 'node:readline/promises';
import { isNonInteractiveEnv } from './agent-env.js';

export function createSequencePrompt(ctx) {
  if (typeof ctx.promptSequence === 'function') {
    return { ask: ctx.promptSequence, close: () => {} };
  }
  if (ctx.json || ctx.interactive === false || !process.stdin.isTTY || !process.stderr.isTTY
      || isNonInteractiveEnv(ctx.env ?? process.env)) {
    return { ask: undefined, close: () => {} };
  }
  let readline;
  return {
    ask: async ({ chain, protocol, fieldName }) => {
      readline ??= createInterface({ input: process.stdin, output: process.stderr });
      return readline.question(
        `${protocol} cannot reconstruct chain ${chain}. Enter its full 1-letter sequence (${fieldName}.${chain}): `,
      );
    },
    close: () => readline?.close(),
  };
}
