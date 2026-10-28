# Native BoltzGen 0.2.0

Use native BoltzGen for protein, peptide, nanobody or antibody design against
protein, nucleic-acid or small-molecule targets, or for structure redesign and
inverse folding. The [managed BoltzGen protocol](../../ariax-boltzgen/SKILL.md)
has its own project lifecycle, schema and results. Inspect the exact live native
mode before selecting it. Use `ariax forge catalog --task TASK --compact --json`
to find relevant choices, then `ariax forge catalog --tool boltzgen --model MODEL
--mode MODE --json` with the returned exact model and mode IDs. Discover this
guide and its examples with `ariax skills forge --tool boltzgen --json`.

The image pins [upstream 0.2.0](https://github.com/HannesStark/boltzgen/tree/e4c961b55e74fc80ec2f1906972db1e4e4371262).
It saves native confidence, coordinates, PAE/pLDDT and atom/token maps in folding
NPZ files. Sampling, models, score direction, ranking weights and scientific
thresholds retain upstream behavior. Later 0.3.x ESMFold2 scoring is outside this
version. The seeded wrapper uses one Python/NumPy/Torch global RNG stream through
stage order, but native featurization also creates fresh entropy-seeded NumPy
generators: a seed does not promise identical repeated outputs. Filtering uses
native `random_state=0`.

## Inputs and protocols

The [example directory](boltzgen/README.md) contains native YAML inputs and their
structure dependencies. Preserve relative paths, scaffold masks and chain IDs.
These are computational examples with no designed experimental binding reference.

| Protocol or mode | Example inputs and scope |
| --- | --- |
| `protein-anything` | `ubiquitin.yaml`: 76-residue target, 40-residue binder; `variable.yaml`: binder 40–80, with diverse/adherence design checkpoints |
| `nanobody-anything` | `nanobody.yaml`: pinned 7EOW CDR scaffold, binder 118–139 residues |
| `antibody-anything` | `antibody.yaml`: adalimumab 6CR1 H/L CDR scaffold, combined binder 216–250 residues |
| `peptide-anything` | `peptide.yaml`, `cyclic.yaml`, `disulfide.yaml`: 16-residue linear, cyclic or fixed-disulfide peptide |
| `protein-small_molecule` | `ligand-ccd.yaml`: CCD NAG; `ligand-smiles.yaml`: aspirin SMILES; 40-residue binder and native affinity stage |
| Partial redesign / `--only_inverse_fold` | `redesign.yaml`, `inverse-only.yaml`: ubiquitin residues 20–30 designed, remaining structure fixed |
| Reference scoring | `reference-scoring.yaml`: fully designed 76-residue input; retained conditioning structure supplies the reference |
| Fixed protein targets | `protein-sequence.yaml`, `protein-pdb.yaml`: complete ubiquitin sequence or PDB |
| Fixed nucleic-acid targets | `dna.yaml`: two 36-nucleotide CIF chains; `rna.yaml`: 12-nucleotide sequence |
| Secondary-structure conditioning | `secondary-structure.yaml`: 40-residue binder with 20 helix, 10 loop and 10 sheet positions |
| Larger input example | `large.yaml`: four coincident ubiquitin chains (304 target residues), binder 140; this does not establish a physical tetramer |

`protein-anything` executes design, inverse_folding, folding, design_folding,
analysis and filtering. Peptide and antibody protocols omit design_folding;
`protein-small_molecule` adds affinity. Inspect the chosen manifest's native
stage order. Native folding uses five samples, three recycles and 200 diffusion
steps; design uses three recycles and 500 steps in these examples.

The supplied workloads use one GPU and eight assigned CPUs. Bounded examples
specify zero loader workers and two analysis processes; the inverse-fold-only
branch needs its explicit stage override because it ignores the general worker
flag. The native run CLI defaults to one loader worker even though stage
templates specify four. The 25-design example explicitly sets `--num_workers 4`
and diffusion batch size 5; the Forge launcher supplies 1 GiB shared memory.
Native checkpoint fractions retain batch rounding. Inspect the saved GPU-stage
YAML settings and use the CPUs assigned to the workload when setting a cpuset.
Observed resource usage does not establish a hardware minimum.

## Run and check results

Use an authorized `SESSION`. Set `DESIGN_YAML` to your prepared YAML and
`TARGET_CIF` to its referenced target; this example stages the target as
`/inputs/boltzgen/target.cif`. Upload other scaffold/structure companions at the
paths your YAML references. The [protein-binder recipe](../references/campaign-recipes.md#protein-binder-generation-and-review)
shows an input schema and candidate selection.

```sh
ariax forge tools add "$SESSION" --tools boltzgen --priority boltzgen --json
ariax forge tools wait "$SESSION" boltzgen --timeout 1800 --json
ariax forge inputs add "$SESSION" --file "$DESIGN_YAML" --path boltzgen/design.yaml --json
ariax forge inputs add "$SESSION" --file "$TARGET_CIF" --path boltzgen/target.cif --json
ariax forge inputs list "$SESSION" --json
```

Require every input `ready`. Set `DESIGN_COUNT`, `OUTPUT_BUDGET`, `SEED` and
`TIMEOUT_SECONDS` for the requested workload. `OUTPUT_BUDGET` is the native
final-selection budget, separate from the session's GPU-hour limit. This
protein design command uses the diverse checkpoint and native refold settings:

```sh
ariax forge run "$SESSION" --tool boltzgen --gpus 0 --timeout-seconds "$TIMEOUT_SECONDS" --json -- forge-boltzgen --seed "$SEED" run /inputs/boltzgen/design.yaml --output /workspace/boltzgen/run-01 --protocol protein-anything --num_designs "$DESIGN_COUNT" --budget "$OUTPUT_BUDGET" --devices 1 --num_workers 0 --cache /scratch/cache --moldir /models/boltzgen/mols --design_checkpoints /models/boltzgen/boltzgen1_diverse.ckpt --inverse_fold_checkpoint /models/boltzgen/boltzgen1_ifold.ckpt --folding_checkpoint /models/boltzgen/boltz2_conf_final.ckpt --config analysis num_processes=2
```

Set `COMMAND_ID` to the command ID returned by `run`, then monitor it:

```sh
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout "$TIMEOUT_SECONDS" --json
ariax forge logs "$SESSION" "$COMMAND_ID" --tail 1000 --json
```

Use a fresh output directory for each run. Inspect resolved settings, candidate
identity, refold samples, ranked exports and native filter decisions. The
[example README](boltzgen/README.md) lists optional fixture workflows and their
matching checkers; those checks apply to their declared inputs and manifests.

## Output interpretation and recovery

Native masks identify designed residues and preserve scaffold/target identity.
The two-chain protein example maps input design B to emitted A and target A to
emitted B; use saved masks and author/label-chain maps for every other input.
Inverse-fold-only writes sequences/refolds under `intermediate_designs/`; use
native `config/analysis.yaml`'s `design_dir` to locate them. Reference scoring
uses the target chain mask, sequence recovery uses the residue design mask, and
optional binder-only lDDT uses the saved `asym_id` chain map.

| Output | Meaning |
| --- | --- |
| `steps.yaml`, `config/` | Exact native stage order and resolved settings |
| `intermediate_designs/` | Original backbones and design masks |
| `intermediate_designs_inverse_folded/` | Sequences and masks; designed sidechains may be zero placeholders |
| `refold_cif/`, `refold_design_cif/` | Native complex and binder-only refolds |
| `fold_out_npz/`, `fold_out_design_npz/` | Every saved native sample with atom/token maps |
| Native affinity outputs | Predicted affinity and binder-probability arrays for ligand inputs |
| `aggregate_metrics_analyze.csv` | Native analysis, including unavailable reference metrics |
| `final_ranked_designs/all_designs_metrics.csv` | Candidate identity, rank and every filter decision |
| `final_designs_metrics_N.csv`, `final_N_designs/` | Diversity-selected exports; inspect `pass_filters` |
| `results_overview.pdf` | Native report and criteria |

All five coordinate, confidence and PAE samples remain in NPZ. Native 0.2.0 selects
CIF coordinates by `argmax(0.8*iPTM+0.2*pTM)`, while CIF pLDDT uses sample zero.
Native filtering keeps the first occurrence of an identical
designed sequence; retain all generated arrays and inspect retained/deduplicated IDs.

A normal exit establishes execution. A ranked export may remain scientifically
rejected. Keep rejection flags, failed cases, unavailable metrics and score
direction. `protein-anything` retains its GLU fraction cap 0.2 and RMSD 2.5 Å;
peptide settings differ and remain in resolved configs. Unconditioned inputs
leave SS-conditioning metrics unavailable. Confidence, ranking and affinity
predictions establish no experimental binding or benchmark-accuracy claim.

Save inputs and complete outputs using [Forge Files](../outputs.md). Resume
restores saved files without replaying scientific commands. For optional
single-file packaging and explicit unpacking, see the
[archive helper](boltzgen/README.md#optional-archive-helper).
