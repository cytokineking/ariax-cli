"""Check native BoltzGen candidate identity, all refold samples and ranked exports.

This preserves 0.2.0's best-coordinate/first-pLDDT CIF convention and scientific
rejections. It does not claim experimental accuracy or accepted binding.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import gemmi
import numpy as np
import pandas as pd
import yaml

AA={'ALA':'A','ARG':'R','ASN':'N','ASP':'D','CYS':'C','GLN':'Q','GLU':'E','GLY':'G','HIS':'H','ILE':'I','LEU':'L','LYS':'K','MET':'M','PHE':'F','PRO':'P','SER':'S','THR':'T','TRP':'W','TYR':'Y','VAL':'V'}
UB='MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG'


def structure(path: Path) -> dict:
    block=gemmi.cif.read_file(str(path)).sole_block()
    fields=['label_asym_id','label_seq_id','label_comp_id','label_atom_id','type_symbol','Cartn_x','Cartn_y','Cartn_z','B_iso_or_equiv','auth_asym_id','auth_seq_id']
    coords=[];mapping=[];residues={};order=[];bfactor=[]
    for row in block.find('_atom_site.',fields):
        row=list(map(str,row));chain,seq,name,atom,element=row[:5]
        residue=seq if seq not in ('.','?') else row[10]
        key=(chain,residue)
        if key not in residues:
            order.append([chain,residue,name,row[9],row[10]])
        residues[key]=name
        mapping.append([chain,residue,name,atom,element])
        coords.append(list(map(float,row[5:8])));bfactor.append(float(row[8]))
    array=np.asarray(coords)
    if not len(array) or not np.isfinite(array).all():raise ValueError('Empty/nonfinite native CIF: '+str(path))
    sequences={}
    for chain,res,name,_,_ in order:sequences[chain]=sequences.get(chain,'')+AA.get(name,'X')
    bonds={k:list(block.find_values(k)) for k in ('_struct_conn.conn_type_id','_struct_conn.ptnr1_label_asym_id','_struct_conn.ptnr1_label_seq_id','_struct_conn.ptnr1_label_atom_id','_struct_conn.ptnr2_label_asym_id','_struct_conn.ptnr2_label_seq_id','_struct_conn.ptnr2_label_atom_id')}
    return {'sequences':sequences,'residues':order,'mapping':mapping,'coords':array,'bfactor':np.asarray(bfactor),'connections':bonds}


def check(root: Path, case: dict) -> dict:
    names=[r['name'] for r in yaml.safe_load((root/'steps.yaml').read_text())['steps']]
    if names!=case['expected_stages']:raise ValueError('Native stage order differs: '+str(names))
    configurations={n:yaml.safe_load((root/'config'/f'{n}.yaml').read_text()) for n in names}
    for name in ('folding','design_folding'):
        if name in names and configurations[name]['diffusion_samples']!=case['refold_samples']:
            raise ValueError('Refolding sample count was changed')
    sequence_dir=root/'intermediate_designs_inverse_folded'
    inverse=sorted(p for p in sequence_dir.glob('*.cif') if not p.stem.endswith('_native'))
    expected=case['designs']
    if len(inverse)!=expected:raise ValueError(f'Expected {expected} inverse-folded candidates, got {len(inverse)}')
    raw=sorted(p for p in (root/'intermediate_designs').glob('*.cif') if not p.stem.endswith('_native'))
    if 'design' in names and len(raw)!=case['designs']:raise ValueError('Backbone identity/count lost')
    samples=[]
    for design in inverse:
        before=structure(design)
        meta=np.load(design.with_suffix('.npz'),allow_pickle=True)
        token_mask=meta['design_mask'].astype(bool).reshape(-1)
        mol_type=meta['mol_type'].reshape(-1)
        if len(token_mask)!=len(mol_type):raise ValueError('Design mask/token molecule mapping differs')
        # Native ligand atoms are separate tokens inside one CIF residue.
        protein_mask=token_mask[mol_type==0]
        if int((mol_type==0).sum())!=sum(r[2] in AA for r in before['residues']):raise ValueError('Protein token/residue identity differs')
        if token_mask[mol_type!=0].any():raise ValueError('Unexpected designed nonprotein token')
        iterator=iter(protein_mask)
        mask=np.asarray([next(iterator) if r[2] in AA else False for r in before['residues']],dtype=bool)
        chain_masks={c:[bool(selected) for r,selected in zip(before['residues'],mask) if r[0]==c] for c in before['sequences']}
        designed={c for c,m in chain_masks.items() if any(m)}
        fixed=set(chain_masks)-designed
        binder=sum(len(before['sequences'][c]) for c in designed)
        if not case['binder_range'][0]<=binder<=case['binder_range'][1]:raise ValueError('Binder length outside declared profile')
        if case['target_residues']:
            if sum(len(before['sequences'][c]) for c in fixed)!=case['target_residues'] or any(before['sequences'][c]!=UB for c in fixed):
                raise ValueError('Fixed target sequence/chain identity differs')
        item={'id':design.stem,'sequences':before['sequences'],'designed_chains':sorted(designed),'fully_fixed_target_chains':sorted(fixed),'binder_residues':binder,'designed_residue_count':int(mask.sum()),'design_mask':token_mask.tolist(),'residue_design_mask':mask.tolist(),'token_molecule_types':mol_type.tolist(),'residue_mapping':before['residues'],'connections':before['connections'],'metadata_keys':list(meta.files),'refolds':{}}
        for directory,cifdir in [('fold_out_npz','refold_cif'),('fold_out_design_npz','refold_design_cif')]:
            if directory=='fold_out_design_npz' and 'design_folding' not in names:continue
            data=np.load(sequence_dir/directory/(design.stem+'.npz'),allow_pickle=False)
            required={'coords','atom_to_token','asym_id','residue_index','atom_pad_mask','token_pad_mask','pae','plddt','iptm','ptm'}
            if not required<=set(data.files):raise ValueError('Native confidence/identity arrays missing: '+str(required-set(data.files)))
            for key in ('coords','atom_to_token','pae','plddt','ptm'):
                if not np.isfinite(data[key]).all():raise ValueError('Nonfinite structural/confidence array: '+key)
            n=case['refold_samples']
            if len(data['coords'])!=n or len(data['plddt'])!=n or len(data['pae'])!=n:raise ValueError('All native refold samples were not saved')
            emitted=structure(sequence_dir/cifdir/design.name)
            if directory=='fold_out_npz' and emitted['sequences']!=before['sequences']:raise ValueError('Complex refold sequence identity changed')
            if directory=='fold_out_design_npz' and sorted(emitted['sequences'].values())!=sorted(before['sequences'][c] for c in designed):raise ValueError('Binder-only sequence identity changed')
            best=int(np.argmax(.8*data['iptm']+.2*data['ptm']))
            atom_mask=data['atom_pad_mask'][0].astype(bool)
            coordinates=data['coords'][best][atom_mask]
            if coordinates.shape!=emitted['coords'].shape:raise ValueError('Native atom count differs from selected CIF')
            delta=float(np.max(np.abs(coordinates-emitted['coords'])))
            if delta>0.0006:raise ValueError('Best-sample/CIF coordinate tolerance exceeded: '+str(delta))
            token_ids=data['atom_to_token'][0][atom_mask].argmax(axis=1)
            bdelta=float(np.max(np.abs(data['plddt'][0][token_ids]-emitted['bfactor'])))
            if bdelta>0.006:raise ValueError('Native first-sample pLDDT/CIF tolerance exceeded: '+str(bdelta))
            token_mask=data['token_pad_mask'][0].astype(bool)
            for k in ('asym_id','residue_index'):
                if data[k].shape[-1]!=len(token_mask):raise ValueError('Native token identity shape differs')
            if data['pae'].shape[-2:]!=(len(token_mask),len(token_mask)):raise ValueError('Native PAE/token mapping differs')
            item['refolds'][directory]={'samples':n,'selected_coordinate_sample':best,'cif_plddt_sample':0,'coordinate_max_delta_angstrom':delta,'bfactor_max_delta':bdelta,'token_count':int(token_mask.sum()),'atom_count':len(coordinates),'array_shapes':{k:list(data[k].shape) for k in data.files},'unavailable_native_metrics':[k for k in data.files if np.issubdtype(data[k].dtype,np.number) and not np.isfinite(data[k]).all()],'atom_mapping':emitted['mapping'],'token_chain_ids':data['asym_id'][0][token_mask].tolist(),'token_residue_indices':data['residue_index'][0][token_mask].tolist()}
        if 'affinity' in names:
            paths=list(sequence_dir.glob('**/*'+design.stem+'*.npz'))
            affinity=[p for p in paths if any(part in ('affinity','aff_out_npz') or 'affinity' in part for part in p.parts)]
            if not affinity:raise ValueError('Native affinity arrays missing')
            item['affinity']={str(p.relative_to(root)):{k:np.load(p,allow_pickle=False)[k].tolist() for k in np.load(p,allow_pickle=False).files} for p in affinity}
        raw_path=root/'intermediate_designs'/design.name
        if raw_path.exists():
            original=structure(raw_path)
            if len(original['residues'])!=len(mask):raise ValueError('Backbone/sequence residue count differs')
            for source_residue,result_residue,selected in zip(original['residues'],before['residues'],mask):
                if source_residue[:2]!=result_residue[:2] or (not selected and source_residue[2]!=result_residue[2]):
                    raise ValueError('Fixed residue or chain identity changed in inverse folding')
            item['fixed_residues_preserved_from_backbone']=True
        if case['id']=='R09':
            cys=[(i,r) for i,r in enumerate(before['residues']) if r[0] in designed and r[2]=='CYS']
            if len(cys)!=2:raise ValueError('Explicit fixed disulfide cysteine identity changed')
            item['fixed_disulfide_cysteines']=[r for _,r in cys]
        samples.append(item)
    ranked=root/'final_ranked_designs';allrows=pd.read_csv(ranked/'all_designs_metrics.csv')
    if len(allrows)!=expected or set(allrows['id'])!={p.stem for p in inverse}:raise ValueError('Ranking lost candidate identity')
    flags=[c for c in allrows if c.startswith('pass_') and c.endswith('_filter')]
    if not flags or not (allrows['pass_filters']==allrows[flags].all(axis=1)).all():raise ValueError('Filter decisions differ from original flags')
    final=pd.read_csv(ranked/f"final_designs_metrics_{case['budget']}.csv")
    exports=[]
    for _,row in final.iterrows():
        path=ranked/f"final_{case['budget']}_designs"/f"rank{int(row['final_rank'])}_{row['file_name']}"
        if path.read_bytes()!=(sequence_dir/'refold_cif'/row['file_name']).read_bytes():raise ValueError('Final export differs from native selected refold')
        exports.append({'id':row['id'],'file':str(path.relative_to(root)),'pass_filters':bool(row['pass_filters'])})
    quality=list((ranked/f'intermediate_ranked_{expected}_designs').glob('*.cif'))
    if len(quality)!=expected:raise ValueError('Quality exports lost candidates')
    for p in quality:
        original=p.name.split('_',1)[1]
        if p.read_bytes()!=(sequence_dir/'refold_cif'/original).read_bytes():raise ValueError('Quality export differs')
        if (p.parent/'before_refolding'/p.name).read_bytes()!=(sequence_dir/original).read_bytes():raise ValueError('Pre-refold export differs')
    if not (ranked/'results_overview.pdf').exists():raise ValueError('Native report missing')
    decisions=[{'id':r['id'],'rank':int(r['final_rank']),'sequence':r['designed_sequence'],'pass_filters':bool(r['pass_filters']),'rejection_reasons':[c for c in flags if not bool(r[c])]} for _,r in allrows.iterrows()]
    return {'state':'native_outputs_checked','case':case['id'],'stages':names,'sample_count':len(samples),'accepted_candidates':int(allrows['pass_filters'].sum()),'samples':samples,'decisions':decisions,'final_exports':exports,'unavailable_metric_columns':allrows.columns[allrows.isna().all()].tolist(),'native_cif_convention':'0.2.0 selects argmax(0.8*iptm+0.2*ptm) coordinates and sample-zero pLDDT; all samples remain in NPZ.','binding_claim':False,'benchmark_accuracy_claim':False}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);p.add_argument('--case',type=Path,required=True);p.add_argument('--id',required=True)
    a=p.parse_args();case=next(c for c in json.loads(a.case.read_text())['cases'] if c['id']==a.id)
    print(json.dumps(check(a.root,case),indent=2))
