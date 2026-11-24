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
floors and qualification rows. Browse methods in the
[tool index](tools/capabilities/matrix.md) or [capability discovery](tools/capabilities.md).

## 2. Create a session & wait for tools

Creating or resuming a session starts paid compute; preparation and idle time
consume `--max-gpu-hours` (omitting it leaves the session open-ended). Always
include a core GPU (`H100`, `A100_80GB`, `L40S`, or `RTX6000PRO`) in
`--allowed-gpus` (or `--gpu` if `--allowed-gpus` is omitted). `base` is always
included; omit it from `--tools`.

```sh
ariax forge create --name "My workspace" --gpu L40S --allowed-gpus L40S,H100 --gpu-count 1 --tools boltz2,interface-scores --priority boltz2 --max-gpu-hours 4 --json
ariax forge status SESSION --json
ariax forge tools wait SESSION base --wait-timeout 1800 --json
ariax forge tools wait SESSION boltz2 --wait-timeout 1800 --json
```

Use `--min-ram-gib`, `--min-cpu-count`, and `--min-disk-gib` for hardware
minima. Session `available` means `base` accepts commands; each scientific tool
reports `queued`, `installing`, `ready`, or `failed` independently. Add more
tools later with `ariax forge tools add SESSION --tools TOOL`.

## 3. Stage inputs & run native commands

```sh
ariax forge inputs add SESSION --file ./target.yaml --path targets/target.yaml --json   # mounted at /inputs/targets/target.yaml
ariax forge inputs status SESSION INPUT_ID --json                                       # wait for state=ready
ariax forge run SESSION --tool boltz2 --gpus 0 --wait-ready --input-ids INPUT_ID --wait --wait-timeout 1800 -- boltz predict /inputs/targets/target.yaml --out_dir /workspace/out
ariax forge logs SESSION COMMAND_ID --tail 1000 --no-json
ariax forge command SESSION COMMAND_ID --json
```

- Put the native executable and arguments after `--`; `--cwd` defaults to `/workspace` and must stay under it.
- Multi-GPU sessions require explicit `--gpus 0` / `--gpus 1,0` for GPU tools (CPU tools omit `--gpus`). Overlapping GPU reservations return `gpu_busy`; use distinct output directories for concurrent commands.
- `--wait` exits nonzero on failed/interrupted/cancelled commands, but exit `0` does not verify scientific validity — always inspect native outputs and files.
- Use `--retained` with `commands`, `command`, `logs`, or `inputs list/status` after session closure. `ariax forge list`, `project`, `activity`, `commands`, and `command` return lean summary payloads by default (add `--details` for full metadata).

## 4. Save files, finish & release compute

A completed command does **not** close the session. Write durable outputs under
`/workspace` (keep heavy scratch intermediates in `/scratch`), then finish and
confirm release:

```sh
ariax forge sync SESSION --wait --wait-timeout 900 --json
ariax forge files PROJECT --path /workspace --json
ariax forge finish SESSION --wait --json      # drains commands + flushes + closes
ariax forge status SESSION --json             # confirm state=closed
```

Use `ariax forge close SESSION` for immediate teardown, `ariax forge cancel SESSION COMMAND_ID`
to cancel one command, `ariax forge limit SESSION --gpu-hours H` to edit a
session cap, and `ariax forge resume PROJECT --gpu GPU ...` to reopen the same
project's saved files (`--hydrate PATH` selects a subset).

**Deep references:** [outputs & file ops](outputs.md) · [recovery, holds & deletions](references/recovery.md) · [campaign recipes](references/campaign-recipes.md) · [custom code](references/custom-code.md) · [Adaptyv ordering](references/adaptyv-ordering.md)
