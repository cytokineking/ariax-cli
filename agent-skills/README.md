# Ariax agent guides

These guides ship with `ariax-cli`. Install the CLI with
`npm install --global ariax-cli`, then read the shared entry point:

```sh
ariax discover --query "<goal>" --json
ariax skills --read --json
ariax skills install --target all --dry-run
```

Use [engine choice](core/engine-choice.md) to select a managed protocol or
Forge. Read the selected guide and its live schema or catalog entry in one call:

```sh
ariax skills PROTOCOL --read --json
ariax skills forge --read --json
# Read one Forge tool guide (or combine with live catalog via --with-guide):
ariax skills forge --tool GUIDE --read --json
ariax forge catalog --tool TOOL --with-guide --json
```

Managed protocol guides cover [BindCraft](skills/ariax-bindcraft/SKILL.md),
[BindCraft2](skills/ariax-bindcraft2/SKILL.md), [BoltzGen](skills/ariax-boltzgen/SKILL.md),
[PXDesign](skills/ariax-pxdesign/SKILL.md) and
[ESMFold2-pipeline](skills/ariax-esmfold2-pipeline/SKILL.md).
[Forge discovery](skills/ariax-forge/tools/capabilities.md) explains how to find
native tools and their guide IDs.

For VHH generation, `ariax skills forge --tool rfd4-antibody --json` locates the
[RFd4 antibody guide](skills/ariax-forge/tools/rfd4-antibody.md) and its fixture.

Use [managed lifecycle](core/managed-projects.md) for preparation, pricing,
recovery and results; [campaign planning](core/campaigns.md) for sizing and
scaling; [feedback and triage](core/feedback.md) for reporting bugs or CLI
friction; and [interpretation](core/interpretation.md) for result metrics.
[Raw REST examples](core/raw-curl.md) are available when the CLI cannot be used.
Starter files in `examples/` must be validated against the live protocol schema
before submission.

Licensed under the Elastic License 2.0.
