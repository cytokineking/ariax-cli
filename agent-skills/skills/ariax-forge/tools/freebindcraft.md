# Forge FreeBindCraft binder design

For real inputs and result review, read
[target preparation and budgets](../references/freebindcraft-inputs.md) (`freebindcraft-inputs`) and [filters, placeholders and ranking](../references/freebindcraft-results.md) (`freebindcraft-results`).
Use those IDs with
`ariax skills forge --reference ID --read --json`. The [shared interpretation
guide](../../../core/interpretation.md) covers structure stages and fair comparisons.

FreeBindCraft is a GPU tool for designing candidate protein binders. B09 uses
the retained [native source](https://github.com/cytokineking/FreeBindCraft/tree/d12747dbc907435622559b81891ad73e0a45c2e4)
with ColabDesign 1.1.3, JAX 0.6.0 and OpenMM 8.3.1 plus its CUDA plugin.
The private image and this bounded native fixture passed on an L40 builder
and through the installed Forge CLI on Hyperstack.
Availability depends on the deployed catalog and tool readiness. A completed
command and consistent files establish execution, without establishing
binding, specificity, expression or experimental affinity.

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

```sh
ariax forge create --name FreeBindCraft-restored --gpu L40 --tools freebindcraft --restore-session "$SESSION" --checkpoint "$CHECKPOINT" --max-hours 1 --json
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
