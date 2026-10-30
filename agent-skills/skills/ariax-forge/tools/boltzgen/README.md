# BoltzGen native examples

Read [the tool guide](../boltzgen.md) for protocols, resource settings, run
commands and output interpretation. Manifests record exact argv, seeds, budgets
and expected stages. Run helpers accept a case ID and `--print`, and refuse an
existing output directory. These are example inputs with no designed experimental
binding reference.

`1ubq.cif` is the complete 76-residue ubiquitin target. The pinned native scaffold
files come from BoltzGen commit `e4c961b55e74fc80ec2f1906972db1e4e4371262` under
`example/nanobody_scaffolds/` and `example/fab_scaffolds/` and retain source
comments, CDR masks and insertion ranges. Nanobody 128 minus 13 excluded plus
3–24 inserted gives 118–139 residues. The antibody variable domains 228 minus
52 excluded plus 40–74 inserted give 216–250 combined H/L residues.

The DNA fixture is the unchanged upstream
`example/denovo_zinc_finger_against_dna/zf.cif`; the input selects its two
36-nucleotide chains while retaining the file's original protein and zinc records.
`1ubq.pdb` was exported from the CIF with Gemmi, preserving protein coordinates.

| Manifest / helper | Inputs and result checks |
| --- | --- |
| `testing-25-batch5-cases.json` / `run-testing-25.py W25B` | 25 variable-length designs; `audit-defaults-v2.py` and `check-complete-v6.py` check resolved settings and native outputs |
| `input-class-cases.json` / `run-input-case.py R23` (or R24–R26) | Fixed protein sequence, PDB, DNA CIF and RNA sequence; `check-input-classes.py --id R25` (or R26) verifies fixed nucleotide sequences |
| `secondary-structure-cases.json` / `run-secondary.py R27` | 20 helix, 10 loop and 10 sheet positions; `check-auxiliary.py --id R27` verifies the saved mask and recomputes native DSSP scores |
| `reference-scoring-cases.json` / `run-reference.py R28` | Fully designed reference input; `check-reference-scoring.py --id R28` checks native reference metrics |
| `candidate-cases.json` / `run-candidate.py R29` | Partial-reference input; `check-candidate-reference.py --id R29` checks native reference metrics |
| `auxiliary-cases.json` | Retained-reference inverse folding; `check-auxiliary.py --id R16` checks sequence recovery and lDDT availability |

Pass the matching manifest with `--case`, its case ID with `--id`, and a report
path with `--report` to `check-complete-v6.py`. Specialized checkers take the
output root as their positional argument. Keep unavailable reference and
per-class SS scores unchanged.
`check-semantics-v2.py OUTPUT --id CASE` recomputes native filtering, rank direction
and weights; for cyclic/disulfide examples it also reports connections and
distances. Native filtering deduplicates identical designed sequences; the
output checker retains all arrays and verifies the IDs kept by that operation.

## Run a packaged example

Read the selected manifest before launching: it fixes the input paths, seed,
design count, output directory and timeout. Cases using `taskset -c 0-7` require
those CPU indices to be assigned to the workload; adapt the cpuset to the actual
assignment before running. Use a fresh output directory and retain the matching
manifest when adapting a case.

For the 25-design example, set `BOLTZGEN_EXAMPLES` to `data.examples.boltzgen`
from `ariax skills forge --tool boltzgen --json`. Stage its helper, manifest,
fixture and checker dependencies into an authorized session:

```sh
for FILE in run-testing-25.py testing-25-batch5-cases.json variable.yaml 1ubq.cif audit-defaults-v2.py check-complete-v6.py check-semantics-v2.py check-complete-v3.py; do
  ariax forge inputs add "$SESSION" --file "$BOLTZGEN_EXAMPLES/$FILE" --path "boltzgen/$FILE" --json
done
ariax forge inputs list "$SESSION" --json
```

Require every input `ready` and BoltzGen ready as described in the
[tool guide](../boltzgen.md#run-and-check-results). Print the command for review,
then run it within the session's authorized budget:

```sh
ariax forge run "$SESSION" --tool boltzgen --gpus 0 --timeout-seconds 60 --json -- python /inputs/boltzgen/run-testing-25.py W25B --print
ariax forge run "$SESSION" --tool boltzgen --gpus 0 --timeout-seconds 14400 --json -- python /inputs/boltzgen/run-testing-25.py W25B
```

Monitor the returned command ID using the tool guide. After successful
completion, check the example's saved settings and outputs:

```sh
ariax forge run "$SESSION" --tool boltzgen --gpus 0 --timeout-seconds 240 --json -- python /inputs/boltzgen/audit-defaults-v2.py /workspace/b43/W25B --devices 1 --design-samples 5 --report /scratch/W25B-settings.json
ariax forge run "$SESSION" --tool boltzgen --gpus 0 --timeout-seconds 240 --json -- python /inputs/boltzgen/check-complete-v6.py /workspace/b43/W25B --case /inputs/boltzgen/testing-25-batch5-cases.json --id W25B --report /scratch/W25B-science.json
ariax forge run "$SESSION" --tool boltzgen --gpus 0 --timeout-seconds 240 --json -- python /inputs/boltzgen/check-semantics-v2.py /workspace/b43/W25B --id W25B
```

These checkers use the pinned BoltzGen environment. Their assertions cover the
listed examples; they do not validate arbitrary inputs or experimental binding.

## Optional archive helper

Use `archive-native.py` when you need the native directory as one Files export.
It packs and checks the archive, then moves the source to the explicit scratch
backup, which is outside the saved workspace. Set `BOLTZGEN_EXAMPLES` from
`data.examples.boltzgen` in `ariax skills forge --tool boltzgen --json`:

```sh
ariax forge inputs add "$SESSION" --file "$BOLTZGEN_EXAMPLES/archive-native.py" --path boltzgen/archive-native.py --json
```

Require that input ready before packing:

```sh
ariax forge run "$SESSION" --tool boltzgen --gpus 0 --timeout-seconds 300 --json -- python /inputs/boltzgen/archive-native.py pack /workspace/boltzgen/run-01 /workspace/boltzgen/run-01-native.tar.gz --backup /scratch/archived-native/run-01
```

After it finishes, save with [Forge Files](../../outputs.md). In a restored
session, wait for the tool and explicitly unpack into an absent target directory:

```sh
ariax forge run "$RESTORED_SESSION" --tool boltzgen --gpus 0 --timeout-seconds 300 --json -- python /inputs/boltzgen/archive-native.py unpack /workspace/boltzgen/run-01-native.tar.gz --destination /workspace/boltzgen
```

Inspect the unpacked outputs before continuing; unpacking does not replay science.
