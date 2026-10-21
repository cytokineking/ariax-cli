# BoltzGen native examples

Read [the tool guide](../boltzgen.md) and completion report.
`completion-cases-v2.json` records exact bounded native commands; `run-example.py`
prints or runs one explicit case and refuses an existing output directory.
`check-complete-v5.py` checks complete native files and preserves rejection.
The older `check.py` remains the exact reduced-sample B43 pilot checker.

`1ubq.cif` is the complete 76-residue ubiquitin target. The pinned native scaffold
files come from BoltzGen commit e4c961b55e74fc80ec2f1906972db1e4e4371262 under
`example/nanobody_scaffolds/` and `example/fab_scaffolds/` and retain source comments, CDR masks and insertion ranges.
Nanobody 128 minus 13 excluded plus 3–24 inserted gives 118–139 residues.
The antibody variable domains 228 minus 52 excluded plus 40–74 inserted give 216–250
combined H/L residues. These fixtures provide computational qualification cases;
there is no designed experimental binding reference.

`input-class-cases.json` and `run-input-case.py` cover fixed protein sequence,
PDB, DNA CIF and RNA sequence inputs. The DNA fixture is the unchanged pinned
`example/denovo_zinc_finger_against_dna/zf.cif`; its two 36-nucleotide chains are
selected while the file retains its original protein and zinc records. `1ubq.pdb`
was exported remotely from the existing CIF with Gemmi, preserving protein coordinates.
`check-input-classes.py` verifies fixed nucleotide sequences; `check-semantics-v2.py`
recomputes original filter thresholds, rank direction and weights and reports
explicit cyclic/disulfide connections and distances. Earlier staged helper and
manifest versions remain for the recorded initial commands.

`archive-native.py` packs a complete native campaign for a single Files export,
compares every member byte before moving the source to an explicit scratch
backup, and unpacks only into an absent destination. This avoids expanding the
number of checkpoint entries for campaign output and leaves inference explicit.
Native filtering deduplicates identical designed sequences. The checker retains
all generated arrays and verifies the exact IDs kept by that native operation.

`secondary-structure-cases.json` and `run-secondary.py` provide the conditioned
R27 profile (20 helix, 10 loop, 10 sheet positions). `check-auxiliary.py` checks its
saved mask/native DSSP scores and R16's retained-reference sequence recovery and
lDDT availability. All unavailable per-class scores remain native values.

`reference-scoring-cases.json`/`run-reference.py` supply fully designed R28 native
reference scoring. `candidate-cases.json`/`run-candidate.py` supply fresh R29
partial-reference execution after the target-mask correction. Dedicated reference
checkers retain original unavailable values. `check-reference-partial.py` checks
R16's failed-output snapshot; `check-reference-regression-v4.py` compares every native
metric of the accepted ordinary R13 analysis across the correction, aligning CSV columns by name.

The auxiliary correction also supplies saved `asym_id` to binder-only lDDT.
The original full-reference R28 KeyError and its completed refolds remain
retained; corrected analysis/filtering and fresh R29 are explicit new checks.
