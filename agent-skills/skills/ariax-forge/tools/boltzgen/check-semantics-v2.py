"""Recompute native filtering/ranking and report explicit covalent constraints.

Runs in the pinned image against retained files. Native Filter supplies its
original thresholds/weights; no filtering or output-writing method is called.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
import numpy as np
import pandas as pd
import yaml
from boltzgen.task.filter.filter import Filter

spec=importlib.util.spec_from_file_location('output_checker',Path(__file__).with_name('check-complete-v3.py'))
output_checker=importlib.util.module_from_spec(spec);spec.loader.exec_module(output_checker)


def check(root: Path, case_id: str) -> dict:
    config=yaml.safe_load((root/'config/filtering.yaml').read_text());config.pop('_target_')
    if config['random_state']!=0:raise ValueError('Native random_state differs')
    config['outdir']='/scratch/semantics/'+case_id
    native=Filter(**config)
    df=pd.read_csv(root/'final_ranked_designs/all_designs_metrics.csv')
    cumulative=pd.Series(True,index=df.index);passed=pd.Series(0,index=df.index)
    for rule in native.filters:
        feature=rule['feature'];value=df[feature];threshold=rule['threshold']
        expected=(value<=threshold) if rule['lower_is_better'] else (value>=threshold)
        if not expected.equals(df['pass_'+feature+'_filter']):raise ValueError('Original native threshold decision differs: '+feature)
        cumulative &= expected;passed+=cumulative
    if not np.array_equal(passed,df['num_filters_passed']):raise ValueError('Native cumulative-filter rank priority differs')
    ranks=[]
    for feature,weight in native.metrics.items():
        if weight is None:continue
        expected=df[['num_filters_passed',feature]].apply(tuple,axis=1).rank(method='min',ascending=False).astype(int)/weight
        if not np.allclose(expected,df['rank_'+feature],atol=1e-8,rtol=0):raise ValueError('Native rank direction/weight differs: '+feature)
        ranks.append(expected)
    maximum=pd.concat(ranks,axis=1).max(axis=1)
    if not np.allclose(maximum,df['max_rank'],atol=1e-8,rtol=0):raise ValueError('Worst native rank differs')
    secondary=maximum.rank(method='dense').astype(int)
    if not np.array_equal(secondary,df['secondary_rank']):raise ValueError('Native dense rank differs')
    if list(df['final_rank'])!=list(range(1,len(df)+1)):raise ValueError('Final ranks differ')
    for aa,name in output_checker.AA.items():
        field=aa+'_fraction'
        if field not in df:continue
        expected=df['designed_sequence'].map(lambda s:s.count(name)/len(s))
        if not np.allclose(expected,df[field],atol=0.0000051,rtol=0):raise ValueError('Composition/mask sequence differs: '+field)
    if not np.allclose(-df['min_design_to_target_pae'],df['neg_min_design_to_target_pae'],atol=1e-7,rtol=0):raise ValueError('PAE direction differs')
    constraints=[]
    if case_id in ('R08','R09'):
        folder=root/'intermediate_designs_inverse_folded'
        for path in sorted(folder.glob('*.cif')):
            if path.stem.endswith('_native'):continue
            original=output_checker.structure(path)
            refold=output_checker.structure(folder/'refold_cif'/path.name)
            mask=np.load(path.with_suffix('.npz'),allow_pickle=True)['design_mask'].astype(bool).reshape(-1)
            designed={r[0] for r,m in zip(original['residues'],mask) if m}
            if len(designed)!=1:raise ValueError('Constraint requires one designed chain')
            chain=next(iter(designed));connections=refold['connections']
            rows=list(zip(*connections.values()))
            expected_atoms={'C','N'} if case_id=='R08' else {'SG'}
            expected_res={'1','16'} if case_id=='R08' else {'4','11'}
            found=[]
            for row in rows:
                kind,c1,r1,a1,c2,r2,a2=row
                if c1==chain and c2==chain and {r1,r2}==expected_res and {a1,a2}==expected_atoms:
                    indexes=[next(i for i,m in enumerate(refold['mapping']) if m[0]==chain and m[1]==r and m[3]==a) for r,a in ((r1,a1),(r2,a2))]
                    found.append({'connection':row,'distance_angstrom':float(np.linalg.norm(refold['coords'][indexes[0]]-refold['coords'][indexes[1]]))})
            constraints.append({'id':path.stem,'expected_chain':chain,'expected_residues':sorted(expected_res),'expected_atoms':sorted(expected_atoms),'native_cif_connections':rows,'matched_connections':found,'topology_preserved':bool(found)})
    return {'case':case_id,'native_thresholds':native.filters,'native_maximized_metrics_inverse_weights':native.metrics,'original_score_direction_checked':True,'native_composition_csv_quantization_tolerance':0.0000051,'ranked_candidates':len(df),'covalent_constraints':constraints,'geometry_acceptance_claim':False}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);p.add_argument('--id',required=True)
    a=p.parse_args();print(json.dumps(check(a.root,a.id),indent=2))
