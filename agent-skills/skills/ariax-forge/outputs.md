# Forge inputs, checkpoints, and restore

Read this reference with `ariax skills forge --reference outputs --read --json`
(alias `ariax-forge`). [Base](tools/base.md), [ipSAE](tools/ipsae.md), and
[Boltz2](tools/boltz2.md) cover native inputs, commands, and output checks.
Use `ariax skills forge --json` to locate their bundled examples. Image and
native GPU qualification remain separate from the CLI file workflow.

Write native outputs under `/workspace`. `/scratch` is disposable. Read-only inputs live under `/inputs`. Checkpoints cover workspace files and ready inputs; the host keeps its journal, credentials, and model assets outside that index.

```sh
ariax forge inputs add SESSION --file target.yaml --path targets/target.yaml --json
ariax forge inputs add SESSION --artifact PROJECT_ID:output/result.cif --path structures/result.cif --json
ariax forge inputs add SESSION --url 'https://example.org/target.fasta' --path target.fasta --json
ariax forge inputs list SESSION --json
ariax forge inputs status SESSION INPUT_ID --json
ariax forge run SESSION --tool base -- python3 -c 'from pathlib import Path; Path("result.txt").write_text(Path("/inputs/target.fasta").read_text())'
ariax forge sync SESSION --wait --timeout 900 --json
ariax forge checkpoints SESSION --json
ariax forge checkpoint SESSION CHECKPOINT_ID --json
ariax forge files SESSION --path /workspace --checkpoint CHECKPOINT_ID --json
ariax forge download SESSION /workspace/result.txt --dest ./result.txt --checkpoint CHECKPOINT_ID --json
```

Choose exactly one input source. `--path` is a relative POSIX file path and rejects traversal, symlinks, absolute paths, and backslashes. An input publishes only after the transfer completes and Ariax retains a durable copy. Completed input paths remain immutable. Inputs support regular files up to 20 GiB and transfers have a 900 second limit. Public URLs undergo network and redirect checks. Artifact imports require access to the source project.

The CLI prints and saves `input_id` or `checkpoint_id` before mutation. After a lost reply, query that ID with inputs status or checkpoint. Retry with `--input-id` or `--checkpoint-id`, the original fields, root directory, account, and API origin. Accepted operations are observed before resubmission. URL imports require the original URL again when the server has no accepted operation. Ordinary request records exclude signed URLs and transfer grants. Keep presigned URLs out of shell history when possible.

`sync --wait` waits locally; `--timeout SECONDS` or Ctrl-C leaves accepted work intact. Checkpoint states are queued, syncing, synced, and failed. A completed checkpoint is required for files and download. An omitted `--checkpoint` selects the latest completed checkpoint. File listings show immediate children and fetch all bounded pages. Downloads stream into a private temporary file and publish after the expected byte count arrives. Use a fresh destination path.

The daemon detects changes through file metadata and checks every copied file version. A command writing during sync can cause failure; wait for the writer and submit a new checkpoint ID. Checkpoints retain earlier versions and record deletions. They describe each stable file version across the attempt. Each checkpoint permits 100,000 entries and 100 GiB in total. Periodic sync runs on a five minute cadence while a session is available. A busy sync returns its active checkpoint ID. A failed attempt leaves `persistence.checkpoint` at the last completed checkpoint.

```sh
ariax forge close SESSION --json
ariax forge status SESSION --json
ariax forge create --name restored-work --gpu L40 --restore-session SESSION --checkpoint CHECKPOINT_ID --max-hours 2 --json
```

Close fences command admission and stops workspace writers. Stopping writers and the final checkpoint share a 60-second close budget. Resource cleanup continues through host or storage failures; inspect `persistence.error` for a durability gap. `closed` confirms resource release. Files and downloads remain available from completed checkpoints afterward.

Restore requires an authorized source session in closed or failed state and a complete checkpoint. A new session restores that chosen index before commands can run, preserving deletion between checkpoints. It gets a new allocation, job, project, and credentials through the usual billing path. Submit native work explicitly when the restored workspace is ready.
