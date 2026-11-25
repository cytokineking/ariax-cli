# Forge outputs, file operations, and resume

Read this guide with `ariax skills forge --reference outputs --read --json`.
Browse tools in the [tool index](tools/capabilities/matrix.md); for lost
responses, human holds, revision conflicts, `files recover`, and recursive
deletion fencing/recovery, see [Forge recovery](references/recovery.md).

## Interpret native results

Read command state, native stage records, and saved scientific artifacts
together. Exit `0` can still contain failed items, missing samples, or zero
designs passing native filters. Report planned, attempted, completed, and
accepted counts separately, preserving rejection reasons and unavailable metrics.

| Result family | Interpretation boundary |
| --- | --- |
| AF2, Boltz-2, RF3, Protenix, Biohub ESMFold2, OpenDDE, OpenFold3 | Pair structure, raw confidence, native token/atom map, model, seed, and sample/rank from one attempt. pLDDT scales differ by writer; PAE axes may include atomized chemicals and remain directional. Plain AF2 monomer lacks PAE/pTM. |
| Interface scores / ipSAE | Use an admitted predictor adapter and standard-protein residue map. Missing or split-token inputs leave metrics unavailable. Preserve directional scores and original predictor summaries. |
| MPNN / FAMPNN / JMS / ESMC | Likelihoods, logits, masked outputs, and stability estimates have separate conditioning and units. FAMPNN PDB B-factors are PSCE, not pLDDT. JMS constituents cannot be substituted with ESMFold2/ESMC. |
| Foundry / Proteina-Complexa | Generated sequence, coordinates, input chemistry, and topology are distinct evidence. Preserve fixed-atom misses and sentinel rewards. RF3 `chain_ptm` at shipped source is mean chain pLDDT. |
| BoltzGen / BindCraft2 / FreeBindCraft / RFantibody | Keep generation, sequence design, complex refold, binder-only refold, relaxation, and selection distinct. FreeBindCraft OpenMM placeholder fields are uncomputed. RFantibody arrays use T/H/L while PDBs use H/L/T. |
| Absolute stability / structure tools | `DG_AB` estimates full-complex stability; ensemble spread is model disagreement. RMSD/TM-score, SASA, overlaps, and relaxation energies are distinct quantities. |

Computational confidence and rank do not establish wet-lab binding, affinity, or
specificity (see [shared interpretation](../../core/interpretation.md)).

## Scratch → Curate → Pack → Finish & workspace files

Write durable files under `/workspace`; `/scratch` is fast local NVMe that is
ephemeral and not synced; `/inputs` is read-only. Limits: 20 GiB per file,
1 TiB and 1M entries per project (including paths omitted from selective
`--hydrate`).

For any multi-file or bulk run:
1. Write raw outputs under `/scratch/<run>/` so thousands of intermediates never trigger continuous background sync.
2. Copy compact summaries (CSV/JSON) and top-N preview structures (uncompressed `.pdb`/`.cif` ≤10 MB) to `/workspace/results/`.
3. Pack bulk outputs into a verified archive + manifest under `/workspace/archives/` with `ariax forge pack` (stages in `/scratch`, verifies integrity, auto-shards >`--max-shard-gib` default 10 GiB, optionally deletes `--src` after move with `--remove-src`).
4. Finalize and release compute with `ariax forge finish SESSION --wait --json`.

```sh
ariax forge inputs add SESSION --file target.yaml --path targets/target.yaml --json   # or --artifact PROJ:PATH / --url HTTPS
ariax forge inputs status SESSION INPUT_ID --json                                     # wait for state=ready before forge run
ariax forge pack SESSION --src /scratch/run1 --dest /workspace/archives/run1.tar.zst --wait --json
ariax forge sync SESSION --wait --wait-timeout 900 --json                             # flush changed /workspace files
ariax forge files PROJECT --path /workspace --json                                    # paginated; follow next_cursor
ariax forge files hydrate SESSION --path /workspace/result.txt --wait --json          # load a saved file into active session
ariax forge files delete PROJECT --path /workspace/old --recursive --wait --json      # permanent (see references/recovery.md)
ariax forge download PROJECT /workspace/result.txt --dest ./result.txt --json         # atomic + checksum-verified
ariax forge link PROJECT /workspace/result.txt --json                                 # project-page URL (uncompressed <=10 MB PDB/CIF previews)
```

