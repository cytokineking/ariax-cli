#!/usr/bin/env python3
"""Create the disclosed two-crop native JSONL inside the installed image."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0, '/opt/proteinmpnn')
from protein_mpnn_utils import parse_PDB
p=argparse.ArgumentParser();p.add_argument('--pdb',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
a.out.mkdir(parents=True,exist_ok=False)
lines=a.pdb.read_text().splitlines();records=[];fixed={}
for length in (64,93):
    selected=[];residues=[]
    for line in lines:
        if line.startswith('ATOM') and line[21]=='A':
            key=line[22:27]
            if key not in residues:residues.append(key)
            if residues.index(key)<length:selected.append(line[:22]+f'{residues.index(key)+1:4d}'+' '+line[27:])
    assert len(residues)>=length
    name='crop'+str(length);file=a.out/(name+'.pdb');file.write_text('\n'.join(selected)+'\nEND\n')
    protein=parse_PDB(str(file),ca_only=False)[0];assert len(protein['seq'])==length
    (a.out/(name+'-source-map.json')).write_text(json.dumps({'dense_to_author':{str(i+1):x.strip() for i,x in enumerate(residues[:length])}},indent=2)+'\n')
    records.append(protein);fixed[name]={'A':[i for i in range(1,length+1) if i not in range(11,21)]}
(a.out/'parsed.jsonl').write_text(''.join(json.dumps(x)+'\n' for x in records))
(a.out/'fixed.jsonl').write_text(json.dumps(fixed)+'\n')
(a.out/'provenance.json').write_text(json.dumps({'structure':'3HTN','source':'accepted ProteinMPNN 8907e667 fixture','chain':'A','crops':[64,93],'redesign_dense_positions':[11,20],'designed_sequences_per_target':2},indent=2)+'\n')
