# Forge BindCraft2 binder design

Use BindCraft2 in Forge for native binder design with explicit target, scaffold,
optimization and filtering settings. The [managed BindCraft2 protocol](../../ariax-bindcraft2/SKILL.md)
has its own schema and project lifecycle; its job JSON is not a native settings
file. Inspect the live tool with `ariax skills forge --tool bindcraft2 --json`.
This guide describes the v1.0.4 workflow.

For target preparation, modalities, model selection and metric units, read
[native scientific configuration and interpretation](../references/bindcraft2-science.md)
with `ariax skills forge --reference bindcraft2-science --read --json`.
The [shared interpretation guide](../../../core/interpretation.md) covers
structure stages and fair comparisons.

Read this guide with `ariax skills forge --reference bindcraft2 --read --json`
(alias `ariax-forge`). Set `EXAMPLES` to the absolute `data.examples.bindcraft2`
path from the live tool response and `SESSION` to an authorized session UUID.
Forge passes native argv after `--` unchanged; use an explicit shell when needed.

## Readiness and models

For a session with BindCraft2 in its catalog:

```sh
ariax forge tools add "$SESSION" --tools bindcraft2 --priority bindcraft2 --json
ariax forge tools wait "$SESSION" bindcraft2 --timeout 1800 --json
ariax forge status "$SESSION" --json
```

Require host `available` and `bindcraft2` ready. The shared named `alphafold2`
asset mounts read-only at `/models/alphafold2`; it contains LICENSE and fifteen
ordinary, pTM and multimer_v3 NPZ files, totaling about 5.6 GB. The image sets
`BINDCRAFT_AF2_PARAMS` to this mount and supplies ProteinMPNN weights separately.
Reuse the prepared asset. JAX requires CUDA; compilation and cache writes use
scratch. Host credentials remain outside workloads. Preserve model/scaffold
license and attribution notices when exporting or redistributing assets.

The native design pool is `model_1_multimer_v3` through `model_5_multimer_v3`.
The pTM validation pool is `model_1_ptm` and `model_2_ptm`; explicit multimer
validation uses models held out from the chosen design set. ProteinMPNN uses
checkpoint `v_48_020` with native `negative` or `neutral` variants. Record the
actual design/validation models, recycles and effective settings with results.

## Inputs and settings

For a real campaign, establish the target construct, chain/residue mapping,
hotspots, binder scope, accepted-design goal, attempt limit and evaluation
criteria. Native settings accept structure or FASTA targets and custom scaffolds;
follow the [scientific configuration reference](../references/bindcraft2-science.md)
for selectors, sequence crops/flanks, fixed positions and modality-specific
constraints. Use staged absolute `/inputs` paths. Relative target/scaffold paths
resolve from the settings file's directory.

Fixed-framework VHH edits must be compatible with the selected losses. A
CDR-only mask such as `A27-33,A52-57,A100-114` fails native preflight when
`binder_intra_coldspot` remains enabled because that loss requires editable
framework positions. Choose a compatible mask/objective explicitly; the science
reference explains the loss override for intentionally fixed frameworks.
Multistate completion remains unconfirmed after prediction-metadata failures;
partial arrays do not establish a completed multistate result. Native preset
availability alone does not establish successful execution for every modality.

The bundled [settings](examples/bindcraft2/settings.json) use the
[PD-L1 example structure](examples/bindcraft2/PDL1.pdb): chain A, 115 residues
numbered 18–132, hotspot 56, and a 31-residue chain B binder. They request one
trajectory, one MPNN sequence, seed 7, one design model and one held-out
validation model, with one recycle each. Screen/refine/anneal/harden budgets
are 5/5/1/1 with no mutation stage. Autotuning, desperation, resume, extra
workers and next-length compilation are disabled; the attention backend is XLA.
Optional final filters are cleared and stage confidence thresholds are zero.
These short settings illustrate execution and are not a scientific search
recommendation. The structure is example input, not a user result or a supplied
generated binder.

