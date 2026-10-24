# Forge FreeBindCraft binder design

For real inputs and result review, read
[target preparation and budgets](../references/freebindcraft-inputs.md) (`freebindcraft-inputs`) and [filters, placeholders and ranking](../references/freebindcraft-results.md) (`freebindcraft-results`).
Use those IDs with
`ariax skills forge --reference ID --read --json`. The [shared interpretation
guide](../../../core/interpretation.md) covers structure stages and fair comparisons.


Read this guide with `ariax skills forge --reference freebindcraft --read --json`
(alias `ariax-forge`). Set `EXAMPLES` to the absolute `data.examples.root`
path from `ariax skills forge --json`, and `SESSION` to an authorized session's
UUID. The agent chooses native argv inside the selected image, including an
explicit shell when needed. Forge passes that argv unchanged. The commands
below illustrate one bounded native case.

## Readiness and shared model mount

For a session with FreeBindCraft in its deployed catalog:

```sh
ariax forge tools add "$SESSION" --tools freebindcraft --priority freebindcraft --json
ariax forge tools wait "$SESSION" freebindcraft --timeout 1800 --json
ariax forge status "$SESSION" --json
```

Require host `available` and `freebindcraft` ready. The shared named
`alphafold2` asset mounts read-only at `/models/alphafold2` and contains
LICENSE plus all fifteen native ordinary, pTM and multimer_v3 NPZ files.
Both design tools reuse this prepared directory. The advanced settings set
`af_params_dir` to that mount. The small soluble MPNN weights remain image
package resources. JAX requires CUDA and the image sets
`OPENMM_PLATFORM_ORDER=CUDA` for GPU relaxation. Compilation/cache writes
use scratch; host credentials remain outside workloads.

## Staged inputs and native settings

The [settings](examples/freebindcraft/settings.json) select the bundled
[PD-L1 structure](examples/freebindcraft/PDL1.pdb), chain A with 115 residues
numbered 18–132 and hotspot 56. They request an 80-residue chain B binder,
within the native PD-L1 example's 65–150-residue range.
The [advanced settings](examples/freebindcraft/advanced.json) bound the case
to one trajectory and one MPNN sequence, with the native standard four-stage
optimizer: logits 75, softmax 45, one-hot 5 and semigreedy 15 iterations.
Model sampling is enabled. Beta reoptimization is disabled, with one recycle
for design and validation; two held-out models validate the redesigned
complex and binder alone. [Filters](examples/freebindcraft/filters.json)
are `{}`, clearing optional refold/final thresholds. Native trajectory
confidence, contact and clash checks remain.

The pinned native CLI has no seed argument or config selector; it draws
each trajectory seed internally. The accepted B09 native case used seed
171558. A later single trajectory can be rejected by the same native gates.
Rejection fails the case; no second trajectory or automatic replay follows.
These bounded settings are execution checks, not a scientific search
recommendation. For real work establish the user's target construct,
chain, hotspots, binder scope and evaluation criteria. The target is a
retained example structure, and no generated binder is supplied in advance.

```sh
ariax forge inputs add "$SESSION" --file "$EXAMPLES/freebindcraft/PDL1.pdb" --path freebindcraft/PDL1.pdb --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/freebindcraft/settings.json" --path freebindcraft/settings.json --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/freebindcraft/advanced.json" --path freebindcraft/advanced.json --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/freebindcraft/filters.json" --path freebindcraft/filters.json --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/freebindcraft/check.py" --path freebindcraft/check.py --json
ariax forge inputs list "$SESSION" --json
```

Record each input ID and require all five paths ready. Observe imports with
`ariax forge inputs status "$SESSION" "$INPUT_ID" --json`. Inputs are
read-only. The JSON contains absolute input paths and writes to
`/workspace/b09/freebindcraft`. Update those paths when staging elsewhere.
A changed run needs a fresh `design_path`, a new staged settings path and an
explicit new command, preserving the previous run and its IDs.

## One bounded native GPU run

`freebindcraft` is a thin PATH shim that execs native `bindcraft.py` with the
supplied argv. Native arguments follow the CLI's `--` separator:

