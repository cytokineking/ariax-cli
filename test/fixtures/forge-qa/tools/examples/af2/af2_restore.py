#!/usr/bin/env python3
"""Compare every restored project byte, then check all declared native results.

Run on the authorized remote GPU host. Never loads pickle or runs inference.
"""
from __future__ import annotations

import argparse
import filecmp
import json
from pathlib import Path
from af2_outputs import inspect


def compare(source: Path, restored: Path) -> dict:
    old={str(p.relative_to(source)):p for p in source.rglob('*')}
    new={str(p.relative_to(restored)):p for p in restored.rglob('*')}
    if old.keys()!=new.keys():
        raise ValueError('Complete project path set differs after restoration')
    count=total=0
    for name, a in old.items():
        b=new[name]
        if a.is_symlink() or b.is_symlink():
            raise ValueError('Files project contains a link; retain native cache first')
        if a.is_dir()!=b.is_dir() or a.is_file()!=b.is_file():
            raise ValueError(f'Restored file kind differs: {name}')
        if a.is_file():
            if not filecmp.cmp(a,b,shallow=False):
                raise ValueError(f'Restored file bytes differ: {name}')
            count+=1; total+=a.stat().st_size
    return {'files':count,'bytes':total,'all_project_bytes_equal':True}


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path)
    parser.add_argument('restored',type=Path)
    parser.add_argument('locations',type=Path,help='JSON list of id/result/manifest paths relative to the workspace')
    parser.add_argument('--matrix',type=Path,required=True)
    args=parser.parse_args()
    report=compare(args.source,args.restored)
    matrix=json.loads(args.matrix.read_text())
    rows=json.loads(args.locations.read_text())
    services=[x for x in matrix['service_cases'] if x.get('native_state')!='accepted_inherited']
    inherited={x['id'] for x in matrix['inherited_restore_cases']}
    for case in matrix['service_cases']:
        if case.get('native_state')=='accepted_inherited' and case.get('reuse_result') not in inherited:
            raise ValueError('Reused service case lacks its required inherited restoration row')
    required={x['id'] for x in services+matrix['capacity_profiles']+matrix['inherited_restore_cases']}
    ids=[row['id'] for row in rows]
    if len(ids)!=len(set(ids)) or set(ids)!=required:
        raise ValueError('Restoration must check every inherited and remaining matrix result exactly once')
    checks=[]
    for row in rows:
        paths=[]
        for key in ('result','manifest'):
            path=(args.restored/row[key]).resolve(strict=True)
            if not path.is_relative_to(args.restored.resolve()):
                raise ValueError('Scientific restore path escapes the restored project')
            paths.append(path)
        checked=inspect(paths[0],json.loads(paths[1].read_text()))
        checks.append({'id':row['id'],'result':checked})
    if not checks:
        raise ValueError('Scientific restoration needs every completed result location')
    report.update(scientific_checks=checks,scientific_replay=False,pickle_loaded=False)
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    main()
