# Forge FreeBindCraft binder design

FreeBindCraft designs protein binders with AlphaFold2-guided optimization,
ProteinMPNN sequence redesign, held-out refolding and structural relaxation.
Use the miniprotein or linear-peptide profile for the intended binder format.
The [managed BindCraft protocol](../../ariax-bindcraft/SKILL.md) has a separate
project lifecycle, schema and results. Inspect the exact live FreeBindCraft mode
before choosing settings.

For real inputs and result review, read
[target preparation and budgets](../references/freebindcraft-inputs.md)
(`freebindcraft-inputs`) and [filters, placeholders and ranking](../references/freebindcraft-results.md)
(`freebindcraft-results`). Read references with
`ariax skills forge --reference ID --read --json`. The
[shared interpretation guide](../../../core/interpretation.md) covers structure
stages and fair comparisons.

Read this guide with `ariax skills forge --reference freebindcraft --read --json`
(alias `ariax-forge`). Set `EXAMPLES` to `data.examples.freebindcraft` from
`ariax skills forge --tool freebindcraft --json`, and `SESSION` to an authorized
session's UUID. Forge passes native argv unchanged; include an explicit shell
when needed. Run scientific commands on the remote GPU host.

## Readiness, assets and relaxation route

For a session with FreeBindCraft in its deployed catalog:

```sh
ariax forge tools add "$SESSION" --tools freebindcraft --priority freebindcraft --json
ariax forge tools wait "$SESSION" freebindcraft --timeout 1800 --json
ariax forge status "$SESSION" --json
```

Require host `available` and `freebindcraft` ready. The shared `alphafold2`
asset mounts read-only at `/models/alphafold2`, with its LICENSE and native
ordinary, pTM and multimer_v3 NPZ files. Set `af_params_dir` to this mount.
Soluble MPNN weights are image package resources. JAX requires CUDA; the image
sets `OPENMM_PLATFORM_ORDER=CUDA`. Cache writes use scratch, and credentials
stay outside workloads.

| Route | Native command selection | Requirements and interpretation |
| --- | --- | --- |
| OpenMM | Include `--no-pyrosetta` | Performs CUDA relaxation and alternative scoring, despite upstream help suggesting relaxation is skipped. Several Rosetta-specific metrics are placeholders; review the results reference before using filters. |
| PyRosetta | Omit `--no-pyrosetta` | Requires the separately authorized complete `pyrosetta` asset at `/models/pyrosetta/python/pyrosetta`. Absence or initialization failure stops the command. Use this route for native FastRelax and interface scoring. |

Require the deployed catalog to supply the selected route and its assets.
PyRosetta requires separate native-use authorization, which does not grant
distribution rights. Retain the FreeBindCraft source LICENSE, ColabDesign
Beer-ware notice and installed dependency notices.

The catalog requires 8 CPUs and 250 GiB disk, with no fixed RAM floor. The
finite examples use 8 CPUs/32 GiB; held-out diagnostics use 24 CPUs/50 GiB,
with swap disabled. The GPU-memory minimum is unknown. These allocations do
not establish support for arbitrary protein lengths or unrun upstream modes.

## Prepare a finite design

Establish the user's target construct, chains, hotspots, binder format and
evaluation criteria before editing settings. Preserve complete effective
target, advanced and filter JSON files. Use the preflight workflow in the
[inputs reference](../references/freebindcraft-inputs.md) for a new target.

The bundled [PD-L1 structure](examples/freebindcraft/PDL1.pdb) has target
chain A with 115 residues numbered 18–132 and hotspot A56. The
[complete examples](examples/freebindcraft/complete/README.md) retain native
filters and save FASTA, structures and native arrays:

| Profile | Settings under `complete/` | Advanced / filters under `complete/` | Binder |
| --- | --- | --- | --- |
| Miniprotein | `settings-miniprotein-openmm.json` or `settings-miniprotein-pyrosetta.json` | `advanced-miniprotein.json` / `filters-miniprotein.json` | B80 |
| Linear peptide | `settings-peptide-openmm.json` or `settings-peptide-pyrosetta.json` | `advanced-peptide.json` / `filters-peptide.json` | B20 |

Miniprotein settings use the four-stage optimizer (75/45/5/15 iterations),
sampled multimer-v3 models 1–5, design recycle 1, held-out pTM models 1–2 with
validation recycle 3, and soluble MPNN v_48_020 batch 20/cap 2. The peptide
profile uses three stages (75/45/5), MPNN batch 10/cap 2, initial guess and
native peptide losses/filters. Each example bounds search to two trajectories
and an accepted goal of one. An accepted goal does not bound attempts: retain
an explicit attempt cap and session duration. Rejection and timeout are usable
saved outcomes. These examples are not a scientific search recommendation.

For the miniprotein OpenMM example:

