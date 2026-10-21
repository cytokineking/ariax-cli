"""Check conditioned native SS scores and preserve reference-metric availability."""
from pathlib import Path
import argparse,importlib.util,json
import numpy as np
import pandas as pd
import pydssp
import torch
from boltzgen.task.analyze.analyze_utils import compute_ss_metrics
spec=importlib.util.spec_from_file_location('output_checker',Path(__file__).with_name('check-complete-v4.py'))
checker=importlib.util.module_from_spec(spec);spec.loader.exec_module(checker)
p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);p.add_argument('--id',choices=('R28',),required=True);a=p.parse_args()
folder=a.root/('intermediate_designs' if a.id=='R28' else 'intermediate_designs_inverse_folded')
rows=pd.read_csv(next(folder.glob('aggregate_metrics_*.csv')));observations=[]
for _,row in rows.iterrows():
 path=folder/row['file_name'];value=checker.structure(path);meta=np.load(path.with_suffix('.npz'),allow_pickle=True);mask=meta['design_mask'].astype(bool).reshape(-1);ss=meta['ss_type'].reshape(-1)[mask]
 observed={'id':row['id'],'conditioned_residues':int(np.count_nonzero(ss))}
 if a.id=='R27':
  assert np.array_equal(ss,np.array([2]*20+[1]*10+[3]*10)),'Native SS input/mask differs'
  coordinates=[]
  for residue,selected in zip(value['residues'],mask):
   if not selected:continue
   chain,index=residue[:2]
   for atom in ('N','CA','C','O'):
    i=next(i for i,m in enumerate(value['mapping']) if m[0]==chain and m[1]==index and m[3]==atom)
    coordinates.append(value['coords'][i])
  predicted=pydssp.assign(torch.tensor(np.asarray(coordinates).reshape(-1,4,3),dtype=torch.float32),out_type='index')+1
  metrics=compute_ss_metrics(predicted,torch.tensor(ss))
  for name,expected in metrics.items():
   actual=float(row[name]);assert (np.isnan(actual) and np.isnan(expected)) or abs(actual-expected)<=0.0000051,(row['id'],name)
  observed.update(native_ss_metrics=metrics,computed_accuracy_overall=float(row['accuracy_overall']),original_ss_scores_checked=True)
 else:
  assert observed['conditioned_residues']==0
  metrics={key:float(row[key]) for key in rows.columns if 'lddt' in key or key in ('seq_recovery','accuracy_overall')}
  assert np.isfinite(metrics['seq_recovery']),'Native sequence recovery unavailable'
  expected_sequence=''.join(checker.UB[int(residue[1])-1] for residue,selected in zip(value['residues'],mask) if selected)
  actual_sequence=row['designed_sequence'];assert len(actual_sequence)==len(expected_sequence)==76
  recovery=sum(a==b for a,b in zip(actual_sequence,expected_sequence))/76
  assert abs(recovery-metrics['seq_recovery'])<=0.0000051,'Native sequence recovery/input mapping differs'
  assert any(np.isfinite(v) for k,v in metrics.items() if 'lddt' in k),'Native lDDT unavailable'
  observed.update(native_reference_metrics=metrics,conditioning_structure_reference=True,experimental_accuracy_claim=False)
 observations.append(observed)
assert len(observations)==2
print(json.dumps({'case':a.id,'observations':observations,'native_scalar_csv_tolerance':0.0000051},indent=2))
