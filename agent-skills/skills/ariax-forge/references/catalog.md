# Choose Forge tools

Read with `ariax skills forge --reference catalog --read --json`. Start with
the experiment's required inputs and outputs; use the
[tool index](../tools/capabilities/matrix.md) for individual usage guides.

| Need | Selection guide |
| --- | --- |
| Generate a binder or conditioned design | [Design tools](../tools/capabilities/matrix.md#design): compare modality, design mechanism, fixed regions, chemistry and required downstream stages. |
| Predict a defined structure or complex | [Prediction tools](../tools/capabilities/matrix.md#prediction): match molecule types, MSA/template needs, restraints and checkpoint choice. |
| Redesign or score sequences | [Sequence tools](../tools/capabilities/matrix.md#sequence-optimization): distinguish backbone-conditioned design, sequence likelihood and learned stability estimates. |
| Assess, search or compare existing candidates | [Validation and search](../tools/capabilities/matrix.md#validation-and-search): choose confidence, geometry, energy, reference comparison or database search for the actual question. |
| Compose stages or incorporate experimental results | [Campaign and workspace guides](../tools/capabilities/matrix.md#campaigns-and-workspace): preserve candidate identity, native rejection and explicit review points. |

Discover current account-visible choices with
`ariax forge catalog --task TASK --compact --json`, then fetch
`ariax forge catalog --tool TOOL --model MODEL --json` for that model's modes
and resources. Copy model IDs from the compact result, and add `--mode MODE`
for a listed mode. Omit `--model` for tools without model IDs. Use
`capabilities.guide` with
`ariax skills forge --tool GUIDE --json` to locate the guide, relevant references
and examples. [Capability discovery](../tools/capabilities.md) explains the
fields and limits. Packaged documentation does not establish live availability;
held, untested and unknown modes are not supported choices.

Check `ariax pricing --json` and workload-specific resource requirements before
allocating compute. Null resource minima remain unknown. A managed protocol's
settings and native Forge scope are separate; compare
[execution models](../../../core/engine-choice.md) when either might fit.

Require ready tools and inputs, inspect native output and rejection records,
then use the [checkpoint and restore flow](../outputs.md) before closing compute.
After a lost acknowledgment, reconcile the original command/session ID through
the [Forge lifecycle](../SKILL.md#recover-a-lost-response). For a human pause,
follow [project controls](../SKILL.md#project-controls-and-resume); approval
clears the hold and an explicit subsequent command resumes work.