```sh
ariax forge inputs add "$SESSION" --file "$EXAMPLES/PDL1.pdb" --path freebindcraft/PDL1.pdb --json
for FILE in settings-miniprotein-openmm.json advanced-miniprotein.json filters-miniprotein.json; do
  ariax forge inputs add "$SESSION" --file "$EXAMPLES/complete/$FILE" --path "freebindcraft/complete/$FILE" --json
done
ariax forge inputs list "$SESSION" --json
```

Record each input ID and require every path ready; observe an import with
`ariax forge inputs status "$SESSION" "$INPUT_ID" --json`. Inputs are
read-only. Settings contain absolute paths and write distinct directories
under `/workspace/complete/` for each profile and route. A changed run needs
a fresh `design_path`, new staged settings path and explicit new command,
preserving the previous run and its IDs.

## Run and inspect status

`freebindcraft` is a PATH shim that execs native `bindcraft.py`. Native
arguments follow the CLI's `--` separator:

```sh
ariax forge run "$SESSION" --tool freebindcraft --gpus 0 --timeout-seconds 3600 --json -- freebindcraft --settings /inputs/freebindcraft/complete/settings-miniprotein-openmm.json --advanced /inputs/freebindcraft/complete/advanced-miniprotein.json --filters /inputs/freebindcraft/complete/filters-miniprotein.json --no-pyrosetta --no-plots --no-animations --verbose
ariax forge watch "$SESSION" "$DESIGN_COMMAND_ID" --timeout 3600 --json
ariax forge logs "$SESSION" "$DESIGN_COMMAND_ID" --tail 1000 --json
```

Set `DESIGN_COMMAND_ID` to the returned ID. For peptide design, stage and use
the peptide settings, advanced and filter files. For PyRosetta, stage and use
the matching `settings-*-pyrosetta.json` and omit `--no-pyrosetta`.

The native CLI draws trajectory seeds internally; it has no seed selector.
Rejected trajectories count against the attempt budget. Relaxation/repacking
failures stop the command rather than presenting an unrelaxed copy as success.
Inspect logs for completed relaxation of the structures actually produced.
Early rejection can prevent later complex models, complex relaxation,
binder-alone refolds and Accepted/Ranked results.

Require `succeeded` before dependent checks. A `watch` timeout ends local
polling while remote work continues. Inspect the same ID and logs after a
lost acknowledgment. Recover the original saved request with `--command-id`
and identical fields when appropriate. A new ID is a new execution. A
correction needs an explicit new command and fresh output directory; do not
automatically replay design or substitute CPU execution after a GPU failure.

## Check native outputs

Set `RUN_DIR` to the settings' `design_path`, for example
`/workspace/complete/miniprotein-openmm`. Read trajectory and design identities
from the CSVs rather than guessing random-seed filenames. Depending on which
stages finish, outputs include:

```text
trajectory_stats.csv
mpnn_design_stats.csv
final_design_stats.csv
failure_csv.csv
rejected_mpnn_full_stats.csv
Trajectory/<trajectory>.pdb
Trajectory/Relaxed/<trajectory>.pdb
MPNN/<design>_modelN.pdb
MPNN/Relaxed/<design>_modelN.pdb
MPNN/Binder/<design>_modelN.pdb
MPNN/Sequences/<design>.fasta
Accepted/<design>_modelN.pdb
Accepted/Ranked/<native ranked name>.pdb
.../NativeArrays/*.native.npz
.../NativeMPNN/*.mpnn.npz
```

```sh
ariax forge run "$SESSION" --tool freebindcraft --gpus 0 --timeout-seconds 120 --json -- freebindcraft-check "$RUN_DIR"
ariax forge watch "$SESSION" "$CHECK_COMMAND_ID" --timeout 180 --json
ariax forge logs "$SESSION" "$CHECK_COMMAND_ID" --tail 1000 --json
```

Record the checker ID and require it to pass. Inspect command logs for completed
relaxation. The optional [packaged fixture checker](examples/freebindcraft/complete/check.py)
expects PD-L1 at `/inputs/freebindcraft/PDL1.pdb`; use target-specific checks for
your own construct.

An exit-zero design can leave incomplete or header-only output, and an attempt
limit can leave no accepted design. Reconcile CSV identities and sequences,
FASTA, target register and accepted structures. Review native rejection reasons
and enabled filters; file existence and computational acceptance do not prove
binding. Do not clear filters merely to obtain an accepted candidate.

Raw AF2 pLDDT uses 0–1 and raw PAE uses Å; CSV pAE/i_pAE are normalized native
summaries. Raw MPNN score is negative log likelihood over unfixed masked
residues, so lower is better. The supplemental rejected-full table contains
zero score/recovery placeholders; use raw NativeMPNN values for those fields.
Rejected-table failure indicators are not confidence scores.
PyRosetta `Binder_Energy_Score` is TotalEnergyMetric over chain B, and `dG` is
InterfaceAnalyzer's separated-interface score in Rosetta energy units, not
experimental binding free energy. `dSASA` is buried area in Å² and `dG/dSASA`
is the native ratio multiplied by 100. PackStat, ShapeComplementarity and
interface H-bond fields retain native definitions; unseeded PyRosetta PackStat
can vary on rescoring. OpenMM placeholders and missing-metric filter gaps
remain as documented in the [results reference](../references/freebindcraft-results.md).

