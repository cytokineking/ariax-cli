"""Save a complete native directory as one ordinary Forge Files export.

Packing verifies every member before moving the source to an explicit scratch
backup. Unpacking is an explicit output operation and requires an absent target.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path, PurePosixPath
import shutil
import tarfile


def members(archive: tarfile.TarFile) -> list[tarfile.TarInfo]:
    values=archive.getmembers()
    for m in values:
        p=PurePosixPath(m.name)
        if p.is_absolute() or '..' in p.parts or not (m.isfile() or m.isdir()):
            raise ValueError('Only safe regular native files/directories may be archived')
    return values


def equal_streams(left, right) -> bool:
    while True:
        a=left.read(1024*1024);b=right.read(1024*1024)
        if a!=b:return False
        if not a:return True


def pack(source: Path, archive: Path, backup: Path) -> dict:
    if not source.is_dir() or archive.exists() or backup.exists():raise ValueError('Fresh archive and backup paths required')
    if archive.is_relative_to(source) or backup.is_relative_to(source):raise ValueError('Archive and backup must be outside native source')
    paths={str(p.relative_to(source.parent)):p for p in source.rglob('*') if p.is_file()}
    if any(p.is_symlink() for p in source.rglob('*')):raise ValueError('Native source links are not accepted')
    partial=archive.with_name(archive.name+'.partial')
    if partial.exists():raise ValueError('Preserve/review previous partial archive before packing')
    with tarfile.open(partial,'w:gz') as t:t.add(source,arcname=source.name)
    with tarfile.open(partial,'r:gz') as t:
        files=[m for m in members(t) if m.isfile()]
        if {m.name for m in files}!=set(paths):raise ValueError('Native archive member set differs')
        for m in files:
            with paths[m.name].open('rb') as left,t.extractfile(m) as right:
                if not equal_streams(left,right):raise ValueError('Native archive file bytes differ: '+m.name)
    partial.rename(archive);backup.parent.mkdir(parents=True,exist_ok=True)
    shutil.move(str(source),str(backup))
    return {'archive':str(archive),'source_backup':str(backup),'files':len(paths),'native_bytes':sum(p.stat().st_size for p in backup.rglob('*') if p.is_file()),'archive_bytes':archive.stat().st_size,'member_bytes_equal':True}


def unpack(archive: Path, destination: Path) -> dict:
    with tarfile.open(archive,'r:gz') as t:
        values=members(t);roots={PurePosixPath(m.name).parts[0] for m in values}
        if len(roots)!=1:raise ValueError('Expected one complete native directory')
        target=destination/next(iter(roots))
        if target.exists():raise ValueError('Unpack target must be absent')
        t.extractall(destination,filter='data')
    return {'archive':str(archive),'restored_directory':str(target),'files':sum(p.is_file() for p in target.rglob('*')),'scientific_replay':False}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='action',required=True)
    a=sub.add_parser('pack');a.add_argument('source',type=Path);a.add_argument('archive',type=Path);a.add_argument('--backup',type=Path,required=True)
    a=sub.add_parser('unpack');a.add_argument('archive',type=Path);a.add_argument('--destination',type=Path,required=True)
    a=p.parse_args();result=pack(a.source,a.archive,a.backup) if a.action=='pack' else unpack(a.archive,a.destination)
    print(json.dumps(result,indent=2))
