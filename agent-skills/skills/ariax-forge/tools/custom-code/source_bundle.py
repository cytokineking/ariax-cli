"""Save a Git working tree as regular checkpoint files; unpack explicitly."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import stat
import subprocess
import tarfile
import tempfile
from pathlib import Path


def git(source: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(source), *args], check=True, capture_output=True,
        text=True, timeout=60,
    ).stdout


def save(source: Path, archive: Path, tool: str, assets: list[str]) -> dict:
    source = source.resolve(strict=True)
    if Path(git(source, "rev-parse", "--show-toplevel").strip()).resolve() != source:
        raise ValueError("Source must be the Git checkout root")
    archive = archive.absolute()
    if archive.is_symlink() or archive.with_suffix(".source.json").is_symlink():
        raise ValueError("Archive and source record must be regular files")
    if archive.resolve().is_relative_to(source):
        raise ValueError("Save the archive outside the source checkout")
    status = git(source, "status", "--porcelain=v1", "--untracked-files=all")
    record = {
        "commit": git(source, "rev-parse", "HEAD").strip(),
        "local_changes": bool(status),
        "status_porcelain": status,
        "tool": tool,
        "assets": assets,
    }
    names = sorted(set(git(source, "ls-files", "-z", "--cached", "--others", "--exclude-standard").split("\0")) - {""})
    archive.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=archive.parent, delete=False) as pending:
        temporary = Path(pending.name)
    try:
        with tarfile.open(temporary, "w", dereference=False) as bundle:
            for name in names:
                path = source / name
                if not path.parent.resolve().is_relative_to(source):
                    raise ValueError(f"Source path leaves checkout: {name}")
                try:
                    mode = path.lstat().st_mode
                except FileNotFoundError:
                    continue  # Preserve a tracked deletion by omitting its file.
                if stat.S_ISLNK(mode):
                    if os.path.isabs(os.readlink(path)) or not path.resolve().is_relative_to(source):
                        raise ValueError(f"Source symlink leaves checkout: {name}")
                elif not stat.S_ISREG(mode):
                    raise ValueError(f"Source contains a directory/submodule or special file: {name}")
                bundle.add(path, arcname=name, recursive=False)
        os.replace(temporary, archive)
    finally:
        temporary.unlink(missing_ok=True)
    # This is ordinary source metadata, separate from the shipped catalog record.
    with tempfile.NamedTemporaryFile(mode="w", dir=archive.parent, delete=False) as pending:
        temporary = Path(pending.name)
        json.dump(record, pending, indent=2)
        pending.write("\n")
    try:
        os.replace(temporary, archive.with_suffix(".source.json"))
    finally:
        temporary.unlink(missing_ok=True)
    return record


def unpack(archive: Path, destination: Path) -> None:
    # A new destination avoids overwriting live source or following old links.
    destination.mkdir(parents=True, exist_ok=False)
    try:
        with tarfile.open(archive, "r:*") as bundle:
            bundle.extractall(destination, filter="data")
    except BaseException:
        shutil.rmtree(destination)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="operation", required=True)
    pack = commands.add_parser("save")
    pack.add_argument("source", type=Path)
    pack.add_argument("archive", type=Path)
    pack.add_argument("--tool", required=True)
    pack.add_argument("--asset", action="append", default=[])
    restore = commands.add_parser("unpack")
    restore.add_argument("archive", type=Path)
    restore.add_argument("destination", type=Path)
    args = parser.parse_args()
    if args.operation == "save":
        print(json.dumps(save(args.source, args.archive, args.tool, args.asset)))
    else:
        unpack(args.archive, args.destination)
        print(args.destination)


if __name__ == "__main__":
    main()
