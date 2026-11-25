# Capability discovery

Find tools by task, then request only the model and mode you need:

```sh
ariax forge catalog --task binder-design --json
ariax forge catalog --tool TOOL --model MODEL --json
ariax forge catalog --tool TOOL --model MODEL --mode MODE --json
ariax forge catalog --tool TOOL --with-guide --json
```

Copy `TOOL`, `MODEL` and `GUIDE` from the compact result's `tool`, `models[].id`
and `capabilities.guide` fields. The model response lists its modes; use
those exact IDs for `MODE`. Tools without model IDs can use `--tool TOOL --mode MODE` directly.
Omit both filters only when you need the complete selected-tool record.
Filters cannot be combined with `--compact` or `--details`.

Other task filters are `antibodies`, `molecular-prediction`,
`sequence-optimization` and `validation-search`. The [tool index](capabilities/matrix.md)
compares purposes and links to usage guides.

Model-specific mode IDs appear in `models[].modes`. Modes that take no model
appear in the tool's `modes` list. Read `resources` for hardware requirements
and the linked guide for input limits.

Follow the component notices: source, weights and databases can have different
terms. Use the [file synchronization flow](../outputs.md) to save inputs and useful outputs.
