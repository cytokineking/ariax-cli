# Forge BindCraft2 binder design

Forge selects BindCraft2 v1.0.4 at source
`d502f19a187a1bc8c05e833ca9cbab7bc1934fe7`. The CUDA 12 image uses JAX 0.11.1
and the shared fifteen-file AlphaFold2 asset. Native scientific outcomes and
saved-output checks remain tied to each run’s recorded settings.

For real inputs and result review, read
[native scientific preparation and interpretation](../references/bindcraft2-science.md) (`bindcraft2-science`).
Use those IDs with
`ariax skills forge --reference ID --read --json`. The [shared interpretation
guide](../../../core/interpretation.md) covers structure stages and fair comparisons.


Read this guide with `ariax skills forge --reference bindcraft2 --read --json`
(alias `ariax-forge`). Set `EXAMPLES` to the absolute `data.examples.root`
path from `ariax skills forge --json`, and `SESSION` to an authorized session's
UUID. The agent chooses native argv inside the selected image, including an
explicit shell when needed. Forge passes that argv unchanged. The commands
below illustrate one bounded native case.

## Readiness and shared model mount

For a session with BindCraft2 in its deployed catalog:

```sh
ariax forge tools add "$SESSION" --tools bindcraft2 --priority bindcraft2 --json
ariax forge tools wait "$SESSION" bindcraft2 --timeout 1800 --json
ariax forge status "$SESSION" --json
```

Require host `available` and `bindcraft2` ready. The shared named `alphafold2`
asset mounts read-only at `/models/alphafold2` and contains LICENSE plus all
fifteen native ordinary, pTM and multimer_v3 NPZ files. Both design tools
reuse this prepared directory. The image sets `BINDCRAFT_AF2_PARAMS` to this
mount and supplies its small ProteinMPNN weights separately. JAX requires
CUDA; compilation and cache writes use scratch. Host credentials remain
outside workloads.

## Staged inputs and native settings

The [settings](examples/bindcraft2/settings.json) select the bundled
[PD-L1 structure](examples/bindcraft2/PDL1.pdb), chain A with 115 residues
numbered 18–132 and hotspot 56. They request a 31-residue chain B binder,
one trajectory, one MPNN sequence, seed 7 and one recycle for each design
and validation phase. Screen/refine/anneal/harden steps are 5/5/1/1, with
no mutation stage. One design model and one held-out validation model are
used. The XLA attention backend is explicit; autotuning, desperation,
resume, extra workers and next-length compilation are disabled.

Optional final filters are cleared and stage confidence thresholds are
zero. These reduced settings qualify execution; they are not a scientific
search recommendation. For real work establish the user's target construct,
chain, hotspots, binder scope and evaluation criteria. The target is a
retained example structure, and no generated binder is supplied in advance.

```sh
ariax forge inputs add "$SESSION" --file "$EXAMPLES/bindcraft2/PDL1.pdb" --path bindcraft2/PDL1.pdb --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/bindcraft2/settings.json" --path bindcraft2/settings.json --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/bindcraft2/check.py" --path bindcraft2/check.py --json
ariax forge inputs list "$SESSION" --json
```

Record each input ID and require all three paths ready. Observe imports with
`ariax forge inputs status "$SESSION" "$INPUT_ID" --json`. Inputs are
read-only. The JSON contains absolute input paths and writes to
`/workspace/b09/bindcraft2`. Update those paths when staging elsewhere.
Choose a fresh `project_folder` and input settings path for a changed run;
the example's `resume: false` refuses an existing nonempty campaign.

## One bounded native GPU run

`bindcraft` is on PATH. Native arguments follow the CLI's `--` separator:

```sh
ariax forge run "$SESSION" --tool bindcraft2 --timeout-seconds 3600 --json -- bindcraft design /inputs/bindcraft2/settings.json
ariax forge watch "$SESSION" "$DESIGN_COMMAND_ID" --timeout 3600 --json
ariax forge logs "$SESSION" "$DESIGN_COMMAND_ID" --tail 1000 --json
```

Set `DESIGN_COMMAND_ID` to the returned ID and require `succeeded` before a
dependent check. A `watch` timeout ends local polling and leaves remote work
running. Inspect that same ID and its logs after a lost acknowledgment.
Recover the original saved request with `--command-id` and identical fields
when appropriate. A new ID is a new execution. A correction uses an explicit
new command and fresh output directory; do not automatically replay design
or substitute CPU execution after a GPU failure.

## Check native outputs

