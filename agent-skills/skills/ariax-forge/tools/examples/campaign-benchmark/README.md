# Saved campaign benchmark example

Locate this directory with `ariax skills forge --tool campaign-benchmark --json`
at `data.examples['campaign-benchmark']`. Read the
[primary guide](../../campaign-benchmark.md) and
[methods](../../campaign-benchmark/methods.md) for remote Forge commands,
denominators and limitations.

| File | Purpose |
| --- | --- |
| `plan.json` | Two exact minibinders and one paired antibody, their chain sequences, QC/search cutoffs and source revisions. The required legacy `accepted_b70_heads` fields are already populated. |
| `benchmark.py` | `prepare` checks the original manifest, shortlist, scores and run records and stages four chain queries; `report` reads saved files to write 11 JSON/TSV table pairs plus `report.json` and `report.md`. Python standard library only. |
| `qc.py` | Checks exact native chain sequences and finite complete N/CA/C/O coverage. Run remotely in `design-qc` with Gemmi 0.7.3. |
| `search.py` | Runs one complete-snapshot CUDA `easy-search`; saves the native log, resource record, operation elapsed time and command ID. |
| `results.py` | Joins saved QC/search records and optional sanitized quote, resource and timing records. |
| `report-files.json` | Lists the 24 report output paths. |

Register the five executable/plan inputs under `/inputs/campaign-benchmark/`
and observe each import ID until ready. Installed source paths and remote
input paths are distinct. Every helper runs on the authorized remote host.

Under `/workspace/benchmark/`, supply `campaign-delivery/campaign.json` with
all referenced original files and `campaign-shortlists/shortlists.json`.
The guide creates `prepared/`, `new/qc/`, `new/search/`, `results.json` and
`report/` there. The `--campaign` and `--shortlists` arguments can name other
relative locations; the benchmark root must contain every saved dependency.
No scientific outputs or experimental observations are bundled here.

To inspect saved results or optionally regenerate reports after a
[same-project resume](../../../outputs.md), retain the original campaign files,
prepared selection/queries, QC/search outputs and any measurement sources.
`report.json` lists the complete input closure by relative path and size.
Choose a fresh report output directory. Report generation rereads those saved
files and preserves failed/rejected outcomes; it does not run new generation,
prediction, QC or search.