```sh
ariax forge inputs add "$SESSION" --file "$EXAMPLES/PDL1.pdb" --path bindcraft2/PDL1.pdb --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/settings.json" --path bindcraft2/settings.json --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/check.py" --path bindcraft2/check.py --json
ariax forge inputs list "$SESSION" --json
```

Record each input ID and require all paths ready. Observe imports with
`ariax forge inputs status "$SESSION" "$INPUT_ID" --json`. Inputs are read-only.
The bundled settings write to `/workspace/b09/bindcraft2`; set `OUTPUT` to
that path for the commands below. For your own run, stage your target/settings,
choose a fresh `project_folder` under `/workspace` and set `OUTPUT` accordingly.
Update input paths when staging elsewhere. With `resume: false`, an existing
nonempty campaign directory is refused.

The alternative [campaign settings](examples/bindcraft2/campaign-settings.json)
restore native confidence and final filters. They cap attempts at two
trajectories and MPNN proposals at two per trajectory, use stage budgets
10/10/3/1 and the negative ProteinMPNN variant, and retain the same target,
binder length and one-recycle/model limits. Neither an attempt cap nor an
accepted-design goal guarantees a passing candidate. Stage this file instead
of the short settings, or use a new input path such as
`bindcraft2/campaign-settings.json` and pass that path to `bindcraft design`.
Set `OUTPUT` from its `project_folder`, using a fresh directory. Do not loosen
filters to turn a rejected outcome into acceptance.

## Run and recover commands

`bindcraft` is on PATH. Run the staged settings through the ready GPU tool:

```sh
ariax forge run "$SESSION" --tool bindcraft2 --timeout-seconds 3600 --json -- bindcraft design /inputs/bindcraft2/settings.json
ariax forge watch "$SESSION" "$DESIGN_COMMAND_ID" --timeout 3600 --json
ariax forge logs "$SESSION" "$DESIGN_COMMAND_ID" --tail 1000 --json
```

Set `DESIGN_COMMAND_ID` to the returned ID and wait for a terminal state before
dependent inspection. A `watch` timeout ends local polling and leaves remote
work running. Inspect the same command ID and logs after a lost acknowledgment.
Recover the original saved request with `--command-id` and identical fields
when appropriate; a new ID is a new execution. A correction uses an explicit
new command and fresh output directory. Do not automatically replay design or
substitute CPU execution after a GPU failure.

Native campaign continuation and Forge session restoration are separate actions.
Inspect the original command and native state before explicitly enabling native
resume for the same scientific intent. Do not delete claimed-attempt state or
accepted structures to force a restart. Session restoration recovers saved files
without replaying scientific commands.

## Inspect the actual results

Read command logs, resolved settings, stage tables and saved structures together.
Native output paths under `OUTPUT` include:

```text
campaign_metadata.json
1_Trajectories/!_Trajectories.csv
1_Trajectories/<trajectory>/<trajectory>_trajectory.cif
2_Refolded/!_Refolded.csv
2_Refolded/Complexes/<trajectory>_candidate<n>.cif
3_Ranked/!_Ranked.csv
3_Ranked/<trajectory>_seq<n>.cif
summary.csv
```

Use a CSV parser and discover names from the actual rows. `design` identifies
files; `_candidate<n>` indexes MPNN draws and `_seq<n>` identifies retained
sequences. Check the user's requested target sequence, binder chains/lengths,
fixed scaffold residues and crop/flank mappings against saved structures and
sequences. Coordinates must be finite and chain/residue roles must match the
reported candidate. Inspect confidence values with their documented units,
and identify whether coordinates are trajectory, complex refold, binder-only
prediction or relaxed output.

Report attempted, completed and accepted counts separately. A blank trajectory
`terminated` means gradient optimization completed; later `outcome` and
`failed_filters` describe candidate evaluation. Screen/refine/anneal/harden/
mutate/final gates can stop a trajectory before redesign. An attempt limit can
leave zero accepted designs, missing later-stage files or header-only tables,
even when the command exits zero. Preserve original rejections and unavailable
metrics. A separate diagnostic evaluation of a rejected pose does not promote
it into a ranked campaign result.

