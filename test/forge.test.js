import { it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { exerciseForgeCli } from './helpers/forge-http.js';

it('recovers accepted Forge requests after lost responses without duplicate work, and keeps waits, cancellation, and cleanup scoped', async () => {
  await exerciseForgeCli(fileURLToPath(new URL('../bin/ariax.js', import.meta.url)));
});
