# Run and restore project-local code

Use this recipe when the user wants to modify a tool checkout inside Forge.
Choose an authorized project/session and a compatible selected scientific
tool. Base supplies Git; the scientific image supplies its own compatible
interpreter and heavy packages. Source edits run with the existing container
and GPU boundaries. Shipped installations and shared weights stay read-only.

Read this reference with
`ariax skills forge --reference custom-code --read --json`. Follow the
[shared lifecycle](../SKILL.md) for tool readiness, command recovery, billing,
human controls and closure. Run setup and execution inside the remote Forge
session; keep environments and scientific workloads off the workstation.

## Choose source and dependencies

Inspect the selected tool with
`ariax forge catalog --tool TOOL --model MODEL --json`, adding `--mode MODE`
for a listed mode and omitting `--model` for a tool without model IDs. Read its
guide using the reference paths from `ariax skills forge --tool GUIDE --json`.
For source modifications, also request `ariax forge catalog --tool TOOL --json`
without model/mode filters to obtain the full selected-tool metadata, including
`sources`, `patches`, model assets and image guidance. Keep it with the run
settings. Clone a credential-free repository URL with base Git and check out
a chosen commit.
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

## Example: save a custom checkout

This example edits a DNA composition tool, installs a tiny local dependency,
and saves both for later use. It needs no shared model or network.
It demonstrates source/environment handling and makes no predictor claim.
Set `SESSION` to an available authorized session with base ready. Set
`EXAMPLE` to `data.examples["custom-code"]` from
`ariax skills forge --tool custom-code --json`:

```sh
FORGE_TOOLS=$(dirname "$(dirname "$EXAMPLE")")
for file in prepare.py bootstrap.py run.py sequences.fasta check.py dependency/fixture_stats.py; do
  ariax forge inputs add "$SESSION" --file "$EXAMPLE/$file" --path "custom-code/$file" --json
done
ariax forge inputs add "$SESSION" --file "$FORGE_TOOLS/custom-code/source_bundle.py" --path custom-code/source_bundle.py --json
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

## Save and close

Stop writers, sync and retain the completed checkpoint ID:

```sh
ariax forge sync "$SESSION" --wait --timeout 900 --json
ariax forge files "$SESSION" --checkpoint "$CHECKPOINT" --path /workspace/custom --json
ariax forge close "$SESSION" --json
ariax forge status "$SESSION" --json
```

Set `CHECKPOINT` from the completed sync. Require `synced` and source state
`closed`, which confirms resource release. The saved source, bootstrap and
outputs remain available through the [checkpoint file commands](../outputs.md).

## Continue saved code when needed

Resume only when the user's task calls for more work. Set `PROJECT` from the
source session and follow [project controls](../SKILL.md#project-controls-and-resume)
to inspect any human hold and obtain the current `control.revision`. Human web
approval leaves compute stopped; await the user's direction before resuming
that project. Resume starts a new paid allocation and does not replay commands
or reinstall dependencies.

```sh
ariax forge project "$PROJECT" --json
ariax forge resume "$PROJECT" --session-id "$NEW_SESSION_ID" --restore-session "$SESSION" --checkpoint "$CHECKPOINT" --control-revision "$REVISION" --gpu L40 --gpu-count 1 --max-gpu-hours 1 --json
```

Set `REVISION` from `control.revision` and use a fresh UUID for `NEW_SESSION_ID`.
Omitting tools suffices for this composition example. Scientific work must
explicitly select its compatible tools. Choose hardware and the new allowance
within the authorized scope. After an uncertain reply, use the saved request
ID and fields as described in [request recovery](../SKILL.md#recover-a-lost-response).
Wait for the new session and its selected tools to be ready before execution.

Set `RESTORED_SESSION` to the returned new session UUID. Restore completes
before command admission; it reconstructs saved workspace/input files and
does not replay commands or reinstall dependencies. Inspect the saved source
record and bootstrap before explicitly unpacking, reinstalling and running
with a fresh output path:

```sh
ariax forge run "$RESTORED_SESSION" --tool base --json -- python3 /inputs/custom-code/source_bundle.py unpack /workspace/custom/source.tar /scratch/custom-source
ariax forge run "$RESTORED_SESSION" --tool base --timeout-seconds 120 --json -- python3 /workspace/custom/bootstrap.py /scratch/custom-source /scratch/custom-env
ariax forge run "$RESTORED_SESSION" --tool base --json -- /scratch/custom-env/bin/python /scratch/custom-source/entry.py /scratch/custom-source/sequences.fasta /workspace/custom/after.json
ariax forge run "$RESTORED_SESSION" --tool base --json -- python3 /inputs/custom-code/check.py /workspace/custom/after.json
```

Watch each command to `succeeded` in sequence. Save the new outputs in a
completed checkpoint, close the session and confirm `closed`. Use links or
downloads from that checkpoint for result consumption; keep bulk outputs
on remote storage under the workstation storage policy.

## Use a scientific container

A saved checkout and recreated environment do not establish that a custom
predictor revision is scientifically compatible. Use the selected tool's
documented interpreter, compatible named assets, native inputs and output
checks. Record the executable/module paths, exact commit, local edits, model,
native options and requested-versus-produced counts with the outputs. Keep
shipped installations and shared model assets read-only. Each new prediction
needs a fresh workspace output directory.

The [Boltz source preparation](../tools/examples/custom-code/native/prepare_boltz.py)
and [bootstrap](../tools/examples/custom-code/native/bootstrap_boltz.py) scripts
illustrate Boltz v2.2.1 source at commit
`cb04aeccdd480fd4db707f0bbafde538397fa2ac` with the named `boltz2` asset at
`/models/boltz2`. The bootstrap expects Torch `2.9.0+cu128` and compatible
image packages. These scripts do not establish compatibility for another
revision, model or workload. Read the [Boltz2 guide](../tools/boltz2.md) for native
structure, confidence and PAE interpretation and current supported modes.
