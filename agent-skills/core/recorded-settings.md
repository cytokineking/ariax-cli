# Recorded settings and configuration export

`ariax runs PROJECT --json` lists jobs with optional recorded settings; use
`--job JOB_ID` for a detail response. Recorded settings are a best-effort copy
of the accepted job configuration, captured once after acceptance. They do not
prove which settings executed or that inference completed. Missing, older, or
malformed records are reported as unavailable and never block operations.

The version-1 record uses `kind: "ariax_run_settings"` and
`capture_scope: "accepted_job_configuration"`. It contains public `settings`,
`compute_preferences`, known `input` metadata (source, filename, PDB ID, and
SHA256 when known), and optional `ariax_build`. It does not probe remote inputs,
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

Output groups and candidate tables describe mutable current project outputs.
A restart can change them; retain downloaded tables, structures and checksums
when comparing results historically.
