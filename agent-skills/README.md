# Ariax agent guides

These guides ship with `ariax-cli`. Install the CLI with
`npm install --global ariax-cli`, then read the shared entry point:

```sh
ariax skills --read --json
```

Use [engine choice](core/engine-choice.md) to select a managed protocol or
Forge. Read the selected guide and its live schema or catalog entry:

```sh
ariax skills PROTOCOL --read --json
ariax skills forge --read --json
# Locate only one native tool's references and examples:
ariax skills forge --tool GUIDE --json
ariax skills forge --reference GUIDE --read --json
```

Managed protocol guides cover [BindCraft](skills/ariax-bindcraft/SKILL.md),
[BindCraft2](skills/ariax-bindcraft2/SKILL.md), [BoltzGen](skills/ariax-boltzgen/SKILL.md),
[PXDesign](skills/ariax-pxdesign/SKILL.md) and
[ESMFold2-pipeline](skills/ariax-esmfold2-pipeline/SKILL.md).
[Forge discovery](skills/ariax-forge/tools/capabilities.md) explains how to find
native tools and their guide IDs.

Use [managed lifecycle](core/managed-projects.md) for preparation, pricing,
recovery and results; [campaign planning](core/campaigns.md) for sizing and
scaling; and [interpretation](core/interpretation.md) for result metrics.
[Raw REST examples](core/raw-curl.md) are available when the CLI cannot be used.
Starter files in `examples/` must be validated against the live protocol schema
before submission.

Licensed under the Elastic License 2.0.
