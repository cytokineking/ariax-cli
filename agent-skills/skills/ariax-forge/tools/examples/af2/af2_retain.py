#!/usr/bin/env python3
"""Retain native search-cache links in a tar before making caches Files-compatible.

Run on the owned remote GPU host after scientific work. Original prediction
files and opaque pickles remain untouched. The archive preserves native links.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import tarfile


def retain(cache: Path, archive: Path) -> dict:
    cache = cache.resolve(strict=True)
    links=[]
    for path in sorted(cache.rglob('*')):
        if path.is_symlink():
            target=path.resolve(strict=True)
            if not target.is_file() or not target.is_relative_to(cache):
                raise ValueError('Native cache link target must be a regular file inside that cache')
            links.append((path,target,path.readlink()))
    # Refuse overwrite so repeated retention cannot replace original-link evidence.
    with tarfile.open(archive, 'x', dereference=False) as out:
        out.add(cache, arcname=cache.name)
    with tarfile.open(archive) as saved:
        for member in saved.getmembers():
            source=cache.parent/member.name
            if member.isfile():
                with saved.extractfile(member) as a, source.open('rb') as b:
                    while True:
                        chunk=a.read(1024*1024)
                        if chunk != b.read(1024*1024):
                            raise ValueError('Native cache archive bytes changed')
                        if not chunk:
                            break
            elif member.issym() and str(source.readlink()) != member.linkname:
                raise ValueError('Native cache archive link changed')
    for path,target,_ in links:
        temporary=path.with_name(path.name+'.regular')
        with temporary.open('xb') as out, target.open('rb') as source:
            shutil.copyfileobj(source,out)
        temporary.replace(path)
    return {'archive':str(archive),'bytes':archive.stat().st_size,
            'materialized_links':[{'path':str(p.relative_to(cache)),'native_target':str(t)} for p,_,t in links],
            'native_archive_member_read':True,'prediction_files_modified':False}


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args=parser.parse_args()
    cache=args.cache.resolve(strict=True)
    archive=args.archive.resolve()
    if archive.is_relative_to(cache) or args.output.resolve().is_relative_to(cache):
        raise ValueError('Archive and link map must be outside the cache being retained')
    if args.output.exists():
        raise ValueError('Refuse to overwrite native cache link map')
    args.output.write_text(json.dumps(retain(cache,archive),indent=2)+'\n')


if __name__=='__main__':
    main()
