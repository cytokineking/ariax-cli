"""Remote-only preparation of supplied native fixtures and public CCD chemistry."""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
from urllib.request import urlopen

import numpy as np
from biotite.structure.io import pdb


def main(fixtures: Path, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=False)
    for name in ['PD-L1.pdb', '7v11_ligand_centered.pdb', 'M0024_1nzy_v3.pdb']:
        shutil.copyfile(fixtures / name, output / name)
    urls = {name + '.cif': 'https://files.rcsb.org/ligands/download/' + name + '.cif'
            for name in ['BCA', 'OQO', 'DHZ', 'ZN']}
    urls.update({name + '.pdb': 'https://files.rcsb.org/download/' + name + '.pdb'
                 for name in ['1CTT', '1TNF', '1NZY']})
    for name, url in urls.items():
        destination = output / name
        temporary = destination.with_suffix(destination.suffix + '.part')
        with urlopen(url, timeout=60) as response, temporary.open('xb') as out:
            shutil.copyfileobj(response, out)
        temporary.replace(destination)
    structure = pdb.PDBFile.read(output / '1CTT.pdb').get_structure(model=1, include_bonds=True, extra_fields=['charge'])
    selected = structure[(structure.chain_id == 'A') & ((~structure.hetero) | np.isin(structure.res_name, ['DHZ', 'ZN']))]
    natural = output / 'M0097_1ctt.pdb'
    record = pdb.PDBFile(); record.set_structure(selected); record.write(natural)
    spec = importlib.util.spec_from_file_location('explicit_chemistry', '/opt/complexa-tools/prepare-chemistry.py')
    chemistry = importlib.util.module_from_spec(spec); spec.loader.exec_module(chemistry)
    rows = {}
    for name, original, mappings, omissions in [
        ('OQO', output / '7v11_ligand_centered.pdb', [('OQO', output / 'OQO.cif')], {}),
        ('DHZ-ZN', natural, [('DHZ', output / 'DHZ.cif'), ('ZN', output / 'ZN.cif')], {}),
        ('BCA-observed', output / 'M0024_1nzy_v3.pdb', [('L:1', output / 'BCA.cif')], {'L:1': ['O7A', 'O8A', 'O9A', 'P3D']}),
    ]:
        rows[name] = chemistry.prepare(original, output / (name + '-prepared.cif'), mappings, omissions)
    (output / 'preparation.json').write_text(json.dumps({'source_urls': urls, 'natural_selection': '1CTT chain A protein plus original DHZ and ZN', 'cases': rows}, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixtures', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    main(args.fixtures, args.output)