```sh
ariax forge run "$SESSION" --tool freebindcraft --timeout-seconds 3600 --json -- freebindcraft --settings /inputs/freebindcraft/settings.json --advanced /inputs/freebindcraft/advanced.json --filters /inputs/freebindcraft/filters.json --no-pyrosetta --no-plots --no-animations --verbose
ariax forge watch "$SESSION" "$DESIGN_COMMAND_ID" --timeout 3600 --json
ariax forge logs "$SESSION" "$DESIGN_COMMAND_ID" --tail 1000 --json
```

The accepted native `--no-pyrosetta` flag selects OpenMM relaxation and
alternative scoring in this revision, despite its upstream help text
suggesting relaxation is skipped. PyRosetta is absent. The reviewed image
propagates CUDA relaxation/repacking failures and counts rejected trajectories
against the attempt budget. A failed relaxation is not presented as a copied
unrelaxed success. Inspect the native log for completed CUDA relaxation of
the trajectory and both redesigned complex models, at least three stages
for this exact case. Rosetta-specific metrics may be native placeholders;
do not interpret them as measured Rosetta scores.

Set `DESIGN_COMMAND_ID` to the returned ID and require `succeeded` before a
dependent check. A `watch` timeout ends local polling and leaves remote work
running. Inspect that same ID and its logs after a lost acknowledgment.
Recover the original saved request with `--command-id` and identical fields
when appropriate. A new ID is a new execution. A correction uses an explicit
new command and fresh output directory; do not automatically replay design
or substitute CPU execution after a GPU failure.

## Check native outputs

Paths below are inside `/workspace/b09/freebindcraft`. The native trajectory
name is `forge_b09_l80_s<randomseed>` and must be read from its CSV:

```text
trajectory_stats.csv
mpnn_design_stats.csv
final_design_stats.csv
failure_csv.csv
Trajectory/<trajectory>.pdb
Trajectory/Relaxed/<trajectory>.pdb
MPNN/<trajectory>_mpnn1_model{1,2}.pdb
MPNN/Relaxed/<trajectory>_mpnn1_model{1,2}.pdb
MPNN/Binder/<trajectory>_mpnn1_model{1,2}.pdb
MPNN/Sequences/<trajectory>_mpnn1.fasta
Accepted/<trajectory>_mpnn1_model<best>.pdb
Accepted/Ranked/<native ranked name>.pdb
```

```sh
ariax forge run "$SESSION" --tool freebindcraft --timeout-seconds 60 --json -- python3 /inputs/freebindcraft/check.py /workspace/b09/freebindcraft
ariax forge watch "$SESSION" "$CHECK_COMMAND_ID" --timeout 120 --json
ariax forge logs "$SESSION" "$CHECK_COMMAND_ID" --tail 1000 --json
```

Record the new checker ID. The [checker](examples/freebindcraft/check.py),
using the image's Gemmi package, requires one row in each design table,
matching redesigned/final identities and sequences, and a matching native
FASTA. It parses the original and relaxed trajectory, both unrelaxed and
relaxed refolded complexes, and one accepted relaxed PDB. Each checked
complex must have target chain A matching the staged PD-L1 sequence, binder
B80 and finite coordinates. Native average pLDDT/pTM/i_pTM must be finite
on 0–1. The log inspection above supplies separate CUDA relaxation evidence.

An exit-zero command can still produce incomplete or header-only output.
The checker must pass. Reaching the attempt limit can leave no accepted
design. Review native rejection reasons and tables rather than inventing a
passing score threshold or claiming binding success from file existence.
The bundled `check-limit.py` is the operator's native attempt-budget probe;
it is separate from design and its output checker.

## Save, download and restore

After all run/check commands are terminal, create a completed checkpoint:

```sh
ariax forge sync "$SESSION" --wait --timeout 1800 --json
ariax forge files "$SESSION" --path /workspace/b09/freebindcraft --checkpoint "$CHECKPOINT" --json
ariax forge files "$SESSION" --path /workspace/b09/freebindcraft/Accepted --checkpoint "$CHECKPOINT" --json
ariax forge download "$SESSION" /workspace/b09/freebindcraft/final_design_stats.csv --checkpoint "$CHECKPOINT" --dest ./b09-freebindcraft-final.csv --json
ariax forge download "$SESSION" "/workspace/b09/freebindcraft/Accepted/$ACCEPTED_FILE" --checkpoint "$CHECKPOINT" --dest ./b09-freebindcraft-complex.pdb --json
ariax forge close "$SESSION" --json
ariax forge status "$SESSION" --json
```

