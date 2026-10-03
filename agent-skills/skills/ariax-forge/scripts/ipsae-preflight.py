"""Read-only consistency checks for standard-protein ipSAE v3 handoffs.

Prediction lineage is supplied by the caller; consistency cannot establish its truth.
This deliberately supports a strict subset of native PDB/mmCIF layouts.
"""
import json
from pathlib import Path
import re
import sys

import numpy as np

AA = dict(zip(
    'ALA ARG ASN ASP CYS GLN GLU GLY HIS ILE LEU LYS MET PHE PRO SER THR TRP TYR VAL'.split(),
    'ARNDCQEGHILKMFPSTWYV',
))


def require(value: object, message: str) -> None:
    if not value:
        raise ValueError(message)


def array(value: object, shape: tuple, maximum: float | None = None) -> np.ndarray:
    raw = np.asarray(value)
    require(raw.dtype.kind in 'fiu', 'confidence must be numeric, not strings or booleans')
    a = raw.astype(float)
    require(a.shape == shape, f'invalid array shape: {a.shape}, expected {shape}')
    require(bool(np.isfinite(a).all()) and bool((a >= 0).all()), 'invalid nonfinite/negative confidence')
    if maximum is not None:
        require(bool((a <= maximum).all()), 'invalid confidence scale')
    return a


def atoms(path: Path, cif: bool) -> list[tuple[int, str, str, int, str]]:
    fields, result = [], []
    model_count = 0
    for line in path.read_text().splitlines():
        if line.startswith('MODEL'):
            model_count += 1
            require(model_count <= 1, 'multiple structure models unsupported')
        if line.startswith('_atom_site.'):
            fields.append(line.strip().split('.', 1)[1])
        if not line.startswith(('ATOM', 'HETATM')):
            continue
        if cif:
            parts = line.split()
            require(len(parts) == len(fields), 'unsupported CIF atom row quoting/layout')
            d = dict(zip(fields, parts))
            require(d.get('label_alt_id', '.') in ('.', '?'), 'alternative locations unsupported')
            require(d.get('pdbx_PDB_ins_code', '?') in ('.', '?'), 'insertions unsupported')
            require(d.get('pdbx_PDB_model_num', '1') == '1', 'multiple/noncanonical models unsupported')
            serial, name, res, chain, number = d['id'], d['label_atom_id'], d['label_comp_id'], d['label_asym_id'], d['label_seq_id']
            xyz = [float(d[k]) for k in ('Cartn_x', 'Cartn_y', 'Cartn_z')]
        else:
            require(line[16:17] == ' ' and line[26:27] == ' ', 'alternative locations/insertions unsupported')
            serial, name, res, chain, number = line[6:11], line[12:16].strip(), line[17:20], line[21], line[22:26]
            xyz = [float(line[a:b]) for a, b in ((30, 38), (38, 46), (46, 54))]
        require('C1' not in name and 'C3' not in name, 'unsupported representative atom name')
        require(res in AA and number not in ('.', '?'), 'nonstandard protein/ligand/nucleic-acid mapping pending')
        require(bool(np.isfinite(xyz).all()), 'nonfinite coordinates')
        require(chain and '-' not in chain, 'unsupported chain label')
        result.append((int(serial), name, chain, int(number), res))
    require(bool(result), 'no atoms')
    require(len({a[0] for a in result}) == len(result), 'duplicate atom identifiers')
    require(len({a[1:] for a in result}) == len(result), 'duplicate atoms/conformers')
    return result


