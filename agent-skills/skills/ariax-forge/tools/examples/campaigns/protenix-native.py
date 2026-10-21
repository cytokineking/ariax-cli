"""Capture the B56 native dumper input, then run the shipped Protenix runner unchanged.

Run only inside the qualified remote Protenix workload. This helper adds native
array files beside predictions; it changes no tensors, settings or native writer.
"""
import json
from pathlib import Path
import runpy
import sys

import numpy as np
import torch
from runner.dumper import DataDumper


def capture(value, arrays):
    if isinstance(value, (torch.Tensor, np.ndarray)):
        name = f"array_{len(arrays)}"
        dtype = str(value.dtype)
        if isinstance(value, torch.Tensor):
            tensor = value.detach().cpu()
            array = (tensor.float() if tensor.dtype == torch.bfloat16 else tensor).numpy().copy()
        else:
            array = value.copy()
        if array.dtype.hasobject:
            raise ValueError("Native capture cannot contain object arrays")
        arrays[name] = array
        return {"kind": "array", "name": name, "source_dtype": dtype,
                "stored_dtype": str(array.dtype), "shape": list(value.shape)}
    if isinstance(value, dict):
        if any(not isinstance(key, str) for key in value):
            raise ValueError("Native confidence keys must be strings")
        return {"kind": "dict", "values": {key: capture(item, arrays) for key, item in value.items()}}
    if isinstance(value, (list, tuple)):
        return {"kind": type(value).__name__, "values": [capture(item, arrays) for item in value]}
    if isinstance(value, np.generic):
        return {"kind": "numpy-scalar", "source_dtype": str(value.dtype), "value": value.item()}
    if value is None or type(value) in (bool, int, float, str):
        return {"kind": "scalar", "value": value}
    raise TypeError("Unsupported native dumper value type: " + type(value).__name__)


ORIGINAL = DataDumper.dump_predictions


def dump(self, pred_dict, dump_dir, pdb_id, atom_array, entity_poly_type, seed):
    path = Path(dump_dir) / "b56-native"
    path.mkdir(parents=True, exist_ok=False)
    arrays = {}
    tree = capture(pred_dict, arrays)
    np.savez(path / "prediction.npz", **arrays)
    record = {"input_id": pdb_id, "seed": seed, "prediction": tree,
              "rank_indices": [int(value) for value in self._get_ranker_indices(pred_dict)],
              "need_atom_confidence": self.need_atom_confidence,
              "entity_poly_type": entity_poly_type,
              "atom_annotations": {key: atom_array.get_annotation(key).tolist()
                                   for key in atom_array.get_annotation_categories()}}
    (path / "prediction.json").write_text(json.dumps(record, indent=2, allow_nan=False) + "\n")
    return ORIGINAL(self, pred_dict, dump_dir, pdb_id, atom_array, entity_poly_type, seed)


if __name__ == "__main__":
    positions = [index for index, value in enumerate(sys.argv) if value == "--dump_dir"]
    if len(positions) != 1 or positions[0] + 1 == len(sys.argv):
        raise ValueError("Supply one explicit --dump_dir under /workspace")
    output = Path(sys.argv[positions[0] + 1]).resolve()
    if not output.is_relative_to(Path("/workspace")) or output.exists():
        raise ValueError("Choose a new absent native output directory under /workspace")
    DataDumper.dump_predictions = dump
    runpy.run_module("runner.inference", run_name="__main__")
