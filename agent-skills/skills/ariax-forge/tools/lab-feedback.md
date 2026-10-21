# Laboratory feedback

Use `lab-feedback` to save experimental observations beside exact protein identities,
prepare an offline Adaptyv review draft, or inspect an exchange restored in another
Forge session. This tool has no network, submission or purchase command. A saved
shortlist records the target construct and ordered chains. Requests stay in Files
until the human authorizes the actual laboratory recipient and quote.

Read [formats and limits](lab-feedback/formats.md), [the runnable example](examples/lab-feedback/README.md)
and [campaign selection guidance](../references/campaign-recipes.md). Actual catalog
qualification fields govern availability. This package contains no learned model
or named asset. Its CPU workload runs on a remote Forge GPU host. The bounded
46,310,408-byte CSV (4,069 proteins; 185,375 evaluations) passed under one CPU
and 2 GiB RAM in 17.47 seconds with 450,940 KiB maximum RSS. The measured disk
minimum is unknown. Use 4 GiB as a conservative tool-space recommendation and
allow 20 GiB for qualification/recovery staging, including environments, package
artifacts and image/archive readback. Larger exports remain unmeasured.

## Choose the path

| Input | Command | Interpretation |
| --- | --- | --- |
| Permitted ProteinBase CSV | `import-proteinbase` | Every evaluation retains method, valueType, unit, target, date and raw row identity. |
| Reviewed shortlist JSON | `draft` | Validated create/estimate request files, an identity map and unresolved gates. |
| Saved Adaptyv affinity ResultInfo, identity map and assay context | `import-adaptyv` | Exact sequence/name join; KD, kon, koff replicate observations with external result/experiment IDs. |
| Retained exchange JSON | `inspect` | Explicit consumer of saved observations; runs no inference. |

The ResultInfo parser passed its marked artificial controls. Actual private-result
compatibility and authenticated quote inspection remain conditional stages awaiting
account/data access.