- **Inputs:** `--path` is relative to `/inputs` (commands read `/inputs/<path>`).
  Resumed Forge projects retain prior `/inputs` remotely (inspect with
  `ariax forge files PROJECT --path /inputs`). Completed `/inputs` paths are
  immutable until deleted — upload updated scripts/files under a new `--path`
  (e.g. `fixed/script.py`). Local multipart uploads report `ready` only after
  daemon-backed workspace confirmation (not storage publication alone).
- **Pack & Hygiene notices:** `forge pack` stages under `/scratch/.ariax-pack-<id>/`,
  dereferences valid symlinks while skipping broken symlinks/sockets, verifies
  integrity, shards archives larger than `--max-shard-gib` (1–18, default 10),
  writes `<dest>.manifest.json` (unless `--no-manifest`), and moves finalized
  files into `/workspace/`. `forge status`, `sync`, `finish`, and `close` emit
  structured stderr notices when telemetry detects high file counts, heavy
  pending syncs, low disk space, symlinks, near-20 GiB files, or unsaved
  `/scratch` bytes.
- **Sync:** flushes changed files (`saved`, `pending`, or `failed`); it is not
  an atomic multi-file snapshot — stop writers when a coherent set is needed.
- **Storage audit & cleanup:** Use `ariax storage usage`, `ariax storage projects`,
  `ariax storage project PROJECT`, `ariax storage entries PROJECT`,
  `ariax storage suggest PROJECT` (highlights packed/large Forge directories and
  managed Smart Cleanup targets), and `ariax storage delete PROJECT --path P --preview`
  to inspect and manage stored data across projects.
- **Links & previews:** Links point to the current path (not a pinned historical
  version). Only uncompressed `.pdb`/`.cif`/`.mmcif` ≤10 MB preview on the web
  page; create an uncompressed copy on the VM if needed.
- **Permanent deletions & server-side copies:** `files delete` permanently
  removes saved paths without a trash copy (and `files recover` copies from
  catalog versions, archives, or managed artifacts). See
  [recovery, holds & deletions](references/recovery.md) for recursive-delete
  fencing, `progress` vs `cleanup_remaining`, conflict preservation, and recovery.

## Finish, close, resume & retained logs

```sh
ariax forge finish SESSION --wait --json       # drains commands + pre-stop flush + releases GPU
ariax forge status SESSION --json              # confirm state=closed
ariax forge project PROJECT --json             # status, control.revision, session history
ariax forge activity PROJECT --limit 50 --json # command & control timeline
ariax forge logs SESSION COMMAND_ID --tail 1000 --retained --json
```

- Check `finish`'s `execution`, `drain`, `durability`, `release`, and
  `termination` separately. `forge close [--wait]` is for immediate teardown
  (75s sync ceiling) and refuses by default when >100 files or >500 MiB are
  pending sync (`--force` bypasses the guard when intentionally discarding).
- `ariax forge resume PROJECT --gpu GPU [--wait] [--hydrate PATH ...]` opens a
  new allocation in the same project with its saved files (never replays
  commands; recreate custom scratch environments explicitly per
  [custom code](references/custom-code.md)).
- `forge run --wait` and `forge watch` return `output_tail` (default 80 lines /
  4 KiB, configurable via `--tail N`) and exit with code **`11`** on remote
  script failure (with `exit_code` and `output_tail` in `error.details`).
- Retained command logs cap at 256 KiB UTF-8 / 1–5000 lines (`output_available`,
  `output_complete`, `output_truncated`, `output_error`). Save full logs in
  `/workspace` files when complete traces matter.
