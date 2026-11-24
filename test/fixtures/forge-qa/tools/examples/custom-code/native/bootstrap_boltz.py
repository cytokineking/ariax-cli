"""Explicitly recreate a scratch environment using compatible image packages."""

import json
import os
from pathlib import Path
import subprocess
import sys
import venv

source, environment, output = map(Path, sys.argv[1:])
if environment.exists():
    raise SystemExit("Choose a fresh scratch environment")
for key, value in {
    "PIP_CACHE_DIR": "/scratch/pip",
    "XDG_CACHE_HOME": "/scratch/cache",
    "PYTHONUSERBASE": "/scratch/python-user",
    "PYTHONDONTWRITEBYTECODE": "1",
}.items():
    os.environ[key] = value
venv.EnvBuilder(with_pip=True, system_site_packages=True).create(environment)
python = str(environment / "bin/python")
subprocess.run(
    [
        python,
        "-m",
        "pip",
        "install",
        "--no-deps",
        "--no-build-isolation",
        "--editable",
        str(source),
    ],
    check=True,
)
subprocess.run([python, "-m", "pip", "check"], check=True)
probe = 'import boltz.main,json,sys,torch,importlib.metadata as m; print(json.dumps({"source_file":boltz.main.__file__,"python":sys.version,"boltz":m.version("boltz"),"torch":torch.__version__,"cuequivariance":m.version("cuequivariance"),"cuda_available":torch.cuda.is_available(),"cuda_device":torch.cuda.get_device_name(0),"cuda_tensor":float(torch.ones(1,device="cuda").item())}))'
record = json.loads(subprocess.check_output([python, "-c", probe], text=True))
if not Path(record["source_file"]).is_relative_to(source):
    raise SystemExit("Selected environment loaded shipped source")
if record["torch"] != "2.9.0+cu128":
    raise SystemExit("Heavy dependency changed")
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps(record))
