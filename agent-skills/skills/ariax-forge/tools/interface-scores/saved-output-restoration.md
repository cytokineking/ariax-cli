# Preserve and restore complete interface-score results

The accepted B35q image supports one-CPU/1-GiB scoring through 115 native tokens
and 958 atoms. GPU count and VRAM are zero. Reuse accepted native evidence and
saved results for retained features. Larger profiles and repeated sample series
are optional benchmarks. Use live catalog requirements and preserve the measured
scope; ordinary case observations do not establish larger workload capacity.

Stage every original matched native file through ordinary Files inputs. Keep the
original input sequences and producer identity/settings records, full confidence,
summary, structure and token-map derivation together. OpenDDE needs native identity
and original input roles. OpenFold3 needs its original native confidence and feature
identity files as well as the exported JSON. Retain feature files as originals;
scoring does not load their PT/pickle payloads. Preserve each handoff's relative
layout when staging it. A host absolute path must be explicitly rebased in a
separate workload handoff to its actual `/inputs` location; retain the original
handoff beside that derivative.

Write all scores, checker reports, resource logs, native positional v3 text,
by-residue and PyMOL outputs under `/workspace/interface-scores`. Preserve failed
attempts and unavailable values. Scratch is disposable. Wait for every writer to
finish, sync and require a completed checkpoint:

```sh
ariax forge sync "$SESSION" --wait --timeout 1800 --json
ariax forge checkpoints "$SESSION" --json
ariax forge checkpoint "$SESSION" "$CHECKPOINT" --json
ariax forge files "$SESSION" --path /inputs --checkpoint "$CHECKPOINT" --json
ariax forge files "$SESSION" --path /workspace/interface-scores --checkpoint "$CHECKPOINT" --json
ariax forge link "$SESSION" /workspace/interface-scores/af2.json --checkpoint "$CHECKPOINT" --json
```

Use the returned checkpoint ID. `files` lists immediate children; inspect each
required subdirectory. Confirm that the complete registered input set and all
workspace result/reference/log files are retained, with expected paths and byte
counts. Saving just the final result JSON cannot restore its native evidence.
Use stable checkpoint links to inspect/download scientific files. Bulk output
remains in private remote storage under the campaign's workstation policy.

The [shared outputs guide](../../outputs.md) supplies the ordinary authorized
resume command and the distinction between same-project resume and a new project.
A resume allocates normal billed compute and needs available authorization; this
guide grants no extra allocation. Require the chosen checkpoint restored before
command admission. Restore recovers input and workspace files, starts with empty
scratch and command history, and performs no scientific replay.

After restore, compare every saved input/workspace path and byte to the selected
checkpoint. Check the restored result explicitly, using its original availability
expectation:

```sh
ariax forge run "$RESTORED_SESSION" --tool interface-scores --timeout-seconds 60 --json -- python3 /opt/interface-scores/check.py /workspace/interface-scores/af2.json --require-available
ariax forge watch "$RESTORED_SESSION" "$RESTORED_CHECK_COMMAND_ID" --timeout 120 --json
```

Omit `--require-available` for a monomer or a case with recorded unavailable metrics.
Compare stored directional metrics, aggregates, residue identities and reasons.
Do not run `interface-scores` or prediction merely to reconstruct missing saved
results. An explicit later scoring command needs its own fresh output path and
retains its actual command ID. Inspect status after closing owned compute and
confirm resource release.
