"""Check saved exchange identities and preserved import conflicts after explicit commands."""
import argparse,json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--ledger',type=Path,required=True);p.add_argument('--original',type=Path);p.add_argument('--controls',action='store_true');a=p.parse_args()
x=json.loads(a.ledger.read_text());review=json.loads(a.ledger.with_name(a.ledger.stem+'-review.json').read_text())
assert x['schema']=='forge-lab-feedback-v1' and x['imports']
assert review['observations']
if a.original: assert x==json.loads(a.original.read_text()),'Recovered exchange changed'
if a.controls:
    controlled=[r for r in review['observations'] if r['protein_id']=='forge-control-only']
    assert len(controlled)==3
    assert any('missing_units' in r['flags'] and r['unit'] is None for r in controlled)
    assert sum('measurements_differ' in r['flags'] for r in controlled)==2
    assert all(r['provenance']['source']=='synthetic importer controls' for r in controlled)
print(json.dumps({'retained_imports':len(x['imports']),'observations':len(review['observations']),'identity_and_provenance':True}))
