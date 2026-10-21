"""Offline sequence-register differential against a pinned local ESMFold2 pipeline.

Usage: python3 test/verify-esmfold2-reference.py /path/to/esmfold2-pipeline
Executes upstream pure mapping functions; does not qualify the full biotite reader.
"""
import __future__
import ast
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

reference = Path(sys.argv[1])
revision = subprocess.check_output(["git", "-C", str(reference), "rev-parse", "HEAD"], text=True).strip()
assert revision == "6015a76ad628895749bf02f8ef4aef8d5c7768cd", revision
source_path = reference / "src/esmfold2_pipeline/structure/target.py"
names = {"StructureTargetError", "_map_observed_residues_to_sequence", "_direct_auth_sequence_positions", "_unique_subsequence_positions", "_int_or_none"}
source = ast.parse(source_path.read_text())
namespace = {}
exec(compile(ast.Module(body=[n for n in source.body if getattr(n, "name", None) in names], type_ignores=[]), str(source_path), "exec", flags=__future__.annotations.compiler_flag), namespace)
fixtures = json.loads(Path(__file__).with_name("fixtures").joinpath("structure-correctness.json").read_text())
for item, expected in [(fixtures["cases"][0], (0, 1, 2)), (fixtures["cases"][3], (0, 2))]:
    aa = {"ALA": "A", "CYS": "C", "ASP": "D"}
    observed = tuple(SimpleNamespace(auth_seq_id=line[22:26].strip(), sequence_1letter=aa[line[17:20]], res_name=line[17:20]) for line in item["text"].splitlines() if line.startswith("ATOM"))
    positions = namespace["_map_observed_residues_to_sequence"](observed, item["sequence"], field_name="fixture")
    assert positions == expected, (positions, expected)
    print(f"Verified {item['name']}: author → full-sequence/MSA positions {positions}")
ambiguous = (SimpleNamespace(auth_seq_id="101", sequence_1letter="A", res_name="ALA"),)
try:
    namespace["_map_observed_residues_to_sequence"](ambiguous, "AA", field_name="ambiguous fixture")
except namespace["StructureTargetError"]:
    pass
else:
    raise AssertionError("upstream must reject ambiguous full-sequence alignment")
print(f"ESMFold2 pipeline reference {revision}: mapping differential checks passed")

# Compare the CLI's compact provenance mapper with the actual pinned mapper over
# small ambiguous/repeated sequences as well as author-number offsets.
from itertools import product
cases = []
for length in range(1, 5):
    for letters in product("AC", repeat=length):
        sequence = "".join(letters)
        for observed_length in range(1, min(length, 3) + 1):
            for observed_letters in product("AC", repeat=observed_length):
                for offset in (0, 100):
                    residues = [{"author": offset + index + 1, "aminoAcid": letter} for index, letter in enumerate(observed_letters)]
                    observed = tuple(SimpleNamespace(auth_seq_id=str(row["author"]), sequence_1letter=row["aminoAcid"], res_name="ALA") for row in residues)
                    try:
                        expected = [position + 1 for position in namespace["_map_observed_residues_to_sequence"](observed, sequence, field_name="differential")]
                    except namespace["StructureTargetError"]:
                        expected = None
                    cases.append({"sequence": sequence, "residues": residues, "expected": expected})
cli_source = """
import fs from 'node:fs';
import { sequencePositions } from './src/input-manifest.js';
const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(cases.map(item => sequencePositions(item.sequence, item.residues))));
"""
actual = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", cli_source], input=json.dumps(cases), text=True, cwd=Path(__file__).resolve().parents[1]))
assert actual == [case["expected"] for case in cases]
print(f"CLI provenance mapper agrees with the pinned ESM mapper for {len(cases)} sequence/register cases")
