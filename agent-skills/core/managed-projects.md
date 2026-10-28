# Managed project lifecycle

Use this reference with the selected managed protocol guide and live schema.
For the initial choice between a managed project and Forge, see
[engine choice](engine-choice.md); for shared account access, see the
[agent workflow](../SKILL.md).

Discover the live contract and current prices before configuring a project:

```sh
ariax protocols --json
ariax pricing --json
ariax schema PROTOCOL --raw -o schema.json
```

Start with compact output and follow its `action`. Add `--details` when you
need omitted diagnostic or provenance fields.

## Prepare and validate

Start with a [small example](examples.md) and the live protocol schema.
Keep explicit user constraints exact. A request for residue A88 does not by
itself authorize a larger epitope; distinguish an exact selector from a request
to choose a region around it. Do not add `user_id` to job JSON.

```sh
ariax inputs inspect --input ./target.pdb -f job.json --json
ariax inputs prepare --input ./target.pdb -f job.json --output ./prepared --json
ariax validate -f job.json --input ./target.pdb --json
```

`inputs inspect`/`prepare` need no account. Use `--pdb 2B5I` instead of
`--input` to fetch an RCSB entry. Preparation writes `job.json`, an input copy
and a preparation manifest. Validate and submit the saved paths together;
do not mix the original job with a remapped input.

Inspection previews sequences and residues. Use reported totals rather than
counting preview rows; add `--full` for complete sequences and residue maps.
For BindCraft2, `data.files` reports the input bundle, selectors, scaffold
edits and warnings. Add `--details` for preparation diagnostics; it can be
combined with `--full`.

BindCraft2 multi-file preparation and authoritative nested settings are covered
by its protocol guide; use `--input-dir` for its exact bundle.

With `--input`, the CLI checks selected chains, coordinates, sequence metadata,
and protocol-specific selectors locally, then validates JSON through the API.
Structure-backed BoltzGen requires `--input` for both `validate` and `submit`.
For other protocols that allow validation without structure bytes, API validation
establishes only configuration validity.
Resolve `error.details.issues` using each field path,
rule, and constraint; do not weaken an explicit requirement to silence an error.

| Protocol | Residue register |
| --- | --- |
| BindCraft | PDB author chain/residue IDs; PDB input required |
| BindCraft2 | Native structure chain/residue selectors; first target is `input.pdb` or `input.cif` |
| BoltzGen | Canonical 1-based positions; mmCIF uses absolute label IDs |
| PXDesign | PDB author IDs; direct mmCIF requires matching selected author/label IDs |
| ESMFold2-pipeline | Author residue IDs; supported chain remapping updates the prepared copy |

Request a missing structure first and inspect its sequence metadata before
requesting a separate sequence. Ask for the full sequence only when it cannot
be reconstructed safely from the supplied file.

For unresolved sequence information, supply the exact full sequence in
`sequence_by_chain` (PXDesign) or `protocol_config.target.sequences`
(ESMFold2). JSON/noninteractive mode never prompts. Do not invent missing
residues or translate numbering by guesswork. PXDesign rejects gapped PDBs
whose full sequence would be lost by its converter; use compatible canonical
mmCIF for those targets. PXDesign does not reject numbering differences confined to unselected mmCIF chains.

## Check prices and choose GPUs

Run `ariax pricing --json` when choosing or changing GPU preferences. Use the
returned hourly rates and the live protocol schema to select a range of
compatible GPU models within the user's hourly price preferences, maximizing
availability while meeting memory requirements. A single compatible core GPU
class is valid but reduces availability; a listed price does not promise stock.
`allowed_gpus` names alternatives for one
allocation, not a GPU count. `priority_mode` ranks those alternatives; only
explicit Turbo settings request multiple GPUs.

Every effective policy must include at least one compatible core GPU:

| Protocol | Core GPU identifiers |
| --- | --- |
| BindCraft / FreeBindCraft, BindCraft2, BoltzGen | `H100`, `A100_80GB`, `L40`, `L40S`, `RTX6000PRO` |
| PXDesign | `H100`, `A100_80GB`, `L40`, `L40S` |
| ESMFold2-pipeline | `H100`, `A100_80GB`, `RTX6000PRO` |

`A100_40GB`, `A6000`, `H200`, `B200`, and other supported classes may be
supplemental; alone they do not meet this rule. `RTX6000PRO` is distinct from
`RTX6000ADA` and `A6000`; PXDesign excludes it. The live schema and server
validation still decide full protocol compatibility. Select as many compatible
classes as the user's memory and hourly budget permit. Preserve explicitly
supplied or saved policies unless a replacement is authorized. If no core class
fits those constraints, explain the conflict; never add an undersized or
unauthorized GPU just to pass validation. Correct an invalid saved policy with
`ariax gpu-preferences` before restart.

