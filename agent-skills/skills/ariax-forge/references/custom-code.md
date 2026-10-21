# Run and restore project-local code

Use this recipe when the user wants to modify a tool checkout inside Forge.
Choose an authorized project/session and a compatible selected scientific
tool. Base supplies Git; the scientific image supplies its own compatible
interpreter and heavy packages. Source edits run with the existing container
and GPU boundaries. Shipped installations and shared weights stay read-only.

B25 uses the accepted B18 same-project session route. The repository handoff
records remote qualification for the base recipe and its selected Boltz
source/environment. B22's installed `forge project` and `forge resume`
commands are integrated. B25 used two logical sessions on one physical VM;
B26 qualifies real provider/R2 restoration. The custom-code exercise on
separate real allocations remains part of B57.
Root reference/example discovery is owned by B55. Until it is registered,
read this file directly from the installed skill package.

## Choose source and dependencies

Get the selected tool's `sources`, `patches`, model assets and image guidance
from catalog/tool inspection. Save that shipped metadata separately. Clone a
credential-free repository URL with base Git and check out a chosen commit.
A plain checkout can live in workspace. Keep trees containing symlinks in
scratch, and save them as a regular source archive in workspace. Git pulls
and custom dependency installation are explicit actions within the user's
task scope. Keep credentials and private `.git` configuration out of saved
files and logs.

Run code inside the selected scientific container. Use its documented Python
to make `/scratch/custom-env` with `python -m venv --system-site-packages`.
Install the reviewed project requirements there; install the checkout with
`/scratch/custom-env/bin/python -m pip install --no-deps --no-build-isolation --ignore-installed /scratch/custom-source`
and check dependencies with `pip check`. Set pip, compiler, CUDA and Python
caches under scratch. The image's build backends/compilers must support that
checkout. A revision that needs incompatible Torch/CUDA, preprocessing or
weights requires explicit compatibility work. Run its normal native loader
and output checks before reusing the selected shared assets.

Save the exact commit, local-change status, dependency/bootstrap instructions,
image tag, interpreter, chosen assets and native settings with the outputs.
An observed `pip freeze --all` is useful context; review image packages and
scratch path entries before using it as reinstall input. Source metadata
describes that saved checkout; arbitrary argv can run other code.

[source_bundle.py](../tools/custom-code/source_bundle.py) saves tracked and
nonignored untracked files, with local edits, deletions and internal relative
symlinks. It excludes `.git`, ignored files and empty directories. Track an
essential ignored source file explicitly. Archive submodules separately.
Escaping/absolute links, directories representing submodules and special
files fail the save. Stop source writers and audit saved files first.

The helper writes a regular tar and a separate `.source.json` containing
commit, local changes, tool and supplied asset names. On explicit unpack it
requires a fresh destination and Python 3.11.8+ with tar's standard safe
data filter. Environments stay in scratch and are never checkpointed. To
recreate Git history after unpack, explicitly `git init`, add the reviewed
origin, fetch the saved commit and `git reset --mixed FETCH_HEAD`; inspect
status before pulling. This preserves saved edits and deleted files.

## Stage the small restore exercise

This example edits a DNA composition tool, installs a tiny local dependency,
and recreates both from saved source. It needs no shared model or network.
It exercises source/environment behavior; it does not qualify a predictor.
Set `SESSION` to an available authorized session with base ready. Set
`EXAMPLES` to `data.examples.root` from `ariax skills forge --json`:

```sh
FORGE_TOOLS=$(dirname "$EXAMPLES")
for file in prepare.py bootstrap.py run.py sequences.fasta check.py dependency/fixture_stats.py; do
  ariax forge inputs add "$SESSION" --file "$EXAMPLES/custom-code/$file" --path "custom-code/$file" --json
done
ariax forge inputs add "$SESSION" --file "$FORGE_TOOLS/custom-code/source_bundle.py" --path custom-code/source_bundle.py --json
ariax forge inputs add "$SESSION" --file "$FORGE_TOOLS/custom-code/probe_read_only.py" --path custom-code/probe_read_only.py --json
ariax forge inputs list "$SESSION" --json
```

Require every returned input ID to be `ready`; inspect pending imports with
`forge inputs status`. Imported destinations are immutable, so use a new
prefix/session if replacing these inputs.

```sh
ariax forge run "$SESSION" --tool base --timeout-seconds 120 --json -- python3 /inputs/custom-code/prepare.py /scratch/custom-source
ariax forge run "$SESSION" --tool base --timeout-seconds 120 --json -- python3 /scratch/custom-source/bootstrap.py /scratch/custom-source /scratch/custom-env
ariax forge run "$SESSION" --tool base --timeout-seconds 120 --json -- /scratch/custom-env/bin/python /scratch/custom-source/entry.py /scratch/custom-source/sequences.fasta /workspace/custom/before.json
ariax forge run "$SESSION" --tool base --timeout-seconds 120 --json -- python3 /inputs/custom-code/source_bundle.py save /scratch/custom-source /workspace/custom/source.tar --tool base
ariax forge run "$SESSION" --tool base --json -- /bin/sh -c 'cp /scratch/custom-source/bootstrap.py /workspace/custom/bootstrap.py'
ariax forge run "$SESSION" --tool base --json -- python3 /inputs/custom-code/check.py /workspace/custom/before.json
```

