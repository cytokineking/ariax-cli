"""Unchanged native ScaffoldReducer metrics in the selected Genie3 image.

The separate motif-pdb.py step creates or verifies this PDB with Gemmi in the
selected BoltzGen image. Native Genie3 supplies its own metric dependencies.
"""
import argparse
import csv
import json
from pathlib import Path
from genie3.evaluation.reducer.scaffold import ScaffoldReducer
from genie3.evaluation.utils.parse import parse_motif

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, required=True)
parser.add_argument('--motif-inputs', type=Path, required=True)
parser.add_argument('--cif', type=Path, required=True)
parser.add_argument('--report', type=Path, required=True)
args = parser.parse_args()
root = args.root.resolve(strict=True)
inputs = args.motif_inputs.resolve(strict=True)
cif = args.cif.resolve(strict=True)
report = args.report.resolve()
assert root.is_relative_to('/workspace') and cif.is_relative_to(root)
assert inputs.is_relative_to('/inputs') and report.is_relative_to(root)
assert not report.exists()
domain = '04_5WN9_0'
with (root / 'motif/04_5WN9/scaffold_info.tsv').open() as body:
    rows = list(csv.DictReader(body, delimiter='\t'))
assert len(rows) == 1 and rows[0]['name'] == domain
pdb = root / 'motif-final-prediction.pdb'
assert pdb.is_file() and pdb.stat().st_size
prediction = json.loads((root / 'motif-prediction-check.json').read_text())
segments = parse_motif(str(inputs), '04_5WN9')
metrics = ScaffoldReducer._compute_motif_agreement(None, domain, str(pdb), {domain: rows[0]['config']}, segments)
ca = prediction['identity_matched_ca_rmsd_angstrom']
metrics.update(identity_ca_rmsd_angstrom=ca,
    backbone_success=ca < 2 and metrics['motif_backbone_rmsd'] < 1,
    allatom_success=ca < 2 and metrics['motif_backbone_rmsd'] < 1 and metrics['motif_allatom_rmsd'] < 2,
    strict_allatom_success=ca < 2 and metrics['motif_backbone_rmsd'] < 1 and metrics['motif_allatom_rmsd'] < 1,
    definition='Unchanged upstream ScaffoldReducer motif computation and filters; one managed CA-only ProteinMPNN/Boltz2 join.')
with report.open('x') as stream:
    stream.write(json.dumps(metrics, indent=2, allow_nan=False) + '\n')
print(json.dumps({'candidate': domain, 'report': str(report)}))
