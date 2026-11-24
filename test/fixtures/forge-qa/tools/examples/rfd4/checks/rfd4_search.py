#!/usr/bin/env python3
"""Validate the recorded native selection and continuation of RFd4 SAM search.

Requires the opt-in runtime selection trace and retained completed rollouts.
This checks one input per batch; it does not qualify a scientific mode by itself.
"""
from __future__ import annotations

import argparse
import filecmp
import json
import math
from pathlib import Path

HBOND = "interchain_interactions.hbond_atom_pair_count_coi"
HYDROPHOBIC = "interchain_interactions.hydrophobic_atom_pair_count_coi"
REWARD = "search.reward"


def number(value, label: str) -> float:
    if isinstance(value, list) and len(value) == 1:
        value = value[0]
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"Missing or nonfinite {label}: {value!r}")
    return float(value)


def same(left: float, right: float) -> bool:
    return math.isclose(left, right, rel_tol=1e-6, abs_tol=1e-6)


def workspace_path(path: str, run_dir: Path) -> Path:
    container_path = Path(path)
    if not container_path.is_absolute() or not container_path.is_relative_to("/workspace") or ".." in container_path.parts:
        raise ValueError(f"Expected a workspace path in the native trace: {path}")
    resolved_run = run_dir.resolve()
    if resolved_run.is_relative_to("/workspace"):
        workspace = Path("/workspace")
    else:
        # An exported or host-visible Files workspace may live outside /workspace.
        # Preserve the original direct-child fallback for older flat exports.
        workspace = next((parent for parent in resolved_run.parents if parent.name == "workspace"),
                         resolved_run.parent)
    result = workspace / container_path.relative_to("/workspace")
    if not result.resolve().is_relative_to(workspace):
        raise ValueError("Trace path escapes the recorded workspace")
    if result.is_symlink():
        raise ValueError("Trace state must be an ordinary file")
    return result


def validate_state(path: Path, checkpoint: int) -> None:
    import torch

    if not path.is_file() or path.stat().st_size == 0:
        raise ValueError(f"Expected selected state is missing or empty: {path}")
    state = torch.load(path, map_location="cpu", weights_only=True)
    if not isinstance(state, dict) or state.get("step") != checkpoint or not isinstance(state.get("x"), dict):
        raise ValueError(f"Malformed native sampling state: {path}")
    tensors = list(state["x"].values())
    if not tensors or any(not torch.is_tensor(tensor) or tensor.ndim == 0 or tensor.shape[0] != 1 or
                          not torch.isfinite(tensor).all().item() for tensor in tensors):
        raise ValueError(f"Saved state has invalid batch dimensions or nonfinite values: {path}")


def load_trace(path: Path) -> list[dict]:
    records = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    if not records or any(not isinstance(record, dict) for record in records):
        raise ValueError("Search trace must contain native checkpoint records")
    return records


def validate_checkpoint_sequence(records: list[dict], *, resumed: bool) -> None:
    """Require the complete pinned schedule and coherent continuation metadata."""
    if not isinstance(records, list) or any(not isinstance(record, dict) for record in records):
        raise ValueError("Search trace must contain native checkpoint records")
    expected = [60] if resumed else [40, 60]
    steps = [record.get("checkpoint_step") for record in records]
    if any(type(step) is not int for step in steps) or steps != expected:
        raise ValueError(f"Expected checkpoint sequence {expected}, found {steps}")
    if any(record.get("continuing") is not True for record in records):
        raise ValueError("A completed search requires a true continuation flag at every checkpoint")
    if any("resume_from" not in record or "resume_seed" not in record for record in records):
        raise ValueError("Search trace lacks explicit resume metadata")
    if resumed:
        paths = [record["resume_from"] for record in records]
        seeds = [record["resume_seed"] for record in records]
        if (any(not isinstance(path, str) or not path for path in paths)
                or any(type(seed) is not int for seed in seeds)
                or len(set(paths)) != 1 or len(set(seeds)) != 1):
            raise ValueError("A resumed search requires one consistent resume path and seed")
    elif any(record["resume_from"] is not None or record["resume_seed"] is not None for record in records):
        raise ValueError("An initial search must not carry resume metadata")
    input_ids = [record.get("input_id") for record in records]
    if any(not isinstance(value, str) or not value for value in input_ids) or len(set(input_ids)) != 1:
        raise ValueError("Checkpoint records must identify the same input")


