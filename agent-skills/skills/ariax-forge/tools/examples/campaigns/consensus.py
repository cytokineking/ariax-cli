"""Consume explicit native outputs into campaign review shortlists; no inference."""
from __future__ import annotations
import argparse
import csv
import json
import math
from pathlib import Path
import gemmi
import numpy as np

PATHS = {'minibinder', 'antibody', 'states', 'ligand-motif', 'nucleic-acid'}
KINDS = {'protein', 'rna', 'dna'}
FAMILIES = {'boltzgen': 'boltz', 'boltz2': 'boltz', 'boltz2-accelerated': 'boltz',
            'rf3': 'rf3', 'rf3_preprint_124': 'rf3', 'rf3_preprint_921': 'rf3',
            'protenix': 'protenix', 'abodybuilder2': 'immunebuilder',
            'igdesign': 'igdesign-igmpnn', 'igmpnn': 'igdesign-igmpnn',
            'proteina-complexa': 'proteina', 'genie3': 'genie3'}

def read_json(path):
    return json.loads(path.read_text())

def resolve(root, relative):
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        raise ValueError('Output references must be relative to the restored campaign root')
    path = (root / relative).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError('Output reference must name a regular file inside the campaign root')
    return path

def field(root, spec):
    path = resolve(root, spec['file'])
    if spec.get('format', 'json') == 'csv':
        rows = list(csv.DictReader(path.open()))
        key, ident = spec['match'].items().__iter__().__next__()
        matches = [r for r in rows if r.get(key) == ident]
        if len(matches) != 1:
            raise ValueError('Native CSV candidate must match exactly one row')
        value = matches[0][spec['column']]
    else:
        value = read_json(path)
        for key in spec.get('keys', []):
            value = value[key]
    # Preserve native values and units; CSV strings stay strings.
    return {'value': value, 'units': spec['units'], 'direction': spec['direction'],
            'source': spec['file'], 'keys': spec.get('keys'), 'column': spec.get('column')}

def structure(root, observation, chains, chemicals):
    model = gemmi.read_structure(str(resolve(root, observation['structure'])))[0]
    available = {chain.name: chain for chain in model}
    mappings = observation['chains']
    if set(mappings) != set(chains):
        raise ValueError('Every molecular chain role requires an explicit native chain mapping')
    coordinates = {}
    residue_map = []
    for role, expected in chains.items():
        kind = expected['kind']
        if kind not in KINDS:
            raise ValueError('Unsupported molecular modality: ' + kind)
        chain = available[mappings[role]]
        residues = []
        for residue in chain:
            if kind == 'protein' and gemmi.find_tabulated_residue(residue.name).is_amino_acid():
                letter = gemmi.find_tabulated_residue(residue.name).one_letter_code.upper()
            elif kind in ('dna', 'rna') and residue.name in ('A', 'C', 'G', 'U', 'DA', 'DC', 'DG', 'DT'):
                letter = residue.name.removeprefix('D')
            else:
                continue
            residues.append((residue, letter))
        sequence = ''.join(letter for _, letter in residues)
        if sequence != expected['sequence']:
            raise ValueError('Native output sequence differs for chain role ' + role)
        for i, (residue, letter) in enumerate(residues):
            for atom in residue:
                if not all(math.isfinite(v) for v in (atom.pos.x, atom.pos.y, atom.pos.z)):
                    raise ValueError('Native structure has nonfinite coordinates')
            name = 'CA' if kind == 'protein' else 'P'
            atoms = [a for a in residue if a.name == name and a.altloc in ('\x00', 'A')]
            if len(atoms) == 1:
                coordinates[(role, i)] = [atoms[0].pos.x, atoms[0].pos.y, atoms[0].pos.z]
            residue_map.append({'role': role, 'native_chain': chain.name, 'sequence_position': i + 1,
                                'author_number': residue.seqid.num, 'insertion': residue.seqid.icode.strip(),
                                'residue': letter})
    chemical_atoms = {}
    for role, expected in chemicals.items():
        native_chain = observation['chemical_chains'][role]
        chain = available[native_chain]
        atoms = [{'name': a.name, 'element': a.element.name, 'residue': r.name,
                  'author_number': r.seqid.num, 'chain': chain.name,
                  'xyz_angstrom': [a.pos.x, a.pos.y, a.pos.z]}
                 for r in chain for a in r if a.element.name not in ('H', 'D')]
        counts = {}
        for atom in atoms:
            counts[atom['element']] = counts.get(atom['element'], 0) + 1
            if not all(math.isfinite(v) for v in atom['xyz_angstrom']):
                raise ValueError('Native chemical coordinates must be finite')
        if counts != expected['heavy_element_counts']:
            raise ValueError('Native chemical heavy-atom identity differs for ' + role)
        chemical_atoms[role] = atoms
    return coordinates, residue_map, chemical_atoms

