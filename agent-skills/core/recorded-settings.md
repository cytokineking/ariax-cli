# Recorded settings and configuration export

Use `ariax runs` to inspect accepted job settings, or export a reusable job
configuration:

```sh
ariax runs PROJECT --json
ariax runs PROJECT --job JOB_ID --json
ariax projects export PROJECT --output job.json
```

Run records contain accepted settings and available input/engine metadata.
Older jobs can report settings as unavailable. Use job status and results to
inspect execution; the current default engine cannot identify an older run.

Export writes the public `job_spec` to the output file and reports metadata on
stdout. It preserves saved settings, including historical property spellings
and explicit advanced controls. It does not download inputs. Keep original
target structures, MSAs, scaffold files and preparation outputs separately.
PXDesign regenerates its MSA; fetching an RCSB identifier again can return
changed source data.

To reuse an export, review the live schema, prepare its required inputs and
validate before submitting. `ariax submit` creates a new billable campaign
with the server-selected engine. `ariax restart` continues a paused campaign
with its compatible recorded engine and existing scientific settings.

Candidate tables and outputs describe current project state. Download the
tables and structures you need before continuation or reranking changes them.
