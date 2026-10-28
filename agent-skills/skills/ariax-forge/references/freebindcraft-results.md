# FreeBindCraft filters and results

Use this reference to interpret FreeBindCraft acceptance, ranking and metric
availability. Read it alongside the [native result checks](../tools/freebindcraft.md)
and [shared interpretation guide](../../../core/interpretation.md).
The current `--no-pyrosetta` path performs CUDA OpenMM relaxation and
alternative scoring. CUDA relaxation/repacking failures stop the command.
The runtime patch changes relaxation and attempt counting; it leaves the
alternative scorer's fixed values and native filter comparisons intact.

## Counts and ranking

`trajectory_stats.csv` records trajectory identity, seed, sequence, length,
hotspot and scores. `mpnn_design_stats.csv` includes redesigned candidates
with average and per-model metrics. Read rejection reasons from
`failure_csv.csv` and `rejected_mpnn_full_stats.csv` when produced.
`Accepted/*.pdb` contains selected accepted complex models; native reranking
fills `Accepted/Ranked` and `final_design_stats.csv` once the accepted goal is
reached. An attempt cap or interruption can leave partial acceptance and a
header-only final table. Reconcile those files with the actual accepted count.

Join each accepted filename's stem before `_modelN` to CSV `Design`,
`Sequence`, length and selected model. Ranked filenames add a rank prefix.
Check the structure's binder sequence against its CSV/FASTA, target sequence
and remodeled register. Native target chain A can concatenate source chains;
retain the original-to-modeled map. Default cleanup may remove unrelaxed or
monomer files, and FASTA/PAE retention depends on configuration.

Default ranking descends by `Average_i_pTM`; `--rank-by ipSAE` chooses
`Average_ipSAE`. Ranking changes neither filters nor scientific acceptance.
Native built-in ipSAE uses its own target-then-binder PAE calculation, with
default cutoff 10 Å; external ipSAE versions need separate comparison.
CSV pLDDT follows ColabDesign's 0–1 scale. Keep PAE arrays and their units
separate from normalized summary metrics or PDB B factors.

## Filter evaluation gaps

Each scalar filter has `threshold` and `higher`. True sets a lower bound,
false an upper bound; equality passes. A null threshold disables the test.
The native `check_filters` skips unknown labels and missing/None values.
For `InterfaceAAs` dictionaries it also skips missing amino-acid entries.
Floating NaN compares false in either direction and can pass. Infinity is
not rejected as nonfinite and can pass a one-sided threshold.

Before interpreting acceptance, match every enabled filter to an emitted
column, require a finite numeric value in the right units, and distinguish
computed metrics from the fixed substitutes below. Report unevaluated or
unusable criteria as unavailable. Clearing final filters leaves early native
trajectory confidence, contact and clash gates active.

## Values emitted by the current OpenMM scorer

The table names native CSV suffixes. Average/per-model prefixes may be added.
These fixed values are explicitly chosen by the native scorer to pass filters:

| CSV metric suffix | Value | Scientific meaning |
| --- | --- | --- |
| `Binder_Energy_Score` | -1 | Uncomputed energy placeholder |
| `PackStat` | 0.65 | Uncomputed packing placeholder |
| `dG` | -10 | Uncomputed energy placeholder |
| `dG/dSASA` | 0 | Uncomputed energy/area placeholder |
| `n_InterfaceHbonds` | 5 | Uncomputed H-bond count |
| `InterfaceHbondsPercentage` | 60 | Uncomputed H-bond percentage |
| `n_InterfaceUnsatHbonds` | 1 | Uncomputed unsatisfied H-bond count |
| `InterfaceUnsatHbondsPercentage` | 0 | Uncomputed unsatisfied H-bond percentage |

Check exact emitted spelling against the CSV header. `ShapeComplementarity`
is calculated by the bundled executable when it succeeds; the scorer returns
0.70 when that computation is unavailable or fails. Retain its log evidence.
Missing DSSP can also trigger secondary-structure substitutes. SASA,
hydrophobicity and interface residue counts use separate geometric methods;
CUDA relaxation does not turn the fixed fields into measured Rosetta scores.

For the unchanged PD-L1 examples, the [packaged checker](../tools/examples/freebindcraft/complete/README.md)
checks saved native-array/PDB correspondence and available MPNN captures.
It assumes the bundled target and export layout. For a different target or
configuration, check its actual sequences, chain/register map, native arrays,
metric availability and original filter decisions; a fixture check is not a
general validation of those results.

Preserve effective filters, scoring mode, native logs, raw CSVs, sequence and
structure stage with a shortlist. Review interface geometry and target context
before choosing experimental candidates. Follow the [checkpoint and recovery
workflow](../outputs.md); recover a missing saved artifact without automatically
replaying design.

Sources: [alternative scorer](https://github.com/cytokineking/FreeBindCraft/blob/d12747dbc907435622559b81891ad73e0a45c2e4/functions/pr_alternative_utils.py),
[filter/ranking code](https://github.com/cytokineking/FreeBindCraft/blob/d12747dbc907435622559b81891ad73e0a45c2e4/functions/generic_utils.py).
