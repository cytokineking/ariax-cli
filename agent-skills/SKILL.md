---
name: ariax-agent-access
description: Prepare, validate, submit, recover, monitor, and retrieve Ariax protein-design campaigns through the CLI or versioned REST API.
---

# Ariax agent workflow

Use the `ariax` CLI. Run `ariax skills --read --json` for this guide and
`ariax skills PROTOCOL --read --json` for the matching protocol guide; the
Markdown is in `data.content`. Reference IDs are discoverable with
`ariax skills --json`; read one with
`ariax skills [PROTOCOL] --reference ID --read --json`. Read the matching
scientific guide before configuring a run:
[BindCraft](skills/ariax-bindcraft/SKILL.md),
[BindCraft2](skills/ariax-bindcraft2/SKILL.md),
[BoltzGen](skills/ariax-boltzgen/SKILL.md),
[PXDesign](skills/ariax-pxdesign/SKILL.md), or
[ESMFold2-pipeline](skills/ariax-esmfold2-pipeline/SKILL.md).
For an undecided engine, read the [engine-choice guide](core/engine-choice.md).
Read [campaign planning](core/campaigns.md) when choosing size, compute, or the
next design wave, and [result interpretation](core/interpretation.md) when
reviewing a pilot or shortlist. Both are readable through the CLI using reference
IDs `campaigns` and `interpretation`.
Use [raw REST](core/raw-curl.md) only when the CLI is unavailable.

This guide owns authentication, authorization, recovery, and transfers.
Protocol guides explain scientific settings and results. The live catalog and
schema define hosted capabilities; broader upstream options are not
automatically available through Ariax.

Affected campaign commands use compact human and JSON defaults. Begin with the
compact view and follow its `action`; add `--details` only for migration,
support, or fields the compact view intentionally omits. Unknown remains
unknown rather than becoming zero or false.

## Authorization and account

Carry forward the user's existing authorization for the campaign, including
its size, compute policy, and agreed lifecycle actions. Ask only for a material
change outside that scope. Validation starts no compute; submission and restart
can spend credits. There is no compute-quote endpoint or exact campaign spend
ceiling. Interrupting a local wait leaves remote compute running.

If authentication is missing, ask the user to run `ariax login` in their own
terminal after creating a key at <https://www.ariax.bio/settings/api-keys>.
Never request the key in conversation, print it, or put it in a command argument,
URL, or job file. Secret-manager injection through `ARIAX_API_KEY` is supported.
Submit, restart, and recovery need both `read` and `write` scopes.

```sh
ariax --version --json
ariax upgrade --check --json
ariax me --json
ariax protocols --json
ariax pricing --json
ariax schema bindcraft-v1.5 --raw -o schema.json
```

An `unpublished` upgrade status means no npm release exists; continue with the
identified GitHub build. Record the verified CLI channel and revision with
retained evidence.

## Prepare and validate

Start with a [small example](core/examples.md) and the live protocol schema.
Keep explicit user constraints exact. A request for residue A88 does not by
itself authorize a larger epitope; distinguish an exact selector from a request
to choose a region around it. Do not add `user_id` to job JSON.

```sh
ariax inputs inspect --input ./target.pdb -f job.json --json
ariax inputs prepare --input ./target.pdb -f job.json --output ./prepared --json
ariax validate -f job.json --input ./target.pdb --json
```

`inputs inspect`/`prepare` need no account. Use `--pdb 2B5I` in place of
`--input` to fetch an exact RCSB entry. Preparation writes `job.json`, an input
copy, and `input-manifest.json` with hashes and preparation provenance.
Validate and submit those saved paths; do not mix the original job with a
remapped input. Default inspection is bounded. For BindCraft2, compact
`data.files` reports filenames, roles, targets, selector validation,
authoritative chain counts and preview truncation, chain/record lengths,
scaffold edits, and scientific warnings. Add `--full` for
complete sequences and residue maps; add `--details` for manifest hashes, build
identity, and the prior diagnostic field layout. These flags are orthogonal and
can be combined. Other protocols retain their bounded chain preview, where
`residue_count` is the authoritative total and `residues_truncated` marks a
preview.

BindCraft2 multi-file preparation and authoritative nested settings are covered
by its protocol guide; use `--input-dir` for its exact bundle.

With `--input`, the CLI checks selected chains, coordinates, sequence metadata,
and protocol-specific selectors locally, then validates JSON through the API.
Without structure bytes, API validation establishes only configuration validity.
Neither validation mode proves that a remote job completed or that a binder
works experimentally. Resolve `error.details.issues` using each field path,
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
availability while meeting memory requirements. Do not narrow to one GPU model
unless the user's constraints require it. A listed price does not promise stock.