Paths below are inside `/workspace/b09/bindcraft2`. The native trajectory
name is discovered from its CSV, rather than predicted in advance:

```text
1_Trajectories/!_Trajectories.csv
1_Trajectories/<trajectory>/<trajectory>_trajectory.cif
2_Refolded/!_Refolded.csv
2_Refolded/Complexes/<trajectory>_candidate1.cif
3_Ranked/!_Ranked.csv
3_Ranked/<trajectory>_seq0.cif
summary.csv
```

```sh
ariax forge run "$SESSION" --tool bindcraft2 --timeout-seconds 60 --json -- python3 /inputs/bindcraft2/check.py /workspace/b09/bindcraft2
ariax forge watch "$SESSION" "$CHECK_COMMAND_ID" --timeout 120 --json
ariax forge logs "$SESSION" "$CHECK_COMMAND_ID" --tail 1000 --json
```

Record the new checker ID. The [checker](examples/bindcraft2/check.py), using
the image's Biotite reader and NumPy, requires one completed row per stage
and a passed native refold. It checks candidate/ranked identifiers and
binder sequences, then parses the trajectory, refolded and ranked CIFs. Each must have target
chain A matching the staged PD-L1 sequence, binder B31 and finite coordinates.
The emitted refolded pLDDT and i_pTM must be finite on 0–1. Candidate
`_candidate1` and ranked `_seq0` are distinct native identifiers. No binder
monomer prediction is requested by the cleared optional filters.

An exit-zero command can still produce incomplete or header-only output.
The checker must pass. A completed gradient trajectory is separate from an
accepted redesigned candidate; reaching the attempt limit can leave no
accepted design. Review attempts, native rejection reasons and ranking
records separately. Computational acceptance under these reduced filters
does not imply biological binding success.

## Two-trajectory native campaign extension

The separate [campaign settings](examples/bindcraft2/campaign-settings.json) restore
native confidence and final filters, cap the search at two trajectories and cap
redesign at two candidates per trajectory. They use screen/refine/anneal/harden
budgets 10/10/3/1, zero mutation, seed 7, the same A115/B31 target/binder and
one-recycle/one-model limits. Native binder presets set effective final unbound
pLDDT >=0.7, pTM >=0.55, i_pTM >=0.7, normalized i_pAE <=0.35, zero backbone
clashes, >=7 interface residues and binder RMSD <=3.5 Å. ProteinMPNN uses the
native negative v_48_020 variant. These bounded settings are an execution case.

B44 ran this case on an L40 through the accepted Forge `DockerRuntime`, with
read-only inputs/models and writable workspace/scratch. Both trajectories were
rejected at the native screen pLDDT >=0.6 gate, so later gradient stages were
not reached. A separate explicit command produced four native MPNN candidates
and evaluated their held-out complexes and binder monomers. All four were
rejected; no accepted or ranked binder resulted. This extension has native
runtime evidence; the earlier B09/B12 report retains installed-CLI lifecycle
qualification.

The [campaign helper](examples/bindcraft2/campaign.py) invokes the native campaign
and saves its returned arrays beside each trajectory. Its `evaluate-rejected`
operation evaluates saved rejected poses, keeps their original termination,
and writes diagnostics separately. Those outputs do not become ranked campaign
designs. Existing diagnostic folders refuse replay.

Stage the settings, helper and [rejection checker](examples/bindcraft2/campaign-check.py)
as ready `bindcraft2/campaign-settings.json`, `bindcraft2/campaign.py` and
`bindcraft2/campaign-check.py` inputs alongside `PDL1.pdb` and `check.py`. Then run:

```sh
ariax forge run "$SESSION" --tool bindcraft2 --gpus 0 --timeout-seconds 1800 --json -- taskset -c 0-7 python3 /inputs/bindcraft2/campaign.py campaign /inputs/bindcraft2/campaign-settings.json
# Record and watch the returned command ID to completion before evaluation.
ariax forge run "$SESSION" --tool bindcraft2 --gpus 0 --timeout-seconds 1800 --json -- taskset -c 0-7 python3 /inputs/bindcraft2/campaign.py evaluate-rejected /workspace/b44/bindcraft2
# Record and watch the evaluation ID before checking its outputs.
ariax forge run "$SESSION" --tool bindcraft2 --gpus 0 --timeout-seconds 60 --json -- taskset -c 0-7 python3 /inputs/bindcraft2/campaign-check.py /workspace/b44/bindcraft2 /workspace/b44/native-check.json
```

