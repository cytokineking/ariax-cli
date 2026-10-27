# Native BoltzGen 0.2.0

The [managed BoltzGen protocol](../../ariax-boltzgen/SKILL.md) runs a defined
project lifecycle with its own schema and results. This native guide has
separate modes and qualification; inspect the exact live mode.


The image pins [upstream 0.2.0](https://github.com/HannesStark/boltzgen/tree/e4c961b55e74fc80ec2f1906972db1e4e4371262),
Torch 2.9.0/CUDA 12.8 and cuequivariance 0.5.1. Its output patch saves native
confidence, coordinates, PAE/pLDDT and atom/token maps in folding NPZ files.
Sampling, models, score direction, ranking weights and scientific thresholds
retain their upstream behavior. The reference-score fix uses the native target
chain mask, matching the generated target mask while preserving the residue mask
for sequence recovery. It also supplies the saved `asym_id` chain map to
binder-only lDDT when that optional calculation is requested. The seeded wrapper creates one Python/NumPy/Torch
global RNG stream through stage order. Native featurization also creates fresh entropy-seeded NumPy generators, so a seed does not promise identical repeated outputs. Filtering keeps native random_state=0.

The example manifest contains the exact argv,
seeds, budgets and expected stages for every bounded case. The helper
[run-example.py](boltzgen/run-example.py) prints that argv and runs it once, refusing an
existing output directory or same campaign archive. These are explicit qualification examples. Read each
case's result before selecting it for scientific work.

| Case | Protocol and input | Workload |
| --- | --- | --- |
| R02 | protein-anything, diverse, 1UBQ target | target76, binder40, designs2, seed7 |
| R03 | protein-anything, adherence, same target | target76, binder40, designs2, seed8 |
| R04 | both design checkpoints, variable binder | target76, binder40–80, designs4, batch2, seed9 |
| R05 | nanobody-anything, pinned 7EOW CDR scaffold | target76, binder118–139, designs2, seed10 |
| R06 | antibody-anything, pinned adalimumab 6CR1 H/L CDR scaffold | target76, combined binder216–250, designs2, seed11 |
| R07–R09 | peptide-anything, linear/cyclic/fixed disulfide | target76, peptide16, designs2 each, seeds12–14 |
| R10–R11 | protein-small_molecule, CCD NAG/aspirin SMILES | binder40, designs2 each, seeds15–16; native affinity stage |
| R12 | partial structure redesign, ubiquitin residues20–30 | target76 plus binder76, designs2, seed17 |
| R13 | only_inverse_fold, same partial design mask | target76 plus binder76, two sequences, seed18 |
| R14 | both design checkpoints, bounded campaign | target76, binder40–80, designs100, batch10, budget10, seed19 |
| R16 | native auxiliary scoring against the retained input structure | same inverse-fold profile, two sequences, seed21; sequence recovery, lDDT and SS metrics |
| R15 | four complete ubiquitin target chains | target304, binder140, designs2, seed20 |
| R23–R24 | fixed protein sequence / complete PDB target | target76, binder40, designs2 each, seeds23–24 |
| R25 | fixed two-chain DNA CIF target | target72 nucleotides, binder40, designs2, seed25 |
| R26 | fixed RNA sequence target | target12 nucleotides, binder40, designs2, seed26 |
| R27 | secondary-structure-conditioned binder | target76, binder40:20 helix/10 loop/10 sheet, designs2, seed27 |
| R28 | full inverse-fold reference design | target76, binder76 fully designed, sequences2, seed28 |
| R29 | fresh corrected candidate partial-reference pipeline | target76, binder76, designed span20–30, sequences2, seed29 |

Every folding stage in these examples uses the native five samples, three
recycles and 200 diffusion steps. Design uses three recycles and 500 steps.
Protein-anything executes design, inverse_folding, folding, design_folding,
analysis and filtering. Peptide and antibody protocols omit design_folding;
protein-small_molecule adds affinity. The manifest retains each native order.
The explicit inverse-fold stage override sets zero loader workers where the native
only-inverse-fold branch ignores the general flag. All use one GPU, eight assigned
CPUs, zero loader workers and two analysis processes. R15 uses coincident copies
of the input chain as a resource profile; it establishes no physical tetramer.
R16 scores against the retained conditioning structure. Its unconditioned input
leaves SS-conditioning metrics unavailable. Require the operating envelope in the completion report. An observed
peak alone does not establish a hardware minimum. The native run CLI defaults to
one loader worker even though the stage templates specify four. Set
`--num_workers 4` explicitly for the 25-design testing envelope;
inspect the saved settings in every GPU-stage YAML. The Forge launcher supplies 1 GiB of shared memory for these loaders. Batch 5 produces exactly 25 designs; native checkpoint fractions retain their batch rounding. The original bounded
profiles above retain their explicit zero-worker/two-analysis-process settings.

Set `BOLTZGEN_EXAMPLES` to `data.examples.boltzgen` from
`ariax skills forge --tool boltzgen --json`. `SESSION` is an authorized
Forge session UUID. Stage every regular example file, preserving relative paths.
This includes both scaffold YAML/CIF pairs and the manifest/checker/helper:

```sh
ariax forge tools add "$SESSION" --tools boltzgen --priority boltzgen --json
ariax forge tools wait "$SESSION" boltzgen --timeout 1800 --json
find "$BOLTZGEN_EXAMPLES" -type f | while IFS= read -r example; do
  relative=${example#"$BOLTZGEN_EXAMPLES"/}
  ariax forge inputs add "$SESSION" --file "$example" --path "boltzgen/$relative" --json
done
ariax forge inputs list "$SESSION" --json
```

Input import is asynchronous. Inspect every returned input ID with
`ariax forge inputs status SESSION INPUT_ID` and require `ready` before running.
The following retained 25-design full-settings case documents a historical
qualification workload, not a prescribed pilot size. If reproducing that
specific case is authorized, print its native command and run it explicitly:

```sh
python3 "$BOLTZGEN_EXAMPLES/run-testing-25.py" W25B --print
ariax forge run "$SESSION" --tool boltzgen --gpus 0 --timeout-seconds 14400 --json -- python /inputs/boltzgen/run-testing-25.py W25B
```

Require a fresh output directory and successful command completion. Run the settings and output checks explicitly:

```sh
ariax forge run "$SESSION" --tool boltzgen --gpus 0 --timeout-seconds 240 --json -- python /inputs/boltzgen/audit-defaults-v2.py /workspace/b43/W25B --devices 1 --design-samples 5 --report /scratch/W25B-settings.json
ariax forge run "$SESSION" --tool boltzgen --gpus 0 --timeout-seconds 240 --json -- python /inputs/boltzgen/check-complete-v6.py /workspace/b43/W25B --case /inputs/boltzgen/testing-25-batch5-cases.json --id W25B --report /scratch/W25B-science.json
ariax forge run "$SESSION" --tool boltzgen --gpus 0 --timeout-seconds 240 --json -- python /inputs/boltzgen/check-semantics-v2.py /workspace/b43/W25B --id W25B
```

The older bounded profiles remain reproducible through `run-example.py R02` and their matching manifests. Use CPU indices assigned to the workload when a bounded manifest specifies a cpuset.

The [input-class manifest](boltzgen/input-class-cases.json) uses the same output
layout. For those cases, print/run `run-input-case.py R23` and pass
`--case /inputs/boltzgen/input-class-cases.json --id R23` to the checker.
The nucleotide checker verifies the fixed DNA/RNA sequences. The separate
`check-semantics-v2.py OUTPUT --id CASE` recomputes native filtering/ranking and
reports cyclic/disulfide connection distances. The separate
`secondary-structure-cases.json`/`run-secondary.py` supply R27; pass that manifest
to the general checker. `check-auxiliary.py OUTPUT --id R16` checks retained
reference-metric availability and sequence recovery. With `--id R27`, it verifies
the saved conditioning mask and recomputes native SS scores, retaining unavailable
per-class values. `reference-scoring-cases.json`/`run-reference.py` supply R28;
`candidate-cases.json`/`run-candidate.py` supply the fresh R29 correction check.
Use their matching manifests with the general checker and
`check-reference-scoring.py` / `check-candidate-reference.py` for native reference
metrics. The original R16 failure and a failed-output snapshot remain retained;
`check-reference-partial.py` checks completed refold arrays in that snapshot.

Native masks identify designed residues and preserve scaffold/target identity.
The two-chain protein case maps input design B to emitted A and target A to
emitted B; other cases must use their saved masks and author/label-chain maps.
Inverse-fold-only writes sequences/refolds under `intermediate_designs/`; use
the native `config/analysis.yaml` design_dir for every case. All five coordinate, confidence and PAE samples remain in NPZ. Native 0.2.0
selects CIF coordinates by argmax(0.8*iPTM+0.2*pTM), while its CIF pLDDT field
uses sample zero. The checker preserves this convention with 0.0006 Å coordinate
and 0.006 fractional pLDDT tolerances.

| Output | Meaning |
| --- | --- |
| `steps.yaml`, `config/` | Exact native stage order and resolved settings |
| `intermediate_designs/` | Original backbones and design masks |
| `intermediate_designs_inverse_folded/` | Sequences and masks; designed sidechains may be zero placeholders |
| `refold_cif/`, `refold_design_cif/` | Native complex and binder-only refolds |
| `fold_out_npz/`, `fold_out_design_npz/` | Every saved native sample with atom/token maps |
| Native affinity outputs | Original predicted affinity and binder-probability arrays for ligand cases |
| `aggregate_metrics_analyze.csv` | Native analysis, including unavailable reference metrics |
| `final_ranked_designs/all_designs_metrics.csv` | Candidate identity, rank and every filter decision |
| `final_designs_metrics_N.csv`, `final_N_designs/` | Diversity-selected exports; inspect `pass_filters` |
| `results_overview.pdf` | Native report and original criteria |

A normal exit establishes execution. A ranked export may remain scientifically
rejected. Native filtering keeps the first occurrence of an identical designed sequence.
Keep all generated arrays and inspect the checker's retained/deduplicated IDs.
Keep original rejection flags, failed cases, unavailable metrics and score direction. Protein-anything retains its GLU fraction cap0.2 and RMSD2.5 Å;
peptide protocol settings differ and are preserved in resolved configs. Native
confidence, ranking and affinity predictions establish no experimental binding
or benchmark-accuracy claim. Save all selected inputs and complete outputs with
Forge Files; restoration leaves scratch/history empty and does not replay science.
To save the complete project in one file, pack its directory into an ordinary archive before
saving. The helper compares every archived member to its source, then moves the
source to the explicitly supplied scratch backup. A successful restore can
unpack that saved archive and run output checks without inference:

```sh
ariax forge run "$SESSION" --tool boltzgen --gpus 0 --timeout-seconds 300 --json -- python /inputs/boltzgen/archive-native.py pack /workspace/b43/W25B /workspace/b43/W25B-native.tar.gz --backup /scratch/archived-native/W25B
# Save using the commands in saved results linked below.
# In the fresh restored session, after tool preparation:
ariax forge run "$RESTORED_SESSION" --tool boltzgen --gpus 0 --timeout-seconds 300 --json -- python /inputs/boltzgen/archive-native.py unpack /workspace/b43/W25B-native.tar.gz --destination /workspace/b43
```

Require empty scratch/history immediately after Files restoration, before explicit
unpack/check commands. The scratch backup is outside the checkpoint; the archive
contains every native campaign file. Use [saved results](../outputs.md) for the
exact save/restore and checkpoint-pinned export commands.

The earlier reduced1/1-sample pilot remains in the
original qualification report, with its
original two GLU rejections. Testing uses 25 designs under the human’s October 9 direction; the exact full-settings command is in [testing-25-batch5-cases.json](boltzgen/testing-25-batch5-cases.json). The native upstream design-count default remains configuration history.
Later 0.3.x ESMFold2 scoring is outside the selected 0.2.0 version.
