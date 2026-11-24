"""Inspect saved Chai structures and confidence without running prediction."""
from __future__ import annotations
import argparse
import csv
import re
import json
from pathlib import Path
import gemmi
import numpy as np


def measure_restraints(chains, path):
    if path is None:
        return []
    results = []
    with path.open() as stream:
        for row in csv.DictReader(stream):
            if row['connection_type'] not in ('contact', 'pocket'):
                continue
            def coordinates(chain_name, position):
                residues = list(chains[chain_name])
                if position:
                    match = re.fullmatch(r'([A-Z])(\d+)', position)
                    if match is None:
                        raise ValueError('Unsupported residue restraint identity')
                    residues = [r for r in residues if r.seqid.num == int(match[2])]
                    if len(residues) != 1 or gemmi.find_tabulated_residue(residues[0].name).one_letter_code.upper() != match[1]:
                        raise ValueError('Saved restraint residue identity differs')
                atoms = [a for r in residues for a in r if a.element.name not in ('H', 'D')]
                if not atoms:
                    raise ValueError('Restraint endpoint has no heavy atoms')
                return np.asarray([[a.pos.x, a.pos.y, a.pos.z] for a in atoms])
            a = coordinates(row['chainA'], row['res_idxA'])
            b = coordinates(row['chainB'], row['res_idxB'])
            distance = float(np.sqrt(((a[:, None, :] - b[None, :, :])**2).sum(axis=2)).min())
            upper = float(row['max_distance_angstrom'])
            results.append({'id': row['restraint_id'], 'type': row['connection_type'],
                'minimum_heavy_atom_distance_angstrom': distance,
                'requested_upper_distance_angstrom': upper,
                'within_requested_upper_distance': distance <= upper,
                'interpretation': 'saved geometry observation; native input conditioning does not guarantee satisfaction'})
    return results


def inspect(directory: Path, expected: dict, restraints: Path | None = None) -> dict:
    files = sorted(directory.glob('pred.model_idx_*.cif'))
    if len(files) != expected.get('samples', 1):
        raise ValueError('Saved structure count differs from the requested samples')
    reports = []
    for path in files:
        structure = gemmi.read_structure(str(path))
        if len(structure) != 1:
            raise ValueError('Expected one model per native mmCIF')
        chains = {chain.name: chain for chain in structure[0]}
        if set(chains) != set(expected['chains']):
            raise ValueError('Native output chain identities differ: '+str(sorted(chains)))
        chain_reports = {}
        for name, specification in expected['chains'].items():
            chain = chains[name]
            residues = list(chain)
            atoms = [a for r in residues for a in r]
            coords = np.asarray([[a.pos.x, a.pos.y, a.pos.z] for a in atoms])
            b = np.asarray([a.b_iso for a in atoms])
            if not atoms or not np.isfinite(coords).all() or not np.isfinite(b).all():
                raise ValueError('Coordinates or atom confidence missing/nonfinite')
            if (b < 0).any() or (b > 100.001).any():
                raise ValueError('Native mmCIF pLDDT is outside 0–100')
            sequence = ''.join(gemmi.find_tabulated_residue(r.name).one_letter_code.upper() for r in residues)
            if specification.get('sequence') is not None and sequence != specification['sequence']:
                raise ValueError('Native polymer sequence differs for '+name+': '+sequence)
            if specification.get('residues') is not None and len(residues) != specification['residues']:
                raise ValueError('Native residue count differs for '+name)
            if len(atoms) < specification.get('min_atoms', 1):
                raise ValueError('Native molecule atoms are missing')
            elements = sorted(set(a.element.name for a in atoms))
            if any(e not in elements for e in specification.get('required_elements', [])):
                raise ValueError('Expected chemical element is missing')
            chain_reports[name] = {'residues': len(residues), 'atoms': len(atoms),
                'sequence': sequence if specification.get('sequence') else None,
                'elements': elements, 'mean_atom_plddt_0_100': float(b.mean())}
        scores_path = directory/path.name.replace('pred.', 'scores.').replace('.cif', '.npz')
        score_report = {}
        with np.load(scores_path, allow_pickle=False) as scores:
            for key in scores.files:
                value = scores[key]
                if key in ('aggregate_score', 'ptm') and not np.isfinite(value).all():
                    raise ValueError('Required ranking confidence is nonfinite: '+key)
                if np.issubdtype(value.dtype, np.number):
                    score_report[key] = {'shape': list(value.shape), 'finite': bool(np.isfinite(value).all())}
        if 'aggregate_score' not in score_report:
            raise ValueError('Native aggregate ranking score is missing')
        distances = []
        for bond in expected.get('bonds', []):
            def select(endpoint):
                name, number, atom = endpoint
                found = [a for r in chains[name] if r.seqid.num == number for a in r if a.name == atom]
                if len(found) != 1:
                    raise ValueError('Bond atom identity is not unique: '+str(endpoint))
                return found[0].pos
            distance = select(bond['a']).dist(select(bond['b']))
            if not bond['min_angstrom'] <= distance <= bond['max_angstrom']:
                raise ValueError('Predicted covalent geometry outside declared range: '+str(distance))
            distances.append({'a': bond['a'], 'b': bond['b'], 'angstrom': distance})
        reports.append({'structure': path.name, 'chains': chain_reports, 'scores': score_report, 'bonds': distances, 'conditioning_distances': measure_restraints(chains, restraints)})
    confidence = directory/'confidence.npz'
    if confidence.exists():
        with np.load(confidence, allow_pickle=False) as arrays:
            pae, pde, plddt = (arrays[k] for k in ('pae', 'pde', 'plddt'))
            if pae.shape != pde.shape or pae.ndim != 3 or pae.shape[1] != pae.shape[2] or plddt.shape != pae.shape[:2]:
                raise ValueError('Native confidence array shapes disagree')
            if pae.shape[0] != len(files) or not all(np.isfinite(x).all() for x in (pae, pde, plddt)):
                raise ValueError('Native confidence arrays have missing/nonfinite samples')
            if (pae < 0).any() or (pde < 0).any() or (plddt < 0).any() or (plddt > 1).any():
                raise ValueError('Native confidence array range differs')
            confidence_report = {'pae_shape': list(pae.shape), 'plddt_shape': list(plddt.shape),
                'mean_plddt_0_1': float(plddt.mean()), 'max_pae_angstrom': float(pae.max())}
    elif expected.get('confidence_arrays', True):
        raise ValueError('Native API confidence arrays missing')
    else:
        confidence_report = {'availability': 'native CLI writes ranking NPZ and atom pLDDT; use predict.py for full arrays'}
    return {'passed': True, 'models': reports, 'confidence': confidence_report}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('directory', type=Path)
    p.add_argument('expected', type=Path)
    p.add_argument('--output', type=Path)
    p.add_argument('--restraints', type=Path)
    args = p.parse_args()
    report = inspect(args.directory, json.loads(args.expected.read_text()), args.restraints)
    encoded = json.dumps(report, indent=2)+'\n'
    if args.output:
        if args.output.exists():
            raise FileExistsError('Saved inspection must use a fresh output path')
        args.output.write_text(encoded)
    print(encoded)

if __name__ == '__main__':
    main()