Rates are USD per complete allocation-hour. Turbo hourly pricing is
`single-GPU hourly price × GPU count`; use the API's explicit allocation
rates; do not multiply a complete allocation rate by GPU count again. Use
[observed campaign evidence](campaigns.md#forecast-from-observed-work) for
qualified runtime and cost forecasts.
The response includes the pricing source; identify fallback rates when returned.

`data.rates[].hourly_rate` is the current CLI price for the complete GPU allocation.
Use `standard_hourly_rate` for comparison and `promotion` metadata for the offer
label, active flag, and dates. The server selects the price and handles expiry.
Read `quote_is_binding` and `rate_lock_event` before estimating cost; recheck
prices for a new allocation or restart. Existing allocations retain their
recorded rate. Launching through the website or an unmarked API client can
change eligibility.

## Submit and recover

Use the validated configuration and structure snapshot within the authorized
campaign scope.

```sh
ariax submit -f job.json --input ./target.pdb --name my-project --wait
```

If a response is lost or a wait is interrupted:

```sh
ariax operations --json
ariax recover OPERATION_ID --wait
# Once a project ID is known, polling alone is also sufficient:
ariax status PROJECT_ID --wait
```

If a direct input upload succeeds but local operation journaling fails, the CLI
reports the upload intent ID and confirms project creation was not sent. Keep
the original job and input bytes, account, API origin, and project name; select
a writable `--root-dir` and retry with `--input-upload-intent-id ID` before
the intent expires. No operation ID is returned, so `ariax recover` does not
apply. If the intent expires, resolve the reservation before considering a new
upload within the existing campaign authorization.

Recovery reconciles the original request and safely retries it when needed
without creating a replacement campaign. Follow `in_progress` with `--wait`.
A failed operation with `retryable: false` is terminal: diagnose it before any
separately authorized new attempt. Changed inputs, origin, or account block
replay. Once a project ID is known, status polling is sufficient.

Restart preserves saved scientific settings and the saved GPU policy. Only
paused projects can be restarted. Failed projects require diagnosis and support; `recover` reconciles an uncertain request and does not
restart failed compute. Scientific changes require a new project. Use pause, restart,
or abort when included in the user's authorization. Terminal project states
are `completed`, `failed`, `paused`, and `aborted`; a local timeout is not one.
Follow the [provisioning and failure guidance](#provisioning-and-job-failures)
before choosing a retry or seeking support.

Use `ariax gpu-preferences PROJECT_ID -f preferences.json` to replace the saved
GPU policy when the campaign authorization includes that change. The file needs
`priority_mode` and `allowed_gpus`, with optional `turbo_mode` and
`turbo_multiples`. It affects the next provisioning attempt; active allocations
are unchanged. Restart uses the saved policy.

## Export settings

`ariax projects export PROJECT --output job.json` saves public saved settings.
Export is read-only and does not inspect or download stored inputs. Private
storage and runtime MSA paths are omitted. Retain original custom PDB/mmCIF
targets and any user-supplied MSA or scaffold files; prepare and upload required
inputs, review the settings, then use normal `ariax submit` for a new authorized
billable project. PXDesign regenerates its MSA. RCSB identifiers are retained,
but fetching them again may return changed source data.

## Results and errors

```sh
ariax jobs --project PROJECT_ID --json
ariax logs JOB_ID --list
ariax logs JOB_ID --tail 200
ariax logs JOB_ID --log-ref logs/design_workers/WORKER.log --tail 200
ariax runs PROJECT_ID --json
ariax runs PROJECT_ID --job JOB_ID --json
ariax candidates PROJECT_ID --view final --json
ariax results PROJECT_ID --json
ariax results PROJECT_ID --download ./results
ariax results PROJECT_ID --path output/provenance.json --download ./results --details --json
ariax results PROJECT_ID --path output/Trajectory --download ./results
```

Results default to protocol-specific output roots. `--path` selects an exact
artifact or all files beneath a directory, without glob or partial-prefix
matching. The provenance example saves `./results/output/provenance.json`.
Listings show file paths, roles and sizes; downloads report destinations and
file outcomes. Add `--details` for diagnostic and provenance fields. Downloads
check available checksums automatically.

Rerun the same download to resume completed files. JSON failures identify every
affected path with `code`, `reason`, `retryable`, and `action`. Retry transient
transfers; correct access, destination, or configuration problems first; never
use bytes after an integrity mismatch. A read failure never authorizes a new
paid submission.

Use the [candidate guide](candidates.md) and the engine's output reference
before interpreting a shortlist. Selection, passing filters, and ranking
eligibility have distinct meanings. Unknown eligibility stays unknown; a generic
`--eligible` filter is unsuitable for PXDesign/BoltzGen. Candidate files describe current project outputs and can change on continuation.
BindCraft2 tables show native outcome and binder-chain count; multi-chain
sequences remain an ordered array in JSON.

Check `project.design_count_source` before treating project counts as evidence.
For BindCraft, BindCraft2, and ESMFold2, `project_counters` makes the numeric
`tested_designs`/`accepted_designs` fields meaningful. For BoltzGen/PXDesign,
`candidate_evidence` means use candidate evidence instead; `unavailable` means
no supported count source is known.

Use `ariax runs PROJECT --json` for accepted job settings, adding `--job JOB_ID`
for one job. Older jobs can report settings as unavailable. See
[recorded settings and export](recorded-settings.md).

For recorded runtime, cost, and forecasts, follow
[campaign forecasting](campaigns.md#forecast-from-observed-work).

Logs are retained project/campaign compute artifacts; restarts can reuse the
same object. They are not isolated job transcripts or platform logs. A truncated
tail is not the whole run; request a larger bounded `--tail` (up to 5000) before
making a run-wide claim. Interpret
each engine's metrics within its own scoring and filtering workflow, and keep
computational acceptance separate from experimental binding.

Open a project at `https://www.ariax.bio/projects/<engine>/<id>`. Engine route
segments are `bindcraft`, `bindcraft2`, `boltzgen`, `pxdesign`, and `esmfold2-pipeline`.

Use `--json` for scripts: stdout is data, stderr is progress. Exit codes are
`0` success, `1` usage, `2` authentication, `3` authorization, `4` not found,
`5` validation, `6` payment, `7` conflict, `8` rate limit, `9` network/timeout,
`10` server failure, and `130` interruption. Do not turn a transport failure
into a new spending attempt.

For scripts, follow the [safe stdout/stderr and exit-code example](examples.md#safe-scripted-output)
before parsing JSON. Write `ariax help COMMAND` to a separate text file; never
mix help text into a JSON capture.

## Provisioning and job failures

Use public status, returned actions, and retained campaign logs. Do not expose
internal provisioning diagnostics, seek platform/provider access, or guess a
provider failure from a generic status. Follow explicit user instructions and
server retry guidance; the defaults below do not expand spending authorization.

| Public evidence | Action |
| --- | --- |
| Provisioning or compute is still in progress | Poll the same project. Do not submit a duplicate, restart a running project, or change scientific settings to address unexplained provisioning delays. |
| Public status clearly identifies a restartable provisioning pause | Within existing restart authorization, make at most one delayed retry on the same project. If it recurs, seek support instead of looping restarts. A generic pause alone does not establish a provisioning failure. |
| GPU choices are narrow | Suggest broadening to compatible classes within authorized memory and hourly limits, retaining at least one core GPU. Preserve the saved policy unless its replacement is authorized; broader choices do not guarantee availability. |
| Submission or restart outcome is uncertain | Use [operation recovery](#submit-and-recover). Reconcile the existing request before considering a replacement campaign. |
| A requested stop or cleanup is unconfirmed, or allocation/status evidence conflicts | Continue read-only status checks and seek support. A local timeout or interrupted wait does not confirm remote compute stopped. |
| Execution failed | Inspect status, discover retained logs, read the campaign summary, then the failed worker's returned `log_ref`. Diagnose a supported input or scientific correction before proposing new paid compute; missing evidence is not a diagnosis. Failed projects cannot be restarted. |
| Workflow completed with zero accepted designs | Review scientific outcomes using [campaign planning](campaigns.md#decide-the-next-wave-from-evidence). This is not automatically a platform incident or authorization to relaunch. |

Campaign summaries report worker outcomes; retained worker tracebacks may
explain execution failures. Validation passing is not proof of runtime success.
Distinguish failure before designs were produced from completed designs rejected
by filters. Report only what the evidence supports. Missing retained logs do
not promise future availability.

### Seek technical support

Recommend support@ariax.bio for repeated provisioning
problems after the bounded retry, failures with missing logs or no supported
correction, inconsistent public status/results/allocation evidence, or an
unconfirmed stop. Prepare a short summary with available project/job IDs,
request/operation IDs, CLI version/revision, the command and public error,
expected versus observed behavior, and actions already tried. Missing fields
should not delay seeking help. Exclude credentials, signed URLs, unnecessary
inputs, and bulk log dumps.

Recommend emailing that summary; send it only if the user explicitly asks.
Do not claim a support ticket was created or promise a response time.

To record project-linked feedback and obtain an ID to include in a support
email, follow [agent feedback](feedback.md). The same command accepts
feature requests and other project-related observations.
