"""Run the saved small source fixture with an explicitly recreated environment."""

from pathlib import Path
import shutil
import subprocess
import sys

stage = sys.argv[1]
source = Path("/scratch/fixture-source")
saved = Path("/workspace/custom/fixture")
saved.mkdir(parents=True, exist_ok=True)


def run(*args: str) -> None:
    subprocess.run(list(args), check=True)


if stage == "before":
    run(sys.executable, "/inputs/custom-code/example/prepare.py", str(source))
    run(
        sys.executable,
        "/inputs/custom-code/source_bundle.py",
        "save",
        str(source),
        str(saved / "source.tar"),
        "--tool",
        "base",
    )
    shutil.copyfile(source / "bootstrap.py", saved / "bootstrap.py")
else:
    run(
        sys.executable,
        "/inputs/custom-code/source_bundle.py",
        "unpack",
        str(saved / "source.tar"),
        str(source),
    )
assert (source / "entry.py").is_symlink() and (source / "entry.py").readlink() == Path(
    "run.py"
)
assert (
    not (source / ".git").exists() if stage == "after" else (source / ".git").is_dir()
)
run(sys.executable, str(saved / "bootstrap.py"), str(source), "/scratch/fixture-env")
result = str(saved / (stage + ".json"))
run(
    "/scratch/fixture-env/bin/python",
    str(source / "entry.py"),
    str(source / "sequences.fasta"),
    result,
)
run(sys.executable, "/inputs/custom-code/example/check.py", result)
