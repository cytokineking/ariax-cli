"""Check preserved partial-reference arrays after native analysis failed.

This verifies completed stages only; missing analysis/filtering stay failed.
"""
from pathlib import Path
import argparse,importlib.util,json
import numpy as np
import yaml
spec=importlib.util.spec_from_file_location('checker',Path(__file__).with_name('check-complete-v5.py'));checker=importlib.util.module_from_spec(spec);spec.loader.exec_module(checker)
p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);a=p.parse_args();folder=a.root/'intermediate_designs';observations=[]
assert not list(folder.glob('aggregate_metrics_*.csv'))
for path in sorted(folder.glob('*.cif')):
 if path.stem.endswith('_native'):continue
 before=checker.structure(path);meta=np.load(path.with_suffix('.npz'),allow_pickle=True);mask=meta['design_mask'].astype(bool).reshape(-1);assert int(mask.sum())==11
 for chain in before['sequences']:
  residues=[(r,m) for r,m in zip(before['residues'],mask) if r[0]==chain];assert len(residues)==76
  assert all(selected or checker.AA.get(r[2],'X')==checker.UB[i] for i,(r,selected) in enumerate(residues))
 result={'id':path.stem,'design_mask':mask.tolist(),'chain_sequences':before['sequences'],'refolds':{}}
 for directory,cifs in (('fold_out_npz','refold_cif'),('fold_out_design_npz','refold_design_cif')):
  data=np.load(folder/directory/path.with_suffix('.npz').name,allow_pickle=False);assert len(data['coords'])==len(data['pae'])==len(data['plddt'])==5
  assert np.isfinite(data['coords']).all() and np.isfinite(data['pae']).all() and np.isfinite(data['plddt']).all()
  emitted=checker.structure(folder/cifs/path.name);best=int(np.argmax(.8*data['iptm']+.2*data['ptm']));atoms=data['atom_pad_mask'][0].astype(bool);coords=data['coords'][best][atoms];delta=float(np.max(np.abs(coords-emitted['coords'])));assert delta<=0.0006
  tokens=data['atom_to_token'][0][atoms].argmax(axis=1);bd=float(np.max(np.abs(data['plddt'][0][tokens]-emitted['bfactor'])));assert bd<=0.006
  if directory=='fold_out_npz':assert emitted['sequences']==before['sequences']
  result['refolds'][directory]={'samples':5,'coordinate_max_delta_angstrom':delta,'bfactor_max_delta':bd,'array_shapes':{k:list(data[k].shape) for k in data.files}}
 observations.append(result)
assert len(observations)==2
print(json.dumps({'case':'R16','native_analysis_state':'failed','native_error':'native target mask mismatch601 vs1118 atoms','filtering_completed':False,'observations':observations,'scientific_replay':False},indent=2))
