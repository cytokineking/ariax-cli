"""Run one explicit native Proteina-Complexa command in a ready Forge tool.

Stage this file in /inputs/proteina. Every attempt uses a new working directory.
The script supplies named model paths and native configuration overrides only.
"""
import argparse
import os
from pathlib import Path
import subprocess

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--model',choices=['protein','ligand','ame'],required=True)
p.add_argument('--algorithm',choices=['single-pass','best-of-n','beam-search','fk-steering','mcts'],default='single-pass')
p.add_argument('--reward',choices=['none','rf3','af2'],default='none')
p.add_argument('--refine',choices=['none','greedy','soft'],default='none')
p.add_argument('--length',type=int,required=True)
p.add_argument('--samples',type=int,default=1)
p.add_argument('--batch',type=int,default=1)
p.add_argument('--run-name',required=True)
p.add_argument('--inputs',type=Path,default=Path('/workspace/proteina-inputs'))
p.add_argument('--tnf',action='store_true')
p.add_argument('--config-only',action='store_true',help='Compose and print the native Hydra configuration without inference')
a=p.parse_args()
minimum=64 if a.model=='ame' else 32
if not minimum<=a.length<=256 or not 1<=a.samples<=4 or not 1<=a.batch<=4:p.error('Supported lengths are 32–256 (AME 64–256); samples and batch are 1–4')
if a.model!='protein' and (a.reward=='af2' or a.refine!='none'):p.error('AF2 reward/refinement supports protein complexes')
baseline=180 if a.model=='ame' else 100
if a.algorithm!='single-pass' and (a.reward!='rf3' or a.length!=baseline or a.samples!=1 or a.batch!=1 or a.tnf):p.error('Qualified search uses RF3, one baseline-length target, samples1 and batch1')
if (a.reward=='af2' or a.refine!='none') and (a.algorithm!='single-pass' or a.length!=100 or a.samples!=1 or a.batch!=1 or a.tnf):p.error('Qualified AF2 routes use one PD-L1 target and a 100-residue binder')
if a.refine!='none' and a.reward!='none':p.error('Qualified refinement is separate from reward scoring')
if (a.samples>1 or a.batch>1) and (a.length!=baseline or a.tnf):p.error('Qualified multi-item runs use the baseline length and original target')
if a.tnf and (a.model!='protein' or a.length+438>512):p.error('TNF profile requires a protein binder and at most 512 total residues')
if not a.run_name or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in a.run_name):p.error('Use a simple unique run name')
config={'protein':'binder','ligand':'ligand_binder','ame':'ame'}[a.model]
checkpoint={'protein':'complexa','ligand':'complexa_ligand','ame':'complexa_ame'}[a.model]
argv=['complexa','generate',f'/opt/complexa/configs/search_{config}_local_pipeline.yaml','--verbose','++ckpt_path=/models/proteina-complexa','++ckpt_name='+checkpoint+'.ckpt','++autoencoder_ckpt_path=/models/proteina-complexa/'+checkpoint+'_ae.ckpt','++generation.search.algorithm='+a.algorithm,'++generation.search.max_batch_size=16','++generation.dataloader.batch_size='+str(a.batch),'++generation.dataloader.dataset.nres.nsamples='+str(a.samples),'++generation.dataloader.dataset.nres.low='+str(a.length),'++generation.dataloader.dataset.nres.high='+str(a.length),'++seed=5','++ncpus_=8','++run_name='+a.run_name]
if a.model=='protein':
 argv+=['++generation.task_name='+('38_TNFalpha' if a.tnf else '02_PDL1'),'++generation.dataloader.dataset.conditional_features.0.pdb_path='+str(a.inputs/('1TNF.pdb' if a.tnf else 'PD-L1.pdb'))]
elif a.model=='ligand':
 argv+=['++generation.task_name=39_7V11_LIGAND','++generation.dataloader.dataset.conditional_features.0.pdb_path='+str(a.inputs/'OQO-prepared.cif'),'++generation.dataloader.dataset.conditional_features.0.use_bonds_from_file=true']
else:
 argv+=['++generation.task_name=M0097_1ctt',*['++generation.dataloader.dataset.conditional_features.'+str(i)+'.pdb_path='+str(a.inputs/'DHZ-ZN-prepared.cif') for i in [0,1]],'++generation.dataloader.dataset.conditional_features.1.use_bonds_from_file=true']
if a.reward=='none':argv+=['++generation.reward_model=null']
elif a.reward=='rf3':
 runner='{_target_:proteinfoundation.rewards.rf3_reward.RF3RewardRunner,ckpt_path:/models/foundry-rf3/rf3_foundry_01_24_latest_remapped.ckpt,rf3_path:rf3,normalize_pae:true,reward_weights:{min_ipAE:-1.0},dump_dir:'+str(Path.cwd()/'rf3_outputs')+'}'
 if a.model=='protein':argv+=['~generation.reward_model.reward_models.af2folding','++generation.reward_model.reward_models.rf3folding='+runner]
 elif a.model=='ligand':argv+=['++generation.reward_model.reward_models.rf3folding.ckpt_path=/models/foundry-rf3/rf3_foundry_01_24_latest_remapped.ckpt','++generation.reward_model.reward_models.rf3folding.dump_dir='+str(Path.cwd()/'rf3_outputs')]
 else:argv+=['++generation.reward_model={_target_:proteinfoundation.rewards.base_reward.CompositeRewardModel,reward_models:{rf3folding:'+runner+'}}']
if a.refine=='none':argv+=['++generation.refinement.algorithm=null']
else:argv+=['++generation.refinement.algorithm=sequence_hallucination','++generation.refinement.save_pre_refinement=final','++generation.refinement.enable_soft_optimization='+('true' if a.refine=='soft' else 'false'),'++generation.refinement.enable_greedy_optimization=true']
# JAX sizes some native pools from CPU affinity. Keep the complete process tree
# within Forge's existing 512-process container limit on large GPU hosts.
os.sched_setaffinity(0, sorted(os.sched_getaffinity(0))[:8])
env={**os.environ,'AF2_DIR':'/models/alphafold2','OMP_NUM_THREADS':'8','MKL_NUM_THREADS':'8'}
if a.model=='ame':env['USE_V2_COMPLEXA_ARCH']='True'
if a.config_only:
 argv=['python3','-m','proteinfoundation.generate','--config-path','/opt/complexa/configs','--config-name',Path(argv[2]).stem,'--cfg','job',*argv[4:]]
raise SystemExit(subprocess.run(argv,env=env).returncode)
