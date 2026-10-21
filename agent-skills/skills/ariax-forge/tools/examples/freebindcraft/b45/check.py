"""Compare actual B45 native arrays with their saved prealignment PDBs."""
import csv
import json
from pathlib import Path
import sys

import gemmi
import numpy as np
from colabdesign.af.alphafold.common import residue_constants as rc

root = Path(sys.argv[1])
target = gemmi.read_structure('/inputs/freebindcraft/PDL1.pdb')[0]['A']
target_sequence = ''.join(gemmi.find_tabulated_residue(r.name).one_letter_code for r in target)
assert len(target_sequence) == 115
tables = {}
sequences = {}
for name in ['trajectory_stats.csv', 'mpnn_design_stats.csv', 'final_design_stats.csv', 'failure_csv.csv', 'rejected_mpnn_full_stats.csv']:
    path = root / name
    assert path.is_file(), name
    with path.open(newline='') as stream:
        rows = list(csv.DictReader(stream))
    tables[name] = len(rows)
    for row in rows:
        if row.get('Design') and row.get('Sequence') and row['Sequence'] not in ('nan', 'None'):
            sequences[row['Design']] = row['Sequence']

reports = []
array_sequences = {}
arrays = sorted(root.glob('**/NativeArrays/*.native.npz'))
assert arrays, 'No completed native array export'
for archive in arrays:
    metadata = json.loads(archive.with_suffix('.json').read_text())
    structure = gemmi.read_structure(str(archive.with_suffix('.pdb')))
    with np.load(archive, allow_pickle=False) as data:
        values = {k: data[k] for k in data.files}
    for name, info in metadata['arrays'].items():
        assert list(values[name].shape) == info['shape'], (archive, name)
        assert str(values[name].dtype) == info['dtype'], (archive, name)
    xyz, mask, plddt, aatype = [values[k] for k in ['atom_positions', 'atom_mask', 'plddt', 'aatype']]
    assert xyz.shape[-2:] == (37, 3)
    assert len(structure) == xyz.shape[0] == len(metadata['models'])
    assert np.isfinite(plddt).all() and plddt.min() >= 0 and plddt.max() <= 1
    assert np.isfinite(values['pae']).all() and values['pae'].min() >= 0
    assert metadata['atom_axis'] == list(rc.atom_types)
    coordinate_error = confidence_error = 0.0
    atom_count = 0
    binder_sequences = set()
    for m, model in enumerate(structure):
        residues = [(chain.name, residue) for chain in model for residue in chain]
        assert len(residues) == xyz.shape[1] == sum(metadata['native_lengths'])
        axes = [{'chain': chain, 'residue_number': residue.seqid.num, 'insertion_code': residue.seqid.icode.strip(), 'residue_name': residue.name} for chain, residue in residues]
        assert axes == metadata['pdb_residue_axes'][m]
        for i, (_, residue) in enumerate(residues):
            expected_name = rc.restype_1to3[rc.restypes[int(aatype[m, i])]]
            assert residue.name == expected_name
            expected_atoms = {rc.atom_types[a] for a in np.flatnonzero(mask[m, i] >= .5)}
            assert {a.name for a in residue} == expected_atoms
            for atom in residue:
                a = rc.atom_order[atom.name]
                expected = xyz[m, i, a]
                assert np.isfinite(expected).all()
                error = float(np.max(np.abs(np.array([atom.pos.x, atom.pos.y, atom.pos.z]) - expected)))
                confidence = abs(atom.b_iso - 100 * mask[m, i, a] * plddt[m, i])
                assert error <= .000501, (archive, m, i, atom.name, error)
                assert confidence <= .00501, (archive, m, i, atom.name, confidence)
                coordinate_error = max(coordinate_error, error)
                confidence_error = max(confidence_error, confidence)
                atom_count += 1
        chain_sequences = {chain.name: ''.join(gemmi.find_tabulated_residue(r.name).one_letter_code for r in chain) for chain in model}
        if metadata['native_lengths'] == [115, 80]:
            assert chain_sequences['A'] == target_sequence
            assert len(chain_sequences['B']) == 80
            binder_sequences.add(chain_sequences['B'])
        elif metadata['native_lengths'] == [80]:
            assert sum(map(len, chain_sequences.values())) == 80
            binder_sequences.add(''.join(chain_sequences.values()))
        else:
            raise AssertionError(('Unexpected native lengths', metadata['native_lengths']))
    assert len(binder_sequences) == 1
    binder = next(iter(binder_sequences))
    design = metadata['structure'].removesuffix('.pdb')
    if '_model' in design:
        design = design.rsplit('_model', 1)[0]
    if design in sequences:
        assert binder == sequences[design], ('Native CSV/array sequence differs', design)
    array_sequences[design] = binder
    reports.append({'array': str(archive.relative_to(root)), 'models': metadata['models'], 'lengths': metadata['native_lengths'], 'trajectory_seed': metadata['trajectory_seed'], 'atoms_compared': atom_count, 'max_coordinate_error_angstrom': coordinate_error, 'max_plddt_bfactor_error': confidence_error, 'native_iptm_finite': bool(np.isfinite(values['i_ptm']).all()), 'csv_sequence_matched': design in sequences})
fasta_count = 0
for path in sorted(root.glob('**/*.fasta')):
    records = []
    for line in path.read_text().splitlines():
        if line.startswith('>'):
            records.append('')
        elif line.strip():
            assert records, ('FASTA has sequence before header', path)
            records[-1] += line.strip()
    assert len(records) == 1
    assert records[0] == array_sequences[path.stem] == sequences[path.stem]
    fasta_count += 1
structure_count = relaxed_count = 0
for path in sorted(root.glob('**/*.pdb')):
    if path.parent.name == 'NativeArrays':
        continue
    design = path.stem
    if '_model' in design:
        design = design.rsplit('_model', 1)[0]
    assert design in array_sequences, ('Structure lacks its native array', path)
    for model in gemmi.read_structure(str(path)):
        assert ''.join(gemmi.find_tabulated_residue(r.name).one_letter_code for r in model['A']) == target_sequence
        assert ''.join(gemmi.find_tabulated_residue(r.name).one_letter_code for r in model['B']) == array_sequences[design]
    structure_count += 1
    relaxed_count += path.parent.name == 'Relaxed'
assert fasta_count == 1 and relaxed_count == 1
print(json.dumps({'directory': str(root), 'csv_rows': tables, 'native_arrays': reports, 'fasta_sequences_matched': fasta_count, 'structure_sequences_matched': structure_count, 'relaxed_sequences_matched': relaxed_count, 'accepted_count': tables['final_design_stats.csv'], 'scientific_binding_claim': False}, indent=2))
