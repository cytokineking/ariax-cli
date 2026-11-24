"""Create explicit finite native settings and target format examples on the GPU host."""
import json, shutil
from pathlib import Path
from biotite.structure.io import load_structure, save_structure
from check import chain_sequences
from bindcraft.settings import read_settings, build_design_settings, select_design_and_validation_models
from bindcraft.af2 import MULTIMER_POOL, MONOMER_POOL
ROOT=Path('/workspace/b44/fixtures');ROOT.mkdir(parents=True,exist_ok=False)
source=Path('/inputs/bindcraft2/PDL1.pdb');shutil.copyfile(source,ROOT/'PDL1.pdb')
structure=load_structure(source);save_structure(ROOT/'PDL1.cif',structure)
(ROOT/'PDL1.fasta').write_text('>A\n'+chain_sequences(source)['A']+'\n')
base={'targets':[{'name':'hPDL1','target_path':str(ROOT/'PDL1.pdb'),'chains':'A','hotspots':'A56'}],
 'modality':'binder','campaign_seed':7,'number_of_final_designs':1,'max_trajectories':1,
 'resume':False,'hash_design_names':False,'auto_multi_gpu':False,'design_workers':1,
 'workers_per_gpu':1,'max_workers_per_gpu':1,'compile_next_length':False,
 'save_design_trajectory':True,'save_failed_refolds':True,'save_failed_trajectories':True,
 'save_binder_monomers':True,'save_design_animations':False,'save_loss_plots':False}
records=[]
def case(name,**overrides):
 d={**base,**overrides,'campaign_name':'b44_'+name,'project_folder':'/workspace/b44/campaigns/'+name}
 p=ROOT/(name+'.json');p.write_text(json.dumps(d,indent=2)+'\n')
 try:
  effective=read_settings(p);design=build_design_settings(effective)
  models=select_design_and_validation_models(effective,MULTIMER_POOL,MONOMER_POOL)
  records.append({'case':name,'settings':str(p),'design_models':list(models.design_models),'validation_models':list(models.validation_models),'effective':effective})
 except Exception as e: records.append({'case':name,'settings':str(p),'preparation_error':str(e)})
for length in [60,100,180]:case('default-'+str(length),binder_lengths=[length])
case('diagnostic',binder_lengths=[60],autotune=False,desperation=False,attention_backend='xla',use_cueq=False)
case('cif',binder_lengths=[60],targets=[{'name':'hPDL1','target_path':str(ROOT/'PDL1.cif'),'chains':'A','hotspots':'A56','coldspots':'A57'}])
for crop in [60,False]:case('fasta-'+str(crop).lower(),binder_lengths=[60],targets=[{'name':'sequence','target_path':str(ROOT/'PDL1.fasta'),'chains':'A'}],crop_fasta_sequence=[crop,crop] if crop is not False else False)
for second in ['target','detarget']:
 case('multi-'+second,binder_lengths=[60],targets=[base['targets'][0],{**base['targets'][0],'name':'second','objective':second,'weight':-1.0 if second=='detarget' else 1.0}])
for modality,lengths in [('peptide',[12,25]),('cyclic_peptide',[12]),('large_binder',[250,600]),('multidomain',[120,300]),('homo_oligomer',[40,120]),('induced_fit',[60]),('fold_switch',[60])]:
 for length in lengths:case(modality+'-'+str(length),modality=modality,binder_lengths=[length],sequence_candidates=1 if modality in ['peptide','cyclic_peptide','induced_fit','fold_switch'] else 2)
for modality in ['VHH','scFv','Fab','ARP']:case(modality,modality=modality,sequence_candidates=2)
case('VHH-fixed',modality='VHH',mutate_positions='A27-33,A52-57,A100-114',sequence_candidates=2)
case('neutral',binder_lengths=[60],mpnn_variant='neutral',sequence_candidates=2)
case('recovery',binder_lengths=[60],max_trajectories=1,autotune=False,desperation=False)
(ROOT/'manifest.json').write_text(json.dumps(records,indent=2)+'\n')
print('Prepared finite native cases',len(records))