Set `CHECKPOINT` to the returned completed checkpoint UUID and require
`synced`. Set `ACCEPTED_FILE` to the accepted PDB basename from the completed
checkpoint listing and match it to the checker result. Listing/download
reads completed bytes, including after close. Public `closed` confirms
allocation release; inspect persistence errors separately and preserve the
last completed checkpoint.

Set `PROJECT` from the session and `REVISION` from its current `control.revision`.
If held, stop and wait for authenticated web approval and user direction, then
read the new revision. Approval itself leaves compute unallocated. Continue
that same project:

```sh
ariax forge project "$PROJECT" --json
ariax forge resume "$PROJECT" --gpu L40 --tools freebindcraft --restore-session "$SESSION" --checkpoint "$CHECKPOINT" --control-revision "$REVISION" --max-gpu-hours 1 --json
ariax forge status "$RESTORED_SESSION" --json
ariax forge tools wait "$RESTORED_SESSION" freebindcraft --timeout 1800 --json
ariax forge run "$RESTORED_SESSION" --tool freebindcraft --timeout-seconds 60 --json -- python3 /inputs/freebindcraft/check.py /workspace/b09/freebindcraft
ariax forge watch "$RESTORED_SESSION" "$RESTORED_CHECK_COMMAND_ID" --timeout 120 --json
ariax forge close "$RESTORED_SESSION" --json
ariax forge status "$RESTORED_SESSION" --json
```

Restore from a terminal source, use the new session ID, and require host/tool
readiness. Record and watch its explicit checker command before closure.
Restore recovers workspace and ready staged inputs without replaying design.
Each new session uses normal allocation and billing. Read the
[outputs reference](../outputs.md) for checkpoint and recovery semantics.


## B45 bounded native routes, October 7, 2026


These settings require the corrected B45 image. The current B45 catalog
fragment selects the explicit no-PyRosetta route and only mounts `alphafold2`.
The PyRosetta route remains pending until managed preparation also supplies
the authorized `pyrosetta` mount described below. Do not run its settings on
the B09 image or interpret the fragment as PyRosetta admission.

After the deployed catalog supplies the matching route and tool readiness,
stage `PDL1.pdb` as above and the B45 settings/helper under these paths:

```sh
for FILE in advanced.json filters.json settings-openmm.json settings-pyrosetta.json check.py; do
  ariax forge inputs add "$SESSION" --file "$EXAMPLES/freebindcraft/b45/$FILE" --path "freebindcraft/b45/$FILE" --json
done
ariax forge inputs list "$SESSION" --json
ariax forge run "$SESSION" --tool freebindcraft --gpus 0 --timeout-seconds 3600 --json -- freebindcraft --settings /inputs/freebindcraft/b45/settings-openmm.json --advanced /inputs/freebindcraft/b45/advanced.json --filters /inputs/freebindcraft/b45/filters.json --no-pyrosetta --no-plots --no-animations --verbose
```

Require every input ready, then watch the returned command to completion.
For the separately admitted PyRosetta route, select `settings-pyrosetta.json`
and omit `--no-pyrosetta`. The settings write distinct `/workspace/b45/openmm`
and `/workspace/b45/pyrosetta` directories. Retain the previous output; changed
inputs/settings need a new staged path and fresh `design_path`.

The B45 checker verifies the recorded rejection layout, not a general
passing-design outcome. Inspect command logs and native tables first:

```sh
ariax forge run "$SESSION" --tool freebindcraft --gpus 0 --timeout-seconds 120 --json -- python3 /inputs/freebindcraft/b45/check.py /workspace/b45/openmm
ariax forge sync "$SESSION" --wait --timeout 900 --json
ariax forge files "$SESSION" --path /workspace/b45/openmm --checkpoint "$CHECKPOINT" --json
ariax forge link "$SESSION" /workspace/b45/openmm/rejected_mpnn_full_stats.csv --checkpoint "$CHECKPOINT" --json
```

Wait for the checker before sync and use the completed checkpoint ID for
`CHECKPOINT`. For PyRosetta, use its directory throughout. Share the rejected
result and retained structures when no Accepted/Ranked files exist. After
restoration, inspect this saved result before any explicit further design.

