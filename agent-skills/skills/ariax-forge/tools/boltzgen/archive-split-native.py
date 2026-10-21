"""Save and explicitly restore complete native outputs as ordinary archive parts.

Each part fits the shipped Files per-file limit. No science runs during packing
or unpacking. Existing destinations and partial attempts require explicit review.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path, PurePosixPath
import shutil
import tarfile

CHUNK = 1024**2


def equal_streams(left, right):
    while True:
        a, b = left.read(CHUNK), right.read(CHUNK)
        if a != b:
            raise ValueError('Archived native file bytes differ')
        if not a:
            return


def members(bundle):
    values = bundle.getmembers()
    seen = set()
    for item in values:
        path = PurePosixPath(item.name)
        if (path.is_absolute() or '..' in path.parts or not path.parts
                or not (item.isfile() or item.isdir()) or item.name in seen):
            raise ValueError('Expected unique safe regular files and directories')
        seen.add(item.name)
    roots = {PurePosixPath(item.name).parts[0] for item in values}
    if len(roots) != 1:
        raise ValueError('Expected one complete native directory')
    return values, next(iter(roots))


def pack(source, destination, backup, part_bytes):
    if (not source.is_dir() or destination.exists() or backup.exists()
            or destination.is_relative_to(source) or backup.is_relative_to(source)):
        raise ValueError('Fresh external archive and backup paths required')
    if not 1 <= part_bytes <= 20 * 1024**3:
        raise ValueError('Parts must fit the shipped 20-GiB Files limit')
    paths = {}
    for path in source.rglob('*'):
        if path.is_symlink():
            raise ValueError('Native source links are not accepted')
        if path.is_file():
            paths[str(path.relative_to(source.parent))] = path
    if not paths:
        raise ValueError('Native source has no regular files')
    destination.mkdir(parents=True)
    temporary = destination / 'complete.tar.gz.pending'
    with tarfile.open(temporary, 'w:gz', compresslevel=3) as bundle:
        bundle.add(source, arcname=source.name)
    with tarfile.open(temporary, 'r:gz') as bundle:
        values, root = members(bundle)
        files = [item for item in values if item.isfile()]
        if {item.name for item in files} != set(paths):
            raise ValueError('Native archive member set differs')
        for item in files:
            with paths[item.name].open('rb') as left, bundle.extractfile(item) as right:
                equal_streams(left, right)
    parts = []
    with temporary.open('rb') as incoming:
        while True:
            chunk = incoming.read(min(CHUNK, part_bytes))
            if not chunk:
                break
            name = f'part-{len(parts):04d}.tar.gz.part'
            size = 0
            with (destination / name).open('xb') as out:
                while chunk:
                    out.write(chunk)
                    size += len(chunk)
                    if size == part_bytes:
                        break
                    chunk = incoming.read(min(CHUNK, part_bytes - size))
            parts.append(dict(name=name, size_bytes=size))
    # Check the ordinary ordered parts directly against the completed archive.
    with temporary.open('rb') as original:
        for part in parts:
            with (destination / part['name']).open('rb') as saved:
                while chunk := saved.read(CHUNK):
                    if chunk != original.read(len(chunk)):
                        raise ValueError('Archive part bytes differ')
        if original.read(1):
            raise ValueError('Archive parts are incomplete')
    report = dict(native_directory=root, files=len(paths),
                  native_bytes=sum(path.stat().st_size for path in paths.values()),
                  archive_bytes=temporary.stat().st_size, part_bytes=part_bytes, parts=parts)
    manifest = destination / 'manifest.json.pending'
    manifest.write_text(json.dumps(report, indent=2) + '\n')
    backup.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(source, backup)
    manifest.rename(destination / 'manifest.json')
    temporary.unlink()
    return dict(state='complete_native_archive_parts_saved', **report,
                source_backup=str(backup), member_bytes_equal=True, part_bytes_equal=True)


def unpack(source, destination, temporary):
    saved = json.loads((source / 'manifest.json').read_text())
    root = saved['native_directory']
    if (PurePosixPath(root).parts != (root,) or root in ('.', '..')
            or (destination / root).exists() or temporary.exists()
            or temporary.is_relative_to(source) or temporary.is_relative_to(destination)):
        raise ValueError('Absent output and external temporary file required')
    parts = saved['parts']
    if not parts or sum(p['size_bytes'] for p in parts) != saved['archive_bytes']:
        raise ValueError('Archive parts are incomplete')
    temporary.parent.mkdir(parents=True, exist_ok=True)
    with temporary.open('xb') as output:
        for index, part in enumerate(parts):
            if part['name'] != f'part-{index:04d}.tar.gz.part':
                raise ValueError('Archive part order differs')
            path = source / part['name']
            if (path.is_symlink() or not path.is_file() or path.stat().st_size != part['size_bytes']
                    or not 1 <= part['size_bytes'] <= saved['part_bytes'] <= 20 * 1024**3):
                raise ValueError('Archive part size/type differs')
            with path.open('rb') as incoming:
                shutil.copyfileobj(incoming, output, CHUNK)
    with tarfile.open(temporary, 'r:gz') as bundle:
        values, actual_root = members(bundle)
        files = [item for item in values if item.isfile()]
        if (actual_root != root or len(files) != saved['files']
                or sum(item.size for item in files) != saved['native_bytes']):
            raise ValueError('Native archive contents differ from the manifest')
        bundle.extractall(destination, filter='data')
        for item in files:
            with bundle.extractfile(item) as archived, (destination / item.name).open('rb') as restored:
                equal_streams(archived, restored)
    temporary.unlink()
    return dict(state='complete_native_archive_parts_restored', restored_directory=str(destination / root),
                files=len(files), native_bytes=saved['native_bytes'],
                every_extracted_member_byte_equal=True, scientific_replay=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    p = sub.add_parser('pack')
    p.add_argument('source', type=Path)
    p.add_argument('destination', type=Path)
    p.add_argument('--backup', type=Path, required=True)
    p.add_argument('--part-bytes', type=int, default=4 * 1024**3)
    p = sub.add_parser('unpack')
    p.add_argument('source', type=Path)
    p.add_argument('--destination', type=Path, required=True)
    p.add_argument('--temporary-file', type=Path, required=True)
    args = parser.parse_args()
    result = (pack(args.source, args.destination, args.backup, args.part_bytes)
              if args.action == 'pack' else unpack(args.source, args.destination, args.temporary_file))
    print(json.dumps(result, indent=2))