## Inspect a retained rejection

`freebindcraft-refold` examines one saved rejected candidate and its matching
trajectory in a new output directory. Use the original target and complete
effective settings, advanced and filter JSON. `CAMPAIGN_DIR`, `SETTINGS_PATH`,
`ADVANCED_PATH` and `FILTERS_PATH` are their remote paths; `DIAGNOSTIC_DIR` must
be a fresh output path.

```sh
ariax forge run "$SESSION" --tool freebindcraft --gpus 0 --timeout-seconds 900 --json -- freebindcraft-refold --campaign "$CAMPAIGN_DIR" --settings "$SETTINGS_PATH" --advanced "$ADVANCED_PATH" --filters "$FILTERS_PATH" --output "$DIAGNOSTIC_DIR" --recycles 3 --no-pyrosetta
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 900 --json
ariax forge run "$SESSION" --tool freebindcraft --gpus 0 --timeout-seconds 120 --json -- freebindcraft-check "$DIAGNOSTIC_DIR" --diagnostic
```

This selects OpenMM and held-out models 1 and 2 with three recycles. For
PyRosetta, use its authorized settings and route consistently. Observe each
command's terminal status. The original seeds are not reconstructed when the
native run did not record them. Refolding and relaxation after rejection do
not change the original filter decision or turn the candidate into an accepted
design. Share rejected results when Accepted/Ranked files are absent.

## Save, download and restore results

After run/check commands are terminal, flush the changed files:

Set `PROJECT` to the session's returned `project_id`.

```sh
ariax forge sync "$SESSION" --wait --timeout 1800 --json
ariax forge files "$PROJECT" --path "$RUN_DIR" --json
ariax forge files "$PROJECT" --path "$RUN_DIR/Accepted" --json
ariax forge link "$PROJECT" "$RUN_DIR/final_design_stats.csv" --json
ariax forge link "$PROJECT" "$RUN_DIR/Accepted/$ACCEPTED_FILE" --json
ariax forge close "$SESSION" --json
ariax forge status "$SESSION" --json
```

Require the flush state `saved`.
Set `ACCEPTED_FILE` from the completed listing and match it to the checked
result. If none were accepted, link the available rejection tables instead.
To download a checked result, set `RESULT_DEST` to an authorized destination
and read the current project files:

```sh
ariax forge download "$PROJECT" "$RUN_DIR/final_design_stats.csv" --dest "$RESULT_DEST/freebindcraft-final.csv" --json
ariax forge download "$PROJECT" "$RUN_DIR/Accepted/$ACCEPTED_FILE" --dest "$RESULT_DEST/freebindcraft-complex.pdb" --json
```

Keep inputs, effective settings, logs, failure tables, NativeArrays,
NativeMPNN and original decisions in Files. Saved project files remain
available after close. Public `closed` confirms allocation release; inspect
synchronization errors separately.

Set `PROJECT` from the session. If the user clears a human hold with
**Resume workspace**, inspect the project and set `RESTORED_SESSION` to its
`active_session_id`; continue there without starting another session or
automatically replaying science. **Allow agent to resume later** leaves compute
stopped; await the user's direction. For a new CLI resume, confirm no session
is active, no hold blocks it and cleanup has completed. Set `REVISION` from the
current `control.revision` and explicitly resume within the authorized budget.
Recover an uncertain earlier request using its original ID, fields and revision:

```sh
ariax forge project "$PROJECT" --json
ariax forge resume "$PROJECT" --gpu L40 --tools freebindcraft --control-revision "$REVISION" --max-gpu-hours 1 --json
```

For the CLI path, set `RESTORED_SESSION` from the response. After either path,
inspect the session and existing commands before running a new authorized check:

```sh
ariax forge status "$RESTORED_SESSION" --json
ariax forge tools wait "$RESTORED_SESSION" freebindcraft --timeout 1800 --json
ariax forge run "$RESTORED_SESSION" --tool freebindcraft --gpus 0 --timeout-seconds 120 --json -- freebindcraft-check "$RUN_DIR"
ariax forge watch "$RESTORED_SESSION" "$RESTORED_CHECK_COMMAND_ID" --timeout 180 --json
ariax forge close "$RESTORED_SESSION" --json
ariax forge status "$RESTORED_SESSION" --json
```

Require host/tool readiness and watch the explicit checker command before
closure. Use the checker appropriate to the saved layout. Restoration recovers workspace and
ready staged inputs without replaying design. Each new session uses normal
allocation and billing. Read the [outputs reference](../outputs.md) for
project-file and recovery semantics.
