---
name: ariax-agent-access
description: Route scientific work to managed Ariax projects or Forge, and use shared account and lifecycle guidance.
---

# Ariax agent workflow

First identify the scientific goal and choose the execution model. A **managed
project** runs a defined protocol: Ariax provisions compute, runs the stages,
reports engine-specific progress and results, persists artifacts, and cleans
up. Choose it when the live schema supports the experiment. **Forge** provides
a workspace for explicit native commands and composed workflows: you plan
commands, inputs, output checks, saves, and session closure; Ariax enforces
access, isolation, billing, and the resource lifecycle. A shared engine name
does not make their settings, versions, or qualification interchangeable.
Read [engine choice](core/engine-choice.md) first:

```sh
ariax skills --reference engine-choice --read --json
```

For a managed project, read the selected protocol guide and
[managed lifecycle](core/managed-projects.md):

```sh
ariax skills PROTOCOL --read --json
ariax skills --reference managed-projects --read --json
```

For Forge, read the [Forge guide](skills/ariax-forge/SKILL.md), then discover
and inspect the exact live tool, model and mode before choosing native commands.
Only read input or output references when they affect the current decision; read
output guidance before running when it changes required stages or saved files.

## Authorization and account

If authentication is missing, ask the user to run `ariax login` in their own
terminal after creating a key at <https://www.ariax.bio/settings/api-keys>.
Never request the key in conversation, print it, or put it in a command argument,
URL, or job file. Secret-manager injection through `ARIAX_API_KEY` is supported.
If an authenticated command reports a rejected API key, follow its
`error.action`: ask the user to run `ariax login` in their own terminal with a
new key, or update `ARIAX_API_KEY` in their secret manager if that override is
in use. Wait for them to finish before rerunning the command.
Submit, restart, and recovery need both `read` and `write` scopes.

```sh
ariax --version --json
ariax upgrade --check --json
ariax me --json
```

An `unpublished` upgrade status means no npm release exists; continue with the
identified GitHub build. Record the verified CLI channel and revision with
retained evidence. Preserve the user's existing compute authorization, explicit
scientific constraints and saved preferences; a material change outside that
scope needs authorization.

For scripts, `--json` keeps data on stdout and progress on stderr. Preserve the
CLI exit code before parsing output; see the [safe shell example](core/examples.md#safe-scripted-output).

## Prepare and validate

For a managed project, select the live protocol schema, prepare the inputs and
validate the saved configuration before submission. The
[managed lifecycle](core/managed-projects.md#prepare-and-validate) explains
input provenance, numbering and protocol-specific preparation. A valid request
is not evidence of a completed run or experimental binding.

## Check prices and choose GPUs

Check `ariax pricing --json` for the selected allocation before spending. Compare
compatible resources against the user's requirements, budget, deadline and
available evidence. The [managed GPU policy](core/managed-projects.md#check-prices-and-choose-gpus)
and [Forge guide](skills/ariax-forge/SKILL.md#discover-plan-run-and-close)
explain their different allocation models.

## Submit and recover

Use the authorized configuration. If a managed submission or restart response
is uncertain, inspect `ariax operations` and reconcile the original operation
with `ariax recover`; do not start a replacement while its outcome is unknown.
A local wait or interruption does not stop remote work. See
[managed recovery](core/managed-projects.md#submit-and-recover) for the full
request and upload rules and [Forge recovery](skills/ariax-forge/SKILL.md#recover-a-lost-response)
for session and command IDs.

## Export settings

See [managed settings export](core/managed-projects.md#export-settings) for
what is saved and which inputs must be retained separately.

## Results and errors

Inspect status, logs, results and the selected engine's output guidance before
interpreting candidates. Scientific acceptance is not proof of experimental
binding. See [managed results](core/managed-projects.md#results-and-errors)
for counts, downloads and error behavior, and
[interpretation](core/interpretation.md) for evidence and metrics.

## Provisioning and job failures

Inspect the same project and retained public evidence before retrying; an
uncertain response, failed download, local timeout, or zero accepted designs
never authorizes duplicate paid work. Follow the
[managed failure and support guidance](core/managed-projects.md#provisioning-and-job-failures).

### Seek technical support

Use the [support guidance](core/managed-projects.md#seek-technical-support) for
inconsistent evidence, unconfirmed cleanup, or failures without a supported
correction. Send a support message only when explicitly requested.

## Forge persistence and close

Preparation and idle time consume the Forge GPU-hour allowance; successful
commands do not close a session. Complete and inspect a checkpoint for useful
workspace files, explicitly close the session when work is done, and verify
resource release and persistence separately. Follow the
[Forge lifecycle](skills/ariax-forge/SKILL.md#discover-plan-run-and-close)
within the user's existing authorization.
