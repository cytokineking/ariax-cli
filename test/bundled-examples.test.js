import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { prepareStructureInput } from '../src/structure-input.js';
import { readAndValidateInput } from '../src/input.js';

const root = fileURLToPath(new URL('../agent-skills/examples/', import.meta.url));
const { cases } = JSON.parse(fs.readFileSync(path.join(root, 'cases.json')));
describe('bundled scientific configuration examples', () => {
  for (const entry of cases) it(entry.name, async () => {
    const spec = JSON.parse(fs.readFileSync(path.join(root, entry.job)));
    assert.ok(spec.protocol);
    assert.equal(spec.user_id, undefined);
    if (!entry.input) return;
    const input = readAndValidateInput(path.join(root, entry.input));
    const prepared = await prepareStructureInput({ spec, text: input.text, targetFilename: input.targetFilename });
    const repeated = await prepareStructureInput({ spec: prepared.spec, text: prepared.text, targetFilename: input.targetFilename });
    assert.deepEqual(repeated.spec, prepared.spec);
    assert.equal(repeated.text, prepared.text);
  });
});