def validate_run(run_dir: Path, trace_path: Path, metrics_path: Path, beam_width: int, *,
                 resumed: bool = False) -> tuple[list[dict], dict]:
    records = load_trace(trace_path)
    validate_checkpoint_sequence(records, resumed=resumed)

    from rfproteina.utils.structure_files import iter_structure_files, structure_file_stem
    from rfd4 import read_metrics

    if not run_dir.is_dir() or beam_width < 1:
        raise ValueError("A completed run and positive beam width are required")
    output_paths = iter_structure_files(run_dir / "inference_samples", stem_suffix="_generated")
    output_ids = [structure_file_stem(path).removesuffix("_generated") for path in output_paths]
    if len(output_ids) != len(set(output_ids)):
        raise ValueError("Generated candidate IDs are ambiguous")
    all_ids: set[str] = set()
    summary = []
    for record in records:
        step = record.get("checkpoint_step")
        if step not in (40, 60):
            raise ValueError(f"Unexpected checkpoint for the pinned SAM search: {step!r}")
        candidates, selected = record.get("candidates"), record.get("selected")
        if not isinstance(candidates, list) or len(candidates) <= beam_width or not isinstance(selected, list):
            raise ValueError("Trace has no complete candidate pool")
        if len(selected) != beam_width or [item.get("rank") for item in selected] != list(range(beam_width)):
            raise ValueError("Trace has an incomplete or unordered selected beam")
        candidate_ids = [item.get("design_id") for item in candidates]
        if any(not isinstance(item, str) or not item for item in candidate_ids) or len(set(candidate_ids)) != len(candidates):
            raise ValueError("Trace contains missing or duplicate candidate IDs")
        if all_ids.intersection(candidate_ids):
            raise ValueError("Candidate IDs recur across checkpoints")
        all_ids.update(candidate_ids)
        if [item.get("index") for item in candidates] != list(range(len(candidates))):
            raise ValueError("Trace candidate indices are incomplete or out of order")
        required = (HBOND, REWARD) if step == 40 else (HBOND, HYDROPHOBIC, REWARD)
        rows = read_metrics(metrics_path, required, example_ids=candidate_ids)
        by_id = {row["example_id"]: row for row in rows}
        scores = []
        for item in candidates:
            label, metrics = item["design_id"], item.get("metrics")
            if not isinstance(metrics, dict):
                raise ValueError(f"Missing checkpoint metrics for {label}")
            hbond = number(metrics.get(HBOND), f"{label} {HBOND}")
            if hbond < 0:
                raise ValueError(f"Negative H-bond count for {label}")
            expected = hbond
            if step == 60:
                hydrophobic = number(metrics.get(HYDROPHOBIC), f"{label} {HYDROPHOBIC}")
                if hydrophobic < 0:
                    raise ValueError(f"Negative hydrophobic count for {label}")
                expected = min(hbond, 6.0) + 0.5 * hydrophobic
            reward = number(item.get("selection_reward"), f"{label} selection reward")
            if not same(reward, expected) or not same(reward, number(metrics.get(REWARD), f"{label} {REWARD}")):
                raise ValueError(f"Native selection reward does not match checkpoint formula: {label}")
            row = by_id[label]
            if any(not same(number(metrics.get(key), f"{label} {key}"), float(row[key])) for key in required):
                raise ValueError(f"Trace and retained generation-time metrics differ: {label}")
            scores.append(reward)
        # The recorded list is in native selection input order; stable descending
        # ranking preserves the lower index on ties.
        expected_indices = sorted(range(len(scores)), key=lambda index: -scores[index])[:beam_width]
        if [item.get("index") for item in selected] != expected_indices:
            raise ValueError("Observed selection differs from native stable descending reward order")
        for item in selected:
            index = item["index"]
            if item.get("design_id") != candidate_ids[index]:
                raise ValueError("Selected candidate ID does not match its native index")
            state = item.get("expected_state_path")
            if step == 40 and record.get("continuing"):
                if not isinstance(state, str):
                    raise ValueError("A continuing interior selection lacks its state path")
                validate_state(workspace_path(state, run_dir), step)
            elif state is not None:
                raise ValueError("Unexpected saved state for this checkpoint")
        summary.append({"checkpoint": step, "input_id": record.get("input_id"),
                        "candidate_count": len(candidates),
                        "selected": [item["design_id"] for item in selected],
                        "continuing": record.get("continuing")})
    if set(output_ids) != all_ids:
        raise ValueError(f"Retained rollout set differs: missing={sorted(all_ids - set(output_ids))}, "
                         f"extra={sorted(set(output_ids) - all_ids)}")
    return records, {"trace": str(trace_path), "metrics_csv": str(metrics_path), "checkpoints": summary}


