# Campaign review helpers

Use these small source files with the [campaign recipes](../../../references/campaign-recipes.md).
The selection helpers read actual native outputs on the authorized remote GPU
host and preserve their decisions for explicit candidate export. No scientific
output is bundled here.

The B56 joined completion recipe records the completed
public-v1 Protenix, managed Genie3 sequence/prediction and Proteina/RF3 joins.
Fresh installation and full Files/R2 scientific restoration passed October 10. `protenix-input.py` ties
an explicit retained cohort/candidate to checked full-target FASTAs. The
separate `protenix-native.py` runs the native predictor with an additive raw
capture; `protenix-compare.py` compares its complete same-forward exports.
B56 exercised these helpers through the installed guide on its authorized GPU
VM and retained their original scientific outcomes.

`boltzgen-select.py` reads the native `all_designs_metrics.csv` and the JSON
printed by the existing B43 checker. It joins explicit candidate IDs to the
checker's design-mask chain map and the actual complex refold. It saves all
rows, original filter flags and unavailable-column names. An explicit
`--candidate` copies that candidate's actual CIF, native confidence NPZ and
sequence. Rejected candidates require `--review-rejected` and go into a
separate `rejected-review` directory. With no candidate, it writes only the
review report. Empty accepted selection stays empty.

`rfantibody-select.py` reads the four existing `rfantibody-check` JSON reports,
the corresponding actual PDB/NPZ pairs and stage records. Candidate identity
is the modality plus `design_0_dldesign_N`, not the shared backbone or rank.
It preserves native scores, unavailable light-chain values, residue maps and
the original screening decision. Explicit export saves H/L separately for a
paired Fv, or complete H for a VHH. It never builds a linker, Fab or IgG.
Rejected candidates require `--review-rejected` and stay rejected.

Outputs use a fresh directory under `/workspace`. Helpers reject missing or
ambiguous IDs and incomplete same-candidate files. A failed partial export
must be inspected and retained; choose a fresh directory after correction.
Run the existing native checker first. These helpers do not replace its
structure/array identity checks or establish experimental quality.

B54b supplied the initial source review. B56 subsequently completed native
use, installed delivery and full scientific restoration. B57 owns the remaining
actual human/agent workflow across separate physical allocations.

The historical exercise proposal records the original
B56/B57 scopes. B56's completed handoff supersedes its old delivery gates and
budget. B57 requires its own current activation before allocation.

## Five-path consensus example

Use [the primary guide](../../campaign-recipes.md) and [manifest format](../../campaign-recipes/formats.md). Each *-plan.json names its finite path and saved output. Register consensus.py as campaigns/review/consensus.py through Files and invoke it in the selected remote RF3 workload against a complete restored campaign-delivery root. It writes all five review shortlists from explicit saved native outputs, with chain checks and separate score scales. Fresh outputs require a fresh --out directory. The consumer performs no prediction.

The molecular/ directory contains the exact ten small JSON/YAML inputs used for the bounded new refolds. They derive from the retained B43 ubiquitin cohort, B66 first IgDesign paired-six proposal, B56 L1 OQO-conditioned design and B28 RNA64 sample 0. Original scientific output is retained through Files, separately from these source fixtures. Stage all input files and stage-inputs.py through inputs add; after import readiness, run `python3 /inputs/campaigns/stage-inputs.py /inputs/campaigns/molecular --out /workspace/campaign-delivery`. Existing files must match byte for byte. This stage performs no prediction.
