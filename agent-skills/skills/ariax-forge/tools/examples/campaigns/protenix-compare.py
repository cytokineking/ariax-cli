"""Compare B56's complete same-forward native prediction with every exported sample.

Run inside the qualified remote Protenix image after its existing output checker.
Expected task, seed and sample identities come from the fixed joined campaign.
"""
import argparse
import copy
import json
from pathlib import Path
import tempfile

import gemmi
import numpy as np
import torch
from protenix.utils.file_io import save_json
from runner.dumper import get_clean_full_confidence


def native_array(value):
    if isinstance(value, torch.Tensor):
        tensor = value.detach().cpu()
        return (tensor.float() if tensor.dtype == torch.bfloat16 else tensor).numpy()
    return np.asarray(value)


def restore(tree, arrays, used):
    kind = tree["kind"]
    if kind == "array":
        name = tree["name"]
        if name in used:
            raise ValueError("Duplicate native capture array")
        used.add(name)
        array = arrays[name]
        if list(array.shape) != tree["shape"] or str(array.dtype) != tree["stored_dtype"]:
            raise ValueError("Native dtype or shape changed")
        if tree["source_dtype"].startswith("torch."):
            return torch.from_numpy(array.copy()).to(getattr(torch, tree["source_dtype"][6:]))
        if str(array.dtype) != tree["source_dtype"]:
            raise ValueError("Native NumPy dtype changed")
        return array.copy()
    if kind == "dict":
        return {key: restore(item, arrays, used) for key, item in tree["values"].items()}
    if kind in {"list", "tuple"}:
        values = [restore(item, arrays, used) for item in tree["values"]]
        return tuple(values) if kind == "tuple" else values
    if kind == "numpy-scalar":
        return np.asarray(tree["value"], dtype=tree["source_dtype"])[()]
    if kind == "scalar":
        return tree["value"]
    raise ValueError("Unknown native capture value")


def equal(expected, actual, label):
    if type(expected) is not type(actual):
        raise ValueError("Native JSON type changed: " + label)
    if isinstance(expected, dict):
        if expected.keys() != actual.keys():
            raise ValueError("Native JSON keys changed: " + label)
        for key in expected:
            equal(expected[key], actual[key], label + "." + key)
    elif isinstance(expected, list):
        if len(expected) != len(actual):
            raise ValueError("Native JSON cardinality changed: " + label)
        for index, (left, right) in enumerate(zip(expected, actual, strict=True)):
            equal(left, right, label + f"[{index}]")
    elif expected != actual:
        raise ValueError("Native JSON value changed: " + label)


def compare(input_path, output):
    tasks = json.loads(input_path.read_text())
    name = "B43_ubiquitin_1_full_target"
    if len(tasks) != 1 or tasks[0]["name"] != name:
        raise ValueError("B56 requires its explicit B43 diagnostic task")
    directories = {path.relative_to(output).as_posix() for path in output.glob("*/seed_*") if path.is_dir()}
    if directories != {f"{name}/seed_101"}:
        raise ValueError("Expected native task/seed set differs")
    directory = output / name / "seed_101"
    record = json.loads((directory / "b56-native/prediction.json").read_text())
    if (record["input_id"] != name or record["seed"] != 101
            or record["rank_indices"] != [0] or record["need_atom_confidence"] is not True):
        raise ValueError("Native task/seed/sample authority differs")
    with np.load(directory / "b56-native/prediction.npz", allow_pickle=False) as arrays:
        used = set()
        prediction = restore(record["prediction"], arrays, used)
        if used != set(arrays.files):
            raise ValueError("Native capture contains unexpected or missing arrays")
    if len(prediction["full_data"]) != 1 or len(prediction["summary_confidence"]) != 1 or prediction["coordinate"].shape[0] != 1:
        raise ValueError("Native sample axis differs from the one-sample campaign")
    full = prediction["full_data"][0]
    raw_coordinates = native_array(full["atom_coordinate"])
    coordinates = native_array(prediction["coordinate"][0])
    if raw_coordinates.shape != coordinates.shape or not np.array_equal(raw_coordinates, coordinates):
        raise ValueError("Native confidence/structure coordinate arrays differ")
    predictions = directory / "predictions"
    expected = {f"{name}_{suffix}_sample_0.json" for suffix in ("raw_full_data", "full_data", "summary_confidence")}
    expected.add(f"{name}_sample_0.cif")
    actual = {path.name for path in predictions.iterdir() if path.is_file() and "_handoff" not in path.name}
    if actual != expected:
        raise ValueError("Complete native export membership differs")
    with tempfile.TemporaryDirectory(prefix="b56-native-", dir="/scratch") as scratch:
        # Match the shipped additive raw save followed by the original formatter.
        # Native save_json makes a shallow copy, so nested dictionaries retain
        # its conversion behavior before formatting on the same working object.
        working = copy.deepcopy(full)
        for suffix in ("raw_full_data", "full_data", "summary_confidence"):
            data = (working if suffix == "raw_full_data" else
                    get_clean_full_confidence(working) if suffix == "full_data" else
                    copy.deepcopy(prediction["summary_confidence"][0]))
            native_path = Path(scratch) / (suffix + ".json")
            save_json(data, str(native_path))
            equal(json.loads(native_path.read_text()),
                  json.loads((predictions / f"{name}_{suffix}_sample_0.json").read_text()), suffix)
    block = gemmi.cif.read_file(str(predictions / f"{name}_sample_0.cif")).sole_block()
    atoms = block.get_mmcif_category("_atom_site.")
    exported = np.asarray([[float(atoms[key][i]) for key in ("Cartn_x", "Cartn_y", "Cartn_z")]
                           for i in range(len(atoms["id"]))])
    if exported.shape != coordinates.shape or not np.isfinite(exported).all():
        raise ValueError("Exported coordinate axes differ or contain nonfinite values")
    difference = float(np.max(np.abs(exported - coordinates)))
    if difference > 0.00001:
        raise ValueError("CIF coordinates differ from the original native forward")
    annotations = record["atom_annotations"]
    for field, annotation in (("label_asym_id", "chain_id"), ("label_atom_id", "atom_name"), ("label_comp_id", "res_name")):
        if atoms[field] != annotations[annotation]:
            raise ValueError("Native CIF atom/chain identity differs: " + field)
    if [int(value) for value in atoms["label_seq_id"]] != annotations["res_id"]:
        raise ValueError("Native CIF residue register differs")
    plddt = native_array(full["atom_plddt"]) * 100
    b_factors = np.asarray([float(value) for value in atoms["B_iso_or_equiv"]])
    if b_factors.shape != plddt.shape or not np.isfinite(b_factors).all() or np.max(np.abs(b_factors - plddt)) > 0.00501:
        raise ValueError("Native CIF pLDDT axis or serialized values differ")
    return {"input_id": name, "seed": 101, "samples": 1, "capture_arrays": len(used),
            "recursive_confidence_and_summary": "exact native serialization",
            "native_dtype_and_shape": "all captured arrays restored",
            "maximum_coordinate_difference_angstrom": difference,
            "coordinate_tolerance_angstrom": 0.00001, "plddt_serialization_tolerance_points": 0.00501}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    print(json.dumps(compare(args.input, args.output), allow_nan=False))
