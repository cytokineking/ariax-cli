import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgv, usageError, isUsageError } from '../src/args.js';
import { isUUID } from '../src/uuid.js';

describe('args: usageError marker', () => {
  it('marks usage errors and detects them', () => {
    const err = usageError('bad flag');
    assert.equal(err.code, 'ARIAX_USAGE');
    assert.equal(isUsageError(err), true);
    assert.equal(isUsageError(new Error('x')), false);
    assert.equal(isUsageError(null), false);
    assert.equal(isUsageError('string'), false);
  });
});

describe('args: command and positionals', () => {
  it('parses bare command with no args', () => {
    const p = parseArgv(['me']);
    assert.equal(p.command, 'me');
    assert.deepEqual(p.positionals, []);
    assert.deepEqual(p.flags, {});
  });
  it('returns undefined command for empty argv', () => {
    const p = parseArgv([]);
    assert.equal(p.command, undefined);
    assert.deepEqual(p.positionals, []);
  });
  it('collects extra bare words as positionals', () => {
    const p = parseArgv(['status', 'abc-123']);
    assert.equal(p.command, 'status');
    assert.deepEqual(p.positionals, ['abc-123']);
  });
  it('treats everything after -- as positional', () => {
    const p = parseArgv(['status', '--', '--wait', 'abc']);
    assert.equal(p.command, 'status');
    assert.deepEqual(p.positionals, ['--wait', 'abc']);
    assert.equal(p.flags.wait, undefined);
  });
  it('rejects empty flag name', () => {
    assert.throws(() => parseArgv(['--=x']), /Bad flag/);
  });
});

describe('args: long flags', () => {
  it('parses --flag value', () => {
    assert.equal(parseArgv(['submit', '--name', 'demo']).flags.name, 'demo');
  });
  it('parses --flag=value', () => {
    assert.equal(parseArgv(['submit', '--name=demo']).flags.name, 'demo');
  });
  it('parses boolean flags without values', () => {
    assert.equal(parseArgv(['submit', '--wait']).flags.wait, true);
    assert.equal(parseArgv(['upgrade', '--check']).flags.check, true);
    assert.equal(parseArgv(['upgrade', '--yes']).flags.yes, true);
  });
  it('rejects inline value for boolean flags', () => {
    assert.throws(() => parseArgv(['submit', '--wait=x']), /takes no value/);
  });
  it('retains prototype-shaped names as own flags for command validation', () => {
    const { flags } = parseArgv(['submit', '--__proto__=true', '--constructor=true', '--toString=true']);
    for (const name of ['__proto__', 'constructor', 'toString']) {
      assert.equal(Object.hasOwn(flags, name), true);
      assert.equal(flags[name], 'true');
    }
    assert.equal(Object.getPrototypeOf(flags), Object.prototype);
  });
  it('rejects missing value for value flags', () => {
    assert.throws(() => parseArgv(['submit', '--name']), /requires a value/);
    assert.throws(() => parseArgv(['submit', '--name', '--wait']), /requires a value/);
  });
});

describe('args: global flags', () => {
  it('routes globals before the command', () => {
    const p = parseArgv(['--json', 'me']);
    assert.equal(p.command, 'me');
    assert.equal(p.globals.json, true);
    assert.equal(p.flags.json, undefined);
  });
  it('routes globals after the command', () => {
    assert.equal(parseArgv(['me', '--json']).globals.json, true);
  });
  it('parses base-url, root-dir, timeout as globals', () => {
    const p = parseArgv(['me', '--base-url', 'https://x.example', '--root-dir', '/tmp/r', '--timeout', '5000']);
    assert.equal(p.globals['base-url'], 'https://x.example');
    assert.equal(p.globals['root-dir'], '/tmp/r');
    assert.equal(p.globals.timeout, '5000');
  });
  it('supports --base-url=value form', () => {
    assert.equal(parseArgv(['me', '--base-url=https://x.example']).globals['base-url'], 'https://x.example');
  });
  it('handles json/no-json/help/version', () => {
    assert.equal(parseArgv(['me', '--json']).globals.json, true);
    assert.equal(parseArgv(['me', '--no-json']).globals['no-json'], true);
    assert.equal(parseArgv(['--help']).globals.help, true);
    assert.equal(parseArgv(['me', '--version']).globals.version, true);
    assert.equal(parseArgv(['me', '--allow-custom-origin']).globals['allow-custom-origin'], true);
  });
});

describe('args: short flags', () => {
  it('maps -h to global help', () => {
    assert.equal(parseArgv(['-h']).globals.help, true);
  });
  it('maps -f to file', () => {
    assert.equal(parseArgv(['validate', '-f', 'job.json']).flags.file, 'job.json');
  });
  it('maps -o to output', () => {
    assert.equal(parseArgv(['schema', 'bindcraft', '-o', 'out.json']).flags.output, 'out.json');
  });
  it('rejects removed -y shorthand', () => {
    assert.throws(() => parseArgv(['restart', 'abc', '-y']), /Unknown short flag/);
  });
  it('rejects unknown short flags', () => {
    assert.throws(() => parseArgv(['-z']), /Unknown short flag/);
  });
  it('rejects value flag combined before another flag', () => {
    assert.throws(() => parseArgv(['-fy']), /must be last/);
  });
  it('rejects -f with missing value', () => {
    assert.throws(() => parseArgv(['validate', '-f']), /requires a value/);
  });
});

describe('uuid: isUUID validation', () => {
  const valid = '123e4567-e89b-12d3-a456-426614174000';
  it('accepts canonical lowercase UUIDs', () => {
    assert.equal(isUUID(valid), true);
  });
  it('accepts uppercase UUIDs', () => {
    assert.equal(isUUID(valid.toUpperCase()), true);
  });
  it('trims surrounding whitespace', () => {
    assert.equal(isUUID('  ' + valid + '  '), true);
  });
  it('rejects non-UUID strings', () => {
    assert.equal(isUUID('not-a-uuid'), false);
    assert.equal(isUUID(''), false);
    assert.equal(isUUID('123e4567e89b12d3a456426614174000'), false);
    assert.equal(isUUID('123e4567-e89b-12d3-a456-42661417400'), false);
    assert.equal(isUUID(valid + '0'), false);
    assert.equal(isUUID('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz'), false);
  });
  it('rejects non-strings', () => {
    assert.equal(isUUID(null), false);
    assert.equal(isUUID(undefined), false);
    assert.equal(isUUID(123), false);
    assert.equal(isUUID({}), false);
  });
});
