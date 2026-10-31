# Forge inputs, current files, and resume

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

Write native outputs under `/workspace`. `/scratch` is disposable and `/inputs`
contains read-only staged inputs. The project has one current saved workspace.
Use the session's `project_id` for file operations and its `session_id` for sync.

```sh
ariax forge inputs add SESSION --file target.yaml --path targets/target.yaml --json
ariax forge inputs add SESSION --artifact PROJECT_ID:output/result.cif --path structures/result.cif --json
ariax forge inputs add SESSION --url 'https://example.org/target.fasta' --path target.fasta --json
ariax forge inputs list SESSION --json
ariax forge inputs status SESSION INPUT_ID --json
ariax forge run SESSION --tool base -- python3 -c 'from pathlib import Path; Path("result.txt").write_text(Path("/inputs/target.fasta").read_text())'
ariax forge sync SESSION --wait --wait-timeout 900 --json
ariax forge files PROJECT --path /workspace --json
ariax forge files recover PROJECT --path /workspace/copied.cif --catalog SOURCE_PROJECT:/workspace/original.cif --version VERSION --wait --json
ariax forge files recover PROJECT --path /workspace/old.cif --archive SOURCE_PROJECT:CHECKPOINT_ID:/workspace/old.cif --wait --json
ariax forge files recover PROJECT --path /workspace/artifact.cif --artifact SOURCE_PROJECT:output/result.cif --wait --json
ariax forge download PROJECT /workspace/result.txt --dest ./result.txt --json
ariax forge link PROJECT /workspace/result.txt --json
```

Choose exactly one input source. Input `--path` is a relative POSIX file path;
file operations use absolute `/workspace` or `/inputs` paths. Empty components,
dot segments, traversal, control characters and backslashes are rejected. An
input publishes after transfer completes and Ariax retains a durable copy.
Completed input paths remain immutable. Inputs support regular files up to
20 GiB and transfers have a 900-second limit. Public URLs undergo network and
redirect checks. Artifact imports require access to the source project.

The CLI prints and saves `input_id` or `sync_id` before mutation. After a lost
reply, use `ariax forge recover ID` with the original root directory, account
and API origin. Accepted inputs and syncs are observed before submission. A
local upload can resume from its unchanged source; an already published input
does not require that source. When only retained input history is available,
`recover` identifies its source in the response metadata; that history does not
confirm installation in an active workspace. When an import has no saved
successful result, repeat a URL input with its original URL and ID so the server
can compare the source. Request records exclude URLs and transfer grants.

`files recover` copies an authorized catalog version, archived checkpoint file,
or managed-project artifact within storage. It records the source, destination,
writer epoch and revisions before sending the operation; recover the same ID
after uncertainty. An existing destination requires `--overwrite`. A published
copy is `ready` only after active-workspace installation is confirmed; `saved`
with `installation_status: not_applicable` means the copy is stored for a future
workspace, not installed. Server-side copying does not pass file bytes through
the CLI. Archive and managed-artifact sources are pinned to their observed
storage ETag because their legacy metadata lacks the current-file checksum.

`sync --wait` waits locally; `--wait-timeout SECONDS` or Ctrl-C leaves an accepted
flush running. Inspect its returned state: `pending` or `queued` means
unfinished, `saved` means the flush completed, and `failed` includes bounded
file diagnostics. After resolving the cause, retry the same ID with `forge
recover ID --wait` or `forge sync SESSION --sync-id ID --wait`. A final-save
deadline failure cannot be reopened. A flush covers its changed files and is not an atomic multi-file
snapshot; later changes can remain pending. Stop writers when a coherent set
is required, and inspect synchronization failures. A successful scientific
command alone does not prove its output is durable.

Files lists immediate children of the current saved project namespace, fetching
all bounded pages. Downloads require project access, stream through a private
temporary file, and publish only after the declared byte count and multipart checksum match. Use a
fresh destination path. Pages and file bytes can change while the project is
active; neither a listing nor a link pins a historical version.

```sh
ariax forge finish SESSION --wait --json
ariax forge status SESSION --json
ariax forge project PROJECT --json
ariax forge resume PROJECT --session-id NEW_SESSION_UUID --gpu L40 --control-revision N --max-gpu-hours 2 --json
```

Finish waits for accepted commands and a pre-stop flush within its fixed
deadline, then requests normal closure. Check its `execution`, `drain`,
`durability`, `release` and `termination` fields separately. `close` remains an
immediate stop. Close stops writers and drains pending files within the existing 75-second
maximum close opportunity. Compute release and file durability are separate
outcomes: inspect synchronization errors and confirm `closed`. Abrupt VM loss
can leave unsaved changes unavailable. Saved project files remain available
after closure.

Resume needs the observed control revision and confirmed prior-session cleanup.
It loads the same project's current saved inputs and workspace files before
commands are admitted. Human-hold approval belongs to the authenticated web
flow and leaves compute stopped until explicitly resumed. Restored custom
source/bootstrap files require explicit environment recreation and a new
command; resume never replays scientific commands.

`link` authorizes the current regular file and returns a project-page URL with
its encoded path. The link can show newer bytes if that path changes; it is not
a historical version. Transfer grants remain private. Only uncompressed `.pdb`,
`.cif` and `.mmcif` up to 10,000,000 bytes preview on the page. Create any
uncompressed preview copy on the VM and flush it alongside the original. Keep
bulk scientific files on remote storage under the workstation storage policy.
Link rejection reports or partial-stage records when no accepted structure
exists, and preserve the scientific provenance needed to interpret each file.

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
through project file synchronization. `output_files` currently returns an empty list.
