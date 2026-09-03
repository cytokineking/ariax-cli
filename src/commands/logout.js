/** ariax logout — remove locally stored API credentials. */
import { usageError } from '../args.js';
import { printData, printJson, printProgress } from '../output.js';

export async function run(ctx) {
  if (ctx.positionals.length > 0) throw usageError('logout: unexpected positional arguments.');
  const unknown = Object.keys(ctx.flags)[0];
  if (unknown) throw usageError('logout: unknown flag --' + unknown + '.');

  const removed = await ctx.credentialStore.remove();
  const environmentOverride = Boolean(ctx.env.ARIAX_API_KEY);
  if (ctx.json) {
    printJson({ data: { removed, environment_override: environmentOverride } });
    return;
  }
  printData('Stored Ariax credentials removed.');
  if (environmentOverride) {
    printProgress('ARIAX_API_KEY is still set and will continue to take precedence.');
  }
}
