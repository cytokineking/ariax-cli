"""Check the saved native full-default settings without changing science."""
import argparse,json
from pathlib import Path
import yaml
p=argparse.ArgumentParser();p.add_argument('root',type=Path);p.add_argument('--devices',type=int,required=True);p.add_argument('--report',type=Path,required=True);p.add_argument('--design-samples',type=int,default=10);p.add_argument('--budget',type=int,default=30);a=p.parse_args()
names=[r['name'] for r in yaml.safe_load((a.root/'steps.yaml').read_text())['steps']]
assert names==['design','inverse_folding','folding','design_folding','analysis','filtering']
c={n:yaml.safe_load((a.root/'config'/f'{n}.yaml').read_text()) for n in names}
settings={}
for n in ['design','inverse_folding','folding','design_folding']:
 x=c[n];assert x['trainer']['devices']==a.devices;workers=x['data'].get('num_workers',x['data'].get('cfg',{}).get('num_workers'))
 expected_steps=500 if n=='design' else 200
 expected_samples=a.design_samples if n=='design' else (1 if n=='inverse_folding' else 5)
 assert x['sampling_steps']==expected_steps and x['recycling_steps']==3 and x['diffusion_samples']==expected_samples and workers==4
 settings[n]={'sampling_steps':x['sampling_steps'],'recycling_steps':3,'diffusion_samples':x['diffusion_samples'],'loader_workers':workers,'devices':a.devices}
checkpoints=c['design']['override']['checkpoints']
assert c['design']['checkpoint']=='/models/boltzgen/boltzgen1_diverse.ckpt'
assert checkpoints['first_checkpoint_num_samples']==0.5
assert checkpoints['checkpoint_list']==[{'checkpoint':{'num_samples':0.5,'path':'/models/boltzgen-extra/boltzgen1_adherence.ckpt'}}]
settings['design_checkpoint_split']={'diverse':0.5,'adherence':0.5}
assert c['analysis']['num_processes']==32
assert c['filtering']['budget']==a.budget and c['filtering']['top_budget']==10
settings.update(analysis_processes=32,budget=a.budget,native_quality_export_budget=10)
a.report.parent.mkdir(parents=True,exist_ok=True);a.report.write_text(json.dumps({'state':'passed','stages':names,'settings':settings},indent=2)+'\n')
print(json.dumps({'state':'passed','settings':settings}))
