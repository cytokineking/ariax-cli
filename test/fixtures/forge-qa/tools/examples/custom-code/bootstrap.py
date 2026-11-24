"""Recreate the fixture venv and install its local wheel without network access."""
from __future__ import annotations

import os
import subprocess
import sys
import venv
import zipfile
from pathlib import Path

source, environment = map(Path, sys.argv[1:])
if environment.exists():
    raise SystemExit("Choose a new scratch environment directory")
os.environ["PIP_CACHE_DIR"] = str(environment.parent / "pip-cache")
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
venv.EnvBuilder(with_pip=True, system_site_packages=True).create(environment)
wheel = environment / "fixture_stats-0.1-py3-none-any.whl"
info = "fixture_stats-0.1.dist-info"
with zipfile.ZipFile(wheel, "w") as package:
    package.write(source / "dependency/fixture_stats.py", "fixture_stats.py")
    package.writestr(info + "/METADATA", "Metadata-Version: 2.1\nName: fixture-stats\nVersion: 0.1\n")
    package.writestr(info + "/WHEEL", "Wheel-Version: 1.0\nGenerator: forge-fixture\nRoot-Is-Purelib: true\nTag: py3-none-any\n")
    # Wheel's standard RECORD permits empty hash/size fields for local files.
    package.writestr(info + "/RECORD", "\n".join(name + ",," for name in ["fixture_stats.py", info + "/METADATA", info + "/WHEEL", info + "/RECORD"]) + "\n")
subprocess.run([str(environment / "bin/python"), "-m", "pip", "install", "--no-index", "--no-deps", str(wheel)], check=True)
print(environment)
