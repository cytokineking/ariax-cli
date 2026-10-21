"""Prepare bounded creator protein fixtures on the selected remote worker."""
import argparse
import json
from pathlib import Path
import urllib.request

p = argparse.ArgumentParser()
p.add_argument('--out', required=True, type=Path)
a = p.parse_args()
a.out.mkdir(parents=True, exist_ok=False)
url = 'https://raw.githubusercontent.com/wallnerlab/DockQ/d9cbb1940bb0f42db3257f7da3b0e96f162b94d9/examples/1A2K_r_l_b.pdb'
text = urllib.request.urlopen(url, timeout=30).read().decode()
(a.out / 'reference.pdb').write_text(text)
for name, move in [('relabeled', 0), ('changed', 50)]:
    rows = []
    for line in text.splitlines():
        if line.startswith(('ATOM  ', 'HETATM', 'TER   ')):
            chain = line[21]
            line = line[:21] + {'A': 'X', 'B': 'Y', 'C': 'Z'}.get(chain, chain) + line[22:]
            if chain == 'C' and move and line.startswith(('ATOM  ', 'HETATM')):
                line = line[:30] + f'{float(line[30:38])+move:8.3f}' + line[38:]
        rows.append(line)
    (a.out / (name + '.pdb')).write_text('\n'.join(rows) + '\n')
for name, groups in [('empty', {'model': [['X'], ['Z']], 'reference': [['X'], ['Z']]}),
                     ('mismatch', {'model': [['X'], ['Z', 'Y']], 'reference': [['A'], ['B', 'C']]}),
                     ('identity', {'model': [['A'], ['B', 'C']], 'reference': [['A'], ['B', 'C']]}),
                     ('relabeled', {'model': [['X'], ['Y', 'Z']], 'reference': [['A'], ['B', 'C']]}),
                     ('pair', {'model': [['X'], ['Z']], 'reference': [['A'], ['C']]})]:
    (a.out / (name + '-partners.json')).write_text(json.dumps(groups, indent=2) + '\n')
(a.out / 'provenance.json').write_text(json.dumps({'source': url, 'identity': 'creator 1A2K protein complex', 'changed_pose': 'author chain C translated +50 angstrom on X; all other coordinates retained', 'chain_relabel': {'A':'X','B':'Y','C':'Z'}, 'reduction': 'bounded creator fixture; no biological inference'}, indent=2) + '\n')

(a.out / 'table.json').write_text(json.dumps({'candidates': [{'id':'reference','reports':['/workspace/qc-dssp/result.json']},{'id':'relabeled','reports':['/workspace/qc-dockq/result.json']},{'id':'changed','reports':['/workspace/qc-changed/result.json']}]}, indent=2) + '\n')
