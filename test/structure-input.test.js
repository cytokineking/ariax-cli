import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { inspectChains } from '../src/input-manifest.js';
import { parseStructureInput, prepareStructureInput } from '../src/structure-input.js';

const NAMES = ['GLY', 'VAL', 'TYR', 'ASP', 'GLY', 'ARG', 'GLU', 'HIS', 'THR', 'VAL'];
// Exact observed polymer sequence from the retained CD47 input; coordinates are
// reduced to one atom per residue so this register regression stays focused.
const CD47_OBSERVED_NAMES = (
  'PCA LEU LEU PHE ASN LYS THR LYS SER VAL GLU PHE THR PHE GLY ASN ASP THR VAL VAL '
  + 'ILE PRO CYS PHE VAL THR ASN MET GLU ALA GLN ASN THR THR GLU VAL TYR VAL LYS TRP '
  + 'LYS PHE LYS GLY ARG ASP ILE TYR THR PHE ASP GLY ALA LEU ASN LYS SER THR VAL PRO '
  + 'THR ASP PHE SER SER ALA LYS ILE GLU VAL SER GLN LEU LEU LYS GLY ASP ALA SER LEU '
  + 'LYS MET ASP LYS SER ASP ALA VAL SER HIS THR GLY ASN TYR THR CYS GLU VAL THR GLU '
  + 'LEU THR ARG GLU GLY GLU THR ILE ILE GLU LEU LYS TYR ARG VAL VAL'
).split(' ');

function pdbChain(chain, residueNumbers, names = NAMES) {
  return residueNumbers.map((residue, index) => (
    `ATOM  ${String(index + 1).padStart(5)}  CA  ${names[index].padEnd(3)} ${chain}${String(residue).padStart(4)}    `
    + '  10.000  10.000  10.000  1.00 20.00           C'
  )).join('\n') + '\n';
}

function cd47PcaPdb() {
  const fullNames = [...CD47_OBSERVED_NAMES, 'SER', 'TRP', 'SER', 'THR', 'ARG',
    'HIS', 'HIS', 'HIS', 'HIS', 'HIS', 'HIS'];
  const seqres = [];
  for (let index = 0; index < fullNames.length; index += 13) {
    seqres.push(
      `SEQRES ${String(seqres.length + 1).padStart(3)} C ${String(fullNames.length).padStart(4)}  `
      + fullNames.slice(index, index + 13).join(' '),
    );
  }
  const coordinates = CD47_OBSERVED_NAMES.map((name, index) => {
    const record = index === 0 ? 'HETATM' : 'ATOM  ';
    return `${record}${String(1801 + index).padStart(5)}  CA  ${name.padEnd(3)} C${String(index + 1).padStart(4)}    `
      + '  10.000  10.000  10.000  1.00 20.00           C';
  });
  return [...seqres, ...coordinates].join('\n') + '\n';
}

function pxSpec(extra = {}) {
  return {
    protocol: 'pxdesign',
    project_type: 'miniprotein',
    chains: 'C',
    hotspots_by_chain: { C: [1, 10] },
    ...extra,
  };
}

