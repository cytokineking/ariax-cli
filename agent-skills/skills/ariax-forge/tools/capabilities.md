# Capability discovery

Find tools by task, then request only the model and mode you need:

```sh
ariax forge catalog --task binder-design --compact --json
ariax forge catalog --tool TOOL --model MODEL --json
ariax forge catalog --tool TOOL --model MODEL --mode MODE --json
ariax skills forge --tool GUIDE --json
ariax skills forge --reference GUIDE --read --json
```

Copy `TOOL`, `MODEL` and `GUIDE` from the compact result's `tool`, `models[].id`
and `capabilities.guide` fields. The model response lists its modes; use
those exact IDs for `MODE`. Tools without model IDs can use `--tool TOOL --mode MODE` directly.
Omit both filters only when you need the complete selected-tool record.
Filters cannot be combined with `--compact` or `--details`.

Other task filters are `antibodies`, `molecular-prediction`,
`sequence-optimization` and `validation-search`. The [tool index](capabilities/matrix.md)
compares purposes and links to usage guides.

Use `capabilities.modes` for model and mode IDs and `resources` for hardware
requirements. A mode marked `held` should not be used. A `documented` mode
covers the workload limits in the linked guide. For `unconfirmed` modes, support
is unknown. Wait for
the tool and inputs to be ready before running a command.

Follow the component notices: source, weights and databases can have different
terms. Use the [file synchronization flow](../outputs.md) to save inputs and useful outputs.
