"""Make a B34-readable copy of native predicted CIF without changing native output."""
import argparse
from pathlib import Path
import gemmi

p = argparse.ArgumentParser()
p.add_argument('native', type=Path)
p.add_argument('output', type=Path)
a = p.parse_args()
if a.output.exists() or a.output.resolve() == a.native.resolve():
    p.error('Use a fresh separate output path')
doc = gemmi.cif.read_file(str(a.native))
block = doc.sole_block()
before = block.get_mmcif_category('_atom_site.')
columns = dict(before)
if 'occupancy' not in columns:
    columns['occupancy'] = ['1.0'] * len(columns['id'])
block.set_mmcif_category('_atom_site.', columns)
a.output.parent.mkdir(parents=True, exist_ok=True)
doc.write_file(str(a.output))
after = gemmi.cif.read_file(str(a.output)).sole_block().get_mmcif_category('_atom_site.')
if any(after[key] != values for key, values in before.items()):
    raise ValueError('Native atom values changed in geometry copy')
print('Native atom columns preserved; modeled occupancy is 1.0 where absent')
