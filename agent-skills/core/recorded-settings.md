# Recorded settings and configuration export

`ariax runs PROJECT --json` lists jobs with optional recorded settings; use
`--job JOB_ID` for a detail response. Recorded settings are a best-effort copy
of the accepted job configuration, captured once after acceptance. They do not
prove which settings executed or that inference completed. Missing, older, or
malformed records are reported as unavailable and never block operations.

The version-1 record uses `kind: "ariax_run_settings"` and
`capture_scope: "accepted_job_configuration"`. It contains public `settings`,
`compute_preferences`, known `input` metadata, and optional `ariax_build`.
Legacy records contain source, filename, PDB ID, and SHA256. BindCraft2 records
can instead contain a `files` map with each bundle filename, byte count, and
SHA256. It does not probe remote inputs,
loaded models, or execution environments. Preserve local preparation manifests
and input bytes separately. Run-list `provenance_status` is `recorded` or
`unavailable`; recording is optional and a missing history table does not hide jobs.

`ariax projects export PROJECT --output job.json` saves public saved settings.
Export is read-only and does not inspect or download stored inputs. Private
storage and runtime MSA paths are omitted. Retain original custom PDB/mmCIF
targets and any user-supplied MSA or scaffold files; prepare and upload required
inputs, review the settings, then use normal `ariax submit` for a new authorized
billable project. PXDesign regenerates its MSA. RCSB identifiers are retained,
but fetching them again may return changed source data.

For BindCraft2, optional `engine_version`, `source_commit`, and
`source_tree_sha256` metadata describe the recorded engine when supplied on a
public provenance surface. The source-tree hash identifies the immutable
generation; missing historical metadata stays unknown. The live schema's
`native_capabilities` describes the active default for new campaigns and cannot
fill gaps in an old record. Client settings cannot choose runtime artifacts.

The CLI writes the config API's public `job_spec` verbatim, retaining explicit
`advanced.confidence_floor`, `advanced.mutate_gate_draws`, and historical
property spellings supplied by the server. It does not insert v1.0.4 defaults,
canonicalize a saved campaign, or migrate its checkpoint. Retain the JSON
response separately when export provenance is needed; `--output` writes only
the reusable job spec, while stdout includes the server's export metadata.
`ariax restart` requests continuation with the campaign's compatible engine and
existing scientific settings. Reusing exported JSON with `ariax submit` starts
a new campaign, whose accepted settings and server-selected engine can differ.
Review the live schema and normalized validation response before submitting;
the server decides compatibility before compute allocation.

Output groups and candidate tables describe mutable current project outputs.
A restart can change them; retain downloaded tables, structures and checksums
when comparing results historically.