def validate(manifest: str | Path) -> dict:
    manifest = Path(manifest).resolve()
    m = json.loads(manifest.read_text())
    require(isinstance(m, dict), 'handoff must be a JSON object')
    predictor = m['predictor']
    require(predictor in ('af2', 'af3', 'boltz2'), 'no native adapter for predictor')
    boltz = predictor.startswith('boltz')
    for key in ('run_id', 'input_id', 'seed'):
        require(str(m.get(key, '')).strip() not in ('', 'None'), f'missing lineage {key}')
    sample = m['sample']
    require(isinstance(sample, dict), 'sample must record original prediction identity')
    record = sample.get('record_id', '')
    rank = sample.get('rank' if boltz else 'index')
    require(isinstance(record, str) and re.fullmatch(r'[A-Za-z0-9_.-]+', record)
            and record not in ('.', '..'), 'invalid sample record_id')
    require(type(rank) is int and rank >= 0, 'sample rank/index must be a nonnegative integer')
    require(m.get('pae_units') == 'angstrom', 'PAE units must be angstrom')
    require(m.get('plddt_scale') == ('0-1' if boltz else '0-100'), 'predictor pLDDT scale mismatch')
    keys = ['structure', 'pae'] + (['plddt', 'summary'] if boltz else ['summary'] if predictor == 'af3' else [])
    files = {}
    for key in keys:
        path = (manifest.parent / m['files'][key]).resolve()
        require(path.is_file(), f'missing {key} file')
        files[key] = path
    require(files['structure'].suffix == ('.pdb' if predictor == 'af2' else '.cif'), 'wrong structure adapter extension')
    require(files['pae'].suffix == ('.npz' if boltz else '.json'), 'unsupported confidence extension; pickle excluded')
    structure_path = str(files['structure'])
    require(('.pdb' in structure_path) == (predictor == 'af2'), 'native path selects wrong structure adapter')
    if predictor != 'af2':
        require(files['structure'].name == f'{record}_model_{rank}.cif', 'structure sample/rank mismatch')
    aa = atoms(files['structure'], predictor != 'af2')
    ca = [[a[2], a[3], a[4]] for a in aa if a[1] == 'CA']
    cb = [[a[2], a[3], a[4]] for a in aa if a[1] == 'CB' or (a[4] == 'GLY' and a[1] == 'CA')]
    require(ca == cb and bool(ca), 'CA/CB representative order or completeness mismatch')
    all_res = list(dict.fromkeys((a[2], a[3], a[4]) for a in aa))
    require(ca == [list(x) for x in all_res], 'missing/out-of-order representative residues')
    require(len({(a[0], a[1]) for a in ca}) == len(ca), 'duplicate residue register')
    require(ca == m.get('residues'), 'structure/register differs from recorded ordered residues')
    chains = list(dict.fromkeys(a[0] for a in ca))
    require(len(chains) >= 2 and chains == m.get('chain_order'), 'chain order mismatch or monomer')
    require(m.get('sequences') == {c: ''.join(AA[a[2]] for a in ca if a[0] == c) for c in chains}, 'missing/mismatched sequence metadata')
    require([r[0] for r in ca] == [c for c in chains for r in ca if r[0] == c],
            'interleaved chain blocks unsupported')
    n = len(ca)
    if boltz:
        require(files['pae'].name == f'pae_{record}_model_{rank}.npz', 'PAE sample/rank mismatch')
        require(chains == sorted(chains), 'native summary sorting differs from chain order')
        indices = m.get('chain_indices')
        require(isinstance(indices, dict) and all(type(v) is int for v in indices.values())
                and indices == dict(zip(chains, range(len(chains)))), 'predictor asym-index map mismatch')
        require(files['plddt'] == Path(str(files['pae']).replace('pae', 'plddt')), 'native pLDDT sidecar path mismatch')
        require(files['summary'] == Path(str(files['pae']).replace('pae', 'confidence').replace('.npz', '.json')), 'native summary sidecar path mismatch')
        with np.load(files['pae'], allow_pickle=False) as z:
            array(z['pae'], (n, n))
        with np.load(files['plddt'], allow_pickle=False) as z:
            array(z['plddt'], (n,), 1)
        summary = json.loads(files['summary'].read_text())['pair_chains_iptm']
        for i in range(len(chains)):
            for j in range(len(chains)):
                if i != j:
                    array(summary[str(i)][str(j)], (), 1)
    else:
        data = json.loads(files['pae'].read_text())
        require(isinstance(data, dict), 'confidence JSON must be an object')
        array(data.get('pae', data.get('predicted_aligned_error')) if predictor == 'af2' else data['pae'], (n, n))
        if predictor == 'af2':
            array(data['plddt'], (n,), 100)
            for key in ('iptm', 'ptm'):
                if key in data:
                    array(data[key], (), 1)
        else:
            require([a[0] for a in aa] == list(range(1, len(aa) + 1)), 'AF3 atom-ID confidence order mismatch')
            array(data['atom_plddts'], (len(aa),), 100)
            require(data.get('token_chain_ids') == [r[0] for r in ca], 'AF3 token chain order mismatch')
            require(data.get('token_res_ids') == [r[1] for r in ca], 'AF3 token residue register mismatch')
            require(data.get('atom_chain_ids') == [a[2] for a in aa], 'AF3 atom chain order mismatch')
            require(files['pae'].name in (f'{record}_full_data_{rank}.json', f'{record}_confidences_{rank}.json'),
                    'AF3 confidence sample mismatch')
            require(chains == [chr(65 + i) for i in range(len(chains))], 'AF3 summary chain indexing unsupported')
            p = str(files['pae'])
            expected = p.replace('confidences', 'summary_confidences') if 'confidences' in p else p.replace('full_data', 'summary_confidences') if 'full_data' in p else None
            require(expected is not None and files['summary'] == Path(expected), 'native AF3 summary path mismatch')
            array(json.loads(files['summary'].read_text())['chain_pair_iptm'], (len(chains), len(chains)), 1)
    return {'adapter': predictor, 'residues': n, 'chain_order': chains, 'sample': sample, 'files': {k: str(v) for k, v in files.items()}, 'limit': 'consistency only; caller-supplied lineage, no binding inference'}


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 2, 'usage: ipsae-preflight.py HANDOFF.json')
        print(json.dumps(validate(sys.argv[1]), sort_keys=True))
    except (ValueError, KeyError, IndexError, OSError, TypeError) as exc:
        print(f'preflight rejected: {exc}', file=sys.stderr)
        sys.exit(1)
