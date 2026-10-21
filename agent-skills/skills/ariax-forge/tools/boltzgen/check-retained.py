"""Output-only checks of every original profile; no native inference replay."""
import importlib.util,json,subprocess,sys
from pathlib import Path
root=Path(sys.argv[1]);inputs=Path('/inputs/boltzgen');report=Path(sys.argv[2]);results=[]
def load(name):
 spec=importlib.util.spec_from_file_location(name.replace('-','_'),inputs/name);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
native=load('check-complete-v5.py');semantic=load('check-semantics-v2.py')
cases=[]
for manifest in ['completion-cases-v2.json','input-class-cases.json','secondary-structure-cases.json','reference-scoring-cases.json','candidate-cases.json']:
 cases.extend(json.loads((inputs/manifest).read_text())['cases'])
subprocess.run(['python',str(inputs/'check.py'),str(root/'retained-b43')],check=True,stdout=subprocess.DEVNULL)
for case in cases:
 directory=root/'b43'/case['id'];out=native.check(directory,case);sem=semantic.check(directory,case['id'])
 results.append({'case':case['id'],'designs':out['sample_count'],'accepted':out['accepted_candidates'],'unique':out['ranked_unique_sequence_count'],'native_arrays_identity_exports':True,'native_filter_ranking_semantics':sem['original_score_direction_checked']})
 helpers=[]
 if case['id'] in ('R16','R27'):helpers.append(('check-auxiliary.py',['--id',case['id']]))
 if case['id']=='R28':helpers.append(('check-reference-scoring.py',['--id','R28']))
 if case['id']=='R29':helpers.append(('check-candidate-reference.py',['--id','R29']))
 if case['id'] in ('R25','R26'):helpers.append(('check-input-classes.py',['--id',case['id']]))
 for helper,args in helpers:subprocess.run(['python',str(inputs/helper),str(directory),*args],check=True,stdout=subprocess.DEVNULL)
for case,helper in [('R16','check-reference-partial.py'),('R28','check-reference-full-partial.py')]:
 subprocess.run(['python',str(inputs/helper),str(root/'b43'/(case+'-failed'))],check=True,stdout=subprocess.DEVNULL)
summary={'state':'passed','original_reduced_profile':True,'full_profiles':results,'preserved_failed_snapshots':['R16','R28'],'scientific_inference_replayed':False,'unchanged_coordinate_tolerance_angstrom':0.0006,'unchanged_fractional_plddt_tolerance':0.006}
report.parent.mkdir(parents=True,exist_ok=True);report.write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps({'state':'passed','full_profile_count':len(results),'preserved_failed_snapshots':2}))
