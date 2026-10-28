# Forge inputs, checkpoints, and restore

Read this reference with `ariax skills forge --reference outputs --read --json`
(alias `ariax-forge`). [Base](tools/base.md), [ipSAE](tools/ipsae.md),
[Boltz2](tools/boltz2.md), [BindCraft2](tools/bindcraft2.md) and
[FreeBindCraft](tools/freebindcraft.md) cover native inputs, commands and output
checks. Use `ariax skills forge --tool GUIDE --json` to locate the selected guide's
references and bundled examples. The [tool index](tools/capabilities/matrix.md)
compares methods. Use the selected guide's source/model/settings and
requested-versus-produced item checks before interpreting native outputs.

## Interpret native results

Read command state, native stage records and saved scientific artifacts together.
A succeeded command can contain failed items, missing samples, or zero designs
passing the original filters. Retain partial stages, original rejection reasons,
unavailable metrics and exact settings. A ranked or exported candidate can still
be rejected. Report planned, attempted, completed and accepted counts separately.

| Result family | Interpretation boundary |
| --- | --- |
| AF2, Boltz-2, RF3, Protenix, Biohub ESMFold2, OpenDDE, OpenFold3 | Pair structure, raw confidence, native token/atom map, model, seed and sample/rank from one attempt. pLDDT scales differ by writer; PAE axes may include atomized chemicals and remain directional. Use each guide's units and chain map. Plain AF2 monomer lacks PAE/pTM; absent monomer interfaces remain unavailable or native zero as documented. |
| Interface scores / ipSAE | Use an admitted predictor adapter and the selected standard-protein residue map. Missing or split-token inputs can leave metrics unavailable. Preserve directional scores and original predictor summaries. |
| MPNN / FAMPNN / JMS / ESMC | Likelihood scores, logits, masked protocol outputs and learned stability estimates have separate conditioning and units. FAMPNN PDB B-factors are PSCE, not pLDDT. JMS half-mask and complete-constituent requirements cannot be filled by ESMFold2/ESMC. |
| Foundry / Proteina-Complexa | Generated sequence, coordinates, input chemistry and output topology are distinct evidence. Preserve fixed-atom misses, unavailable generated bonds and predictor sentinel rewards. RF3 `chain_ptm` at the shipped source is mean chain pLDDT. |
| BoltzGen / BindCraft2 / FreeBindCraft / RFantibody | Keep generation, sequence design, complex refold, binder-only prediction, relaxation and selection stages distinct. Unreached stages stay absent; FreeBindCraft's OpenMM placeholder fields are uncomputed. RFantibody confidence uses T/H/L order while its PDB uses H/L/T. |
| Absolute stability / structure tools | DG_AB estimates full-complex stability. Ensemble spread is model disagreement. RMSD/TM-score, SASA, geometry overlaps and explicitly configured relaxation energy describe different quantities. |

Computational confidence, ranking and consistent exports establish their stated
computational result. They do not establish experimental binding, specificity,
expression or affinity. Use [shared interpretation](../../core/interpretation.md)
and the package's result reference for a scientifically valid comparison.

## Save and inspect files

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
ariax forge link SESSION /workspace/result.txt --checkpoint CHECKPOINT_ID --json
```

Choose exactly one input source. `--path` is a relative POSIX file path and rejects traversal, symlinks, absolute paths, and backslashes. An input publishes only after the transfer completes and Ariax retains a durable copy. Completed input paths remain immutable. Inputs support regular files up to 20 GiB and transfers have a 900 second limit. Public URLs undergo network and redirect checks. Artifact imports require access to the source project.

The CLI prints and saves `input_id` or `checkpoint_id` before mutation. After a lost reply, query that ID with inputs status or checkpoint. Retry with `--input-id` or `--checkpoint-id`, the original fields, root directory, account, and API origin. Accepted operations are observed before resubmission. URL imports require the original URL again when the server has no accepted operation. Ordinary request records exclude signed URLs and transfer grants. Keep presigned URLs out of shell history when possible.

`sync --wait` waits locally; `--timeout SECONDS` or Ctrl-C leaves accepted work intact. Checkpoint states are queued, syncing, synced, and failed. A completed checkpoint is required for files and download. An omitted `--checkpoint` selects the latest completed checkpoint. File listings show immediate children and fetch all bounded pages. Downloads stream into a private temporary file and publish after the expected byte count arrives. Use a fresh destination path.

The daemon detects changes through file metadata and checks every copied file version. A command writing during sync can cause failure; wait for the writer and submit a new checkpoint ID. Checkpoints retain earlier versions and record deletions. They describe each stable file version across the attempt. Each checkpoint permits 100,000 entries and 100 GiB in total. Periodic sync runs on a five minute cadence while a session is available. A busy sync returns its active checkpoint ID. A failed attempt leaves `persistence.checkpoint` at the last completed checkpoint.

```sh
ariax forge close SESSION --json
ariax forge status SESSION --json
ariax forge project PROJECT --json
ariax forge resume PROJECT --session-id NEW_SESSION_UUID --gpu L40 --restore-session SESSION --checkpoint CHECKPOINT_ID --control-revision N --max-gpu-hours 2 --json
```

Close fences command admission and stops workspace writers. Stopping writers,
the final checkpoint and final output capture share a 70-second close budget.
Resource cleanup continues through host or storage failures; inspect
`persistence.error` for a durability gap. `closed` confirms resource release.
Files and downloads remain available from completed checkpoints afterward.

Resume requires a closed or failed source session within the same project,
a completed checkpoint and the observed control revision. The new session/job
restores that index before commands can run, preserving deletions between saves.
Approval of a human hold belongs to the authenticated web flow. It leaves compute
stopped until an agent explicitly resumes with the new revision. Retain the
project identity for continuing held work. An explicitly requested new project
can use `create --restore-session SOURCE --checkpoint CHECKPOINT_ID` when source
authorization and control permit it. Both paths allocate through normal billing.
Restored custom source/bootstrap files require explicit environment recreation
and an explicit next command. Saved commands are never replayed by resume.

`link` selects and authorizes a completed checkpoint for a regular saved file.
It returns a project page URL pinned to that session, checkpoint and encoded
path, with completion time and size when supplied. Transfer grants remain private.
Copy this stable page link for the user to inspect the saved version.
Only uncompressed `.pdb`, `.cif` and `.mmcif` up to 10,000,000 bytes preview
on the page. For compressed native structures, create a separate uncompressed
workspace copy on the VM and checkpoint it alongside the original. Other saved
regular files remain downloadable under the file service limits. Keep bulk
scientific files on remote storage within the workstation storage policy.

Link rejection reports or partial-stage records when no accepted structure
exists. Pin every shared result to its actual completed checkpoint; a live
workspace path alone is not a saved version.

```sh
ariax forge activity PROJECT --limit 50 --json
ariax forge activity PROJECT --cursor NEXT_CURSOR --json
ariax forge command SESSION COMMAND_ID --json
ariax forge logs SESSION COMMAND_ID --tail 1000 --json
```

Activity and command detail/output survive teardown. Output is retained within
256 KiB UTF-8 and the requested 1–5000-line tail. `output_available=true` with
empty `text` means captured empty output. False means unavailable; an omitted
field remains unspecified. `output_complete=true` identifies a captured terminal
tail and can coexist with `output_truncated=true`. A partial tail can remain
readable with an `output_error` after final capture fails. Confirmed release can
report `final_output_unavailable`. Read the fields together before interpreting
missing output. Fuller useful logs belong in regular workspace files saved
through checkpoints. `output_files` currently returns an empty list.
