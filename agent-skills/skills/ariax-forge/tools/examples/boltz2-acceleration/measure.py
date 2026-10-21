"""Qualification instrumentation; native generation spans and total in-process time."""
import json
import runpy
import sys
import time
import resource
start = time.monotonic()
choice = sys.argv.pop(1)
import torch
from pytorch_lightning import Trainer
original = Trainer.predict
spans = []
def predict(self, *args, **kwargs):
    torch.cuda.synchronize()
    before = time.monotonic()
    try:
        return original(self, *args, **kwargs)
    finally:
        torch.cuda.synchronize()
        spans.append(time.monotonic() - before)
Trainer.predict = predict
try:
    if choice == "resid":
        sys.path.insert(0, "/opt/boltz2-acceleration")
        runpy.run_path("/opt/boltz2-acceleration/launch.py", run_name="__main__")
    elif choice == "off":
        from boltz.main import cli
        cli()
    else:
        raise SystemExit("Unknown comparison choice")
finally:
    print("B72_TIMING " + json.dumps({"process_peak_ram_kib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss, "generation_seconds": spans, "in_process_seconds": time.monotonic()-start, "cuda_peak_allocated_bytes": torch.cuda.max_memory_allocated(), "cuda_peak_reserved_bytes": torch.cuda.max_memory_reserved()}), flush=True)