The last command checks the recorded B44 rejection case. It requires two screen
rejections, four rejected candidates, consistent native decisions/scores and
raw array mappings, and matching complex/monomer sequences and finite resolved
coordinates. Its audit preserves unavailable i_pDAE as null and reports the full
filter failures separately from the native confidence-first rejection list.
Different scientific outcomes need checks appropriate to their actual layout.


## Native completion fixtures

The small functional plan defines the remaining
examples and retained evidence. The helper fixtures below document earlier
coverage; they do not require replaying the historical capacity matrix. Preserve
each run's actual stage and filter result. The existing B09/B12 and B44 cases
above retain their own bounds.


[make_cases.py](examples/bindcraft2/make_cases.py) creates explicit native settings
under `/workspace/b44/fixtures` from the staged PD-L1 target. It requires a fresh
fixture directory. [complete.py](examples/bindcraft2/complete.py) provides separate
`campaign`, `stages`, `predictions`, `redesign`, `resume` and output-only `check`
operations. Stage both helpers as ready inputs beside `campaign.py` and `check.py`.
The stage diagnostic uses native 50/25/45/5/15 budgets for one explicitly named
model and audits the original gate at each stage. It explicitly calls later native
functions after a rejected gate and keeps diagnostic outputs outside the campaign.
It never promotes that rejected campaign or creates ranked output.

```sh
ariax forge run "$SESSION" --tool bindcraft2 --gpus 0 --timeout-seconds 120 --json -- taskset -c 0-7 python3 /inputs/bindcraft2/make_cases.py
# Watch that command before starting any dependent command.
ariax forge run "$SESSION" --tool bindcraft2 --gpus 0 --timeout-seconds 1800 --json -- taskset -c 0-7 python3 /inputs/bindcraft2/complete.py stages /workspace/b44/fixtures/diagnostic.json --output /workspace/b44/diagnostics/model_3_multimer_v3 --model model_3_multimer_v3
# Watch the native command, then inspect its original stage outcomes and full arrays.
ariax forge run "$SESSION" --tool bindcraft2 --gpus 0 --timeout-seconds 240 --json -- taskset -c 0-7 python3 /inputs/bindcraft2/complete.py check /workspace/b44/diagnostics/model_3_multimer_v3
```

The native design pool is `model_1_multimer_v3`, `model_2_multimer_v3`,
`model_3_multimer_v3`, `model_4_multimer_v3` and `model_5_multimer_v3`. The pTM
validation pool is `model_1_ptm` and `model_2_ptm`; an explicit multimer validation
route uses models held out from the chosen design set. ProteinMPNN uses checkpoint
`v_48_020` with native `negative` or `neutral` variants. The proposed catalog uses
these seven AF2 names and `proteinmpnn-negative` / `proteinmpnn-neutral`.

The helpers retain every native Protein field, prediction metric and array with
explicit chain, state, residue and atom mappings. Stage comparisons consume saved
actual inputs and compare all outputs with an unwrapped native call at exact zero
tolerance. Prediction diagnostics also retain complete complex and binder-monomer
arrays and fresh raw references for the five multimer and two pTM models. CIF
checks retain 0.00051 Å, rtol 0, with exact atom identities. On failure, the helper
writes unique `.cif.failure-0001.json` and `.failure-0001.arrays.npz` evidence with
first/max deltas, atom/residue identities, shapes/dtypes and full coordinate arrays.
Monomer failures report raw-member order and comparisons through the saved raw
prediction, reconstructed ensemble and binder alignment. New campaign/redesign
exports observe existing native calls and retain actual member/ensemble/aligned
writer snapshots without extra prediction or alignment. Strict CIF serialization
checks use the actual observed written pose, with exact raw/member/order,
input-state and ensemble lineage. Repeating alignment is audited separately;
full coordinate differences are retained, while unaligned pose differences and
all non-coordinate differences still fail. Full final-filter audits preserve score direction and
unavailable values separately from the original confidence-first candidate decisions.
Earlier capacity diagnostics retain their own failures and scope in the archived
qualification records. The current v1.0.4 contribution measures the small workload
specified below.

`resume` is specifically the matrix's two-attempt recovery case: first run
`campaign` on `recovery.json`, inspect its terminal outcome, then issue a separate
explicit `resume` command on that same settings path. It saves the complete first
phase, raises only the attempt cap to two with native resume enabled, and compares
all prior unique result bytes and the first trajectory row. Inspect the original
command ID after a lost acknowledgment; a new ID remains a new execution.

## Current v1.0.4 workload and resources

