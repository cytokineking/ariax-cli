# Offline scientific checks

Discover installed helper paths and examples with `ariax skills forge --json`.
The helpers are readable references and ordinary local Python files:

| Reference ID | Purpose | Dependencies |
| --- | --- | --- |
| `freebindcraft-preflight` | Selected PDB author register, hotspots, family/count settings | Python standard library |
| `ipsae-preflight` | AF2/AF3/standard-protein Boltz2 structure/confidence correspondence | Python 3.10+ and NumPy |
| `boltz2-affinity-check` | Native affinity filename, finite values, probability range and ensemble completeness | Python standard library |

`data.examples.science` locates the synthetic examples; it is separate from
the original live-qualified tool fixtures. Set `CHECKS` to that directory and
set each helper variable to its absolute path in `data.references`:

```sh
python3 "$FBC_PREFLIGHT" --settings "$CHECKS/freebindcraft/target.json" --pdb "$CHECKS/freebindcraft/target.pdb" --family miniprotein
python3 "$IPSAE_PREFLIGHT" "$CHECKS/af3/handoff.json"
python3 "$IPSAE_PREFLIGHT" "$CHECKS/boltz2/handoff.json"
python3 "$AFFINITY_CHECK" "$CHECKS/affinity/affinity_affinity.json" --record-id affinity
```

All examples are synthetic. FreeBindCraft and ipSAE files were adapted from
archive `d8c0b040f553bf9e51a532cb4db693529f50cc70` under
`evaluation/forge-skills/ariax-forge-{freebindcraft,ipsae}/cases/raw/`.
The new handoff records preserve biological/sample identity and units.
AF3 full-data identity arrays describe
the synthetic atom/residue order. Affinity YAML and JSON illustrate format
and the -3 log10(IC50 in µM) to pIC50 9 conversion; no prediction produced them.

For actual ipSAE work, fill the handoff record from the original predictor
metadata and supply the untouched same-sample files. `input_id` and `run_id`
are recorded labels, not an attestation. The helper checks consistency and
cannot identify a same-shaped PAE substituted from another run. AF3/Boltz2
filenames must encode the recorded sample; conservative parser restrictions
are documented in [ipSAE inputs](ipsae-inputs.md).

Checks are read-only and return nonzero on rejection. A successful check
establishes the stated format constraints, with no GPU work or binding claim.
Helpers can also be staged under `/inputs` and invoked with a ready tool that
has their dependencies; stage every companion file at its recorded relative
path. Native ipSAE writes alongside the structure, so score a copy under a
fresh writable workspace directory after validation.

Maintainers run `python3 test/forge-science-checks.py` from the CLI checkout.
It obtains paths through the actual CLI discovery API and exercises valid and
invalid inputs through the helper command lines. The optional
`--ipsae-script /path/to/current/vendored/ipsae.py` also executes native v3 on
the two synthetic handoffs and checks directional scores and file completeness.
It never downloads dependencies or starts inference. NumPy is needed for the
ipSAE cases. Installed-package tests additionally exercise the standard-library
helpers and all reference reads without adding a CLI runtime dependency.

A real AF3 handoff and a remote Boltz2-to-ipSAE handoff still need same-sample
native outputs, original chain/token metadata and a deployed-image scoring
run. The linear-peptide, affinity, advanced Boltz2 and broader BindCraft2
recipes retain source-reviewed status until representative GPU evidence is
recorded. The B12 qualification of the original examples remains unchanged.
