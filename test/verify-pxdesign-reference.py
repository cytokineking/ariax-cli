"""Offline differential check against a pinned local PXDesign checkout.

Usage: python3 test/verify-pxdesign-reference.py /path/to/PXDesign
Executes the upstream pure selector functions, without loading GPU dependencies.
Full PDB/CIF reader qualification still needs the deployed engine environment.
"""
import ast
import json
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Iterable

reference = Path(sys.argv[1])
fixtures = json.loads(Path(__file__).with_name("fixtures").joinpath("pxdesign-mapping.json").read_text())
revision = subprocess.check_output(["git", "-C", str(reference), "rev-parse", "HEAD"], text=True).strip()
assert revision == fixtures["reference_revision"], (revision, fixtures["reference_revision"])
source_path = reference / "pxdesign/utils/infer.py"
names = {"ResidueMaps", "build_residue_maps", "parse_ranges", "format_ranges", "convert_crop_auth_to_new", "convert_hotspot_auth_to_new"}
source = ast.parse(source_path.read_text())
namespace = {"dataclass": dataclass, "defaultdict": defaultdict, "Iterable": Iterable}
exec(compile(ast.Module(body=[n for n in source.body if getattr(n, "name", None) in names], type_ignores=[]), str(source_path), "exec"), namespace)
for item in fixtures["cases"]:
    if "canonical" not in item:
        continue
    observed = item["observed"]
    # These are the converter's retained author IDs and observed-residue canonical IDs.
    atoms = SimpleNamespace(chain_id=["A"] * len(observed), res_id=item["canonical"], auth_asym_id=[item["chain"]] * len(observed), auth_res_id=[r["authorResidue"] for r in observed])
    mapping = namespace["build_residue_maps"](atoms)
    assert namespace["convert_crop_auth_to_new"]({item["chain"]: item["crop"]}, mapping) == {"A": item["canonical_crop"]}
    assert namespace["convert_hotspot_auth_to_new"]({item["chain"]: item["hotspots"]}, mapping) == {"A": item["canonical_hotspots"]}
    for author, canonical in zip(atoms.auth_res_id, item["canonical"]):
        assert mapping.auth2resid[(item["chain"], author)] == ("A", canonical)
    print(f"Verified {item['name']}: author → canonical → full-sequence/MSA register")
print(f"PXDesign reference {revision}: selector differential checks passed")
