---
name: ariax-forge
description: Create and operate Ariax Forge compute sessions, discover tools, run native commands, sync files, and finish or close work through the Ariax CLI.
---

# Ariax Forge

Use Forge for native scientific tools (prediction, inverse folding, scoring/QC,
search, antibody/all-atom design) and custom multi-stage workflows. Compare
with managed protocols in [engine choice](../../core/engine-choice.md); settings
differ even for shared engine names. Keep one scientific campaign in one Forge
project — use `--gpu-count N` and `--gpus` in one session rather than spawning
separate projects, and reuse or `resume` the same project after closure.

## 1. Discover tools & read a guide in one call (no auth needed)

```sh
ariax discover --query "<goal>" --execution forge --json
ariax forge catalog --task binder-design --json          # compact summary by default (--all for experimental/legacy)
ariax forge catalog --tool TOOL --with-guide --json      # full tool record + bundled guide in 1 call
ariax pricing --json
```

Use `--model MODEL` / `--mode MODE` with `--tool TOOL` to inspect exact resource
floors and supported modes (or `--guide-only` for only the lean guide + references).
Browse methods in the [tool index](tools/capabilities/matrix.md) or
[capability discovery](tools/capabilities.md).

## 2. Create a session & wait for tools

Creating or resuming a session starts paid compute; preparation and idle time
consume `--max-gpu-hours` (omitting it leaves the session open-ended). Always
include a core GPU (`H100`, `A100_80GB`, `L40S`, or `RTX6000PRO`) in
`--allowed-gpus` (or `--gpu` if `--allowed-gpus` is omitted). `base` is always
included; omit it from `--tools`.

```sh
ariax forge create --name "My workspace" --gpu L40S --allowed-gpus L40S,H100 --gpu-count 1 --tools boltz2,interface-scores --priority boltz2 --max-gpu-hours 4 --wait --json
ariax forge tools wait SESSION boltz2 --wait-timeout 1800 --json
```

Use `--min-ram-gib`, `--min-cpu-count`, and `--min-disk-gib` for hardware
minima. `--wait` on `create`, `resume`, and `close` polls until the session
reaches its target state (bound with `--wait-timeout`). Session `available`
means `base` accepts commands; each scientific tool reports `queued`,
`installing`, `ready`, or `failed` independently. Add more tools later with
`ariax forge tools add SESSION --tools TOOL`.

## 3. Stage inputs & run native commands

```sh
ariax forge inputs add SESSION --file ./target.yaml --path targets/target.yaml --wait-ready --json   # waits for base; mounts at /inputs/...
ariax forge inputs status SESSION INPUT_ID --json                                       # wait for state=ready
ariax forge run SESSION --tool boltz2 --gpus 0 --wait-ready --input-ids INPUT_ID --wait --wait-timeout 1800 --json -- boltz predict /inputs/targets/target.yaml --out_dir /scratch/run1
ariax forge logs SESSION COMMAND_ID --tail 1000 --no-json
ariax forge command SESSION COMMAND_ID --json
```

- Put the native executable and arguments after `--`; `--cwd` defaults to `/workspace` and must stay under it.
- Resumed Forge projects retain prior `/inputs` remotely (inspect with `ariax forge files PROJECT --path /inputs`); `/inputs` paths are immutable, so upload updated scripts/files under a new `--path` (e.g. `v2/script.py`).
- Multi-GPU sessions require explicit `--gpus 0` / `--gpus 1,0` for GPU tools (CPU tools omit `--gpus`). Overlapping GPU reservations return `gpu_busy`; use distinct output directories for concurrent commands.
- `--wait` returns `exit_code` and a bounded `output_tail` (configure with `--tail N`, default 80 lines / 4 KiB). Remote command failures exit with distinct exit code **`11`** (with `exit_code` and `output_tail` in `error.details`), separate from server errors (`10`). Exit `0` does not verify scientific validity — always inspect native outputs and files.
- Use `--retained` with `commands`, `command`, `logs`, or `inputs list/status` after session closure. `ariax forge list`, `project`, `activity`, `commands`, and `command` return lean summary payloads by default (add `--details` for full metadata).

## 4. Scratch → Curate → Pack → Finish

A completed command does **not** close the session. Keep `/workspace` clean so
synchronization stays fast and stays under project quotas:

1. **Scratch:** Write raw/bulk outputs (trajectories, ensembles, thousands of
   PDB/CIF/NPZ files) to `/scratch/<run>/` (fast local NVMe, never auto-synced).
2. **Curate:** Copy compact summaries (CSV/JSON) and top-N preview structures
   (uncompressed `.pdb`/`.cif` ≤10 MB) into `/workspace/results/`.
3. **Pack:** Archive bulk outputs from `/scratch` (or `/workspace`) into a
   verified, auto-sharded (≤10 GiB parts) archive + manifest under
   `/workspace/archives/` with `ariax forge pack`:
4. **Finish:** Drain, flush, and release the GPU cleanly with `ariax forge finish --wait`.

```sh
ariax forge pack SESSION --src /scratch/run1 --dest /workspace/archives/run1.tar.zst --wait --json
ariax forge files PROJECT --path /workspace --json
ariax forge finish SESSION --wait --json      # drains commands + flushes + releases GPU
ariax forge summary PROJECT --json            # standardized workspace, session & caveat handoff
ariax storage suggest PROJECT --json          # inspect large/high-file-count dirs for cleanup
```

- `forge status`, `forge sync`, `forge finish`, and `forge close` emit
  structured stderr hygiene notices when workspace telemetry flags high file
  counts, pending sync volume, low disk space, symlinks, large files, or unsaved
  `/scratch` data. In `forge summary`, `workspace.hygiene_warnings` reflects
  live daemon telemetry on active sessions while `cleanup_suggestions` reflects
  saved-storage catalog rules from `ariax storage suggest`.
- `ariax forge close SESSION [--wait]` is for emergency/immediate teardown (75s
  sync ceiling) and refuses by default when >100 files or >500 MiB remain
  unsynced (pass `--force` only when intentionally discarding unsaved files).
- Use `ariax forge cancel SESSION COMMAND_ID [--wait]` to cancel one command, `ariax forge limit SESSION --gpu-hours H` to edit a session cap, `ariax forge resume PROJECT --gpu GPU --wait` to reopen saved files (`--hydrate PATH` selects a subset; `--manifest FILE` stages multi-file input batches), and `ariax storage` / `ariax delete PROJECT --yes` to audit or clean up storage.

**Deep references:** [outputs & file ops](outputs.md) · [storage & deletion](../../core/storage.md) · [recovery, holds & deletions](references/recovery.md) · [campaign recipes](references/campaign-recipes.md) · [custom code](references/custom-code.md) · [Adaptyv ordering](references/adaptyv-ordering.md)
