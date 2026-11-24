"""Explicit same-CIF PDB conversion in the selected BoltzGen/Gemmi image."""
import argparse
from pathlib import Path
import gemmi

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--cif', type=Path, required=True)
parser.add_argument('--pdb', type=Path, required=True)
parser.add_argument('--verify-existing', action='store_true')
args = parser.parse_args()
cif = args.cif.resolve(strict=True)
pdb = args.pdb.resolve()
assert cif.is_relative_to('/workspace') and pdb.is_relative_to('/workspace')
text = gemmi.read_structure(str(cif)).make_pdb_string()
if args.verify_existing:
    assert pdb.read_bytes() == text.encode(), 'Saved PDB differs from the same CIF conversion'
else:
    with pdb.open('x') as stream:
        stream.write(text)
print('Same-CIF PDB ' + ('verified' if args.verify_existing else 'created'))