After **each** `run`, set `COMMAND_ID` to its returned ID, run
`ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 180 --json`, and require
`succeeded` before the next step. These commands depend on each other.
Inspect `source.source.json`: the Git commit is present, local changes are
true, and the changed `run.py` plus untracked note are recorded. The tar
holds the relative symlink as an archive entry; workspace holds regular
files. The checker requires target length 8/GC fraction 0.5 and control
length 8/GC fraction 0, both labeled `project-local`.

## Checkpoint, close and resume

Stop writers, sync and retain the completed checkpoint ID:

```sh
ariax forge sync "$SESSION" --wait --timeout 900 --json
ariax forge files "$SESSION" --checkpoint "$CHECKPOINT" --path /workspace/custom --json
ariax forge close "$SESSION" --json
ariax forge status "$SESSION" --json
```

Set `CHECKPOINT` from the completed sync and `PROJECT` from the source
session. Require `synced` and source state `closed`, which confirms provider
release. If the project has a human hold, stop this work and wait for the
human's web approval. Do not create a replacement project to continue held
work. Web approval clears the hold without allocating compute. After the
user directs continuation, read the new revision and explicitly resume:

```sh
ariax forge project "$PROJECT" --json
ariax forge resume "$PROJECT" --session-id "$NEW_SESSION_ID" --restore-session "$SESSION" --checkpoint "$CHECKPOINT" --control-revision "$REVISION" --gpu L40 --gpu-count 1 --max-gpu-hours 1 --json
```

Set `REVISION` from `control.revision` and use a fresh UUID for `NEW_SESSION_ID`.
Omitting tools suffices for the composition fixture; add `--tools boltz2`
for its separate scientific-source exercise. Choose the new allowance within
the authorized scope. Retain the saved request and reuse its ID and fields
if the reply is lost.
Wait for the returned session and its selected tools through the existing
status/tools commands before executing restored code.

Set `RESTORED_SESSION` to the returned new session UUID. Restore completes
before command admission; it reconstructs saved workspace/input files and
does not replay commands or reinstall dependencies. Inspect the saved files
before any execution: the previous output exists and `after.json` is absent.
Then explicitly unpack, reinstall and run:

```sh
ariax forge run "$RESTORED_SESSION" --tool base --json -- python3 /inputs/custom-code/source_bundle.py unpack /workspace/custom/source.tar /scratch/custom-source
ariax forge run "$RESTORED_SESSION" --tool base --timeout-seconds 120 --json -- python3 /workspace/custom/bootstrap.py /scratch/custom-source /scratch/custom-env
ariax forge run "$RESTORED_SESSION" --tool base --json -- /scratch/custom-env/bin/python /scratch/custom-source/entry.py /scratch/custom-source/sequences.fasta /workspace/custom/after.json
ariax forge run "$RESTORED_SESSION" --tool base --json -- python3 /inputs/custom-code/check.py /workspace/custom/before.json /workspace/custom/after.json
```

Watch each command to `succeeded` in sequence. Sync again, close, confirm
`closed`, then download the archive, source record, bootstrap and both
outputs from that new completed checkpoint. Save IDs/settings and actual
command results with the qualification evidence.

## Scientific container and shared weights gate

The assigned remote exercise also runs a custom selected predictor revision
before and after resume. For Boltz2, preserve the compatible named `boltz2`
asset at `/models/boltz2`, use the bundled native complex input and normal
structure/confidence/PAE checker, and give each prediction a new workspace
output directory. A project-local log marker plus executable/module paths
must show that the custom checkout ran. Preserve the exact commit and local
edit, native options and explicit dependency recreation. Resume selects the
same scientific tool and waits for its readiness.

Run the [boundary probe](../tools/custom-code/probe_read_only.py) inside that
selected scientific container before saving and after restore:

```sh
ariax forge run "$SESSION" --tool boltz2 --gpus 0 --json -- python /inputs/custom-code/probe_read_only.py --path /opt --path /models/boltz2 --output /workspace/custom/boundary-before.json
```

Use the restored session and `boundary-after.json` for the second probe.
Both existing directories must reject a unique new-file write. The probe
never edits existing source or weight files; it fails if a write succeeds.
Record ordinary Docker mount/user/device observations, actual native outputs,
peak RAM/VRAM per device, disk and confirmed cleanup on the assigned VM.
The native fixture uses the accepted `b07` Boltz image, v2.2.1 source and
`boltz2` asset. [Its saved bootstrap and preparation scripts](../tools/examples/custom-code/native/)
keep the project edit and environments explicit. The handoff records both
actual predictions, completed checkpoints, restoration, measured resources
and cleanup; broader Boltz workloads and deployed B26 boundaries retain
their existing gates.