def check_continuation(initial: list[dict], initial_run: Path, continued: list[dict],
                       continued_run: Path, rank: int, seed: int) -> dict:
    checkpoints = [record for record in initial if record.get("checkpoint_step") == 40]
    if len(checkpoints) != 1 or not 0 <= rank < len(checkpoints[0]["selected"]):
        raise ValueError("Expected one initial step-40 record and a valid source rank")
    source = checkpoints[0]
    source_state = workspace_path(source["selected"][rank]["expected_state_path"], initial_run)
    if not continued:
        raise ValueError("The continuation has no observed checkpoints")
    resume_paths = {record.get("resume_from") for record in continued}
    resume_seeds = {record.get("resume_seed") for record in continued}
    if len(resume_paths) != 1 or None in resume_paths or resume_seeds != {seed}:
        raise ValueError("Continuation trace does not identify the expected explicit resume and seed")
    if any(record.get("input_id") != f"{source['input_id']}_r{seed}" for record in continued):
        raise ValueError("Continuation input identity does not match the selected source")
    resume_state = workspace_path(next(iter(resume_paths)), continued_run)
    if not resume_state.is_file() or not filecmp.cmp(source_state, resume_state, shallow=False):
        raise ValueError("Continuation input does not contain the selected native state's bytes")
    return {"source_candidate": source["selected"][rank]["design_id"], "source_rank": rank,
            "source_state": str(source_state), "resume_state": str(resume_state), "resume_seed": seed,
            "scope": "explicit state identity and traced selection; compare native input/model settings separately"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--trace", type=Path, required=True)
    parser.add_argument("--metrics-csv", type=Path, required=True)
    parser.add_argument("--beam-width", type=int, default=2)
    parser.add_argument("--continuation-run", type=Path)
    parser.add_argument("--continuation-trace", type=Path)
    parser.add_argument("--continuation-metrics-csv", type=Path)
    parser.add_argument("--source-rank", type=int, default=0)
    parser.add_argument("--resume-seed", type=int)
    args = parser.parse_args()
    continuation_args = (args.continuation_run, args.continuation_trace,
                         args.continuation_metrics_csv, args.resume_seed)
    if any(value is not None for value in continuation_args) and any(value is None for value in continuation_args):
        parser.error("continuation run, trace, metrics CSV and resume seed must be supplied together")
    # Reject either incomplete trace before loading the scientific environment.
    validate_checkpoint_sequence(load_trace(args.trace), resumed=False)
    if args.continuation_trace is not None:
        validate_checkpoint_sequence(load_trace(args.continuation_trace), resumed=True)
    initial, result = validate_run(args.run_dir, args.trace, args.metrics_csv, args.beam_width)
    if args.continuation_run is not None:
        continued, result["continued_run"] = validate_run(args.continuation_run, args.continuation_trace,
                                                         args.continuation_metrics_csv, args.beam_width,
                                                         resumed=True)
        result["continuation"] = check_continuation(initial, args.run_dir, continued,
                                                    args.continuation_run, args.source_rank, args.resume_seed)
    result["qualification"] = "not established"
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
