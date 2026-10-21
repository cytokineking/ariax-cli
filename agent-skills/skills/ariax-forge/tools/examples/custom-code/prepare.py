"""Create a committed source fixture, then a local edit and source symlink."""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

source = Path(sys.argv[1])
source.mkdir(parents=True, exist_ok=False)
fixture = Path(__file__).resolve().parent
for name in ("run.py", "bootstrap.py", "sequences.fasta"):
    shutil.copyfile(fixture / name, source / name)
(source / "dependency").mkdir()
shutil.copyfile(fixture / "dependency/fixture_stats.py", source / "dependency/fixture_stats.py")
(source / "entry.py").symlink_to("run.py")
(source / ".gitignore").write_text("__pycache__/\n")
commands = [["init", "--quiet"], ["add", "."], ["-c", "user.name=Forge fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Custom-code fixture upstream"]]
for args in commands:
    subprocess.run(["git", "-C", str(source), *args], check=True)
(source / "run.py").write_text((source / "run.py").read_text().replace('LABEL = "upstream"', 'LABEL = "project-local"'))
(source / "notes.txt").write_text("Local change: label the output project-local. Dependencies: fixture-stats 0.1 from saved source.\n")
print(source)
