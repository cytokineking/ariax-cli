# Forge base workspace

Use this guide for shell/Python input-to-output work on an authorized Forge
session. Base is a CPU tool with `/bin/sh` and `python3`, always included in
the session. Select tools through the Forge platform; base is omitted from
`--tools`. The session still uses the full VM selected by `forge create`.

Require session state `available` and base state `ready`:

```sh
ariax forge status "$SESSION" --json
ariax forge tools "$SESSION" --json
```


## Stage and execute the small example

The [text input](examples/base/message.txt), [Python program](examples/base/run.py),
and [result checker](examples/base/check.py) produce a one-line JSON result.
Use relative import destinations, published under read-only inputs:

```sh
ariax forge inputs add "$SESSION" --file "$EXAMPLES/base/message.txt" --path base/message.txt --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/base/run.py" --path base/run.py --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/base/check.py" --path base/check.py --json
ariax forge inputs list "$SESSION" --json
```

Record each returned input ID. Require all three to be `ready`; while an
input is importing, use `ariax forge inputs status "$SESSION" "$INPUT_ID"
--json`. A failed import must be resolved before execution.

```sh
ariax forge run "$SESSION" --tool base --timeout-seconds 60 --json -- python3 /inputs/base/run.py /inputs/base/message.txt /workspace/base-demo/result.json
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 120 --json
ariax forge run "$SESSION" --tool base --timeout-seconds 60 --json -- python3 /inputs/base/check.py /workspace/base-demo/result.json
ariax forge watch "$SESSION" "$CHECK_COMMAND_ID" --timeout 120 --json
```

Set each command variable to its corresponding returned command ID, and
require the first command `succeeded` before starting the checker. The result
must contain `text: "Forge base fixture\n"` and `line_count: 1`. The checker
reads the actual JSON and exits nonzero on missing or incorrect results.

Forge executes direct argv. To use shell syntax, explicitly pass `/bin/sh -c`
as argv, as in the ipSAE copy example. `/inputs` and `/models` are read-only;
`/workspace` is writable; `/scratch` is temporary and not saved. The
root filesystem is read-only and the workload runs as UID/GID 10001. Choose
workspace paths for deliverables.

## Save, inspect, and restore

After commands are terminal:

Set `PROJECT` to the session's returned `project_id`.

```sh
ariax forge sync "$SESSION" --wait --timeout 1800 --json
ariax forge files "$PROJECT" --path /workspace/base-demo --json
ariax forge download "$PROJECT" /workspace/base-demo/result.json --dest ./base-result.json --json
ariax forge close "$SESSION" --json
ariax forge status "$SESSION" --json
```

Require the flush state `saved` and confirm the source session is `closed`.
File listing and download read current saved project files, so a successful
command alone does not make
workspace bytes durable. Read the [outputs reference](../outputs.md) with
`ariax skills forge --reference outputs --read --json` for storage behavior.

Continue the same project after a successful flush. If the user clears a human
hold with **Resume workspace**, inspect the project and set `RESTORED_SESSION`
to its `active_session_id`; continue there without starting another session or
automatically replaying science. **Allow agent to resume later** leaves compute
stopped; await the user's direction. For a new CLI resume, confirm no session
is active, no hold blocks it and prior-session cleanup has completed. Set
`REVISION` from the current `control.revision` and explicitly resume. Recover
an uncertain earlier request using its original ID, fields and revision:

```sh
ariax forge project "$PROJECT" --json
ariax forge resume "$PROJECT" --gpu L40 --control-revision "$REVISION" --max-gpu-hours 1 --json
```

For the CLI path, set `RESTORED_SESSION` from the response. After either path,
inspect the session and existing commands before running a new authorized check:

```sh
ariax forge status "$RESTORED_SESSION" --json
ariax forge run "$RESTORED_SESSION" --tool base --timeout-seconds 60 --json -- python3 /inputs/base/check.py /workspace/base-demo/result.json
```

Wait for host/base readiness before the checker.
Watch the new check command to completion. Resume loads current project files
and staged inputs without replaying commands. Close the new session and
confirm resource release when finished.

Keep the same saved command ID after a lost response; query `forge command`
and `forge logs`. A watch timeout ends local waiting and leaves accepted
remote work running. A source session `closed` confirms resource release;
its separate persistence status describes file durability.
