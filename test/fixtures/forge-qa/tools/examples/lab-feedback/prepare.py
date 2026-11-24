"""Run on a remote Forge workload. Build a public review panel and marked controls."""
import argparse
import csv
import json
from pathlib import Path
from uuid import uuid4

p = argparse.ArgumentParser()
p.add_argument('--csv', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
a = p.parse_args(); a.out.mkdir(parents=True, exist_ok=True)
with a.csv.open(newline='', encoding='utf-8-sig') as stream:
    rows = list(csv.DictReader(stream))
selected = []
target = None
for row in rows:
    evaluations = json.loads(row['evaluations'])
    matches = [e for e in evaluations if e.get('type') == 'experimental' and e.get('method') == 'bli' and e.get('target')]
    if not matches or ':' in row['sequence'] or set(row['sequence'].upper()) - set('ACDEFGHIKLMNPQRSTVWY'):
        continue
    if target is None: target = matches[0]['target']
    if not any(e['target'] == target for e in matches): continue
    selected.append(row)
    if len(selected) == 2: break
assert len(selected) == 2, 'Need two public single-chain BLI records for the same target'
shortlist = {'request_id': '7d02cc88-1139-4a74-81fb-f9674156bc73', 'name': 'ProteinBase public review pilot',
             'target': {'catalog_id': None, 'context': target + '; original assay target slug; construct, tags, domain and reference state await review', 'construct_verified': False},
             'assay': {'experiment_type': 'affinity', 'method': 'bli', 'n_replicates': 3, 'antigen_concentrations': [1000,316.2,100,31.6,0], 'concentration_unit': 'nM'},
             'candidates': [{'id': r['id'], 'chains': [{'id':'A','sequence':r['sequence']}], 'sequence_metadata': {'type':'SingleChain'}, 'provenance': {'source':'ProteinBase public export', 'original_record':r, 'selection':'public assay review example; requires experimental selection review'}} for r in selected]}
(a.out/'shortlist.json').write_text(json.dumps(shortlist,indent=2)+'\n')
# These controls exercise importer behavior. Every row identifies its artificial origin.
controls=[]
for i, (value, unit) in enumerate([(1.0,'nM'),(2.0,'nM'),(3.0,None)]):
    controls.append({'id':'forge-control-only','name':'synthetic import control', 'sequence':'ACDEFGHIK', 'author':'Forge software control', 'designMethod':'synthetic-fixture',
                     'evaluations':json.dumps([{'type':'experimental','metric':'kd','target':'synthetic-target','valueType':'numeric','unit':unit,'value':value,'method':'synthetic-control','measuredAt':'2026-10-15T00:00:00Z'}])})
with (a.out/'controls.csv').open('w',newline='') as stream:
    writer=csv.DictWriter(stream,fieldnames=list(controls[0]));writer.writeheader();writer.writerows(controls)
print(json.dumps({'public_records': [r['id'] for r in selected], 'target_slug':target, 'artificial_controls':'controls.csv'}))