ProteinBase offers an attributed public export at its [download page](https://proteinbase.com/download).
An export download supplies no claim about a public bulk REST API. Keep the original
CSV, retrieval timestamp and source/version text. Dataset download and processing
belong on the remote host. Include: “This work used Proteinbase by Adaptyv Bio under
ODC-BY license”. The full original CSV belongs in registered inputs and checkpoint
storage; the installed package ships only helper source.

## Run the installed example

Discover local installed source paths before uploading small helpers:

```sh
ariax skills forge --json
ariax skills forge --reference lab-feedback --read --json
ariax skills ariax-forge --reference lab-feedback-formats --read --json
ariax forge catalog --details --json
```

Set `EXAMPLES` to discovery's `data.examples["lab-feedback"]`. Create a session
using the user's approved GPU/time allowance and live hardware choices, selecting
`lab-feedback`. Wait for session `available` and tool `ready`:

```sh
ariax forge tools wait "$SESSION" lab-feedback --timeout 600 --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/prepare.py" --path lab-feedback/prepare.py --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/check.py" --path lab-feedback/check.py --json
ariax forge inputs add "$SESSION" --url https://storage.proteinbase.com/proteinbase_latest.csv --path lab-feedback/proteinbase.csv --json
ariax forge inputs list "$SESSION" --json
ariax forge inputs status "$SESSION" "$INPUT" --json
```

Wait on each returned input ID. Capture the actual export retrieval timestamp in
`EXPORT_VERSION` and generate a UUID for `IMPORT_ID` before submitting. Reuse that
ID with identical source/version/bytes after an uncertain reply. Each command
returns its own durable command ID; watch it and read its exit status before
starting the dependent command:

```sh
ariax forge run "$SESSION" --tool lab-feedback --timeout-seconds 300 --json -- lab-feedback import-proteinbase --csv /inputs/lab-feedback/proteinbase.csv --source https://storage.proteinbase.com/proteinbase_latest.csv --version "$EXPORT_VERSION" --request-id "$IMPORT_ID" --ledger /workspace/lab-feedback/exchange.json
ariax forge watch "$SESSION" "$COMMAND" --timeout 600 --json
ariax forge run "$SESSION" --tool lab-feedback --timeout-seconds 60 --json -- python3 /inputs/lab-feedback/prepare.py --csv /inputs/lab-feedback/proteinbase.csv --out /workspace/lab-feedback/public-review
ariax forge run "$SESSION" --tool lab-feedback --timeout-seconds 60 --json -- lab-feedback draft --shortlist /workspace/lab-feedback/public-review/shortlist.json --out /workspace/lab-feedback/drafts
ariax forge run "$SESSION" --tool lab-feedback --timeout-seconds 300 --json -- lab-feedback inspect --ledger /workspace/lab-feedback/exchange.json --out /workspace/lab-feedback/observations.json
```

The public review example chooses two exported single-chain BLI records sharing a
target slug. It supplies a bounded software example with pending target/construct
review. Its affinity concentration series is explicitly nM. Candidate provenance
retains the complete original public rows. No candidate is transmitted to a lab.
The generated `controls.csv` contains artificial importer controls; use its own
source/version labels when exercising errors, and retain that distinction.

A draft directory is named by the shortlist's request UUID. `draft.json` retains
the shortlist, create/estimate bodies, chain/name mapping, currency-unit rules and
gates. A changed draft under that UUID fails. Requests explicitly set
`skip_draft=false` and `auto_accept_quote=false`. Binding requires an actual target
catalog UUID and 24 distinct sequences or a lab arrangement. Draft validation
checks the selected SDK's common request subset; live service feasibility remains
pending. Quotes use their stated currency and smallest currency unit, while cost
estimates report USD cents. Preserve material/assay costs, fees, discounts, pricing
version, expiration and terms when a quote becomes available. Lab fees have their
own authorization and budget.

## Read outcomes and continue later

`exchange.json` retains original import payloads and direct request-ID comparison.
`exchange-review.json` carries all observations with source row/evaluation indices.
`missing_units` blocks quantitative interpretation of dimensional metrics;
`measurements_differ` identifies a group for assay review. A differing replicate
remains an observation. Same-valued replicates at distinct source indices survive.
Repeated source coordinates are marked `duplicate_source_observation`; conflicting
source values or sequences carry separate flags. This tool performs no averaging
or unit conversion. Preserve unsuccessful, nonbinding, unavailable and fit-failed
outcomes alongside measured values.

Stop writers and checkpoint the original inputs, ledger, draft, identity map and
raw/result files before closing. Store the checkpoint/session/project IDs with the
review. Download/export through Files on a remote host:

```sh
ariax forge sync "$SESSION" --wait --json
ariax forge files "$SESSION" --path /workspace/lab-feedback --checkpoint "$CHECKPOINT" --json
ariax forge download "$SESSION" /workspace/lab-feedback/exchange.json --checkpoint "$CHECKPOINT" --dest "$REMOTE_EXPORT_DIR/exchange.json" --json
ariax forge create --name "Lab result review" --gpu "$GPU" --tools lab-feedback --restore-session "$SESSION" --checkpoint "$CHECKPOINT" --max-gpu-hours "$GPU_HOURS" --json
```

Use the returned new session ID, wait for restore/tool readiness, then run `inspect`
on the saved ledger. A later result import uses its own persisted import UUID and
saved identity map. Read original IDs after uncertain commands. This workflow
resumes from saved results through explicit commands.

Selected source: [adaptyv-sdk 0.1.0 at cdf2078](https://github.com/adaptyvbio/adaptyv-sdk/tree/cdf207819ed5a58e0c127453626d2bce125c8064), MIT;
[ProteinBase](https://proteinbase.com/download), ODC-BY. The [API alignment change](https://github.com/adaptyvbio/adaptyv-sdk/pull/2)
fixes quote/submit separation and pagination. Current official API documentation
adds optional payment/webhook fields absent from that revision; this tool uses the
common offline subset. Authenticated quote access and actual lab-result import
remain external gates. See formats for scientific limits and supported constructs.