Both explicit routes completed using the [bounded settings](examples/freebindcraft/b45/advanced.json),
[OpenMM](examples/freebindcraft/b45/settings-openmm.json) /
[PyRosetta](examples/freebindcraft/b45/settings-pyrosetta.json) settings and
unchanged upstream default [filters](examples/freebindcraft/b45/filters.json).
Each ran two trajectories, completed one trajectory relaxation and attempted
one MPNN candidate. Both first complex refolds failed native i_pTM/i_pAE
filters, leaving zero accepted designs. Preserve this bounded rejected outcome.
The emitted rejected CSV fields are failure indicators, not confidence scores.
No additional search was run.

OpenMM was selected by `--no-pyrosetta` and completed CUDA relaxation.
The separate PyRosetta route initialized the existing authorized Linux x86_64
Python 3.10 package, version `2025.37+release.df75a9c48e763e52a7aa3f5dfba077f4da88dbf5`,
and completed native FastRelax and interface scoring. Requested PyRosetta
absence or initialization failure now raises an error. The named `pyrosetta`
asset is mounted read-only at `/models/pyrosetta`, with package
`python/pyrosetta`. Its binaries and credentials stay outside the image.
Native-use authorization does not establish distribution rights. B55 owns
admission, component review and concrete private-publication proposals.

Three native-array exports per route preserve the exact selected AF2 arrays,
prealignment PDB, model identity, atom37 axis and residue mappings. The
[output checker](examples/freebindcraft/b45/check.py) passed against original
and restored CSV, FASTA, relaxed/unrelaxed structures and arrays. Maximum
coordinate difference was 0.000500 Angstrom and maximum pLDDT B-factor
difference was 0.004998, within PDB rounding. Raw pLDDT uses 0–1, raw PAE
uses Angstrom, and CSV pAE/i_pAE are normalized native summaries. Refold RNG
seeds remain unavailable when the native caller supplies none.


The October 7 first-refold rejection prevented later complex models, redesigned-complex
relaxation, binder-alone refolds and Accepted/Ranked results in those campaigns.
The October 9 correction cases below exercise those later diagnostic branches. These bounded cases qualify the paths
they reached; they do not qualify every advertised upstream mode or broader
resource minima. Shared catalog admission, managed package preparation,
distribution review and production rollout remain separate.

For PyRosetta, `Binder_Energy_Score` is native TotalEnergyMetric over binder
chain B; `dG` is the InterfaceAnalyzer separated-interface score in Rosetta
energy units. Neither is experimental binding free energy. `dSASA` is buried
area in Angstrom squared, and `dG/dSASA` is the native ratio multiplied by 100.
PackStat, ShapeComplementarity, interface H bonds and buried unsatisfied
heavy-atom H bonds retain native definitions. The explicit no-PyRosetta
placeholders and missing-metric filter gaps described in
[results interpretation](../references/freebindcraft-results.md) remain.
GPU relaxation alone does not compute missing metrics.

## B45 complete-tool profiles and explicit native diagnostics


Both `alphafold2` and the complete separately authorized `pyrosetta` asset are
required by the accepted two-route candidate catalog. PyRosetta remains outside image
layers at `/models/pyrosetta/python/pyrosetta`. OpenMM is explicitly selected
with `--no-pyrosetta`; omission selects native PyRosetta and fails when absent.
The image retains the exact ColabDesign e31a56f Beer-ware notice, FreeBindCraft
source LICENSE and installed dependency notices. Native-use authorization and
private payload publication are recorded independently.

To inspect a saved B45 rejection after restoration, stage the original target,
complete settings/advanced/filter JSON and the diagnostic checker from the
installed `freebindcraft/complete` examples. Use the retained campaign directory
as `--campaign` and a new empty output path. For example:

```sh
ariax forge run "$SESSION" --tool freebindcraft --gpus 0 --timeout-seconds 900 --json -- freebindcraft-refold --campaign /workspace/retained/openmm --settings /inputs/freebindcraft/b45/settings-openmm.json --advanced /inputs/freebindcraft/b45/advanced.json --filters /inputs/freebindcraft/b45/filters.json --output /workspace/diagnostic-openmm-r3 --recycles 3 --no-pyrosetta
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 900 --json
ariax forge run "$SESSION" --tool freebindcraft --gpus 0 --timeout-seconds 120 --json -- freebindcraft-check /workspace/diagnostic-openmm-r3 --diagnostic
```

