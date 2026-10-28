# Inspect a synthetic capability record

This fixture demonstrates separate upstream, native, installation and
restoration statuses. Its values are synthetic and do not describe a usable
scientific tool. Set `EXAMPLE` to `data.examples.capabilities` from
`ariax skills forge --tool capabilities --json`:

```sh
node "$EXAMPLE/inspect.mjs" "$EXAMPLE/catalog.json" antibodies
```

`inspect.mjs` reads a JSON `data.tools` array and selects the task supplied as
its second argument. For actual tool selection, use the scoped commands in
the [capability guide](../../capabilities.md).
