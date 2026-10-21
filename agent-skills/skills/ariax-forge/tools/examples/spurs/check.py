"""Check observed identities, native controls and retained mutation comparisons."""
import csv
import json
from pathlib import Path
import sys
import numpy as np

root = Path(sys.argv[1])
reports = {mode: json.loads((root / mode / 'result.json').read_text()) for mode in ['single','numbering','scan','higher-order','functional','functional-native']}
assert all(r['status'] == 'succeeded' for r in reports.values())
seq = reports['single']['sequence']
assert seq.startswith('WVP') and len(seq) > 40
assert all(r['sequence'] == seq and r['chain'] == 'A' for r in reports.values())
aa = 'ACDEFGHIKLMNPQRSTVWY'
matrix = np.load(root / 'scan/single-ddg.npy')
assert matrix.shape == (len(seq),20) and np.isfinite(matrix).all()
assert np.max(np.abs(matrix[np.arange(len(seq)),[aa.index(a) for a in seq]])) < 1e-6
assert len(list(csv.DictReader((root/'scan/single-ddg.csv').open()))) == len(seq)*20
single = {row['mutations'][0]: row['ddg_kcal_per_mol'] for row in reports['single']['variants']}
assert abs(single['W1W']) < 1e-6
shifted={row['mutations'][0]:row['ddg_kcal_per_mol'] for row in reports['numbering']['variants']}
assert all(abs(shifted[k]-v)<1e-5 for k,v in single.items())
mapping=json.loads((root/'numbering/residue-map.json').read_text())
assert mapping[0]['position']==1 and mapping[0]['pdb_residue']==101 and mapping[-1]['pdb_residue']==166
comparisons = []
for row in reports['higher-order']['variants']:
    summed = sum(single[m] for m in row['mutations'])
    comparisons.append({'mutations':row['mutations'], 'higher_order_kcal_per_mol':row['ddg_kcal_per_mol'], 'single_model_sum_kcal_per_mol':summed, 'difference_kcal_per_mol':row['ddg_kcal_per_mol']-summed})
# Maintainer's fixed native double examples, on the selected checkpoint.
assert abs(comparisons[0]['higher_order_kcal_per_mol']-0.8483) < 0.05
assert abs(comparisons[1]['higher_order_kcal_per_mol']-1.0772) < 0.05
functional = list(csv.DictReader((root/'functional/functional-sites.csv').open()))
assert len(functional)==len(seq)
assert ''.join(row['wt'] for row in functional)==seq
scores=np.array([float(row['function_score']) for row in functional])
assert np.isfinite(scores).all() and np.isclose(scores.min(),-1) and np.isclose(scores.max(),1)
fit=json.loads((root/'functional/functional-fit.json').read_text());assert fit['method']=='paper' and fit['success'] and fit['iterations']>0
assert reports['functional-native']['method']=='native-notebook'
result={'numbering':{'first_parsed_position':1,'first_auth_residue':101,'shifted_scores_agree':True},'functional_fit':fit,'status':'passed','sequence_length':len(seq),'wt_single_kcal_per_mol':single['W1W'],'comparisons':comparisons,'functional_sites':len(functional),'interpretation':'Higher-order minus constituent single-model sum includes different checkpoint parameters and learned correction. Experimental stability and functional-site accuracy unmeasured.','resources':{mode:{k:r[k] for k in ['elapsed_seconds','peak_cuda_allocated_mib','peak_cuda_reserved_mib']} for mode,r in reports.items()}}
(root/'checks.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