Use `pyrosetta` consistently for the other route and omit `--no-pyrosetta`.
Watch each returned command ID. The diagnostic selects the one retained rejected
row and its matching trajectory, predicts the native held-out models 1 and 2,
retains all 13 native array fields before native alignment, and compares each
with an independent direct native call using its recorded diagnostic RNG seed.
The original campaign's unavailable refold seeds remain unavailable.
`--recycles 1` reproduces the bounded B45 validation setting; 3 is the native
preset default. The diagnostic preserves every model's actual filter result.
Its post-rejection relaxation is explicitly marked diagnostic.

The named finite campaign profiles keep upstream thresholds. Default
miniprotein settings use 4stage 75/45/5/15, sampled multimer-v3 models 1–5,
design recycle 1, held-out pTM models 1–2 with validation recycle 3,
soluble MPNN v_48_020 batch 20 and accepted cap 2 per trajectory. The peptide
preset uses 3stage 75/45/5, MPNN batch 10/cap 2, initial guess and its native
peptide losses/filters. Each example bounds search to two trajectories and
accepted goal one. Retention overrides keep FASTA, structures and native arrays.
An accepted goal does not bound attempts; keep both an explicit attempt cap and
a session duration. Rejection and timeout remain usable saved outcomes.

`freebindcraft-check DIRECTORY` verifies every saved native export's atom axis,
model identity, sequence, shapes/dtypes, finite confidence/PAE, atom masks and
PDB correspondence at the original 0.000501 Å coordinate and 0.00501 B-factor
tolerances. With `--diagnostic`, it also requires the retained original rejection,
complete independent comparisons, relaxed complexes and aligned binder sequences.
The checker requires the exact 13-field AF2 set and exact reference shapes and
dtypes before numerical comparison. It audits every unfiltered MPNN sample,
including logits, decoding order, complete input/output cardinality, fixed target
and interface positions, sequence identities and native scores. Raw MPNN score
is native negative log likelihood over unfixed masked residues; lower is better.
The supplemental rejected-full table retains its historical zero score/recovery
placeholders. Use the raw NativeMPNN batch for those values. PyRosetta's unseeded
Packstat can vary on rescoring; deterministic interface fields and original
campaign values remain recorded.

Use the older B45 checker for the exact October 7 rejection fixture. Sync only
after commands are terminal. Preserve all inputs, settings, logs, failure tables,
NativeArrays and original decisions in Files. After a fresh logical restoration,
inspect those bytes and rerun the checker without replaying scientific design.

The completion record reports the measured host, enforced CPU/RAM limits,
actual supported profiles and remaining gates. Reduced or diagnostic execution
does not establish support for an unrun preset or arbitrary protein length.
B57 retains actual outside-human/agent and separate-allocation acceptance.

The qualification host used one ECC-enabled L40 (46,068 MiB visible VRAM),
28 CPUs and 58,345 MiB host RAM. Finite campaigns enforce 8 CPUs/32 GiB;
held-out diagnostics enforce 24 CPUs/50 GiB, with swap disabled. Observed
peaks qualify these tested cases, not a universal minimum. Keep 250 GiB disk
admission for preparation and retained outputs.

## Complete managed-delivery acceptance, October 9

The final private image passed all-layer review with PyRosetta outside image layers. Both complete model directories prepared from absent paths, and native PyRosetta/JAX/OpenMM initialization passed. The installed guide exercised both relaxation routes. Eighteen retained campaigns include three native Accepted/Ranked designs; the two fresh diagnostic checks bring restored audit coverage to thirty-four. Original rejections remain attached to their campaigns.

The final Files checkpoint restored all 4,092 files / 449,160,559 bytes. Full remote R2 restoration compared every selected file and passed all thirty-four audits. Shared Files integration passed on the unchanged four-outstanding-transfer/three-total-SDK-attempt implementation. Existing CLI tests and installed package checks passed remotely. Native whole-matrix admission retains CPU8 and disk250 GiB, with no fixed RAM floor; the fresh route diagnostics record their higher host allocation, and the GPU-memory minimum remains unknown.
