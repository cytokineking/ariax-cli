# Candidate tables and shortlist export

Read [result interpretation](interpretation.md) for confidence scores, structure
stages, pose agreement, and scientific shortlist review. Use [campaign planning](campaigns.md)
when deciding whether the observed yield warrants another design wave.

`ariax candidates PROJECT` retrieves typed rows from current project outputs and starts no compute. BindCraft2 human and JSON defaults use a compact scientific view: identity, native outcome/rank, prioritized metrics, recorded rejection evidence, sequences, structures, publication state, and pagination. Other engines retain their released candidate rows so engine-specific metrics are not discarded. Add `--details` only for the prior full API-oriented record and support fields.

```bash
ariax candidates PROJECT --view final --json
ariax candidates PROJECT --view all --all --output candidates.json --json
ariax candidates PROJECT --view diagnostics --all --output diagnostics.json --json
ariax candidates PROJECT --view final --details --json
```

`final` and `all` are available for all five engines. For BindCraft, `all` aliases `final` and returns only retained accepted designs; use `diagnostics` for trajectories. Complete attempted-sequence statistics are not retained. For BindCraft2, use `final` for ranked accepted designs and `all`/`diagnostics` for available earlier-stage evidence. `diagnostics` means BindCraft trajectories, BindCraft2 trajectory/refold evidence, or ESMFold2 ranking diagnostics and is unsupported for PXDesign/BoltzGen. `--limit` is page size (1–50, default 25). `--all` traverses every page; otherwise use `meta.next_cursor` with `--cursor`. Publication state and pagination are independent: `meta.state: "incomplete"` means project output is not terminal and does not promise another page; only a non-null `meta.next_cursor` does. `--output` writes the same JSON envelope the command would print, atomically. An existing regular file requires `--overwrite`, and failed pagination does not publish a partial export.

The detailed record adds the full selection/filter representation, source path and identity, adapter fields, and additional metrics. A source SHA hashes CSV bytes; it is not a model version or structure checksum. Unknown columns are not interpreted, and missing/nonfinite values remain null. `producer_scaled_pae` is producer-scaled and must not be treated as angstroms.

Human BindCraft2 tables omit columns unavailable in every displayed row and list those fields once below the table. Mixed known/unknown values stay visible, including explicit false and zero. Use `--json` for the complete stable fields, all metrics, ordered sequences, and structure paths; human tables show a few priority scores and published sequence/structure counts.

`--eligible` retains **only explicit true** eligibility. Unknown is not false: the export reports excluded false/unknown counts and exclusion reasons. This filter is generally unsuitable as a generic PXDesign or BoltzGen shortlist filter because those producers do not export a universal ranking-eligibility flag. Inspect their native pass flags and selection separately.

Compact BindCraft2 rows use `binder_sequences`, `selected`, `native_outcome`,
`ranking.eligible`, `ranking.reasons`, and `rejection.terminated_stage` /
`rejection.failed_filters`. Outcome, selection, and ranking eligibility are
distinct; absent filter evidence stays unknown. Ordered per-target names,
signed weights, and i_pDAE values remain in compact `target_scores`. The raw
engine-specific object, scalar `sequence`, and other per-attempt fields require
`--details`.

A structure path appears only when its public object currently exists. Missing paths do not establish that a model was never produced. Use `ariax results PROJECT` for artifact discovery. Candidate files are current project outputs and can change during resume or reranking; use details when that provenance distinction matters.

`meta.state` distinguishes `incomplete` (project not completed), `completed_empty` (completed project with an existing, valid zero-row source table), `missing` (completed project without its expected source table), and `available` (completed project with rows). A failed/paused project can have useful rows while remaining `incomplete`. Storage/authentication failures return errors rather than an empty success.

## Compact JSON migration

| Command | Default change | Prior shape |
| --- | --- | --- |
| BindCraft2 `status`, `validate`, `submit` | Stable compact campaign/settings fields | Add `--details` |
| BindCraft2 `candidates` | Compact rows and compact `meta`; common row notes can move to `meta.notes` | Add `--details` |
| Other-engine `candidates` and status | Released engine-specific payload remains the default | No migration required |
| `results` list/download, all protocols | User-facing paths, roles, sizes, counts, and failures | Add `--details` for hashes, manifests, journals, verification, and request IDs |
| BindCraft2 `inputs inspect` | `data.files` with targets, chains/records, selectors, scaffold evidence, and warnings | Add `--details` for `file_inspections` and manifest/build fields; add `--full` independently for complete sequences/maps |

Common BindCraft2 field moves are:

| Prior detailed field | Compact field |
| --- | --- |
| `status`, `bindcraft2_progress.stage` | `lifecycle.state`, `lifecycle.phase` |
| `bindcraft2_progress.counts.attempted` | `budget.attempts_used` |
| `bindcraft2_progress.requested`, `counts.accepted` | `designs.requested`, `designs.accepted` |
| `counts.trajectories/refolded/ranked` | `records.trajectories/refolded/ranked` |
| `bindcraft2_progress.stop_reason` | `stop.code` |
| `selection.selected`, `ranking_eligible`, `ranking_reasons` | `selected`, `ranking.eligible`, `ranking.reasons` |
| `bindcraft2.outcome`, `bindcraft2.binder_sequences` | `native_outcome`, `binder_sequences` |
| `bindcraft2.recorded_fields.terminated` | `optimization.state` and `optimization.terminated_stage`; a recorded `completed` state is not a rejection |
| `bindcraft2.recorded_fields.failed_filters` | `rejection.failed_filters` |
| `bindcraft2.aligned_positive_target_mean_i_pDAE`, `bindcraft2.target_metrics` | `target_scores.aligned_positive_target_mean_i_pDAE`, `target_scores.targets` |

`--details` changes fields, not page completeness. Use `--all` for every page or
follow `meta.next_cursor`. A default BindCraft2 `--output` export contains the
compact `{data, meta}` envelope; `--details --output` writes the prior detailed
envelope. In either mode an export is complete only after requested pagination
succeeds.

Reading is bounded to 32 MiB and 100,000 rows per CSV, at most three CSVs per request, and one page of at most 1,000 entries for each targeted source-directory discovery. Only current-page structures are verified (at most four explicit paths per row, or five BindCraft model paths). Exceeding a bound returns HTTP 413 with instructions to use the paginated artifact API and analyze the CSV locally; data is never silently truncated. Malformed/unknown identity schemas return HTTP 422. A source change between pages returns HTTP 409 `cursor_stale` (CLI exit 7); restart retrieval without the cursor. Each page rereads bounded source tables, so use artifact downloads for repeated analysis of very large campaigns.
