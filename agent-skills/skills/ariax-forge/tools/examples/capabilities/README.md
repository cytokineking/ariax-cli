# Inspect a synthetic capability record

This example shows how to find a model and mode by task. It uses fictional tool IDs. Set `EXAMPLE` to `data.examples.capabilities` from
`ariax skills forge --tool capabilities --json`:

```sh
node "$EXAMPLE/inspect.mjs" "$EXAMPLE/catalog.json" antibodies
```

`inspect.mjs` reads a JSON `data.tools` array and selects the task supplied as
its second argument. For actual tool selection, use the scoped commands in
the [capability guide](../../capabilities.md).
