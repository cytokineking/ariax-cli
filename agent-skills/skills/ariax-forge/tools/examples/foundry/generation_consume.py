"""Inspect one retained native generation result without inference."""

from __future__ import annotations
import argparse
import contextlib
import sys
import importlib.util
import json
import math
from generation_geometry import evaluate
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "foundry_outputs", "/opt/forge-foundry/foundry_outputs.py"
)
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


def finite_metrics(value: object, path: str = "") -> tuple[object, list[str]]:
    if isinstance(value, float) and not math.isfinite(value):
        return None, [path]
    if isinstance(value, dict):
        out, unavailable = {}, []
        for key, item in value.items():
            out[key], fields = finite_metrics(item, f"{path}.{key}".lstrip("."))
            unavailable.extend(fields)
        return out, unavailable
    if isinstance(value, list):
        out, unavailable = [], []
        for index, item in enumerate(value):
            result, fields = finite_metrics(item, f"{path}[{index}]")
            out.append(result)
            unavailable.extend(fields)
        return out, unavailable
    return value, []


def consume(root: Path, case_id: str, selected_stem: Path | None = None) -> dict:
    fixture = Path(__file__).resolve().parent
    case = next(
        c
        for c in json.loads((fixture / "cases.json").read_text())
        if c["id"] == case_id
    )
    stem = selected_stem if selected_stem is not None else root / case["output_stem"]
    structure = Path(str(stem) + ".cif.gz")
    metadata_path = Path(str(stem) + ".json")
    expected = json.loads((fixture / case["expected"]).read_text())
    result = checker.inspect_structure(structure, expected)
    metadata = json.loads(metadata_path.read_text())
    if metadata["seed"] != 7 or Path(metadata["ckpt_path"]).name != case["model"]:
        raise ValueError("Native output used a different seed or checkpoint")
    if "native_conditioning" not in metadata:
        raise ValueError("Native conditioning annotations were not retained")
    geometry = evaluate(case_id, structure, fixture, metadata)
    metrics, unavailable = finite_metrics(metadata.get("metrics", {}))
    return {
        "case": case_id,
        "atom_count": result["atom_count"],
        "polymer_sequences": {c: d["sequences"] for c, d in result["chains"].items()},
        "checkpoint": Path(metadata["ckpt_path"]).name,
        "seed": metadata["seed"],
        "native_metrics": metrics,
        "nonfinite_native_metric_fields": unavailable,
        "geometry": geometry,
        "scope": "native identity inspected; preserve each geometry and chemistry outcome",
        "output_files": sorted(
            str(p.relative_to(root)) for p in root.rglob("*") if p.is_file()
        ),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--case", required=True)
    parser.add_argument("--expected-samples", type=int, default=1)
    parser.add_argument("--report", type=Path, help="Atomically save the full report outside the native output tree")
    args = parser.parse_args()
    if args.expected_samples < 1:
        parser.error("positive explicit sample count required")
    case = next(c for c in json.loads((Path(__file__).parent / "cases.json").read_text()) if c["id"] == args.case)
    family = case["output_stem"].rsplit("_model_", 1)[0]
    intended = {family + "_model_" + str(i) for i in range(args.expected_samples)}
    actual = {p.stem for p in args.root.glob(family + "_model_*.json")}
    if actual != intended:
        raise ValueError("Native generation outputs differ from the requested sample count")
    with contextlib.redirect_stdout(sys.stderr):
        reports = [consume(args.root, args.case, args.root / stem) for stem in sorted(intended)]
    result = reports[0] if args.expected_samples == 1 else {"case": args.case, "native_samples": reports}
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        temporary=args.report.with_name(args.report.name+".part")
        temporary.write_text(json.dumps(result, indent=2, allow_nan=False)+"\n")
        temporary.replace(args.report)
        print(json.dumps({"case":args.case,"report":str(args.report),"expected_samples":args.expected_samples}))
    else:
        print(json.dumps(result, indent=2, allow_nan=False))
