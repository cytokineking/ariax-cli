"""Check the directional scores and files from the four-residue fixture."""
from __future__ import annotations

import math
import sys
from pathlib import Path

stem = Path(sys.argv[1])
for suffix in (".txt", "_byres.txt", ".pml"):
    path = Path(str(stem) + suffix)
    if not path.is_file() or path.stat().st_size == 0:
        raise SystemExit(f"Missing/empty ipSAE result: {path}")
lines = Path(str(stem) + ".txt").read_text().splitlines()
header = next(line.split() for line in lines if line.startswith("Chn1"))
rows = [dict(zip(header, line.split(), strict=True)) for line in lines if line.startswith(("A ", "B "))]
d0 = max(1.0, 1.24 * (27 - 15) ** (1 / 3) - 1.8)
a_to_b = 1 / (1 + (2 / d0) ** 2)
b_to_a = 1 / (1 + (4 / d0) ** 2)
expected = {("A", "B", "asym"): a_to_b, ("B", "A", "asym"): b_to_a,
            ("A", "B", "max"): a_to_b}
if len(rows) != len(expected):
    raise SystemExit(f"Expected three chain-pair rows, got {len(rows)}")
for row in rows:
    key = row["Chn1"], row["Chn2"], row["Type"]
    if key not in expected or not math.isclose(float(row["ipSAE"]), expected[key], abs_tol=1e-6):
        raise SystemExit(f"Unexpected directional ipSAE: {row}")
    if row["PAE"] != "10" or row["Dist"] != "10":
        raise SystemExit(f"Unexpected thresholds: {row}")
    if any(row[field] != "2" for field in ("nres1", "nres2", "dist1", "dist2")):
        raise SystemExit(f"Unexpected residue/contact counts: {row}")
    if not math.isclose(float(row["ipTM_af"]), 0.5):
        raise SystemExit(f"Unexpected imported ipTM: {row}")
byres = Path(str(stem) + "_byres.txt").read_text().splitlines()
residue_rows = [line.split() for line in byres if line.strip() and line.split()[0].isdigit()]
if len(residue_rows) != 4:
    raise SystemExit(f"Expected four by-residue rows, got {len(residue_rows)}")
print("ipSAE output passed: A->B 0.212489, B->A 0.063193, max 0.212489")
