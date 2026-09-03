import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { pxSequenceMappingError } from '../src/structure-validation.js';
import { prepareStructureInput } from '../src/structure-input.js';
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/pxdesign-mapping.json', import.meta.url)));
for (const item of fixtures.cases) {
  test(item.name, async () => {
    assert.equal(pxSequenceMappingError(item) === null, item.accepted);
    if (item.format !== 'pdb') return;
    const aa = { A: 'ALA', C: 'CYS', D: 'ASP', G: 'GLY' };
    const seqres = item.metadataSequence
      ? `SEQRES   1 A ${String(item.metadataSequence.length).padStart(4)}  ${[...item.metadataSequence].map(a => aa[a]).join(' ')}\n` : '';
    const text = seqres + item.observed.map(({authorResidue, aminoAcid}, i) => (
      `ATOM  ${String(i + 1).padStart(5)}  CA  ${aa[aminoAcid]} A${String(authorResidue).padStart(4)}      10.000  10.000  10.000  1.00 20.00           C`
    )).join('\n') + '\n';
    const spec = {protocol:'pxdesign', chains:'A', sequence_by_chain: item.name.includes('override') ? { A: item.sequence } : undefined};
    if (!item.accepted) {
      await assert.rejects(() => prepareStructureInput({spec,text,targetFilename:'input.pdb'}), /sequence|metadata/);
    } else {
      const result = await prepareStructureInput({spec,text,targetFilename:'input.pdb'});
      assert.equal(result.spec.sequence_by_chain.A, item.sequence);
      assert.equal(result.text, text);
    }
  });
}
