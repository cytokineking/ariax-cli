"""Read back native structures and the package handoffs, without scientific replay."""
import argparse
import json
from pathlib import Path
import numpy as np
import gemmi

AA = dict(zip('ALA ARG ASN ASP CYS GLN GLU GLY HIS ILE LEU LYS MET PHE PRO SER THR TRP TYR VAL'.split(), 'ARNDCQEGHILKMFPSTWYV'))
RNA = dict(zip('A C G U'.split(), 'ACGU'))
DNA = dict(zip('DA DC DG DT'.split(), 'ACGT'))


def check(root: Path) -> dict:
    settings = json.loads((root / 'settings.json').read_text())
    result = json.loads((root / 'result.json').read_text())
    experiment=json.loads((root/'experiment_config.json').read_text())
    model=json.loads((root/'model_config.json').read_text())
    queries=set(settings['query']['queries']);seeds=experiment['experiment_settings']['seeds']
    samples=model['architecture']['shared']['diffusion']['no_full_rollout_samples']
    assert queries and seeds and samples>0, 'Empty prediction request'
    expected={(q,seed,sample) for q in queries for seed in seeds for sample in range(1,samples+1)}
    records=[json.loads((root/r).read_text()) for r in result['handoffs']]
    observed={(h['input_id'],h['seed'],h['sample']['index']) for h in records}
    assert len(records)==len(expected) and observed==expected, 'Missing, duplicate or extra handoff'
    expected_structures={f'{q}/seed_{seed}/{q}_seed_{seed}_sample_{sample}_model.cif' for q,seed,sample in expected}
    assert {str(p.relative_to(root)) for p in root.glob('*/seed_*/*_model.cif')}==expected_structures, 'Missing or extra native structure'
    for suffix in ('_confidences.json','_confidences_aggregated.json'):
        assert {str(p.relative_to(root)) for p in root.glob('*/seed_*/*'+suffix)}=={p.removesuffix('_model.cif')+suffix for p in expected_structures}, 'Missing or extra native confidence file'
    assert {str(p.relative_to(root)) for p in root.glob('*/seed_*/*_batch.pt')}=={f'{q}/seed_{seed}/{q}_seed_{seed}_batch.pt' for q in queries for seed in seeds}, 'Missing or extra native feature file'
    reports = []
    for relative in result['handoffs']:
        path = root / relative
        h = json.loads(path.read_text())
        full = json.loads((path.parent / h['native_files']['confidence']).read_text())
        exported = json.loads((path.parent / h['files']['confidence']).read_text())
        summary = json.loads((path.parent / h['files']['summary']).read_text())
        c = gemmi.cif.read_file(str(path.parent / h['files']['structure'])).sole_block().get_mmcif_category('_atom_site.')
        assert exported['atom_plddts'] == full['plddt'], 'atom confidence values changed'
        if 'pae' in full:
            assert exported['pae'] == full['pae'], 'PAE values changed'
        assert abs(float(np.mean(full['plddt'])) - summary['avg_plddt']) < 0.00002, 'mean pLDDT changed'
        for key, label in (('ptm', 'pTM'), ('iptm', 'ipTM')):
            if summary.get(key) is not None:
                assert label not in h['unavailable'], 'Native summary marked unavailable'
        atoms = h['mapping']['atoms']
        assert len(atoms) == len(c['id'])
        mapping=h['mapping'];n=len(mapping['tokens'])
        assert n>0
        for key in ('token_chain_ids','token_res_ids','native_token_index','native_asym_id'):
            assert len(mapping[key])==n, 'Token-map cardinality changed: '+key
        for key in ('native_atoms','native_elements','atom_to_token_index'):
            assert len(mapping[key])==len(atoms), 'Atom-map cardinality changed: '+key
        assert set(mapping['atom_to_token_index'])==set(range(n)), 'Token membership missing or out of range'
        assert np.asarray(full['plddt']).shape==(len(atoms),)
        assert np.isfinite(full['plddt']).all() and np.min(full['plddt'])>=0 and np.max(full['plddt'])<=100
        for key in ('pae','pde'):
            if key in full:
                array=np.asarray(full[key]);assert array.shape==(n,n), 'Native confidence dimensions changed: '+key
                assert np.isfinite(array).all() and np.min(array)>=0, 'Invalid native confidence: '+key
        coords = np.array([[float(c[k][i]) for k in ('Cartn_x', 'Cartn_y', 'Cartn_z')] for i in range(len(c['id']))])
        assert np.isfinite(coords).all()
        assert len({(a['chain'], a['residue'], a['name'], a['atom']) for a in atoms}) == len(atoms), 'duplicate atoms'
        for i,a in enumerate(atoms):
            assert h['mapping']['native_elements'][i].upper() == c['type_symbol'][i].upper(), 'atom element changed'
            assert (a['chain'],a['name'],a['atom']) == (c['label_asym_id'][i],c['label_comp_id'][i],c['label_atom_id'][i])
        query = settings['query']['queries'][h['input_id']]
        for chain_spec in query['chains']:
            for chain in chain_spec['chain_ids']:
                chain_atoms = [a for a in atoms if a['chain'] == chain]
                assert chain_atoms, 'input chain lost'
                identities = list(dict.fromkeys((a['residue'],a['name']) for a in chain_atoms))
                kind = chain_spec['molecule_type'].lower()
                if kind in ('protein','rna','dna'):
                    alphabet = {'protein': AA, 'rna': RNA, 'dna': DNA}[kind]
                    assert [number for number,_ in identities] == list(range(1,len(identities)+1)), 'residue register changed'
                    if kind=='protein':
                        reverse={v:k for k,v in AA.items()}
                        modified=chain_spec.get('non_canonical_residues') or {}
                        expected=[modified.get(str(i),modified.get(i,reverse.get(letter))) for i,letter in enumerate(chain_spec['sequence'],1)]
                        assert [name for _,name in identities]==expected, 'input protein/modified-residue identity changed'
                    else:
                        assert ''.join(alphabet[name] for _,name in identities) == chain_spec['sequence'], 'input sequence/register changed'
                elif kind=='ligand' and chain_spec.get('ccd_codes'):
                    assert {a['name'] for a in chain_atoms} == {chain_spec['ccd_codes']}, 'ligand CCD identity lost'
        reports.append({'handoff': relative, 'atoms': len(atoms), 'tokens': len(h['mapping']['tokens']),
                        'native_array_max_difference': 0.0, 'sample': h['sample'],
                        'native_pae_available': 'pae' in full, 'confidence_units': h['plddt_scale']})
    return {'pair': settings['pair'], 'predictions': reports, 'geometry': 'See B34 geometry reports; no docking-accuracy claim'}

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('root',type=Path)
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    args.output.write_text(json.dumps(check(args.root),indent=2)+'\n')
