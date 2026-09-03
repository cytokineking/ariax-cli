# Candidate tables and shortlist export

Read [result interpretation](interpretation.md) for confidence scores, structure
stages, pose agreement, and scientific shortlist review. Use [campaign planning](campaigns.md)
when deciding whether the observed yield warrants another design wave.

`ariax candidates PROJECT` retrieves one page of typed rows from current project outputs. It starts no compute. Use `--json` to retain metrics, filter outcomes, source hashes, and explanations; human output is a compact index.

```bash
ariax candidates PROJECT --view final --json
ariax candidates PROJECT --view all --all --output candidates.json --json
ariax candidates PROJECT --view diagnostics --all --output diagnostics.json --json
```

`final` and `all` are available for all four engines. For BindCraft, `all` aliases `final` and returns only retained accepted designs; use `diagnostics` for trajectories. Complete attempted-sequence statistics are not retained. `diagnostics` means BindCraft trajectories or ESMFold2 ranking diagnostics and is unsupported for PXDesign/BoltzGen. `--limit` is page size (1–50, default 25). `--all` traverses every page; otherwise use `meta.next_cursor` with `--cursor`. `--output` writes a JSON envelope atomically; an existing regular file requires `--overwrite`. Failed pagination does not publish a partial export.

Each row has a stable `id` derived from project ID, engine, and native identity; `native_id`; native rank; sequence; `selection`; named `metrics` with numeric value, unit, and direction; source-reported `filters`; nullable `ranking_eligible` with reasons; verified public structure paths; and source path, content SHA256, ETag, byte size, and adapter version. The source SHA is a hash of the CSV bytes, not a model version or a structure checksum. Adapter version `1` is the interpretation version; a producer version is not inferred from absent metadata. Unknown columns are not interpreted, missing/nonfinite numeric values remain null, and unrecognized boolean values remain null. `producer_scaled_pae` retains a producer's scaled PAE values; it must not be treated as angstroms or mixed with unscaled PAE.

`--eligible` retains **only explicit true** eligibility. Unknown is not false: the export reports excluded false/unknown counts and exclusion reasons. This filter is generally unsuitable as a generic PXDesign or BoltzGen shortlist filter because those producers do not export a universal ranking-eligibility flag. Inspect their native pass flags and selection separately.

A structure path is returned only when its public object currently exists. Missing paths do not establish that a model was never produced; files may still be syncing, archived, unavailable, or absent from the final copied subset. Use `ariax results PROJECT` for artifact discovery and downloads. All candidate responses declare `provenance_scope: project_outputs`: artifacts may change during resume/reranking, and this endpoint does not attribute current files to a historical job.

`meta.state` distinguishes `incomplete` (project not completed), `completed_empty` (completed project with an existing, valid zero-row source table), `missing` (completed project without its expected source table), and `available` (completed project with rows). A failed/paused project can have useful rows while remaining `incomplete`. Storage/authentication failures return errors rather than an empty success.

Reading is bounded to 32 MiB and 100,000 rows per CSV, at most three CSVs per request, and one page of at most 1,000 entries for each targeted source-directory discovery. Only current-page structures are verified (at most four explicit paths per row, or five BindCraft model paths). Exceeding a bound returns HTTP 413 with instructions to use the paginated artifact API and analyze the CSV locally; data is never silently truncated. Malformed/unknown identity schemas return HTTP 422. A source change between pages returns HTTP 409 `cursor_stale` (CLI exit 7); restart retrieval without the cursor. Each page rereads bounded source tables, so use artifact downloads for repeated analysis of very large campaigns.
