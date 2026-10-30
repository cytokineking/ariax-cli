# Campaign review helpers

Use these source files with the [campaign recipes](../../../references/campaign-recipes.md)
and [five-path consensus guide](../../campaign-recipes.md). Locate this directory
with `ariax skills forge --tool campaign-recipes --json` at
`data.examples['campaign-recipes']`. Every helper and scientific command runs on
the authorized remote host. No scientific outputs are bundled here.

| Files | Use and limits |
| --- | --- |
| `boltzgen-select.py` | Join native BoltzGen metrics and a matching checker report; review all candidates or export explicitly named IDs. The bundled BoltzGen checker covers the two-design 1UBQ/40-residue-binder fixture only. |
| `rfantibody-select.py` | Discover native RFantibody checker reports beneath checked profile directories; review or export explicit profile/design/sequence identities. |
| `consensus.py`, `*-plan.json` | Read a complete five-path manifest and saved native outputs; write review shortlists without prediction. The plans describe paths and output locations, rather than executable model jobs. |
| `molecular/`, `stage-inputs.py` | Stage the ten supplied molecular JSON/YAML inputs in the remote workspace. These inputs do not include native outputs or a complete campaign manifest. |
| `protenix-input.py` | Prepare a full-1UBQ Protenix input from checked `B43` or `B55g` exports of `ubiquitin_0` or `ubiquitin_1`. It requires the original 40-residue binder and checked target FASTAs. |
| `protenix-native.py`, `protenix-compare.py` | Optional same-forward export diagnostic in the Protenix workload. The capture wrapper adds raw arrays; the comparison is limited to `B43_ubiquitin_1_full_target`, seed 101 and one sample. |
| `genie3-motif-select.py`, `motif-metrics.py`, `motif-native-metrics.py` | Helpers for the retained `04_5WN9_0` motif example, preserving fixed-residue maps, native thresholds, missing atoms and rejection. They are not general motif validators. |
| `motif-pdb.py` | Convert an explicitly named saved CIF to PDB, or verify its existing conversion, in the selected BoltzGen/Gemmi workload. |

`boltzgen-select.py` reads `final_ranked_designs/all_designs_metrics.csv` and a
checker JSON containing `samples`, `filter_decisions` and
`unavailable_metric_columns`. It joins exact candidate IDs to the design-mask
chain map and actual complex refold, preserving all rows and original flags.
Explicit export copies the candidate's CIF/NPZ, binder and target FASTAs,
checker report, native settings and same-candidate context. Without
`--candidate`, it writes only `review.json`; an empty accepted selection stays
empty.

`rfantibody-select.py` scans recognized checker JSON reports recursively; there
is no fixed report count. The current layout is
`PROFILE/checks/design_N_dldesign_M.json`, with matching generation, sequence,
prediction and stage files under `PROFILE`. The legacy `PROFILE/check-M.json`
layout identifies `design_0_dldesign_M`. Candidate IDs are relative profile paths
plus the full native stem, such as `vhvl/design_2_dldesign_3`; shared backbone
or rank alone is insufficient. The helper retains native scores, unavailable
light-chain values, residue maps and screening decisions. Export saves H/L
separately for a paired Fv or complete H for a VHH, with target T and native
files. It does not build a linker, Fab or IgG.

Both selectors take a remote result `root`, fresh `--out` directory and optional
repeatable `--candidate ID`. BoltzGen also requires `--check FILE`. Rejected
candidates require `--review-rejected` and remain in `rejected-review/`.
Outputs stay under `/workspace`. Missing or ambiguous IDs and incomplete
same-candidate files fail explicitly. Inspect and retain a partial failed
export; use a fresh directory after correction. Run the appropriate native
checker first: selectors consume its result and do not replace structure/array
identity checks or establish experimental quality. The recipe guide supplies
registration and command examples.

For consensus, register `consensus.py` as `campaigns/review/consensus.py` through
Files and wait for import readiness. Supply `campaign.json`, original native
outputs and per-command records under one campaign root, using the
[manifest format](../../campaign-recipes/formats.md). The consumer requires all
five paths, with one or two candidates per path. Run it in the selected remote
RF3 workload, where Gemmi and NumPy are available; use a fresh `--out` directory.
Saved files may come from an existing workspace or an optional
[same-project resume](../../../outputs.md).

The molecular fixtures preserve the exact B43 ubiquitin candidates, the B66
paired-six-CDR antibody proposal, L1 OQO-conditioned design and RNA64 sample 0.
They describe bounded inputs; original scientific outputs are saved separately
through Files. Register every file in `molecular/` and `stage-inputs.py`, then
run remotely after all imports are ready:

```sh
python3 /inputs/campaigns/stage-inputs.py /inputs/campaigns/molecular --out /workspace/campaign-delivery
```

Staging copies inputs into `inputs/` beneath the output root. Existing files
must contain the same bytes, preventing a changed molecular input from silently
replacing a saved one. This step runs no prediction.