For the unchanged one-trajectory PD-L1 example only, the bundled
[checker](examples/bindcraft2/check.py) inspects its saved outputs:

```sh
ariax forge run "$SESSION" --tool bindcraft2 --timeout-seconds 60 --json -- python3 /inputs/bindcraft2/check.py "$OUTPUT"
ariax forge watch "$SESSION" "$CHECK_COMMAND_ID" --timeout 120 --json
ariax forge logs "$SESSION" "$CHECK_COMMAND_ID" --tail 1000 --json
```

Set `CHECK_COMMAND_ID` to the new ID. This checker requires one completed row
per stage, a passed native refold, consistent candidate/ranked identifiers and
binder sequences, target chain A matching the staged PD-L1 sequence, binder
B31, finite CIF coordinates, and finite refolded pLDDT/i_pTM on 0–1. It is not
a general checker for different targets, lengths, counts or rejected outcomes;
use checks appropriate to the user's actual settings and output layout. No
binder monomer prediction is requested by the short example's cleared optional
filters. Computational acceptance does not establish biological binding,
specificity, expression or affinity.

## Resources

Allow one GPU with 8 GiB VRAM, 16 GiB RAM, eight CPUs and 32 GiB disk for the
small A115/B31 examples with one recycle. These allowances are specific to
those inputs; larger constructs, binders, model ensembles and other modalities
need their own capacity assessment. Bound both native attempts and session
duration, including compilation and validation time.

## Save, inspect and restore

After all writers are terminal, flush the changed files:

Set `PROJECT` to the session's returned `project_id`.

```sh
ariax forge sync "$SESSION" --wait --timeout 1800 --json
ariax forge files "$PROJECT" --path "$OUTPUT" --json
ariax forge files "$PROJECT" --path "$OUTPUT/3_Ranked" --json
ariax forge link "$PROJECT" "$OUTPUT/3_Ranked/!_Ranked.csv" --json
ariax forge link "$PROJECT" "$OUTPUT/3_Ranked/$RANKED_DESIGN.cif" --json
ariax forge close "$SESSION" --json
ariax forge status "$SESSION" --json
```

Require the flush state `saved`. Set `RANKED_DESIGN` from the actual ranked
table (or the example checker JSON) and confirm its file in the project listing
before linking. If no ranked design exists, link the stage/rejection tables and
available structures instead. Saved project files remain available after close; use the [outputs reference](../outputs.md)
for downloads and storage limits. Keep bulk scientific outputs on remote
storage under the applicable workstation policy. Public `closed` confirms
allocation release; inspect synchronization errors separately.

Set `PROJECT` from the session and `REVISION` from its current `control.revision`.
If held, wait for authenticated web approval and user direction, then read the
new revision. Approval itself leaves compute unallocated. Continue that project.
The saved-output checker below applies to the unchanged PD-L1 example; replace
it with an appropriate check for other results:

```sh
ariax forge project "$PROJECT" --json
ariax forge resume "$PROJECT" --gpu L40 --tools bindcraft2 --control-revision "$REVISION" --max-gpu-hours 1 --json
ariax forge status "$RESTORED_SESSION" --json
ariax forge tools wait "$RESTORED_SESSION" bindcraft2 --timeout 1800 --json
ariax forge run "$RESTORED_SESSION" --tool bindcraft2 --timeout-seconds 60 --json -- python3 /inputs/bindcraft2/check.py "$OUTPUT"
ariax forge watch "$RESTORED_SESSION" "$RESTORED_CHECK_COMMAND_ID" --timeout 120 --json
ariax forge close "$RESTORED_SESSION" --json
ariax forge status "$RESTORED_SESSION" --json
```

Restore from a closed or failed source and use the returned new session ID.
Require host/tool readiness, then inspect the saved results and run an
appropriate saved-output check before closure; record and watch that explicit
command. Restore recovers workspace and ready staged inputs without replaying
design. Each new session uses normal allocation and billing.
