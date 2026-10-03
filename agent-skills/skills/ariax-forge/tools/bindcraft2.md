# Forge BindCraft2 binder design

BindCraft2 is a GPU tool for designing candidate protein binders. B09 uses
native package 1.0.1 from the reviewed [PacesaLab source](https://github.com/PacesaLab/BindCraft2/tree/e6d30f6ea2e5bbc2f62ae7fa722f183da6c6c29f).
The recipe and bundled case await native image and live qualification.
Availability depends on the deployed catalog and tool readiness. A completed
command and consistent files establish execution, without establishing
binding, specificity, expression or experimental affinity.

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
1_Trajectories/<trajectory>/trajectory.cif
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
the image's Gemmi package, requires one completed row per stage and a passed
native refold. It checks candidate/ranked identifiers and binder sequences,
then parses the trajectory, refolded and ranked CIFs. Each must have target
chain A matching the staged PD-L1 sequence, binder B31 and finite coordinates.
Refolded pLDDT/pTM/i_pTM must be finite on 0–1. Candidate `_candidate1` and
ranked `_seq0` are distinct native identifiers. No binder monomer prediction
is requested by the cleared optional filters.

An exit-zero command can still produce incomplete or header-only output.
The checker must pass. A completed gradient trajectory is separate from an
accepted redesigned candidate; reaching the attempt limit can leave no
accepted design. Review attempts, native rejection reasons and ranking
records separately. Computational acceptance under these reduced filters
does not imply biological binding success.

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

```sh
ariax forge create --name BindCraft2-restored --gpu L40 --tools bindcraft2 --restore-session "$SESSION" --checkpoint "$CHECKPOINT" --max-hours 1 --json
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