describe('structure parsing and protocol preparation', () => {
  it('extracts a missing PXDesign sequence from contiguous coordinates', async () => {
    const text = pdbChain('C', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const parsed = parseStructureInput(text, 'input.pdb');
    assert.equal(parsed.author.C.sequence, 'GVYDGREHTV');
    assert.equal(parsed.author.C.sequenceSource, 'atom_site');

    const prepared = await prepareStructureInput({
      spec: pxSpec(), text, targetFilename: 'input.pdb',
    });
    assert.equal(prepared.spec.sequence_by_chain.C, 'GVYDGREHTV');
    assert.match(prepared.messages[0], /atom_site/);
  });

  it('requires a sequence before any upload when coordinate residues have gaps', async () => {
    const text = pdbChain('C', [1, 3], ['ALA', 'ASP']);
    await assert.rejects(
      () => prepareStructureInput({
        spec: pxSpec({ hotspots_by_chain: { C: [1, 3] } }),
        text,
        targetFilename: 'input.pdb',
      }),
      /cannot be reconstructed safely/,
    );

    await assert.rejects(() => prepareStructureInput({
      spec: pxSpec({ hotspots_by_chain: { C: [1, 3] } }),
      text,
      targetFilename: 'input.pdb',
      promptSequence: async ({ chain }) => {
        assert.equal(chain, 'C');
        return 'ACD';
      },
    }), /cannot preserve the full sequence\/register/);
  });

  it('validates BindCraft hotspots as author residue numbers', async () => {
    const text = pdbChain('A', [101, 102], ['ALA', 'CYS']);
    await assert.rejects(
      () => prepareStructureInput({
        spec: { protocol: 'Bindcraft v1.5', chains: 'A', hotspots: 'A1' },
        text,
        targetFilename: 'input.pdb',
      }),
      /author residues.*A:1/,
    );
    await prepareStructureInput({
      spec: { protocol: 'Bindcraft v1.5', chains: 'A', hotspots: 'A101-102' },
      text,
      targetFilename: 'input.pdb',
    });
  });

  it('validates BoltzGen rules in canonical rather than author numbering', async () => {
    const text = pdbChain('A', [101, 102], ['ALA', 'CYS']);
    const prepared = await prepareStructureInput({
      spec: {
        protocol: 'boltzgen',
        project_type: 'miniprotein',
        chains: 'A',
        binding_rules: [{ id: 'A', binding: '1..2' }],
      },
      text,
      targetFilename: 'input.pdb',
    });
    assert.match(prepared.messages[0], /author residue 101 maps to canonical 1/);

    await assert.rejects(
      () => prepareStructureInput({
        spec: {
          protocol: 'boltzgen',
          project_type: 'miniprotein',
          chains: 'A',
          binding_rules: [{ id: 'A', binding: '101' }],
        },
        text,
        targetFilename: 'input.pdb',
      }),
      /author number.*canonical sequence positions/,
    );
  });

  it('retains N-terminal PCA in the BoltzGen register used by the CD47 input', async () => {
    const text = cd47PcaPdb();
    const binding = '1..2,5,26,28..30,33..36,38,40,45,48,96,98..105';
    const spec = {
      protocol: 'boltzgen', project_type: 'vhh', chains: 'C',
      binding_rules: [{ id: 'C', binding }], num_designs: 1, budget: 1,
    };

    const parsed = parseStructureInput(text, 'input.pdb');
    assert.equal(parsed.canonical.C.residues.length, 116);
    assert.deepEqual(parsed.canonical.C.residues[0], {
      author: 1, register: 1, insertion: '', aminoAcid: 'Q',
    });
    assert.equal(parsed.canonical.C.metadataSequence.length, 127);
    assert.equal(parsed.canonical.C.metadataSequence.slice(0, 3), 'QLL');
    for (const position of [1, 2, 5, 26, 28, 105]) {
      assert.equal(parsed.canonical.C.canonicalToAuthor[position], position);
    }
    const inspection = inspectChains({ text, targetFilename: 'input.pdb' }, { spec, selectedOnly: true });
    assert.equal(inspection.chains[0].mapping_status, 'verified');
    assert.deepEqual(
      inspection.chains[0].residues.slice(0, 2).map((residue) => residue.sequence_position),
      [1, 2],
    );
    assert.deepEqual(inspection.warnings, []);

    const prepared = await prepareStructureInput({ spec, text, targetFilename: 'input.pdb' });
    assert.equal(prepared.text, text);
    assert.equal(prepared.spec.binding_rules[0].binding, binding);
    assert.deepEqual(prepared.messages, []);
  });

  it('does not treat an unrelated HETATM residue as part of a protein register', async () => {
    const text = 'HETATM    1  C1  LIG A   1      10.000  10.000  10.000  1.00 20.00           C\n'
      + pdbChain('A', [2], ['ALA']);
    const parsed = parseStructureInput(text, 'input.pdb');
    assert.deepEqual(parsed.canonical.A.authorResidues, [2]);

    const prepared = await prepareStructureInput({
      spec: { protocol: 'boltzgen', chains: 'A', binding_rules: [{ id: 'A', binding: '1' }] },
      text,
      targetFilename: 'input.pdb',
    });
    assert.match(prepared.messages[0], /author residue 2 maps to canonical 1/);
  });

  it('fills ESMFold2 target sequences and validates author-numbered selectors', async () => {
    const text = pdbChain('C', [1, 2, 3], ['GLY', 'VAL', 'TYR']);
    const prepared = await prepareStructureInput({
      spec: {
        protocol: 'esmfold2-pipeline',
        protocol_config: {
          design_type: 'miniprotein',
          target: { chains: ['C'], hotspots: ['C:1-3'], crop: { C: ['1-3'] } },
        },
      },
      text,
      targetFilename: 'input.pdb',
    });
    assert.equal(prepared.spec.protocol_config.target.sequences.C, 'GVY');

    await assert.rejects(
      () => prepareStructureInput({
        spec: {
          protocol: 'esmfold2-pipeline',
          protocol_config: {
            design_type: 'miniprotein',
            target: { chains: ['C'], hotspots: ['C:4'] },
          },
        },
        text,
        targetFilename: 'input.pdb',
      }),
      /hotspot author residues.*4/,
    );
  });

  it('preserves absolute mmCIF label positions for BoltzGen', async () => {
    const text = [
      'data_target',
      'loop_',
      '_struct_asym.id',
      '_struct_asym.entity_id',
      'L 1',
      '#',
      'loop_',
      '_atom_site.type_symbol',
      '_atom_site.Cartn_x',
      '_atom_site.Cartn_y',
      '_atom_site.Cartn_z',
      '_atom_site.group_PDB',
      '_atom_site.label_comp_id',
      '_atom_site.label_asym_id',
      '_atom_site.label_seq_id',
      '_atom_site.auth_comp_id',
      '_atom_site.auth_asym_id',
      '_atom_site.auth_seq_id',
      '_atom_site.label_entity_id',
      'C 10.0 10.0 10.0 ATOM ALA L 41 ALA C 22 1',
      'C 10.0 10.0 10.0 ATOM CYS L 42 CYS C 23 1',
      '#',
    ].join('\n');
    const parsed = parseStructureInput(text, 'input.cif');
    assert.deepEqual(parsed.canonical.L.canonicalResidues, [41, 42]);
    assert.deepEqual(parsed.author.C.authorResidues, [22, 23]);

    await prepareStructureInput({
      spec: { protocol: 'boltzgen', chains: 'L', binding_rules: [{ id: 'L', binding: '41..42' }] },
      text,
      targetFilename: 'input.cif',
    });
    await assert.rejects(
      () => prepareStructureInput({
        spec: { protocol: 'boltzgen', chains: 'L', binding_rules: [{ id: 'L', binding: '1' }] },
        text,
        targetFilename: 'input.cif',
      }),
      /absent from canonical chain L: 1/,
    );
  });

  it('rejects direct PXDesign mmCIF when author and label identifiers diverge', async () => {
    const text = [
      'data_target',
      'loop_',
      '_struct_asym.id',
      '_struct_asym.entity_id',
      'L 1',
      '#',
      'loop_',
      '_atom_site.type_symbol',
      '_atom_site.Cartn_x',
      '_atom_site.Cartn_y',
      '_atom_site.Cartn_z',
      '_atom_site.group_PDB',
      '_atom_site.label_comp_id',
      '_atom_site.label_asym_id',
      '_atom_site.label_seq_id',
      '_atom_site.auth_comp_id',
      '_atom_site.auth_asym_id',
      '_atom_site.auth_seq_id',
      '_atom_site.label_entity_id',
      'C 10.0 10.0 10.0 ATOM ALA L 1 ALA C 101 1',
      'C 10.0 10.0 10.0 ATOM CYS L 2 CYS C 103 1',
      '#',
    ].join('\n');

    await assert.rejects(
      () => prepareStructureInput({
        spec: pxSpec({ chains: 'C', hotspots_by_chain: { C: [101, 103] } }),
        text,
        targetFilename: 'input.cif',
      }),
      /requires matching label and author identifiers/,
    );
  });

  it('ignores PXDesign mmCIF identifier differences on unselected chains', async () => {
    const text = [
      'data_target',
      'loop_',
      '_struct_asym.id',
      '_struct_asym.entity_id',
      'A 1',
      'C 2',
      '#',
      'loop_',
      '_atom_site.label_atom_id',
      '_atom_site.type_symbol',
      '_atom_site.Cartn_x',
      '_atom_site.Cartn_y',
      '_atom_site.Cartn_z',
      '_atom_site.group_PDB',
      '_atom_site.label_comp_id',
      '_atom_site.label_asym_id',
      '_atom_site.label_seq_id',
      '_atom_site.auth_comp_id',
      '_atom_site.auth_asym_id',
      '_atom_site.auth_seq_id',
      '_atom_site.label_entity_id',
      'CA C 10.0 10.0 10.0 ATOM ASN A 88 ASN A 88 1',
      'CA C 10.0 10.0 10.0 ATOM ALA C 1 ALA C 34 2',
      '#',
    ].join('\n');

    const prepared = await prepareStructureInput({
      spec: pxSpec({
        chains: 'A',
        hotspots_by_chain: { A: [88] },
        sequence_by_chain: { A: 'G'.repeat(87) + 'N' },
      }),
      text,
      targetFilename: 'input.cif',
    });

    assert.deepEqual(prepared.spec.hotspots_by_chain, { A: [88] });
  });

  it('canonicalizes PXDesign chain-scoped fields before submission', async () => {
    const text = pdbChain('C', [1, 2, 3, 4], ['ALA', 'CYS', 'ASP', 'GLU']);
    const prepared = await prepareStructureInput({
      spec: pxSpec({
        chains: ' C ',
        hotspots_by_chain: { C: ['3', '1-2'] },
        crop_by_chain: { C: '1-3,4' },
      }),
      text,
      targetFilename: 'input.pdb',
    });

    assert.equal(prepared.spec.chains, 'C');
    assert.deepEqual(prepared.spec.hotspots_by_chain, { C: [1, 2, 3] });
    assert.deepEqual(prepared.spec.crop_by_chain, { C: ['1-3', '4'] });
  });

  it('repairs missing ESMFold2 author atom IDs only in the upload copy', async () => {
    const text = [
      'data_modelcif',
      'loop_',
      '_atom_site.type_symbol',
      '_atom_site.Cartn_x',
      '_atom_site.Cartn_y',
      '_atom_site.Cartn_z',
      '_atom_site.group_PDB',
      '_atom_site.id',
      '_atom_site.label_atom_id',
      '_atom_site.label_comp_id',
      '_atom_site.label_asym_id',
      '_atom_site.label_entity_id',
      '_atom_site.label_seq_id',
      '_atom_site.auth_comp_id',
      '_atom_site.auth_asym_id',
      '_atom_site.auth_seq_id',
      '_atom_site.pdbx_PDB_ins_code',
      'C 10.0 10.0 10.0 ATOM 1 N ALA A 1 1 ALA C 1 ?',
      "C 10.0 10.0 10.0 ATOM 2 'CA' ALA A 1 1 ALA C 1 ?",
      '#',
    ].join('\n');
    const prepared = await prepareStructureInput({
      spec: {
        protocol: 'esmfold2-pipeline',
        protocol_config: {
          design_type: 'miniprotein',
          target: { chains: ['C'], hotspots: ['C:1'], crop: { C: ['1'] } },
        },
      },
      text,
      targetFilename: 'input.cif',
    });

    assert.doesNotMatch(text, /_atom_site\.auth_atom_id/);
    assert.match(prepared.text, /_atom_site\.auth_atom_id/);
    assert.match(prepared.text, /ATOM 1 N ALA A 1 1 ALA C 1 \? N/);
    assert.match(prepared.text, /ATOM 2 'CA' ALA A 1 1 ALA C 1 \? 'CA'/);
    assert.match(prepared.messages[0], /upload copy.*local file was not changed/);
  });

  it('preserves existing ESMFold2 author atom IDs and compatible CIF bytes', async () => {
    const text = [
      'data_target',
      'loop_',
      '_atom_site.type_symbol',
      '_atom_site.Cartn_x',
      '_atom_site.Cartn_y',
      '_atom_site.Cartn_z',
      '_atom_site.group_PDB',
      '_atom_site.label_atom_id',
      '_atom_site.label_comp_id',
      '_atom_site.label_asym_id',
      '_atom_site.label_entity_id',
      '_atom_site.label_seq_id',
      '_atom_site.auth_atom_id',
      '_atom_site.auth_comp_id',
      '_atom_site.auth_asym_id',
      '_atom_site.auth_seq_id',
      '_atom_site.pdbx_PDB_ins_code',
      'C 10.0 10.0 10.0 ATOM CA ALA A 1 1 C-alpha ALA C 1 ?',
      '#',
    ].join('\n');
    const prepared = await prepareStructureInput({
      spec: {
        protocol: 'esmfold2-pipeline',
        protocol_config: {
          design_type: 'miniprotein',
          target: { chains: ['C'] },
        },
      },
      text,
      targetFilename: 'input.cif',
    });

    assert.equal(prepared.text, text);
    assert.doesNotMatch(prepared.messages.join('\n'), /added missing _atom_site\.auth_atom_id/);
  });

  it('normalizes ESMFold2 author chains together with chain-addressed target fields', async () => {
    const text = [
      'data_target',
      'loop_',
      '_atom_site.type_symbol',
      '_atom_site.Cartn_x',
      '_atom_site.Cartn_y',
      '_atom_site.Cartn_z',
      '_atom_site.group_PDB',
      '_atom_site.label_atom_id',
      '_atom_site.label_comp_id',
      '_atom_site.label_asym_id',
      '_atom_site.label_entity_id',
      '_atom_site.label_seq_id',
      '_atom_site.auth_atom_id',
      '_atom_site.auth_comp_id',
      '_atom_site.auth_asym_id',
      '_atom_site.auth_seq_id',
      '_atom_site.pdbx_PDB_ins_code',
      'C 10.0 10.0 10.0 ATOM N ALA X 1 1 N ALA AAA 1 ?',
      '#',
    ].join('\n');
    const prepared = await prepareStructureInput({
      spec: {
        protocol: 'esmfold2-pipeline',
        protocol_config: {
          design_type: 'miniprotein',
          target: {
            chains: ['AAA'],
            hotspots: ['AAA:1'],
            crop: { AAA: ['1'] },
            sequences: { AAA: 'A' },
          },
        },
      },
      text,
      targetFilename: 'input.cif',
    });

    assert.match(prepared.text, /ATOM N ALA X 1 1 N ALA A 1 \?/);
    assert.deepEqual(prepared.spec.protocol_config.target, {
      chains: ['A'],
      hotspots: ['A:1'],
      crop: { A: ['1'] },
      sequences: { A: 'A' },
    });
    assert.match(prepared.messages.join('\n'), /AAA -> A/);
  });

  it('rejects ESMFold2 atom IDs that cannot be reconstructed safely', async () => {
    const text = [
      'data_target',
      'loop_',
      '_atom_site.type_symbol',
      '_atom_site.Cartn_x',
      '_atom_site.Cartn_y',
      '_atom_site.Cartn_z',
      '_atom_site.group_PDB',
      '_atom_site.label_comp_id',
      '_atom_site.label_asym_id',
      '_atom_site.label_entity_id',
      '_atom_site.label_seq_id',
      '_atom_site.auth_comp_id',
      '_atom_site.auth_asym_id',
      '_atom_site.auth_seq_id',
      '_atom_site.pdbx_PDB_ins_code',
      'C 10.0 10.0 10.0 ATOM ALA A 1 1 ALA C 1 ?',
      '#',
    ].join('\n');

    await assert.rejects(
      () => prepareStructureInput({
        spec: {
          protocol: 'esmfold2-pipeline',
          protocol_config: { design_type: 'miniprotein', target: { chains: ['C'] } },
        },
        text,
        targetFilename: 'input.cif',
      }),
      /auth_atom_id cannot be reconstructed safely/,
    );
  });

  it('rejects other atom-site fields required by the deployed ESMFold2 reader', async () => {
    const text = [
      'data_target',
      'loop_',
      '_atom_site.type_symbol',
      '_atom_site.Cartn_x',
      '_atom_site.Cartn_y',
      '_atom_site.Cartn_z',
      '_atom_site.group_PDB',
      '_atom_site.label_atom_id',
      '_atom_site.label_comp_id',
      '_atom_site.label_asym_id',
      '_atom_site.label_seq_id',
      '_atom_site.auth_atom_id',
      '_atom_site.auth_comp_id',
      '_atom_site.auth_asym_id',
      '_atom_site.auth_seq_id',
      '_atom_site.pdbx_PDB_ins_code',
      'C 10.0 10.0 10.0 ATOM N ALA A 1 N ALA C 1 ?',
      '#',
    ].join('\n');

    await assert.rejects(
      () => prepareStructureInput({
        spec: {
          protocol: 'esmfold2-pipeline',
          protocol_config: { design_type: 'miniprotein', target: { chains: ['C'] } },
        },
        text,
        targetFilename: 'input.cif',
      }),
      /label_entity_id/,
    );
  });
});


describe('CIF text-field tokenization', () => {
  const text = readFileSync(new URL('./fixtures/multiline.cif', import.meta.url), 'utf8');
  const prepare = value => prepareStructureInput({
    spec: { protocol: 'esmfold2-pipeline', protocol_config: {
      target: { source: 'upload', chains: ['A'], hotspots: ['A:1'] },
    } }, text: value, targetFilename: 'input.cif',
  });
  it('preserves multiline metadata, inline comments and embedded quote characters', async () => {
    const parsed = parseStructureInput(text, 'input.cif', true);
    assert.equal(parsed.cif.parsed.loops.some(loop => loop.incompleteTokenCount), false);
    const result = await prepare(text);
    assert.equal(result.spec.protocol_config.target.sequences.A, 'A');
    assert.ok(result.text.includes(';Text with multiple words\nloop_\n_not_a_header\n;'));
  });
  it('ignores apparent loops inside scalar text fields and rejects unterminated fields', async () => {
    const scalar = '_struct.title\n;Explanatory text\nloop_\n_note.first\n_note.second\none\n;\n';
    const source = text.replace('data_multiline_regression\n', `data_multiline_regression\n${scalar}`);
    const parsed = parseStructureInput(source, 'input.cif', true);
    assert.equal(parsed.cif.parsed.loops.length, 4);
    assert.ok((await prepare(source)).text.includes(scalar));
    await assert.rejects(() => prepare(`${text}\n_struct.title\n;unterminated metadata`), /unterminated semicolon/);
  });
  it('treats comments between headers and atom rows as whitespace during repairs', async () => {
    const first = 'ATOM 1 C CA ALA A 1 1 ? 0 0 0 1 ALA A CA';
    const second = 'ATOM 2 N N ALA A 1 1 ? 1 0 0 1 ALA A N';
    const source = text.replace('_atom_site.auth_atom_id\n', '')
      .replace('_atom_site.id\n', '_atom_site.id\n# header comment\n')
      .replace(first, `${first.slice(0, -3)}\n# comment within a loop\n${second.slice(0, -2)}`);
    const result = await prepare(source);
    assert.equal(parseStructureInput(result.text, 'input.cif', true).atoms.length, 2);
    assert.ok(result.text.includes(second), 'the row after the comment must also receive auth_atom_id');
    await assert.rejects(() => prepare(source.replace(second.slice(0, -2), 'ATOM 2 N')), /incomplete/);
  });
  it('still rejects incomplete rows and unterminated text or quoted values', async () => {
    await assert.rejects(() => prepare(text.replace('1 1 ALA\n', '1 1\n')), /incomplete/);
    await assert.rejects(() => prepare(text.slice(0, text.indexOf(';A\n;') + 3)), /unterminated semicolon/);
    await assert.rejects(() => prepare(text.replace("'polypeptide(L)'", "'polypeptide(L)")), /unterminated quoted/);
  });
});
