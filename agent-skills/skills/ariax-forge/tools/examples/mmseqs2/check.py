"""Inspect native search, membership and A3M outputs from the bounded example."""
import argparse
import csv
import json
import math
from pathlib import Path

FIELDS = 'query,target,fident,pident,alnlen,qstart,qend,qlen,tstart,tend,tlen,evalue,bits,qcov,tcov,qaln,taln'.split(',')


def hits(path):
    rows = list(csv.DictReader(path.open(), fieldnames=FIELDS, delimiter='\t'))
    for row in rows:
        for key in ('fident', 'pident', 'evalue', 'bits', 'qcov', 'tcov'):
            assert math.isfinite(float(row[key])), (path, key)
        assert abs(float(row['pident'])-100*float(row['fident'])) < .15
        assert len(row['qaln']) == len(row['taln']) == int(row['alnlen'])
        assert int(row['qstart']) >= 1 and int(row['tstart']) >= 1
    return rows


def check(root, mode):
    broad = hits(root/'hits.tsv')
    strict = hits(root/'strict.tsv')
    coverage = hits(root/'target-coverage.tsv')
    assert hits(root/'empty.tsv') == []
    assert {r['target'] for r in broad} == {'HBB', 'HBB_copy', 'HBB_variant'}
    assert {r['target'] for r in strict} == {'HBB', 'HBB_copy'}
    assert 'HBB_fragment' in {r['target'] for r in coverage}
    assert all(float(r['qcov']) >= .8 and float(r['tcov']) >= .8 for r in broad)
    msa = list((root/'a3m').glob('*.a3m'))
    filtered = list((root/'filtered-a3m').glob('*.a3m'))
    assert len(msa) == len(filtered) == 1
    original = msa[0].read_text()
    reduced = filtered[0].read_text()
    assert original.startswith('>') and original.count('>') >= 3
    assert 1 <= reduced.count('>') < original.count('>')
    for block in original.split('>')[1:]:
        seq = ''.join(block.splitlines()[1:])
        assert len(''.join(c for c in seq if not c.islower())) == 147
    if mode == 'cpu':
        for name in ('cluster', 'linclust'):
            groups = {}
            for rep, member in csv.reader((root/(name+'_cluster.tsv')).open(),delimiter='\t'):
                groups.setdefault(rep,set()).add(member)
            assert sorted(map(len,groups.values())) == [1,1,3], groups
            assert {'HBB','HBB_copy','HBB_variant'} in groups.values()
            reps = (root/(name+'_rep_seq.fasta')).read_text()
            assert reps.count('>') == 3
    result = {'mode':mode,'search_hits':len(broad),'strict_hits':len(strict),'query_coordinate_length':147,'msa_sequences':original.count('>'),'filtered_msa_sequences':reduced.count('>'),'passed':True}
    (root/'checks.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root',type=Path)
    parser.add_argument('--mode',choices=['cpu','gpu'],required=True)
    args=parser.parse_args()
    print(json.dumps(check(args.root,args.mode)))