def fit(a, b, alignment_role=None):
    keys = sorted(set(a) & set(b))
    fitting = [k for k in keys if alignment_role is None or k[0] == alignment_role]
    if len(fitting) < 3:
        return {'rmsd_angstrom': None, 'matched_atoms': len(keys), 'reason': 'fewer_than_three_fitting_atoms'}
    x, y = np.array([a[k] for k in fitting]), np.array([b[k] for k in fitting])
    center_x, center_y = x.mean(0), y.mean(0)
    u, _, vt = np.linalg.svd((x - center_x).T @ (y - center_y))
    signs = np.eye(3); signs[2, 2] = -1 if np.linalg.det(u @ vt) < 0 else 1
    rotation = u @ signs @ vt
    translation = center_y - center_x @ rotation
    delta = np.array([a[k] for k in keys]) @ rotation + translation - np.array([b[k] for k in keys])
    roles = {role: float(np.sqrt(np.mean(np.sum(delta[[i for i,k in enumerate(keys) if k[0] == role]] ** 2, axis=1)))) for role in sorted({k[0] for k in keys})}
    return {'rmsd_angstrom': float(np.sqrt(np.mean(np.sum(delta * delta, axis=1)))),
            'matched_atoms': len(keys), 'fitting_atoms': len(fitting), 'alignment_role': alignment_role,
            'per_role_rmsd_angstrom': roles, 'unmatched_atoms': [len(a) - len(keys), len(b) - len(keys)],
            'rotation': rotation.tolist(), 'translation_angstrom': translation.tolist(),
            'atoms': 'C-alpha for protein; phosphate P for nucleic acid'}


