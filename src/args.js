/**
 * Minimal argument parser (no dependencies).
 *
 * Parses `process.argv.slice(2)` into:
 *   { globalFlags, command, positionals, flags }
 *
 * Global flags (may appear before or after the command):
 *   --json / --no-json, --base-url <url>, --allow-custom-origin, --root-dir <dir>,
 *   --timeout <ms>, -h / --help, --version
 *
 * Everything else is per-command. `--flag value`, `--flag=value`,
 * boolean `--flag`, combined shorts (`-fh file` is NOT supported;
 * use `-f file` / `--file file` separately).
 */

export const GLOBAL_FLAG_NAMES = new Set([
  'json',
  'no-json',
  'base-url',
  'allow-custom-origin',
  'root-dir',
  'timeout',
  'help',
  'version',
]);

const SHORT_TO_LONG = Object.freeze({
  h: 'help',
  f: 'file',
  o: 'output',
});

/** Flags that never take a value (boolean). */
const BOOLEAN_FLAGS = new Set([
  'json',
  'no-json',
  'help',
  'version',
  'wait',
  'resume',
  'overwrite',
  'full',
  'raw',
  'all',
  'eligible',
  'check',
  'yes',
  'with-token',
  'insecure-storage',
  'allow-custom-origin',
  'read',
]);

/**
 * Tokenize one argv array.
 * @param {string[]} argv e.g. process.argv.slice(2)
 * @returns {{ command: string|undefined, positionals: string[], flags: Record<string, string|boolean|undefined>, globals: Record<string, string|boolean|undefined> }}
 */
export function parseArgv(argv) {
  const positionals = [];
  // Keep even prototype-shaped option names so dispatch can reject them.
  const flags = Object.create(null);
  const globals = Object.create(null);
  let command;

  const takeValue = (i, name, raw) => {
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('-')) {
      throw usageError(`Flag --${name} requires a value (got "${raw}").`);
    }
    return next;
  };

  let i = 0;
  while (i < argv.length) {
    const tok = argv[i];
    if (tok === '--') {
      // Everything after `--` is positional.
      for (let j = i + 1; j < argv.length; j++) positionals.push(argv[j]);
      break;
    }
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      let name;
      let inlineValue;
      if (eq !== -1) {
        name = tok.slice(2, eq);
        inlineValue = tok.slice(eq + 1);
      } else {
        name = tok.slice(2);
      }
      if (!name) throw usageError(`Bad flag "${tok}".`);
      const target = GLOBAL_FLAG_NAMES.has(name) ? globals : flags;
      if (BOOLEAN_FLAGS.has(name)) {
        if (inlineValue !== undefined) {
          throw usageError(`Flag --${name} takes no value (got "${tok}").`);
        }
        target[name] = true;
        i += 1;
      } else if (inlineValue !== undefined) {
        target[name] = inlineValue;
        i += 1;
      } else {
        target[name] = takeValue(i, name, tok);
        i += 2;
      }
      continue;
    }
    if (tok.startsWith('-') && tok.length > 1) {
      // Short flags: expand each char. Only the last char may take a value.
      const chars = tok.slice(1).split('');
      for (let k = 0; k < chars.length; k++) {
        const ch = chars[k];
        const long = SHORT_TO_LONG[ch];
        if (!long) throw usageError(`Unknown short flag "-${ch}" in "${tok}".`);
        const isLast = k === chars.length - 1;
        const target = GLOBAL_FLAG_NAMES.has(long) ? globals : flags;
        if (BOOLEAN_FLAGS.has(long)) {
          target[long] = true;
        } else if (!isLast) {
          throw usageError(
            `Flag "-${ch}" requires a value and must be last in "${tok}". Use "-${ch} <value>".`,
          );
        } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
          target[long] = argv[i + 1];
          i += 1;
        } else {
          throw usageError(`Flag "-${ch}" (--${long}) requires a value.`);
        }
      }
      i += 1;
      continue;
    }
    // Bare word.
    if (!command) command = tok;
    else positionals.push(tok);
    i += 1;
  }

  // Allow globals after the command too: promote known names from flags.
  for (const name of [...GLOBAL_FLAG_NAMES]) {
    if (flags[name] !== undefined && globals[name] === undefined) {
      globals[name] = flags[name];
      delete flags[name];
    }
  }
  // `--file`/`-f` may be spelled `--file`; normalize aliases.
  if (flags.file === undefined && flags.f !== undefined) flags.file = flags.f;

  return { command, positionals, flags: { ...flags }, globals: { ...globals } };
}

/**
 * Build a usage-style Error with a stable marker.
 * @param {string} message
 */
export function usageError(message) {
  const err = new Error(message);
  err.code = 'ARIAX_USAGE';
  return err;
}

/** @param {unknown} err */
export function isUsageError(err) {
  return !!err && typeof err === 'object' && err.code === 'ARIAX_USAGE';
}
