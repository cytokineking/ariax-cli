"""Inspect one native CLI campaign, preserving its recorded scientific outcome."""
import argparse
import csv
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).parent))
from check import chain_sequences


def check(output,target,report=None):
    target_sequence=chain_sequences(target)['A']
    with (output/'1_Trajectories/!_Trajectories.csv').open() as stream:rows=list(csv.DictReader(stream))
    if len(rows)!=1:raise ValueError('Expected exactly one bounded native trajectory')
    record=rows[0];binder=record.get('Binder_Sequence','')
    if len(binder)!=31 or not set(binder)<=set('ACDEFGHIKLMNPQRSTVWY'):raise ValueError('Trajectory binder sequence missing or invalid')
    structures=[]
    for path in sorted(output.rglob('*.cif')):
        sequences=chain_sequences(path)
        if len(sequences)==2:
            if sequences.get('A')!=target_sequence or len(sequences.get('B',''))!=31:raise ValueError('Complex chain/sequence identity differs')
        elif len(sequences)==1:
            if len(next(iter(sequences.values())))!=31:raise ValueError('Binder-alone residue coverage differs')
        else:raise ValueError('Unexpected output chain count')
        structures.append({'path':str(path.relative_to(output)),'sequences':sequences})
    if not structures:raise ValueError('Native campaign emitted no structure for inspection')
    tables={}
    for name in ['2_Refolded/!_Refolded.csv','3_Ranked/!_Ranked.csv']:
        path=output/name
        if path.exists():
            with path.open() as stream:tables[name]=list(csv.DictReader(stream))
    result={'passed':True,'trajectory':record,'structures':structures,'native_candidate_tables':tables,
        'scope':'native CLI identity/output coverage with its recorded filter outcomes'}
    report=report or output/'direct-check.json'
    if report.exists():raise FileExistsError('Use a fresh inspection report path')
    report.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('output',type=Path);p.add_argument('target',type=Path);p.add_argument('--report',type=Path);a=p.parse_args();check(a.output,a.target,a.report)
