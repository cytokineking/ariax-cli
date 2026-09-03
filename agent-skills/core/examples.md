# Small examples and fixtures

The JSON files in [examples](../examples/) cover each hosted modality. They use
one candidate/accepted design for configuration checks, not production advice.
The synthetic CA-only target files exercise parsers and selectors; **do not
launch scientific campaigns against them**. Replace target, epitope, sequence,
counts, and compute policy for the authorized experiment, then validate.

| Example | Mode | Input |
| --- | --- | --- |
| `bindcraft-v1.5.json` | Miniprotein, FreeBindCraft scoring | Synthetic PDB |
| `bindcraft-peptide.json` | Linear alpha-helical peptide | Synthetic PDB |
| `bindcraft-override.json` | Explicit known cross-family presets | Synthetic PDB |
| `boltzgen.json` | Miniprotein | Synthetic canonical mmCIF |
| `boltzgen-peptide.json`, `boltzgen-cyclic-peptide.json` | Linear / cyclic peptide | Synthetic canonical mmCIF |
| `boltzgen-helicon.json`, `boltzgen-vhh.json` | Installed staple / scaffold recipe | Synthetic canonical mmCIF |
| `boltzgen-miniprotein-small-molecule.json` | CCD target | No structure upload |
| `boltzgen-small-molecule-smiles.json` | SMILES target | No structure upload |
| `pxdesign.json` | Cropped target with a retained hotspot | Synthetic PDB |
| `pxdesign-multichain-cif.json` | Multichain/full-sequence target | Synthetic canonical mmCIF |
| `esmfold2-pipeline.json`, `esmfold2-vhh.json`, `esmfold2-scfv.json` | Three hosted modalities | Synthetic canonical mmCIF |
| `esmfold2-rcsb.json` | Real 2B5I chain A, author residue 88 | RCSB source; JSON validation alone does not inspect the entry |

`examples/cases.json` binds each job to its intended input. The CLI test suite
prepares every structure-backed example; the platform qualification script
validates both original and prepared jobs against runtime and raw schemas.
Use `ariax inputs inspect`/`prepare` to resolve the RCSB entry locally before
validating its prepared upload. A target example is not an assertion of binding
site accessibility or expected activity.

## Safe scripted output

Capture stdout, stderr, and the original CLI status before invoking a JSON
parser. Keep human help in a different file:

```sh
if ariax protocols --json >protocols.json 2>protocols.stderr; then
  cli_exit=0
else
  cli_exit=$?
fi
printf '%s\n' "$cli_exit" >protocols.exit

if [ "$cli_exit" -eq 0 ]; then
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' protocols.json
fi

ariax help protocols >protocols-help.txt 2>protocols-help.stderr
```

Use the same capture pattern for authorized `submit` or `recover` commands; do
not pipe their stdout directly into a parser whose exit status could hide the
CLI status.

For an exact raw schema file, use
`ariax schema PROTOCOL --raw -o schema.json`. The normal JSON response wraps
the same schema at `.data.json_schema`.