For new BindCraft, BindCraft2, BoltzGen, and ESMFold2-pipeline policies, treat
canonical `RTX6000PRO` as a primary/core supported GPU when it appears in the
live schema, not as an additional fallback. Do not confuse it with
`RTX6000ADA` or `A6000`. PXDesign excludes `RTX6000PRO`. Preserve an existing
project's saved or explicitly supplied `allowed_gpus` unless the user authorizes
a replacement policy.

Rates are USD per complete allocation-hour. Turbo hourly pricing is
`(single-GPU hourly price + $1) × GPU count`; use the API's explicit allocation
rates. Report hourly prices only. Do not estimate campaign duration or total cost.
The response includes the pricing source; identify fallback rates when returned.

## Submit and recover

Use the validated configuration and structure snapshot within the authorized
campaign scope. Uploads go directly from the CLI to private object storage.

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

The CLI journals each mutation without credentials or signed URLs. Recovery
reconciles and, when safe, replays only the retained request and idempotency key;
it never creates a replacement campaign. Follow `in_progress` with `--wait`.
A failed operation with `retryable: false` is terminal: diagnose it before any
separately authorized new attempt. Changed inputs, origin, or account block
replay. Once a project ID is known, status polling is sufficient. Legacy
`status --resume --wait` and `submit --resume` remain polling-only.

Restart preserves saved scientific settings and the saved GPU policy; send an
empty body. Only paused projects can be restarted. Failed projects require
diagnosis and support; `recover` reconciles an uncertain request and does not
restart failed compute. Scientific changes require a new project. Use pause, restart,
or abort when included in the user's authorization. Terminal project states
are `completed`, `failed`, `paused`, and `aborted`; a local timeout is not one.

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
```

Results discover protocol-specific roots; `--path` narrows discovery. Compact
listings show user-facing file paths, roles, and sizes. Compact downloads show
one destination, file statuses, and counts. Verification and resume bookkeeping
remain automatic and quiet on success; `--details` restores hashes, manifests,
checkpoints, request IDs, and other diagnostic fields.

Rerun the same download to resume completed files. JSON failures identify every
affected path with `code`, `reason`, `retryable`, and `action`. Retry transient
transfers; correct access, destination, or configuration problems first; never
use bytes after an integrity mismatch. A read failure never authorizes a new
paid submission.

Use the [candidate guide](core/candidates.md), including its compact JSON
migration table, and the engine's output reference
before interpreting a shortlist. Selection, passing filters, and ranking
eligibility have distinct meanings. Unknown eligibility stays unknown; a generic
`--eligible` filter is unsuitable for PXDesign/BoltzGen. Candidate files are
current project outputs, not immutable historical run outputs. Human candidate
tables for engines without a compact adapter retain their released fields.
BindCraft2 tables show native outcome and binder-chain count; multi-chain
sequences remain an ordered array in JSON.

Check `project.design_count_source` before treating project counts as evidence.
For BindCraft, BindCraft2, and ESMFold2, `project_counters` makes the numeric
`tested_designs`/`accepted_designs` fields meaningful. For BoltzGen/PXDesign,
`candidate_evidence` means use candidate evidence instead; `unavailable` means
no supported count source is known. The numeric fields are retained for
compatibility.

`ariax runs PROJECT --json` lists jobs with optional recorded settings; use
`--job JOB_ID` for a detail response. Recorded settings are a best-effort copy
of the accepted job configuration, captured once after acceptance. They do not
prove which settings executed or that inference completed. Missing, older, or
malformed records are reported as unavailable and never block operations.
See [recorded settings](core/recorded-settings.md).

For recorded runtime or cost, inspect every job allocation and sum its recorded
values across attempts. The latest `started_at` can describe only the newest
attempt, so check every allocation state before drawing a project-wide conclusion.

On failure, inspect status, list retained logs, read the campaign summary, and
then read the failed worker's detailed log using its returned `log_ref`. Campaign
summaries report worker outcomes; worker tracebacks explain failures. Validation
passing is not proof that runtime execution will succeed. Separate execution
failures before designs from completed designs rejected by scientific filters.
Report the exception and evidence; do not infer scientific failure from zero
completed designs. Missing retained logs do not promise future availability.

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

For scripts, follow the [safe stdout/stderr and exit-code example](core/examples.md#safe-scripted-output)
before parsing JSON. Write `ariax help COMMAND` to a separate text file; never
mix help text into a JSON capture.
