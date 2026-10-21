"""Inspect the B43 native pilot; rejected exports are retained as rejected."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import gemmi
import numpy as np
import pandas as pd
import yaml

UBIQUITIN = 'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG'
AA = {'ALA':'A','ARG':'R','ASN':'N','ASP':'D','CYS':'C','GLN':'Q','GLU':'E','GLY':'G','HIS':'H','ILE':'I','LEU':'L','LYS':'K','MET':'M','PHE':'F','PRO':'P','SER':'S','THR':'T','TRP':'W','TYR':'Y','VAL':'V'}

def structure(path: Path) -> dict:
    block=gemmi.cif.read_file(str(path)).sole_block()
    fields=['label_asym_id','label_seq_id','label_comp_id','label_atom_id','type_symbol','Cartn_x','Cartn_y','Cartn_z','B_iso_or_equiv','auth_asym_id','auth_seq_id']
    table=block.find('_atom_site.',fields)
    coords=[]; mapping=[]; residues={}; bfactor=[]; residue_mapping=[]
    for row in table:
        row=list(row)
        chain,res,name,atom,element=map(str,row[:5])
        if int(res) not in residues.setdefault(chain,{}):
            residue_mapping.append([chain,int(res),name,str(row[9]),int(row[10])])
        residues[chain][int(res)]=name
        mapping.append([chain,int(res),name,atom,element])
        coords.append([float(v) for v in row[5:8]])
        bfactor.append(float(row[8]))
    coords=np.array(coords)
    if not len(coords) or not np.isfinite(coords).all():
        raise ValueError(f'empty/nonfinite structure: {path}')
    sequences={chain:''.join(AA.get(name,'X') for _,name in sorted(values.items())) for chain,values in residues.items()}
    return {'sequences':sequences,'mapping':mapping,'coords':coords,'bfactor':np.array(bfactor),'residue_mapping':residue_mapping}

def check(root: Path) -> dict:
    steps=yaml.safe_load((root/'steps.yaml').read_text())['steps']
    names=[row['name'] for row in steps]
    if names != ['design','inverse_folding','folding','design_folding','analysis','filtering']:
        raise ValueError(f'incomplete native stages: {names}')
    for name in names:
        if not (root/'config'/f'{name}.yaml').is_file():
            raise ValueError(f'missing resolved stage settings: {name}')
    raw=sorted((root/'intermediate_designs').glob('*.cif'))
    sequence_dir=root/'intermediate_designs_inverse_folded'
    inverse=sorted(sequence_dir.glob('*.cif'))
    if len(raw)!=2 or len(inverse)!=2:
        raise ValueError('expected two genuine backbones and two inverse-folded sequences')
    samples=[]
    for design in inverse:
        item={'id':design.stem,'sequence_stage':{},'native_arrays':{},'refold_comparisons':{}}
        before=structure(design)
        meta=np.load(design.with_suffix('.npz'),allow_pickle=True)
        mask=meta['design_mask'].astype(bool)
        if len(mask)!=116 or int(mask.sum())!=40 or len(before['residue_mapping'])!=116:
            raise ValueError('design/residue mapping changed')
        design_chains={row[0] for row,selected in zip(before['residue_mapping'],mask) if selected}
        target_chains={row[0] for row,selected in zip(before['residue_mapping'],mask) if not selected}
        if len(design_chains)!=1 or len(target_chains)!=1 or design_chains & target_chains:
            raise ValueError('pilot requires one fully designed chain and one fixed target chain')
        binder_chain=next(iter(design_chains)); target_chain=next(iter(target_chains))
        if before['sequences'][target_chain]!=UBIQUITIN or len(before['sequences'][binder_chain])!=40:
            raise ValueError(f'target/binder identity changed: {design}')
        item['sequence_stage']=before['sequences']
        item['input_to_emitted_chain_mapping']={'input_target_A':target_chain,'input_design_B':binder_chain}
        item['sequence_residue_mapping']=before['residue_mapping']
        item['design_mask']=mask.tolist()
        for directory,cifdir,expected in [('fold_out_npz','refold_cif',116),('fold_out_design_npz','refold_design_cif',40)]:
            data=np.load(sequence_dir/directory/(design.stem+'.npz'),allow_pickle=False)
            required=['coords','atom_to_token','asym_id','residue_index','atom_pad_mask','token_pad_mask','pae','plddt','iptm','ptm']
            if not set(required)<=set(data.files):
                raise ValueError(f'missing native arrays: {set(required)-set(data.files)}')
            for key in ('coords','atom_to_token','asym_id','residue_index','pae','plddt','ptm'):
                if not np.isfinite(data[key]).all():
                    raise ValueError(f'nonfinite structural/confidence array: {key}')
            unavailable = [key for key in data.files if np.issubdtype(data[key].dtype,np.number) and not np.isfinite(data[key]).all()]
            item.setdefault('unavailable_native_metrics', {})[directory] = unavailable
            token_mask=data['token_pad_mask'][0].astype(bool)
            if int(token_mask.sum())!=expected or data['pae'].shape[-2:]!=(len(token_mask),len(token_mask)):
                raise ValueError('PAE/token mapping differs')
            emitted=structure(sequence_dir/cifdir/design.name)
            if directory=='fold_out_npz' and emitted['sequences']!=before['sequences']:
                raise ValueError('refolded complex sequences differ')
            if directory=='fold_out_design_npz' and list(emitted['sequences'].values())!=[before['sequences'][binder_chain]]:
                raise ValueError('binder-only sequence differs')
            atom_mask=data['atom_pad_mask'][0].astype(bool)
            coords=data['coords'][0][atom_mask]
            if coords.shape!=emitted['coords'].shape:
                raise ValueError('native atom count differs from CIF')
            delta=float(np.max(np.abs(coords-emitted['coords'])))
            if delta>0.0006:
                raise ValueError(f'native/CIF coordinates differ: {delta}')
            token_ids=data['atom_to_token'][0][atom_mask].argmax(axis=1)
            plddt=data['plddt'][0][token_ids]
            bfdelta=float(np.max(np.abs(plddt-emitted['bfactor'])))
            if bfdelta>0.006:
                raise ValueError(f'native/CIF pLDDT differs: {bfdelta}')
            item['native_arrays'][directory]={key:list(data[key].shape) for key in data.files}
            item['refold_comparisons'][directory]={'atom_count':len(coords),'token_count':expected,'maximum_coordinate_difference_angstrom':delta,'maximum_bfactor_difference':bfdelta,'atom_residue_mapping':emitted['mapping'],'token_chain_ids':data['asym_id'][0][token_mask].tolist(),'token_residue_indices':data['residue_index'][0][token_mask].tolist()}
        item['not_applicable_metrics'] = {
            'fold_out_design_npz': 'Interchain iPTM and interaction PAE have no target chain in the binder-only refold; native zero/sentinel values are retained.',
            'ligand_iptm': 'No ligand is present in this protein-only pilot.'
        }
        samples.append(item)
    ranked=root/'final_ranked_designs'
    allrows=pd.read_csv(ranked/'all_designs_metrics.csv')
    final=pd.read_csv(ranked/'final_designs_metrics_1.csv')
    if len(allrows)!=2 or set(allrows['id'])!=set(p.stem for p in inverse) or len(final)!=1:
        raise ValueError('native ranking lost a candidate identity')
    flags=[c for c in allrows if c.startswith('pass_') and c.endswith('_filter')]
    if not flags or not (allrows['pass_filters']==allrows[flags].all(axis=1)).all():
        raise ValueError('filter flags disagree with native summary')
    exports=[]
    for _,row in final.iterrows():
        path=ranked/'final_1_designs'/f"rank{int(row['final_rank'])}_{row['file_name']}"
        source=sequence_dir/'refold_cif'/row['file_name']
        if path.read_bytes()!=source.read_bytes():
            raise ValueError('ranked export differs from native refold')
        exports.append({'id':row['id'],'file':str(path.relative_to(root)),'passes_scientific_filters':bool(row['pass_filters'])})
    quality=sorted((ranked/'intermediate_ranked_2_designs').glob('*.cif'))
    if len(quality)!=2 or {p.name.split('_',1)[1] for p in quality}!={p.name for p in inverse}:
        raise ValueError('native quality exports lost a candidate')
    for path in quality:
        original=path.name.split('_',1)[1]
        if path.read_bytes()!=(sequence_dir/'refold_cif'/original).read_bytes():
            raise ValueError('quality export differs from native complex refold')
        if (path.parent/'before_refolding'/path.name).read_bytes()!=(sequence_dir/original).read_bytes():
            raise ValueError('quality pre-refold export differs from native sequence stage')
    if not (ranked/'results_overview.pdf').is_file():
        raise ValueError('native final report absent')
    decisions=[{'id':row['id'],'rank':int(row['final_rank']),'sequence':row['designed_sequence'],'pass_filters':bool(row['pass_filters']),'rejection_reasons':[c for c in flags if not bool(row[c])]} for _,row in allrows.iterrows()]
    return {'state':'bounded_native_workflow_checked','stages':names,'sample_count':len(samples),'accepted_candidates':int(allrows['pass_filters'].sum()),'samples':samples,'filter_decisions':decisions,'final_exports':exports,'quality_exports':[str(p.relative_to(root)) for p in quality],'unavailable_metric_columns':allrows.columns[allrows.isna().all()].tolist(),'reference_metric_scope':'No experimental designed-binder structure was supplied; native_* RMSD fields are not benchmark accuracy evidence.','binding_claim':False,'benchmark_accuracy_claim':False}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('root',type=Path)
    print(json.dumps(check(parser.parse_args().root),indent=2))
