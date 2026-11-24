"""Prepare bounded local MSA fixtures and inspect Chai's native input features."""
from __future__ import annotations
import argparse
from dataclasses import fields
import json
from pathlib import Path
import pandas as pd
import torch
from chai_lab.chai1 import make_all_atom_feature_context
from chai_lab.data.parsing.msas.aligned_pqt import expected_basename
from chai_lab.data.dataset.msas.msa_context import NO_PAIRING_KEY


def sequences(path):
    records=[]
    for line in path.read_text().splitlines():
        if line.startswith('>'):records.append(['',line])
        elif line.strip():records[-1][0]+=line.strip()
    return [seq for seq,header in records if header.startswith('>protein|')]


def msa(fasta,directory,paired):
    directory.mkdir(parents=True,exist_ok=False)
    rows=[]
    for sequence in sequences(fasta):
        substitutions=[sequence[:4]+('A' if sequence[4]!='A' else 'G')+sequence[5:],sequence[:-1]+('A' if sequence[-1]!='A' else 'G')]
        data=[{'sequence':sequence,'source_database':'query','pairing_key':'','comment':'native query'}]
        data.extend({'sequence':seq,'source_database':'uniref90','pairing_key':f'fixture_species_{i}' if paired else '',
                     'comment':'synthetic alignment for format and conditioning validation'} for i,seq in enumerate(substitutions))
        destination=directory/expected_basename(sequence);pd.DataFrame(data).to_parquet(destination,index=False)
        rows.append({'file':destination.name,'residues':len(sequence),'rows':len(data),'paired':paired})
    (directory/'fixture.json').write_text(json.dumps({'scope':'synthetic alignment for bounded native input validation','files':rows},indent=2)+'\n')
    print(json.dumps({'prepared':rows}))


def audit(args):
    context=make_all_atom_feature_context(fasta_file=args.fasta,output_dir=args.output,
        use_esm_embeddings=False,msa_directory=args.msa_directory,templates_path=args.template_hits_path,
        constraint_path=args.constraint_path)
    structure=context.structure_context;msa=context.msa_context
    active_rows=msa.mask.any(dim=1)
    chain_ids=structure.token_asym_id.unique()
    coverage=torch.stack([msa.mask[:,structure.token_asym_id==chain].any(dim=1) for chain in chain_ids])
    shared_rows=coverage.all(dim=0);shared_rows[0]=False
    shared_count=int(shared_rows.sum()) if len(chain_ids)>1 else 0
    paired_count=0
    if len(chain_ids)>1:
        for row in range(1,msa.depth):
            keys=[]
            for chain in chain_ids:
                selected=(structure.token_asym_id==chain)&msa.mask[row]
                keys.append(set(msa.pairing_key_hash[row,selected].tolist())-{NO_PAIRING_KEY})
            paired_count+=int(bool(set.intersection(*keys)))
    restraint_counts={field.name:len(getattr(context.restraint_context,field.name) or []) for field in fields(context.restraint_context)}
    bonds=structure.atom_covalent_bond_indices
    cross_chain=0
    for a,b in zip(bonds[0].tolist(),bonds[1].tolist()):
        ia,ib=structure.atom_token_index[a],structure.atom_token_index[b]
        cross_chain+=int(structure.token_asym_id[ia]!=structure.token_asym_id[ib])
    result={'tokens':structure.num_tokens,'atoms':int(structure.atom_exists_mask.sum()),
            'msa_active_rows':int(active_rows.sum()),'msa_active_cells':int(msa.mask.sum()),
            'msa_nonquery_rows_covering_all_chains':shared_count,
            'msa_nonquery_rows_with_shared_pairing_keys':paired_count,
            'templates':context.template_context.num_nonnull_templates,'restraints':restraint_counts,
            'covalent_bonds':len(bonds[0]),'cross_chain_covalent_bonds':cross_chain,
            'embedding_scope':'disabled only for feature inspection; predictions use the shipped ESM model'}
    if not 0<result['tokens']<=256:raise ValueError('Case exceeds the declared native token bound')
    if args.msa_directory and result['msa_active_rows']<2:raise ValueError('Local MSA has no nonquery features')
    if args.msa_pairing=='paired' and paired_count<1:raise ValueError('Paired MSA has no shared nonquery pairing key across chains')
    if args.msa_pairing=='unpaired' and paired_count:raise ValueError('Unpaired MSA unexpectedly pairs nonquery rows')
    if args.template_hits_path and result['templates']<1:raise ValueError('Supplied template produced no native template features')
    if args.require_restraint and not sum(restraint_counts.values()):raise ValueError('Native restraint features are empty')
    if args.require_covalent and cross_chain<1:raise ValueError('Explicit interchain covalent bond is absent')
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/'features.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))


def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='operation',required=True)
    m=sub.add_parser('msa');m.add_argument('fasta',type=Path);m.add_argument('output',type=Path);m.add_argument('--paired',action='store_true')
    a=sub.add_parser('audit');a.add_argument('fasta',type=Path);a.add_argument('output',type=Path)
    a.add_argument('--msa-directory',type=Path);a.add_argument('--template-hits-path',type=Path);a.add_argument('--constraint-path',type=Path);a.add_argument('--msa-pairing',choices=['paired','unpaired'])
    a.add_argument('--require-restraint',action='store_true');a.add_argument('--require-covalent',action='store_true')
    args=p.parse_args()
    if args.operation=='msa':msa(args.fasta,args.output,args.paired)
    else:audit(args)

if __name__=='__main__':main()
