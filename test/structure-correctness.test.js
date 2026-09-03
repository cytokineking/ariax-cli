import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { prepareStructureInput } from '../src/structure-input.js';
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/structure-correctness.json', import.meta.url)));

function specFor(protocol, sequence, target = {}) {
  return protocol === 'PXDesign'
    ? {protocol:'pxdesign', chains:'A', sequence_by_chain:{A:sequence}, hotspots_by_chain:{A:[]}, ...target}
    : {protocol:'esmfold2-pipeline', protocol_config:{target:{chains:['A'], sequences:{A:sequence}, hotspots:[], ...target}}};
}

describe('shared browser/CLI structure correctness corpus', () => {
  for (const item of fixtures.cases) for (const protocol of item.protocols) {
    it(`${protocol}: ${item.name}`, async () => {
      const prepare = () => prepareStructureInput({spec:specFor(protocol,item.sequence),text:item.text,targetFilename:`input.${item.format}`});
      if (item.error) await assert.rejects(prepare, new RegExp(item.error, 'i'));
      else await prepare();
    });
  }
  for (const protocol of ['PXDesign','ESMFold2']) {
    it(`${protocol}: hotspot must survive an author-numbered crop`, async () => {
      const item = fixtures.cases[0];
      const target = protocol === 'PXDesign'
        ? {hotspots_by_chain:{A:[101]},crop_by_chain:{A:'102-103'}}
        : {hotspots:['A101'],crop:{A:['102-103']}};
      await assert.rejects(() => prepareStructureInput({spec:specFor(protocol,item.sequence,target),text:item.text,targetFilename:'input.pdb'}), /removed by the crop/);
    });
    it(`${protocol}: valid author offset crop preserves the hotspot`, async () => {
      const item = fixtures.cases[0];
      const target = protocol === 'PXDesign'
        ? {hotspots_by_chain:{A:[102]},crop_by_chain:{A:'102-103'}}
        : {hotspots:['A102'],crop:{A:['102-103']}};
      await prepareStructureInput({spec:specFor(protocol,item.sequence,target),text:item.text,targetFilename:'input.pdb'});
    });
  }
  it('ESMFold2 rejects a crop containing only unresolved residues', async () => {
    const item = fixtures.cases[1];
    await assert.rejects(() => prepareStructureInput({spec:specFor('ESMFold2',item.sequence,{crop:{A:['2']}}),text:item.text,targetFilename:'input.cif'}), /retains no observed/);
  });
});
