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
| `bindcraft2-pilot.json` | Two-design / 20-trajectory miniprotein pilot | User-supplied `input.pdb` |
| `bindcraft2-formats/*.json` | Ten BC2 native formats, secondary FASTA, and custom scaffold recipes | User-supplied exact bundle files |
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
prepares every structure-backed example; the platform validation script checks
both original and prepared jobs against runtime and raw schemas.
Use `ariax inputs inspect`/`prepare` to resolve the RCSB entry locally before
validating its prepared upload. A target example is not an assertion of binding
site accessibility or expected activity.

## BindCraft2 explicit settings

The cyclic-peptide recipe keeps its explicit `[8, 14]` length range; upstream
v1.0.4's `[7, 20]` default does not replace a supplied range. The templates
omit `confidence_floor` and `mutate_gate_draws` so that native defaults remain
in effect. When the live schema and `native_capabilities.advanced_controls`
support both fields, merge explicit choices into `protocol_config.advanced`,
for example `"confidence_floor": 0.7` and `"mutate_gate_draws": 2`.
The latter chooses the lowest weighted-loss draw from two fresh mutate-gate
predictions, increasing work without averaging scores.

Use canonical `hard_target` and `large_complex` properties for new v1.0.4
submissions when listed by the live capabilities. Keep historical exported
`initial_guess`/`bigbang` spellings until the server normalizes a new submission.
For custom scaffold edits, `A50-55(5-8)` can resize an editable span, while
`A50-55!` holds the existing span and cannot resize it. Check these illustrative
positions against the actual scaffold. See the
[BindCraft2 guide](../skills/ariax-bindcraft2/SKILL.md) for capability gating and
the distinction between continuation and a new campaign.

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
