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

Check the selected model/mode's `qualification` rows for workload limits and
`resources` for hardware requirements. Held, untested or unknown modes are not
available choices; missing resource minima are unknown. Read the selected
guide for inputs and commands, and wait for its tool and inputs to be ready.

Follow the component notices: source, weights and databases can have different
terms. Use the [checkpoint flow](../outputs.md) to save inputs and useful outputs.
