#!/usr/bin/env python3
"""Make the pinned native RF2 sequence/target input from a retained HLT PDB."""
import argparse
import json
from pathlib import Path

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    p.add_argument('--tag',default='sequence_target')
    a=p.parse_args()
    if not a.out.resolve().is_relative_to('/workspace') or a.out.exists():
        p.error('Use a new JSON path under /workspace')
    from check_outputs import read_hlt
    from rfantibody.rf2.modules.parsers import parse_HLT_remarked
    source=read_hlt(a.input)
    native=parse_HLT_remarked(str(a.input))
    target=[i for i,(chain,_) in enumerate(native['pdb_idx']) if chain=='T']
    if not target or 'H' not in source['sequences']:
        p.error('Retain H and target T in the input HLT PDB')
    xyz=native['xyz'][target].clone()
    mask=native['atom_mask'][target]
    xyz[~mask]=0 # Missing slots stay masked; no native present coordinate changes.
    entry={'Hseq':source['sequences']['H'],'Lseq':source['sequences'].get('L',''),
           'hotspots':[False]*len(target),
           'T':{'seq':native['seq'][target].tolist(),'xyz':xyz.tolist(),
                'mask':mask.tolist(),'idx':native['idx'][target].tolist()}}
    a.out.parent.mkdir(parents=True,exist_ok=True)
    a.out.write_text(json.dumps({a.tag:entry},allow_nan=False)+'\n')
    mapping={'source_hlt':str(a.input),'antibody_coordinates':'sequence-only; unavailable',
             'cdr_annotations':'native JSON input has empty CDR masks; unavailable',
             'target':[{'native_output_position':i+1,'source_residue':row['source_residue']}
                       for i,row in enumerate(r for r in source['residue_map'] if r['chain']=='T')]}
    a.out.with_suffix('.source-map.json').write_text(json.dumps(mapping,indent=2)+'\n')

if __name__=='__main__':main()
