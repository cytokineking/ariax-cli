import { createInterface } from 'node:readline/promises';

export function createSequencePrompt(ctx) {
  if (typeof ctx.promptSequence === 'function') {
    return { ask: ctx.promptSequence, close: () => {} };
  }
  if (ctx.json || !process.stdin.isTTY || !process.stderr.isTTY) {
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
