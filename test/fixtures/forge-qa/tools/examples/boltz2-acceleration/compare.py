"""Compare native prediction artifacts, identities and finite outputs exactly."""
import argparse
import json
from pathlib import Path
import gemmi
import numpy as np
from zipfile import ZipFile

def compare(left, right):
    a = {str(p.relative_to(left)): p for p in left.rglob("*") if p.is_file() and "/predictions/" in str(p)}
    b = {str(p.relative_to(right)): p for p in right.rglob("*") if p.is_file() and "/predictions/" in str(p)}
    assert a and a.keys() == b.keys(), "Missing native output or path mismatch"
    report = []
    for key, path in a.items():
        other = b[key]
        if path.suffix == ".npz":
            # Compare native NPY serialization directly, including optional
            # object metadata. ZIP timestamps/compression are container details.
            with ZipFile(path) as x, ZipFile(other) as y:
                assert x.namelist() == y.namelist(), key + ": NPZ fields differ"
                assert all(x.read(name) == y.read(name) for name in x.namelist()), key + ": NPY serialized data differ"
        else:
            assert path.read_bytes() == other.read_bytes(), key + ": bytes differ"
        if path.suffix == ".cif":
            structure = gemmi.read_structure(str(path))
            atoms = [(chain.name, residue.seqid.num, residue.name, atom.name, atom.pos.x, atom.pos.y, atom.pos.z) for chain in structure[0] for residue in chain for atom in residue]
            assert atoms and np.isfinite(np.array([a[-3:] for a in atoms])).all()
            report.append({"path": key, "atoms": len(atoms), "chains": sorted(set(a[0] for a in atoms)), "coordinate_delta": 0})
        if path.suffix == ".json":
            data = json.loads(path.read_text())
            assert all(np.isfinite(v) for v in data.values() if isinstance(v, (int, float)))
            report.append({"path": key, "fields": data})
    return {"prediction_files": len(a), "exact": True, "array_bits_equal": True, "native_json_and_cif_bytes_equal": True, "observations": report}
if __name__ == "__main__":
    p=argparse.ArgumentParser();p.add_argument("left",type=Path);p.add_argument("right",type=Path);a=p.parse_args();print(json.dumps(compare(a.left,a.right),allow_nan=False))
