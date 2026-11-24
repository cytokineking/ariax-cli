"""Check fixed nucleotide identity in the bounded native input-class examples."""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path

spec=importlib.util.spec_from_file_location('checker',Path(__file__).with_name('check-complete-v2.py'))
checker=importlib.util.module_from_spec(spec);spec.loader.exec_module(checker)
BASES={'DA':'A','DC':'C','DG':'G','DT':'T','A':'A','C':'C','G':'G','U':'U'}


def nucleotides(value: dict) -> dict:
    result={}
    for chain,_,name,_,_ in value['residues']:
        if name in BASES:result[chain]=result.get(chain,'')+BASES[name]
    return result


def check(root: Path, case_id: str) -> dict:
    expected=sorted(nucleotides(checker.structure(Path(__file__).with_name('native-dna.cif'))).values()) if case_id=='R25' else ['AUGCAUGCAUGC']
    observations=[]
    folder=root/'intermediate_designs_inverse_folded'
    for p in sorted(folder.glob('*.cif')):
        if p.stem.endswith('_native'):continue
        before=nucleotides(checker.structure(p));after=nucleotides(checker.structure(folder/'refold_cif'/p.name))
        if sorted(before.values())!=expected or before!=after:raise ValueError('Fixed nucleotide sequence/chain identity differs')
        observations.append({'id':p.stem,'nucleotide_sequences_by_emitted_chain':before,'nucleotides':sum(map(len,before.values()))})
    if len(observations)!=2:raise ValueError('Expected two nucleotide-target candidates')
    return {'case':case_id,'fixed_nucleotide_identity_checked':True,'observations':observations}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);p.add_argument('--id',choices=('R25','R26'),required=True)
    a=p.parse_args();print(json.dumps(check(a.root,a.id),indent=2))
