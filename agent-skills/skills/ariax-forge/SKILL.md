---
name: ariax-forge
description: Create and operate Ariax Forge compute sessions, select tools, run native commands, recover submissions, and cancel or close work through the Ariax CLI.
---

# Ariax Forge

Use `ariax forge` within the user's authorized hardware, task, and spending
scope. Creation and idle VM time incur charges. Hyperstack is the default
provider. Use `--provider vastai` for Vast full VMs when the deployed backend
admits that provider. Choose a GPU explicitly; `--max-hours` optionally limits
the session from allocation. Authentication uses the normal `ariax login` or secret-manager
injection of `ARIAX_API_KEY`. Never place credentials in argv or saved notes.

Read this guide with `ariax skills forge --read --json` (alias `ariax-forge`).
Use `ariax forge --help` for the installed command surface. Responses support
the usual `--json`; data is in `data`, diagnostics and printed IDs are on stderr.
The CLI uses `/api/v1/forge` on the existing Ariax API origin.

Discover references and bundled example paths with `ariax skills forge --json`.
Use `ariax skills forge --reference NAME --read --json` to read
[inputs/checkpoints/restore](outputs.md) (`outputs`),
[base shell/Python](tools/base.md) (`base`), [CPU ipSAE](tools/ipsae.md) (`ipsae`),
[GPU Boltz2](tools/boltz2.md) (`boltz2`),
[BindCraft2 design](tools/bindcraft2.md) (`bindcraft2`), or
[FreeBindCraft design](tools/freebindcraft.md) (`freebindcraft`). The
`ariax-forge` alias accepts the
same references. `data.examples.root` is the local directory used by native
examples; `data.examples.base`, `.ipsae`, `.boltz2`, `.bindcraft2`, and
`.freebindcraft` locate individual fixture directories. B08 qualified base,
ipSAE and Boltz2. B09 qualified the BindCraft2 and FreeBindCraft images and
bounded examples on the native GPU builder. Private publication and live
Forge session qualification are separate gates. Use the deployed catalog
and tool readiness.

## Start and select tools

```sh
ariax forge create --name "Base workspace" --gpu L40 --max-hours 2 --json
ariax forge list --json
ariax forge status SESSION --json
ariax forge tools SESSION --json
ariax forge tools wait SESSION base --timeout 600 --json
# When ipsae is in the deployed catalog:
ariax forge tools add SESSION --tools ipsae --priority ipsae --json
ariax forge tools wait SESSION ipsae --timeout 1800 --json
```

Omit `--tools` for a base workspace. Base is always included; leave it out of
selection lists. Tool keys come from the configured public catalog at
`GET /api/v1/forge/catalog`, not managed protocol names or invented image
selectors. `--priority` names any subset of selected tools; the remaining tools
follow in their selection order. Ariax manages ordinary image tags and named
shared model assets.

Session `available` means the host and base workspace accept commands. Each
scientific tool separately reports `queued`, `installing`, `ready`, or `failed`.
Wait for the requested tool to be ready. A tool failure does not revoke host
availability. Adding tools preserves ready tools. Explicitly adding a failed
tool can retry installation; status and wait never start that retry. Tool preparation runs in the background. Inspect a failed tool and use an explicit tools add request when a retry is appropriate.

## Execute and observe

```sh
ariax forge run SESSION --tool base -- python3 -c 'print("hello")'
ariax forge commands SESSION --json
ariax forge command SESSION COMMAND_ID --json
ariax forge watch SESSION COMMAND_ID --timeout 600 --json
ariax forge logs SESSION COMMAND_ID --tail 1000 --no-json
```

The agent chooses native argv inside the selected Docker image. Put the
native executable and every native argument after `--`; Forge passes that
argv unchanged. Include an explicit shell through argv when the task needs
one. The native guides provide examples, with the workflow chosen by the
agent for the user’s task. `--cwd` defaults to
`/workspace` and must stay under it. `--timeout-seconds` controls remote command
execution and defaults to 86400 seconds. Native tool options and scientific
interpretation require that tool's documentation; a command record is not its
stdout or evidence of scientific quality.

One GPU command runs per session; another receives `gpu_busy`. CPU commands
have a small concurrency limit and share writable workspace paths. Use distinct
output paths when work overlaps. `unknown` keeps its GPU reservation until
reconciliation establishes an outcome. Read the command's state, exit code,
error, and logs. `watch` reports failed or interrupted work as an error;
`command` remains available to inspect its full record.

## Recover a lost response

Create prints `session_id` and run prints `command_id` before the POST. Each
request is saved under `.ariax/forge/ID.json` in the chosen `--root-dir`. Retain
the ID, original request fields, root directory, account, and API origin.

After a lost acknowledgment, inspect the printed identity:

```sh
ariax forge status SESSION --json
ariax forge command SESSION COMMAND_ID --json
```

Retry the original create with `--session-id SESSION`, or the original run with
`--command-id COMMAND_ID`, using identical fields and the same account and root
directory. The CLI compares fields directly with the saved request. The server
returns accepted work for a duplicate ID. Changing an ID can allocate another
VM or execute another command. Do not automatically rerun scientific commands
under a new ID after a timeout, failure, or uncertain acknowledgment.

`tools wait` and `watch` use `--timeout SECONDS` to limit local polling; zero or
omission waits without a local deadline. A local timeout or Ctrl-C leaves remote
work running. Resume with the same wait/watch operands. For other commands,
the usual global `--timeout` remains a per-request limit in milliseconds.

## Cancel and close

```sh
ariax forge cancel SESSION COMMAND_ID --json
ariax forge close SESSION --json
ariax forge status SESSION --json
```

Cancellation targets one command. It returns cancellation requested; inspect
the command until its final state is known. Repeated cancellation is harmless.
Close stops the session and releases its allocation. Poll session status until
`closed`, which confirms resource release. A cleanup problem leaves `closing`
with an error. A failed HTTP request does not establish VM loss or cleanup.
Repeated close observes the same closure.

## Inputs and durable outputs

Stage a local file, an authorized Ariax artifact, or an individual public HTTPS object with `ariax forge inputs add SESSION --file FILE --path targets/input.yaml`. Use `--artifact PROJECT_ID:PATH` or `--url URL` for the other sources. Published inputs appear under read-only `/inputs`; inspect readiness with `inputs status SESSION INPUT_ID` before a command reads them.

Run `ariax forge sync SESSION --wait` to publish a checkpoint, then use `files` or `download`. Read `ariax skills forge --reference outputs --read --json` for these commands
and restore. Checkpoints preserve stable file versions and ready inputs. Concurrent writers can fail a sync. Inspect `persistence.checkpoint` and `persistence.error` after close or expiry to learn what became durable.

Create a new session from a terminal source with `--restore-session SOURCE --checkpoint CHECKPOINT`. Restore finishes before command admission. The new session uses normal allocation and billing. Scientific commands require explicit submission after restore.