def consume(root, manifest, out):
    if out.exists():
        raise ValueError('Use a fresh shortlist output directory')
    candidates = manifest['candidates']
    if not candidates or {c['path'] for c in candidates} != PATHS:
        raise ValueError('All five required campaign paths must be present')
    seen = set(); reports = []
    for candidate in candidates:
        ident = (candidate['path'], candidate['id'])
        if ident in seen:
            raise ValueError('Ambiguous campaign candidate identity')
        seen.add(ident)
        if sum(c['path'] == candidate['path'] for c in candidates) > 2:
            raise ValueError('Campaign path exceeds its two-candidate bound')
        states = candidate['states']
        if candidate['path'] == 'states' and set(states) != {'positive', 'negative'}:
            raise ValueError('Positive and negative state identities must remain separate')
        row = {'path': candidate['path'], 'id': candidate['id'], 'native_decision': candidate['native_decision'],
               'review_selection': True, 'accepted_for_experiment': False,
               'generation': candidate['generation'], 'states': {}}
        for state_id, state in states.items():
            if not state['identity']:
                raise ValueError('Missing molecular state identity')
            observations = []; poses = []; chemical_poses = []
            for observation in state['observations']:
                family = FAMILIES.get(observation['model_family'])
                if family is None:
                    raise ValueError('Unsupported model family: ' + observation['model_family'])
                # The retained run record supplies command, source/model, seed/settings and hardware.
                provenance = read_json(resolve(root, observation['run_record']))
                if not all(k in provenance for k in ('command_id', 'sources', 'model', 'settings', 'hardware')):
                    raise ValueError('Incomplete native command provenance')
                model = provenance['model'].lower()
                native_family = next((group for prefix, group in [('boltzgen','boltz'), ('boltz2','boltz'), ('rf3','rf3'), ('protenix','protenix'), ('abodybuilder2','immunebuilder'), ('igdesign','igdesign-igmpnn'), ('igmpnn','igdesign-igmpnn'), ('complexa','proteina'), ('genie3','genie3')] if model.startswith(prefix)), None)
                if native_family != family:
                    raise ValueError('Declared family differs from the retained native model identity')
                scores = {name: field(root, spec) for name, spec in observation['scores'].items()}
                pose, mapping, chemical_atoms = structure(root, observation, state['chains'], state.get('chemicals', {}))
                item = {'family': family, 'model_family': observation['model_family'], 'task': observation['task'],
                        'native_rank': observation.get('native_rank'), 'native_rank_context': observation.get('native_rank_context', 'Unavailable native ranking context'), 'scores': scores,
                        'structure': observation['structure'], 'residue_map': mapping, 'chemical_atoms': chemical_atoms, 'run_record': provenance}
                observations.append(item); poses.append(pose); chemical_poses.append(chemical_atoms)
            comparisons = []
            for i, a in enumerate(observations):
                for j in range(i + 1, len(observations)):
                    b = observations[j]
                    if a['family'] == b['family'] or a['task'] != b['task']:
                        continue
                    comparison = {'families': [a['family'], b['family']], 'task': a['task'], **fit(poses[i], poses[j], state.get('alignment_role'))}
                    if comparison['rmsd_angstrom'] is not None:
                        rotation = np.array(comparison['rotation']); translation = np.array(comparison['translation_angstrom'])
                        chemical_distances = {}
                        for role in sorted(set(chemical_poses[i]) & set(chemical_poses[j])):
                            ca = np.mean([v['xyz_angstrom'] for v in chemical_poses[i][role]], axis=0)
                            cb = np.mean([v['xyz_angstrom'] for v in chemical_poses[j][role]], axis=0)
                            chemical_distances[role] = float(np.linalg.norm(ca @ rotation + translation - cb))
                        comparison['chemical_centroid_displacement_angstrom'] = chemical_distances
                        if chemical_distances:
                            comparison['chemical_pose_limit'] = 'Heavy-atom centroid placement after declared polymer fit; atomwise orientation and bond-graph agreement are unmeasured.'
                    threshold = state.get('pose_review_threshold_angstrom')
                    if threshold is not None:
                        if not isinstance(threshold, (float, int)) or threshold <= 0:
                            raise ValueError('Pose review threshold must be positive')
                        comparison['review_threshold_angstrom'] = threshold
                        rmsd = comparison['rmsd_angstrom']
                        comparison['pose_agreement'] = None if rmsd is None else rmsd <= threshold
                    comparisons.append(comparison)
            row['states'][state_id] = {'identity': state['identity'], 'chains': state['chains'],
                'observations': observations, 'comparisons': comparisons, 'chemicals': state.get('chemicals', {}),
                'consensus': 'compared_distinct_families' if comparisons else 'insufficient_same_task_families'}
        if candidate['path'] == 'states':
            deltas = []
            for positive in row['states']['positive']['observations']:
                for negative in row['states']['negative']['observations']:
                    if positive['model_family'] != negative['model_family']:
                        continue
                    a, b = positive['run_record'], negative['run_record']
                    if a['model'] != b['model'] or a['sources'] != b['sources'] or a['settings'].get('scientific') != b['settings'].get('scientific'):
                        raise ValueError('State comparison requires matching source/model/scientific settings')
                    differences = {}
                    for name, score in positive['scores'].items():
                        other = negative['scores'].get(name)
                        if other is None or other['units'] != score['units']:
                            continue
                        if all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (score['value'], other['value'])):
                            differences[name] = {'value': score['value'] - other['value'], 'units': score['units'], 'direction': score['direction']}
                    deltas.append({'model_family': positive['model_family'], 'fields': differences,
                                   'definition': 'Positive minus negative in the same native scale; no specificity calibration'})
            row['state_differences'] = deltas
        reports.append(row)
    out.mkdir(parents=True)
    report = {'candidates': reports, 'limits': 'Review shortlists preserve native decisions. Computational agreement supplies no experimental function or specificity claim. Scores retain native scales. Recovery consumes saved outputs only.'}
    (out / 'shortlists.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    for path in sorted(PATHS):
        (out / (path + '.json')).write_text(json.dumps([r for r in reports if r['path'] == path], indent=2, allow_nan=False) + '\n')
    columns = ['path', 'candidate', 'state', 'family', 'model', 'command_id', 'native_rank', 'native_rank_context', 'native_decision', 'native_scores', 'pose_comparisons', 'structure']
    with (out / 'shortlists.tsv').open('w', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=columns, delimiter='\t')
        writer.writeheader()
        for row in reports:
            for state_id, state in row['states'].items():
                for observation in state['observations']:
                    writer.writerow({'path': row['path'], 'candidate': row['id'], 'state': state_id,
                        'family': observation['family'], 'model': observation['run_record']['model'],
                        'command_id': observation['run_record']['command_id'], 'native_rank': observation['native_rank'],
                        'native_rank_context': observation['native_rank_context'],
                        'native_decision': json.dumps(row['native_decision'], sort_keys=True),
                        'native_scores': json.dumps(observation['scores'], sort_keys=True),
                        'pose_comparisons': json.dumps(state['comparisons'], sort_keys=True),
                        'structure': observation['structure']})
    return report

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('root', type=Path)
    p.add_argument('--manifest', default='campaign.json')
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    root = a.root.resolve(strict=True)
    result = consume(root, read_json(resolve(root, a.manifest)), a.out)
    print(json.dumps({'paths': sorted(PATHS), 'candidates': len(result['candidates']), 'output': str(a.out)}))

if __name__ == '__main__':
    main()