The current finite package checks use target A115 and binder B31. All five
multimer design models and all seven complex/binder validation models execute
with one recycle. Both ProteinMPNN variants have a two-proposal bound. The
saved settings can stop redesign after `enough_passing_sequences` successes;
that value is one in the short fixture. The output inspector verifies that
stopping decision against saved native settings and candidate outcomes.

The measured L40 host had 48 GiB VRAM, 28 CPUs and 58 GiB RAM. The new bounded
BindCraft runs reached 2,593 MiB sampled GPU memory and 3,871,727,616 bytes
sampled container memory, including the direct native CLI case. Allow one GPU
with 8 GiB VRAM, 16 GiB RAM, eight CPUs and 32 GiB disk for these small cases.
The shared AF2 asset contains sixteen files totaling 5,587,956,571 bytes,
including its license. These scheduling allowances apply to the stated inputs;
other constructs and larger binders require their own capacity assessment.

## Save, download and restore

After all run/check commands are terminal, create a completed checkpoint:

```sh
ariax forge sync "$SESSION" --wait --timeout 1800 --json
ariax forge files "$SESSION" --path /workspace/b09/bindcraft2 --checkpoint "$CHECKPOINT" --json
ariax forge download "$SESSION" '/workspace/b09/bindcraft2/3_Ranked/!_Ranked.csv' --checkpoint "$CHECKPOINT" --dest ./b09-bindcraft2-ranked.csv --json
ariax forge download "$SESSION" "/workspace/b09/bindcraft2/3_Ranked/$RANKED_DESIGN.cif" --checkpoint "$CHECKPOINT" --dest ./b09-bindcraft2-complex.cif --json
ariax forge close "$SESSION" --json
ariax forge status "$SESSION" --json
```

Set `CHECKPOINT` to the returned completed checkpoint UUID and require
`synced`. Set `RANKED_DESIGN` to `design` from the checker JSON and confirm
its file in the checkpoint listing. Listing/download reads completed bytes,
including after close. Public `closed` confirms allocation release; inspect
persistence errors separately and preserve the last completed checkpoint.

Set `PROJECT` from the session and `REVISION` from its current `control.revision`.
If held, stop and wait for authenticated web approval and user direction, then
read the new revision. Approval itself leaves compute unallocated. Continue
that same project:

```sh
ariax forge project "$PROJECT" --json
ariax forge resume "$PROJECT" --gpu L40 --tools bindcraft2 --restore-session "$SESSION" --checkpoint "$CHECKPOINT" --control-revision "$REVISION" --max-gpu-hours 1 --json
ariax forge status "$RESTORED_SESSION" --json
ariax forge tools wait "$RESTORED_SESSION" bindcraft2 --timeout 1800 --json
ariax forge run "$RESTORED_SESSION" --tool bindcraft2 --timeout-seconds 60 --json -- python3 /inputs/bindcraft2/check.py /workspace/b09/bindcraft2
ariax forge watch "$RESTORED_SESSION" "$RESTORED_CHECK_COMMAND_ID" --timeout 120 --json
ariax forge close "$RESTORED_SESSION" --json
ariax forge status "$RESTORED_SESSION" --json
```

Restore from a terminal source, use the new session ID, and require host/tool
readiness. Record and watch its explicit checker command before closure.
Restore recovers workspace and ready staged inputs without replaying design.
Each new session uses normal allocation and billing. Read the
[outputs reference](../outputs.md) for checkpoint and recovery semantics.

The complete output checker also compares originally fixed sequences against native input preparation, maps FASTA crop/flank residues to the source record, and checks equivalent PDB/mmCIF atom identities and coordinates. These checks consume saved arrays and do not rerun design or prediction.

The retained fixture generator uses two-value FASTA crop ranges, such as
`crop_fasta_sequence: [60, 60]`. Saved-output checks audit crop/flank residue
mapping against the original FASTA and retain final-filter metrics alongside
the original trajectory-stage decision.

When a native campaign reaches redesign, the output checker joins its recorded MPNN candidates to the actual held-out model arrays and audits confidence-first stopping, full filter metrics, decoded sequence properties, interface residue identities and complex/binder CIF geometry. Native campaign outcomes retain their own identity alongside explicit diagnostics.


Fixed VHH with exact edit ranges A27-33,A52-57,A100-114 failed native preflight:
the enabled binder_intra_coldspot loss requires editable framework regions.
Both multistate commands failed while recording JAX-valued prediction metadata;
their partial native arrays and original errors remain retained. No failed
campaign was replayed, and no agreed masks, losses, filters or iterations changed.
