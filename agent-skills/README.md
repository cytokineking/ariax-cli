# Ariax agent skills

These guides ship with `ariax-cli`. Install `npm install --global ariax-cli`,
then read them with `ariax skills --read --json` or `ariax skills forge --read --json`.
The standalone `@ariaxbio/agent-skills` npm distribution is retired.

Start from the scientific goal and choose a managed project or a qualified
native Forge workflow with [engine choice](core/engine-choice.md):
`ariax skills --reference engine-choice --read --json`. Managed projects run
defined stages with engine-specific status and results. Forge gives the agent
native command planning, workspace, save and close choices while Ariax enforces
access and the resource lifecycle. Read the selected guide and live contract;
the same engine name does not imply the same settings or qualification.

Agent instructions for using the versioned Ariax REST API through the thin
`ariax-cli` package or raw `curl`. Shared routing, account access and lifecycle
essentials live in [`SKILL.md`](SKILL.md). The
[managed lifecycle](core/managed-projects.md) covers preparation, pricing,
recovery and results in detail, with
[`core/raw-curl.md`](core/raw-curl.md) as its transport fallback.

Protocol-specific scientific guidance is independently discoverable:

- [`ariax-bindcraft`](skills/ariax-bindcraft/SKILL.md)
- [`ariax-bindcraft2`](skills/ariax-bindcraft2/SKILL.md)
- [`ariax-boltzgen`](skills/ariax-boltzgen/SKILL.md)
- [`ariax-pxdesign`](skills/ariax-pxdesign/SKILL.md)
- [`ariax-esmfold2-pipeline`](skills/ariax-esmfold2-pipeline/SKILL.md)

The [Forge platform skill](skills/ariax-forge/SKILL.md) covers sessions, tool
readiness, native commands, recovery, cancellation, inputs, checkpoints,
restore, and close. Read it with `ariax skills forge --read --json` (alias
`ariax-forge`). Use `ariax forge catalog --compact --json` for routing,
then `ariax forge catalog --tool TOOL --json` for full selected-tool evidence.
Use the catalog's guide ID in `ariax skills forge --tool GUIDE_ID --json` to
find that guide's references and examples. `ariax skills forge --json` retains
the full reference and example index.

| Forge reference | Guide |
| --- | --- |
| `outputs` | [Inputs, checkpoints, and restore](skills/ariax-forge/outputs.md) |
| `base` | [Shell/Python workspace](skills/ariax-forge/tools/base.md) |
| `ipsae` | [CPU interface scoring](skills/ariax-forge/tools/ipsae.md) |
| `boltz2` | [GPU structure prediction](skills/ariax-forge/tools/boltz2.md) |
| `bindcraft2` | [Native binder design](skills/ariax-forge/tools/bindcraft2.md) |
| `chai1`, `chai1-fixtures` | [Chai-1 molecular prediction and conditioning](skills/ariax-forge/tools/chai1.md), [input inventory](skills/ariax-forge/tools/examples/chai1/README.md) |
| `freebindcraft` | [OpenMM binder design](skills/ariax-forge/tools/freebindcraft.md) |
| `catalog` | [Accepted candidate and native limits](skills/ariax-forge/references/catalog.md) |
| `boltz2-modes`, `boltz2-fixtures` | [Reviewed molecular/affinity modes](skills/ariax-forge/tools/boltz2/modes.md), [fixture provenance](skills/ariax-forge/tools/examples/boltz2/README.md) |
| `mpnn`, `proteinmpnn`, `solublempnn`, `ligandmpnn`, `abmpnn` | [Native MPNN design and scoring](skills/ariax-forge/tools/mpnn.md) |
| `mpnn-fixtures` | [MPNN input provenance and constraints](skills/ariax-forge/tools/mpnn/README.md) |
| `af2`, `af2-msa`, `af2-fixtures` | [AF2 prediction](skills/ariax-forge/tools/af2.md), [MSA choices](skills/ariax-forge/tools/af2/msa.md), [fixtures](skills/ariax-forge/tools/examples/af2/README.md) |
| `structure-tools`, `foldseek` | [Native structure preparation, analysis and Foldseek](skills/ariax-forge/tools/structure-tools.md) |
| `structure-tools-definitions`, `structure-tools-fixtures` | [Metric definitions](skills/ariax-forge/tools/structure-tools/definitions.md), [fixture provenance](skills/ariax-forge/tools/examples/structure-tools/README.md) |
| `science-checks` | [Offline scientific checks and limits](skills/ariax-forge/references/science-checks.md) |
| `rfd4`, `rfdiffusion4` | [RFd4 native co-design](skills/ariax-forge/tools/rfd4.md); check the live catalog for availability |
| `rfd4-inputs`, `rfd4-modes`, `rfd4-outputs`, `rfd4-fixtures` | [Conditioning](skills/ariax-forge/tools/rfd4/inputs.md), [modes](skills/ariax-forge/tools/rfd4/modes.md), [outputs](skills/ariax-forge/tools/rfd4/outputs.md), [examples](skills/ariax-forge/tools/examples/rfd4/README.md) |
| `rfd4-recipes`, `rfd4-search` | [Generation and evaluation](skills/ariax-forge/tools/rfd4/recipes.md), [structure-only search and continuation](skills/ariax-forge/tools/rfd4/search.md) |
| `tmol`, `tmol-fixtures` | [Protein energy scoring and Cartesian minimization](skills/ariax-forge/tools/tmol.md), [uploadable adapter](skills/ariax-forge/tools/examples/tmol/README.md); check live mode evidence |


The Forge catalog includes Chai-1, BindCraft2 v1.0.4 and Foldseek with the
selected full PDB and Swiss-Prot databases. Discovery returns each installed
guide and its example directory, including `data.examples.chai1`, `.bindcraft2`
and `.foldseek`. Read `catalog` and the tool guide for the qualified settings,
required resources and saved-output checks before selecting a recipe.

Use the selected protocol or Forge skill for configuration and lifecycle
operations. These skills drive the CLI or REST API; they are not separate
implementations of validation or orchestration.

For CLI authentication, direct the user to run `ariax login` in their own
terminal. Never ask them to paste an API key into an agent conversation or pass
one as a command-line argument.

Run `ariax skills --json` to locate shared, protocol, and platform guides in
any supported global Node installation.

Read [campaign planning](core/campaigns.md) for pilot sizes, scaling, compute
tradeoffs, and review points; read [result interpretation](core/interpretation.md)
for metric definitions, structure stages, and shortlist evidence. GPU guidance
lives in each protocol skill. These references are also available directly:

```sh
ariax skills --reference campaigns --read --json
ariax skills --reference interpretation --read --json
```

The server's live protocol catalog and schemas are authoritative. Files in
`examples/` are deliberately small starting points for discovery and must be
validated before submitting.

Licensed under the Elastic License 2.0.
