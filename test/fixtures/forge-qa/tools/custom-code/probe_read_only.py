"""Run inside the selected Forge container to observe shipped-path protection."""
from __future__ import annotations

import argparse
import errno
import json
from pathlib import Path
from uuid import uuid4

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--path", action="append", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
results = []
for directory in args.path:
    if not directory.is_dir() or not any(directory.is_relative_to(root) for root in (Path("/opt"), Path("/models"))):
        raise SystemExit("Probe requires existing /opt or /models directories")
    target = directory / ("forge-custom-code-probe-" + str(uuid4()))
    try:
        with target.open("xb") as output:
            output.write(b"boundary probe\n")
    except OSError as exc:
        if exc.errno not in (errno.EROFS, errno.EACCES, errno.EPERM):
            raise
        results.append({"path": str(directory), "write_blocked": True, "errno": exc.errno})
    else:
        target.unlink()
        results.append({"path": str(directory), "write_blocked": False})
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(results, indent=2) + "\n")
if not all(result["write_blocked"] for result in results):
    raise SystemExit("Shipped path accepted a write")
print("Shipped paths rejected writes")
