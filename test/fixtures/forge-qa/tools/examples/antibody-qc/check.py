"""Check observable scientific identities and controlled motif change in native output."""
import argparse
import json
from pathlib import Path

def check(input_path, output_path):
    inputs = json.loads(input_path.read_text()); report = json.loads(output_path.read_text())
    assert report['status'] == 'succeeded' and len(report['results']) == len(inputs)
    for original, result in zip(inputs, report['results']):
        assert original['id'] == result['id'] and original['kind'] == result['kind']
        for chain in result['chains']:
            seq = original[chain['chain']]; residues = chain['residues']
            assert ''.join(r['aa'] for r in residues) == seq
            assert [r['input_index'] for r in residues] == list(range(1, len(seq) + 1))
            assert len({r['position'] for r in residues}) == len(seq)
            assert {r['region'] for r in residues} == {'FR1','CDR1','FR2','CDR2','FR3','CDR3','FR4'}
            if 'oasis' in chain:
                o = chain['oasis']; assert len(o['peptides']) == len(seq) - 8
                for p in o['peptides']:
                    assert p['peptide'] == seq[p['start'] - 1:p['start'] + 8]
                    assert 0 <= p['fraction_subjects'] <= 1
                for threshold, score in o['scores'].items():
                    n = sum(p['fraction_subjects'] >= score['min_fraction_subjects'] for p in o['peptides'])
                    assert n == score['human_peptides'] and score['identity'] == n / (len(seq) - 8)
                    if original['kind'] == 'vhh':assert score['percentile'] is None and score['percentile_reason'] == 'no_vhh_calibration'
        if 'paired_oasis' in result:
            for name, score in result['paired_oasis'].items():
                parts = [chain['oasis']['scores'][name] for chain in result['chains']]
                count = sum(p['human_peptides'] for p in parts)
                total = sum(p['total_peptides'] for p in parts)
                assert score['human_peptides'] == count and score['total_peptides'] == total
                assert score['identity'] == count / total
    by_id = {r['id']: r for r in report['results']}
    if 'paired-alert' in by_id:
        alert = by_id['paired-alert']['chains'][0]; changed = by_id['paired-changed']['chains'][0]
        assert any(a['method'] == 'n_linked_glycosylation' and a['motif'] == 'NGT' and all(r['region'] == 'CDR3' for r in a['residues']) for a in alert['liabilities'])
        assert not any(a['method'] == 'n_linked_glycosylation' and a['motif'] == 'NGT' for a in changed['liabilities'])
        assert sum(a != b for a,b in zip(alert['sequence'], changed['sequence'])) == 1
    if 'vhh-1zvh' in by_id and 'tnp_sequence' in by_id['vhh-1zvh']:
        tnp = by_id['vhh-1zvh']['tnp_sequence']; assert tnp['total_cdr_length'] == sum(map(len,tnp['cdr_sequences']))
        assert tnp['cdr3_length'] == len(tnp['cdr_sequences'][2])
    print(json.dumps({'checked_inputs': len(inputs), 'residue_identity': True, 'explicit_motif_change': 'paired-alert' in by_id, 'native_peptide_counts': 'oasis' in report['methods']}))

if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('output',type=Path);a=p.parse_args();check(a.input,a.output)
