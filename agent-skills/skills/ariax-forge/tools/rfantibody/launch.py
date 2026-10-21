#!/usr/bin/env python3
"""Explicit native RFantibody stages with named assets and saved settings."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time
import tempfile
import math
import re

REVISION = "3e5a5bb1cb98befde9fc049ae3ff58cabb491f67"
WEIGHTS = {"generate": "RFdiffusion_Ab.pt", "sequence": "ProteinMPNN_v48_noise_0.2.pt", "predict": "RF2_ab.pt"}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="stage", required=True)
    for stage in WEIGHTS:
        q = sub.add_parser(stage)
        q.add_argument("--out", type=Path, required=True, help="New workspace directory for this stage")
        if stage == "generate":
            q.add_argument("--target", type=Path, required=True)
            q.add_argument("--framework", type=Path, required=True)
            q.add_argument("--design-loops", default="H1:,H2:,H3:,L1:,L2:,L3:")
            q.add_argument("--hotspots")
            q.add_argument("--num-designs", type=int, default=10)
            q.add_argument("--steps", type=int, default=50)
        else:
            inputs = q.add_mutually_exclusive_group(required=True)
            inputs.add_argument("--input", type=Path, help="Native PDB directory")
            inputs.add_argument("--input-quiver", type=Path)
            if stage == "predict":
                inputs.add_argument("--input-pdb", type=Path)
                inputs.add_argument("--input-json", type=Path)
        if stage != "predict":
            q.add_argument("--output-quiver", action="store_true")
        if stage == "sequence":
            q.add_argument("--loops", default="H1,H2,H3,L1,L2,L3")
            q.add_argument("--num-sequences", type=int, default=1)
            q.add_argument("--temperature", type=float, default=0.1)
        if stage == "predict":
            q.add_argument("--recycles", type=int, default=10)
            q.add_argument("--seed", type=int)
            q.add_argument("--hotspot-show-proportion", type=float, default=0.1)
        else:
            q.add_argument("--deterministic", action="store_true")
    a = p.parse_args()
    if a.stage == "generate":
        if not 1 <= a.num_designs <= 10 or not 1 <= a.steps <= 50:
            p.error("Qualified generation bounds are 1–10 designs and 1–50 steps")
        loops = a.design_loops.split(",")
        if not loops or len({loop.split(":")[0] for loop in loops}) != len(loops):
            p.error("Design loops must be distinct")
        for loop in loops:
            match = re.fullmatch(r"([HL][123]):(?:(\d+)(?:-(\d+))?)?", loop)
            if not match or (match[2] and not 1 <= int(match[2]) <= int(match[3] or match[2]) <= 40):
                p.error("Use explicit H1/H2/H3/L1/L2/L3 lengths or increasing positive ranges")
    elif a.stage == "sequence":
        if not 1 <= a.num_sequences <= 4 or not math.isfinite(a.temperature) or not 0 < a.temperature <= 1:
            p.error("Qualified sequence bounds are 1–4 samples and temperature in (0,1]")
        if any(not re.fullmatch(r"[HL][123]", loop) for loop in a.loops.split(",")) or len(set(a.loops.split(","))) != len(a.loops.split(",")):
            p.error("Sequence loops must be distinct H1/H2/H3/L1/L2/L3 labels")
    elif not 0 <= a.recycles <= 10 or not math.isfinite(a.hotspot_show_proportion) or not 0 <= a.hotspot_show_proportion <= 1 or (a.seed is not None and not 0 <= a.seed < 2**32):
        p.error("Use 0–10 recycles, visibility in [0,1], and an unsigned 32-bit seed")
    out = a.out.resolve()
    if not out.is_relative_to(Path("/workspace")):
        p.error("--out must be under /workspace")
    if out.exists():
        p.error("Use a new output directory; retained stages are never overwritten or replayed")
    if len(os.sched_getaffinity(0)) < 8:
        p.error("RFantibody requires at least eight assigned CPU cores")
    from check_outputs import read_hlt, read_target
    from prepare import read_pdb
    if a.stage == "generate":
        framework = read_hlt(a.framework)
        if list(framework["sequences"]) not in [["H", "L"], ["H"]]:
            p.error("Framework must contain explicit H/L or H-only chains")
        target = read_target(a.target)
        raw_target, _ = read_pdb(a.target)
        if any(not label.isdecimal() for entries in raw_target.values() for label in entries) or any(not r["source_residue"].isdecimal() for r in framework["residue_map"]):
            p.error("Native HLT requires unambiguous integer residue labels; retain an explicit renumbering sidecar")
        maximum = len(target["residue_map"]) + len(framework["residue_map"])
        for loop in loops:
            label, length = loop.split(":")
            present = sum(r["region"] == label for r in framework["residue_map"])
            if length and not present:
                p.error("A requested CDR length requires that CDR in the framework")
            if length:
                maximum += int(length.split("-")[-1]) - present
        if maximum > 740:
            p.error("Qualified construct bound is 740 residues")
        available = {chain + label for chain, entries in raw_target.items() for label in entries}
        if a.hotspots and any(hotspot not in available for hotspot in a.hotspots.split(",")):
            p.error("Hotspots must identify source-target residues")
        input_map = {"framework": [{k:v for k,v in r.items() if k != "atoms"} for r in framework["residue_map"]],
                     "target": [{k:v for k,v in r.items() if k != "atoms"} for r in target["residue_map"]]}
    else:
        input_map = None
        def validate_tag(tag):
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", tag):
                p.error("Native candidate identifiers must be safe filename components")
        def validate_hlt(path):
            structure = read_hlt(path)
            if len(structure["residue_map"]) > 740 or "T" not in structure["sequences"] or "H" not in structure["sequences"]:
                p.error("Native HLT input requires H and target T and at most 740 residues")
            if any(not r["source_residue"].isdecimal() for r in structure["residue_map"]):
                p.error("Native HLT requires unambiguous integer residue labels")
        if a.input or getattr(a, "input_pdb", None):
            files = sorted(a.input.glob("*.pdb")) if a.input else [a.input_pdb]
            if not files or len(files) > 40:
                p.error("Use 1–40 native HLT PDB inputs")
            for path in files:
                validate_tag(path.stem)
                validate_hlt(path)
        elif a.input_quiver:
            # Quiver is upstream's tagged list of complete PDB text records.
            blocks = {}
            current = None
            for line in a.input_quiver.read_text().splitlines(keepends=True):
                if line.startswith("QV_TAG"):
                    tag = line.split()[1]
                    validate_tag(tag)
                    if tag in blocks:
                        p.error("Quiver candidate tags must be unique")
                    blocks[tag] = []; current = tag
                elif current is not None and not line.startswith("QV_SCORE"):
                    blocks[current].append(line)
            if not 1 <= len(blocks) <= 40:
                p.error("Use 1–40 native Quiver candidates")
            with tempfile.TemporaryDirectory(prefix="rfantibody-input-", dir="/scratch") as temporary:
                for index, lines in enumerate(blocks.values()):
                    path = Path(temporary) / f"{index}.pdb"
                    path.write_text("".join(lines)); validate_hlt(path)
        else:
            entries = json.loads(a.input_json.read_text())
            if not isinstance(entries, dict) or not 1 <= len(entries) <= 40:
                p.error("Use 1–40 native RF2 sequence/target JSON entries")
            for tag, entry in entries.items():
                validate_tag(tag)
                heavy, light, target = entry.get("Hseq", ""), entry.get("Lseq", ""), entry["T"]
                if not heavy or any(aa not in "ARNDCQEGHILKMFPSTWYV" for aa in heavy + light):
                    p.error("JSON requires a standard H sequence and optional L sequence")
                n = len(target["seq"])
                if not n or n + len(heavy) + len(light) > 740 or any(not isinstance(aa, int) or not 0 <= aa < 20 for aa in target["seq"]):
                    p.error("JSON target identity/construct length is invalid")
                if any(len(target[key]) != n for key in ["xyz", "mask", "idx"]) or any(not isinstance(i, int) for i in target["idx"]):
                    p.error("JSON target arrays must retain one row per residue")
                for xyz, mask in zip(target["xyz"], target["mask"]):
                    if len(xyz) != 27 or len(mask) != 27 or any(len(atom) != 3 for atom in xyz):
                        p.error("JSON target coordinates/masks require 27 native atom slots")
                    if any(visible and not all(math.isfinite(v) for v in atom) for atom, visible in zip(xyz, mask)):
                        p.error("JSON visible target atoms must have finite coordinates")
                if len(entry.get("hotspots", [])) not in [0, n]:
                    p.error("JSON hotspots must have one value per target residue")
    import torch
    if not torch.cuda.is_available():
        p.error("Assign a CUDA GPU for each native stage")
    asset = Path(os.getenv("RFANTIBODY_WEIGHTS", "/models/rfantibody")) / WEIGHTS[a.stage]
    if a.stage == "generate":
        cmd = ["rfdiffusion", "--target", str(a.target.resolve()), "--framework", str(a.framework.resolve()),
               "--output", str(out / "pdbs/design"), "--num-designs", str(a.num_designs),
               "--design-loops", a.design_loops, "--diffuser-t", str(a.steps)]
        if a.hotspots:
            cmd += ["--hotspots", a.hotspots]
        if a.output_quiver:
            cmd += ["--output-quiver", str(out / "designs.qv")]
    elif a.stage == "sequence":
        cmd = ["proteinmpnn", "--input-dir" if a.input else "--input-quiver", str((a.input or a.input_quiver).resolve()), "--output-dir", str(out / "pdbs"),
               "--loops", a.loops, "--seqs-per-struct", str(a.num_sequences),
               "--temperature", str(a.temperature), "--debug"]
        if a.output_quiver:
            cmd += ["--output-quiver", str(out / "designs.qv")]
    else:
        input_flag, input_path = next((flag, value) for flag, value in [("--input-dir", a.input), ("--input-pdb", a.input_pdb), ("--input-json", a.input_json), ("--input-quiver", a.input_quiver)] if value)
        cmd = ["rf2", input_flag, str(input_path.resolve()), "--output-dir", str(out / "pdbs"),
               "--num-recycles", str(a.recycles),
               "--hotspot-show-prop", str(a.hotspot_show_proportion)]
        if a.seed is not None:
            cmd += ["--seed", str(a.seed)]
    cmd += ["--weights", str(asset)]
    if getattr(a, "deterministic", False):
        cmd.append("--deterministic")
    out.mkdir(parents=True)
    record = {"stage": a.stage, "repository": "https://github.com/RosettaCommons/RFantibody", "revision": REVISION,
              "checkpoint": str(asset), "argv": cmd, "settings": {k: str(v) if isinstance(v, Path) else v for k, v in vars(a).items()},
              "started_at_unix": time.time(), "exit_code": None}
    (out / "stage.json").write_text(json.dumps(record, indent=2) + "\n")
    if input_map is not None:
        (out / "input-residue-map.json").write_text(json.dumps(input_map, indent=2) + "\n")
    with tempfile.TemporaryDirectory(prefix="rfantibody-", dir="/scratch") as cwd:
        env = dict(os.environ, RFANTIBODY_ROOT=cwd, RFANTIBODY_SCRIPTS="/opt/RFantibody/scripts")
        result = subprocess.run(cmd, env=env)
    record.update(exit_code=result.returncode, elapsed_seconds=time.time() - record["started_at_unix"])
    (out / "stage.json").write_text(json.dumps(record, indent=2) + "\n")
    if result.returncode == 0 and not (out / "designs.qv").is_file() and not list((out / "pdbs").glob("*.pdb")):
        raise RuntimeError("Native stage returned no candidate PDBs; inspect its retained output")
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
