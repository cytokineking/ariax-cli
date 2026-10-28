---
name: ariax-agent-access
description: Choose managed Ariax projects or Forge and follow shared account, spending, and recovery guidance.
---

# Ariax agent workflow

Use a **managed project** for a supported protocol with automatic execution,
artifact storage and cleanup. Use **Forge** for native commands or a custom
workflow; you manage command order, saved files and session closure. Read
[engine choice](core/engine-choice.md) when selecting the workflow.

Read only the selected protocol or platform guide and references needed for
the current task:

```sh
ariax skills PROTOCOL --read --json
ariax skills --reference managed-projects --read --json
# For native commands and custom workflows:
ariax skills forge --read --json
```

Managed and Forge settings can differ for the same engine. Use the live
protocol schema or the selected Forge tool/model/mode to configure work.

## Account access

Check `ariax me --json`. If authentication is missing or rejected, ask the user
to run `ariax login` in their terminal with a key from
<https://www.ariax.bio/settings/api-keys>. Never request or print the key or put
it in command arguments, URLs or job files. If `ARIAX_API_KEY` supplies the key,
the user must update that secret-manager override. Mutations require both
`read` and `write` scopes.

Use `--json` for scripts; data goes to stdout and progress to stderr. Preserve
the exit code before parsing output; see the [shell example](core/examples.md#safe-scripted-output).

## Run and recover

- Keep the user's scientific constraints and existing compute authorization.
  Check `ariax pricing --json` before choosing an allocation.
- For managed jobs, prepare inputs and validate the saved configuration before
  submission. Follow [managed lifecycle](core/managed-projects.md) for GPU
  selection, submission, recovery and results.
- After an uncertain managed submission, use `ariax operations` and
  `ariax recover OPERATION_ID`. For Forge, reconcile the original
  [session or command ID](skills/ariax-forge/SKILL.md#recover-a-lost-response).
  A local interruption does not stop remote work; resolve the existing request
  before starting replacement work.
- Forge preparation and idle time are billed. Checkpoint useful files,
  explicitly close the session when done, and check that closure and saving
  completed. See the [Forge lifecycle](skills/ariax-forge/SKILL.md).

Read the selected engine's output guide and [metric interpretation](core/interpretation.md)
when reviewing candidates. Use [campaign planning](core/campaigns.md) to size or
extend a campaign and [failure guidance](core/managed-projects.md#provisioning-and-job-failures)
to diagnose problems. Send support messages only when explicitly requested.
