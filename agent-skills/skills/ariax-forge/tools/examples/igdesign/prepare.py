#!/usr/bin/env python3
"""Prepare the bounded observed 1N8Z fixture; execution belongs on a remote host."""
import argparse
import json
from pathlib import Path
import shutil

WINDOWS = {'hcdr1':list(range(25,33)), 'hcdr2':list(range(50,58)), 'hcdr3':list(range(96,109)),
    'lcdr1':list(range(26,32)), 'lcdr2':list(range(49,52)), 'lcdr3':list(range(88,97))}


def prepare(source, destination):
    destination.mkdir(parents=True,exist_ok=True)
    residues={}
    for line in (source/'paired.pdb').read_text().splitlines():
        if line.startswith('ATOM  '):
            residues.setdefault(line[21],{}).setdefault(line[22:27],line[17:20])
    header=[]
    for chain, items in residues.items():
        aas=list(items.values())
        for offset in range(0,len(aas),13):
            header.append(f'SEQRES {offset//13+1:3d} {chain} {len(aas):4d}  '+ ' '.join(aas[offset:offset+13]))
    (destination/'paired.pdb').write_text('\n'.join(header)+'\n'+(source/'paired.pdb').read_text())
    shutil.copyfile(source/'abmpnn.plan.json',destination/'abmpnn.plan.json')
    commands=[]
    for family in ('igdesign','igmpnn'):
        cases=[(name,[name],1,'all') for name in WINDOWS]
        cases += [('paired-six',list(WINDOWS),2,'all'),('crop-hcdr3',['hcdr3'],2,list(range(80,120))),('comparison',['hcdr1','lcdr1'],2,'all')]
        for case, order, count, epitope in cases:
            regions={name:{'chain':'heavy' if name.startswith('h') else 'light','positions':WINDOWS[name]} for name in order}
            if case=='comparison':
                regions['hcdr1']['positions']=[30,31];regions['lcdr1']['positions']=[29,30]
            name=family+'-'+case
            cfg={'structure_path':'/inputs/igdesign/paired.pdb','save_path':'/workspace/igdesign/'+name+'.csv',
                'lmdesign_checkpoint':'/models/igdesign-weights/igdesign_acvr2b_holdout.ckpt',
                'pmpnn_checkpoint':'/models/igdesign-weights/igmpnn_acvr2b_holdout.ckpt',
                'region_order':order,'regions':regions,'lmdesign_num_decoding_orders':1,'lmdesign_num_pmpnn_seqs':count,
                'lmdesign_num_lm_seqs':1,'lmdesign_pmpnn_logit_temperature':0.5,'lmdesign_output_logit_temperature':0.5,
                'independent_loss':True,'condition_on_antigen':True,'condition_on_light_chain':True,'predict_light_chain':False,
                'heavy_chain_id':'B','light_chain_id':'A','antigen_chain_id':'C','epitope_idxs_or_all':epitope,
                'random_seed':7,'batch_size':1,'num_batches':1}
            (destination/(name+'.json')).write_text(json.dumps(cfg,indent=2)+'\n')
            commands.append({'case':name,'argv':['igdesign','--model',family,'--config','/inputs/igdesign/'+name+'.json'],
                'check':['igdesign-check','/workspace/igdesign/'+name+'.csv','--rows',str(count)]})
    (destination/'commands.json').write_text(json.dumps(commands,indent=2)+'\n')
    (destination/'without-header.pdb').write_text((source/'paired.pdb').read_text())
    print(json.dumps({'prepared':str(destination),'cases':len(commands),'chain_lengths':{c:len(r) for c,r in residues.items()}}))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('destination',type=Path);a=p.parse_args();prepare(a.source,a.destination)
