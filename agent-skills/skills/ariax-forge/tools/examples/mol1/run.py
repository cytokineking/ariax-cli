"""Run a bundled no-MSA Mol-1 fixture remotely and retain its native evidence.

This helper is original Ariax CLI source, under the repository's Elastic
License 2.0. It is not an upstream scientific implementation or qualification.
"""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

SOURCE = "6ad1a133f919dc79b4f829bdc24fad28b9c4d3f0"
MODEL_ROOT = Path("/models/mol1-models")
CHEMICAL_ROOT = Path("/models/mol1-chemical")
CHECKPOINT = MODEL_ROOT / "checkpoint/mol-1-base.pt"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--profile", choices=("default", "smoke"), default="default")
    args = parser.parse_args()
    output = args.out_dir.resolve()
    if output == Path("/workspace") or not output.is_relative_to("/workspace"):
        parser.error("--out-dir must be a new directory below /workspace")
    source = args.input.resolve(strict=True)
    payload = source.read_bytes()
    jobs = json.loads(payload)
    if not isinstance(jobs, list) or not jobs:
        parser.error("input must be a nonempty job list")
    for job in jobs:
        name = job.get("name", "")
        if not name or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for c in name):
            parser.error("job names must contain only letters, numbers, underscores or hyphens")
    if len({job["name"] for job in jobs}) != len(jobs):
        parser.error("job names must be unique")
    required = [CHECKPOINT] + [CHEMICAL_ROOT / "common" / name for name in (
        "components.cif", "components.cif.rdkit_mol.pkl",
        "clusters-by-entity-40.txt", "obsolete_release_date.csv",
    )]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        parser.error("prepared assets missing; do not download in the workload: " + ", ".join(missing))
    # mkdir refuses existing output, including a restored or interrupted run.
    output.mkdir(parents=True, exist_ok=False)
    (output / "input.json").write_bytes(payload)
    shutil.copyfile(__file__, output / "run.py")
    scratch = Path("/scratch/mol1")
    cache_paths = {
        "TMPDIR": scratch / "tmp",
        "TMP": scratch / "tmp",
        "TEMP": scratch / "tmp",
        "XDG_CACHE_HOME": scratch / "cache",
        "PYTHONPYCACHEPREFIX": scratch / "pycache",
        "TORCH_HOME": scratch / "torch",
        "TORCH_EXTENSIONS_DIR": scratch / "torch-extensions",
        "TORCHINDUCTOR_CACHE_DIR": scratch / "torchinductor",
        "TRITON_CACHE_DIR": scratch / "triton",
        "CUDA_CACHE_PATH": scratch / "cuda",
        "HF_HOME": scratch / "huggingface",
        "MPLCONFIGDIR": scratch / "matplotlib",
    }
    for path in cache_paths.values():
        path.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    environment.update({key: str(value) for key, value in cache_paths.items()})
    cycles, steps, samples = (20, 200, 5) if args.profile == "default" else (20, 200, 1)
    argv = [
        sys.executable, "-m", "mol.runner.inference",
        "--input_json_path", str(output / "input.json"),
        "--dump_dir", str(output / "predictions"),
        "--load_checkpoint_path", str(CHECKPOINT),
        "--model_name", "mol-1-base", "--device", "cuda:0", "--seeds", "101",
        "--model.N_cycle", str(cycles), "--sample_diffusion.N_step", str(steps),
        "--sample_diffusion.N_sample", str(samples), "--dtype", "bf16",
        "--use_msa", "false", "--use_template", "false", "--use_rna_msa", "false",
        "--use_seeds_in_json", "false", "--need_atom_confidence", "true",
        "--enable_tf32", "false",
    ]
    (output / "command.argv.json").write_text(json.dumps(argv, indent=2) + "\n")
    metadata = {
        "upstream_source": SOURCE,
        "model_name": "mol-1-base",
        "profile": args.profile,
        "requested_cycles": cycles, "requested_steps": steps, "requested_samples": samples,
        "seed": 101, "named_assets": ["mol1-models", "mol1-chemical"],
        "checkpoint_path": str(CHECKPOINT), "selected_asset_evidence": None,
        "conditioning": "no MSA; no templates; no RNA MSA",
        "cache_paths": {key: str(value) for key, value in cache_paths.items()},
        "qualification": "untested; helper records execution, not scientific acceptance",
    }
    (output / "run-metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"Native output and full log: {output}", flush=True)
    with (output / "run.log").open("wb") as log:
        result = subprocess.run(argv, cwd="/workspace", env=environment,
                                stdout=log, stderr=subprocess.STDOUT, check=False)
    (output / "exit-code.txt").write_text(str(result.returncode) + "\n")
    print(f"Native exit code: {result.returncode}; inspect run.log and predictions", flush=True)
    return result.returncode if result.returncode >= 0 else 128 - result.returncode


if __name__ == "__main__":
    sys.exit(main())
