# Scientific preflight and output checks

Discover installed helper paths and examples with `ariax skills forge --json`.
The helpers are readable references and packaged Python source. Stage them
and their companion inputs, then execute on an authorized remote GPU VM in
a ready Forge tool with the required dependencies. The workstation storage
policy also applies to these scientific checks.

| Reference ID | Purpose | Dependencies |
| --- | --- | --- |
| `freebindcraft-preflight` | Selected PDB author register, hotspots, family/count settings | Python standard library |
| `ipsae-preflight` | AF2/standard-protein Boltz2 structure/confidence correspondence | Python 3.10+ and NumPy |
| `boltz2-affinity-check` | Native affinity filename, finite values, probability range and ensemble completeness | Python standard library |

`data.examples.science` locates the synthetic examples; it is separate from
the original live-qualified tool fixtures. Set `CHECKS` to that directory and
set each helper variable to its absolute path in `data.references` for upload.
Preserve each case's relative sidecar paths under `/inputs/science`. After the
helper and every companion file are ready, run:

```sh
ariax forge run "$SESSION" --tool base -- python3 /inputs/science/freebindcraft-preflight.py --settings /inputs/science/freebindcraft/target.json --pdb /inputs/science/freebindcraft/target.pdb --family miniprotein
ariax forge run "$SESSION" --tool ipsae -- python3 /inputs/science/ipsae-preflight.py /inputs/science/boltz2/handoff.json
ariax forge run "$SESSION" --tool base -- python3 /inputs/science/boltz2-affinity-check.py /inputs/science/affinity/affinity_affinity.json --record-id affinity
```

All examples are synthetic. FreeBindCraft and ipSAE files were adapted from
archive `d8c0b040f553bf9e51a532cb4db693529f50cc70` under
`evaluation/forge-skills/ariax-forge-{freebindcraft,ipsae}/cases/raw/`.
The new handoff records preserve biological/sample identity and units.
Affinity YAML and JSON illustrate format
and the -3 log10(IC50 in µM) to pIC50 9 conversion; no prediction produced them.

For actual ipSAE work, fill the handoff record from the original predictor
metadata and supply the untouched same-sample files. `input_id` and `run_id`
are recorded labels, not an attestation. The helper checks consistency and
cannot identify a same-shaped PAE substituted from another run. Boltz2
filenames must encode the recorded sample; conservative parser restrictions
are documented in [ipSAE inputs](ipsae-inputs.md).

Checks are read-only and return nonzero on rejection. A successful check
establishes the stated format constraints, with no GPU work or binding claim.
Stage every companion file at its recorded relative path. Native ipSAE writes
alongside the structure, so score a copy under a
fresh writable workspace directory after validation.

For authorized maintenance, run `python3 test/forge-science-checks.py` from
the CLI checkout on the remote VM.
It obtains paths through the actual CLI discovery API and exercises valid and
invalid inputs through the helper command lines. The optional
`--ipsae-script /path/to/current/vendored/ipsae.py` also executes native v3 on
the synthetic Boltz2 handoff and checks directional scores and file completeness.
It never downloads dependencies or starts inference. NumPy is needed for the
ipSAE cases. Installed-package tests additionally exercise the standard-library
helpers and all reference reads without adding a CLI runtime dependency.

Synthetic checks establish format constraints only. AF3 input is unsupported. B35 retains actual AF2/Boltz/RF3/
Protenix consumers; read its guide for admitted mappings. B33's twelve bounded
Boltz2 cases and B44's rejected BindCraft2 outcomes retain their native evidence
and explicit failed/unreached stages. They do not qualify broader campaigns.
The B12 qualification of the original examples remains unchanged.
