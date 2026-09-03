/** ariax login [--with-token] [--insecure-storage] — validate and store an API key. */
import { usageError } from '../args.js';
import { createClient } from '../http.js';
import { looksLikeApiKey } from '../credentials.js';
import { printData, printJson, printProgress } from '../output.js';
import { promptConfirm, promptHidden, readSecretFromStdin } from '../prompt.js';
import { requireTrustedApiOrigin, supportsStoredCredentials } from '../config.js';

export const API_KEYS_URL = 'https://www.ariax.bio/settings/api-keys';

export async function authenticateAndStore(ctx, { automatic = false } = {}) {
  const flags = automatic ? {} : ctx.flags;
  if (!automatic) {
    if (ctx.positionals.length > 0) throw usageError('login: unexpected positional arguments.');
    const allowed = new Set(['with-token', 'insecure-storage']);
    const unknown = Object.keys(flags).find((name) => !allowed.has(name));
    if (unknown) throw usageError('login: unknown flag --' + unknown + '.');
  }
  if (!supportsStoredCredentials(ctx.config.baseUrl)) {
    throw usageError(
      'Stored login is available only for ariax.bio. Use ARIAX_API_KEY for local or custom API origins.',
    );
  }
  requireTrustedApiOrigin(ctx.config);

  let apiKey;
  if (flags['with-token'] === true) {
    try {
      apiKey = await (ctx.readTokenFromStdin ?? readSecretFromStdin)(ctx.input);
    } catch (cause) {
      throw usageError('login: ' + (cause?.message || cause));
    }
  } else {
    if (!ctx.interactive) {
      throw usageError('login: run interactively, or pass a key through stdin with --with-token.');
    }
    printProgress(automatic ? 'Ariax is not connected.' : 'Connect the Ariax CLI.');
    printProgress('Create or copy an API key: ' + API_KEYS_URL);
    try {
      apiKey = await (ctx.promptApiKey ?? promptHidden)(
        'Paste API key (input hidden): ',
        { input: ctx.input, output: ctx.errorOutput },
      );
    } catch (cause) {
      throw usageError('login: ' + (cause?.message || cause));
    }
  }

  if (!looksLikeApiKey(apiKey)) {
    throw usageError('login: expected an Ariax API key beginning with arx_.');
  }

  const client = createClient({
    baseUrl: ctx.config.baseUrl,
    apiKey,
    timeoutMs: ctx.timeoutMs,
    fetchImpl: ctx.fetchImpl,
  });
  const response = await client.get('/api/v1/me');

  let storage = 'session';
  if (await ctx.credentialStore.storeSecure(apiKey)) {
    storage = 'keychain';
  } else {
    let allowFile = flags['insecure-storage'] === true;
    if (!allowFile && ctx.interactive) {
      const confirm = ctx.confirmFileStorage ?? promptConfirm;
      allowFile = await confirm(
        'System credential storage is unavailable. Save the key in '
          + ctx.credentialStore.filePath + ' with user-only permissions? [y/N] ',
        { input: ctx.input, output: ctx.errorOutput },
      );
    }
    if (allowFile) {
      await ctx.credentialStore.storeFile(apiKey);
      storage = 'file';
    } else if (flags['with-token'] === true) {
      throw usageError(
        'login: system credential storage is unavailable; rerun with --insecure-storage '
          + 'to use the user-only credential file.',
      );
    }
  }

  return { apiKey, response, storage };
}

export async function run(ctx) {
  const result = await authenticateAndStore(ctx);
  const actor = result.response.data?.actor ?? {};
  const user = actor.email || actor.user_id || 'Ariax user';
  if (ctx.json) {
    printJson({ data: { authenticated: true, user, storage: result.storage } });
    return;
  }
  printData('Connected as ' + user + '.');
  if (result.storage === 'keychain') {
    printData('API key saved in the system credential store.');
  } else if (result.storage === 'file') {
    printData(
      'API key saved with user-only permissions at ' + ctx.credentialStore.filePath + '.',
    );
  } else {
    printData('API key validated for this command but was not saved.');
  }
}
