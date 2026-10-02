# Ariax agent skills

Agent instructions for using the versioned Ariax REST API through the thin
`ariax-cli` package or raw `curl`. Shared authentication, lifecycle, recovery,
and result-retrieval behavior lives in [`SKILL.md`](SKILL.md), with
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
`ariax-forge`). `ariax skills forge --json` returns its reference paths and
`data.examples`, including the example root and each tool's directory.

| Forge reference | Guide |
| --- | --- |
| `outputs` | [Inputs, checkpoints, and restore](skills/ariax-forge/outputs.md) |
| `base` | [Shell/Python workspace](skills/ariax-forge/tools/base.md) |
| `ipsae` | [CPU interface scoring](skills/ariax-forge/tools/ipsae.md) |
| `boltz2` | [GPU structure prediction](skills/ariax-forge/tools/boltz2.md) |

Read a reference with `ariax skills forge --reference NAME --read --json`.
Small [native examples](skills/ariax-forge/tools/examples/README.md) ship with
the package. Image builds/publication and native GPU qualification remain
pending; live catalog metadata and tool readiness establish availability.

Use the matching protocol skill to choose and configure a design engine, then
use the shared workflow for credentials and lifecycle operations. These skills
drive the CLI or REST API; they are not separate implementations of protocol
validation or orchestration.

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
