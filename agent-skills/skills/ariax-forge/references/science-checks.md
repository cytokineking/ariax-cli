# Scientific preflight and output checks

Use these helpers to check prepared targets or saved prediction files before
design, scoring or result interpretation. They check the constraints below;
they do not run prediction or establish binding. Discover each helper through
its tool-scoped response:

```sh
ariax skills forge --tool freebindcraft --json
ariax skills forge --tool ipsae --json
ariax skills forge --tool boltz2 --json
```

| Guide | Key in `data.references` | Purpose | Dependencies |
| --- | --- | --- | --- |
| `freebindcraft` | `freebindcraft-preflight` | Selected PDB author register, hotspots, family lengths and accepted-design count | Python standard library |
| `ipsae` | `ipsae-preflight` | AF2/standard-protein Boltz2 structure/confidence correspondence | Python 3.10+ and NumPy |
| `boltz2` | `boltz2-affinity-check` | Native affinity filename, finite values, probability range and two-head ensemble completeness | Python standard library |

Set `FBC_PREFLIGHT`, `IPSAE_PREFLIGHT` and `AFFINITY_CHECK` to the absolute
paths at `data.references["freebindcraft-preflight"]`,
`data.references["ipsae-preflight"]` and
`data.references["boltz2-affinity-check"]` in their respective responses.
Stage the helper and its companion inputs, then execute on an authorized
remote GPU VM in a ready Forge tool with the listed dependencies. Follow the
[Forge lifecycle](../SKILL.md) for session authorization, input readiness,
command monitoring and closure.

## Synthetic examples

Set `FORGE_SKILL` to the `data.skill` path from any scoped response above.
The synthetic examples live beside that installed skill under
`tools/examples/science`. Stage every sidecar at its recorded relative path:

```sh
SCIENCE="$(dirname "$FORGE_SKILL")/tools/examples/science"
ariax forge inputs add "$SESSION" --file "$FBC_PREFLIGHT" --path science/freebindcraft-preflight.py --json
ariax forge inputs add "$SESSION" --file "$IPSAE_PREFLIGHT" --path science/ipsae-preflight.py --json
ariax forge inputs add "$SESSION" --file "$AFFINITY_CHECK" --path science/boltz2-affinity-check.py --json
for SCIENCE_FILE in freebindcraft/target.json freebindcraft/target.pdb boltz2/handoff.json boltz2/toy_model_0.cif boltz2/pae_toy_model_0.npz boltz2/plddt_toy_model_0.npz boltz2/confidence_toy_model_0.json affinity/affinity_affinity.json; do
  ariax forge inputs add "$SESSION" --file "$SCIENCE/$SCIENCE_FILE" --path "science/$SCIENCE_FILE" --json
done
ariax forge inputs list "$SESSION" --json
```

Record each input ID and require every input ready. With `base` and `ipsae`
ready in `SESSION`, run the checks and monitor each returned command ID to
its terminal state:

```sh
ariax forge run "$SESSION" --tool base --json -- python3 /inputs/science/freebindcraft-preflight.py --settings /inputs/science/freebindcraft/target.json --pdb /inputs/science/freebindcraft/target.pdb --family miniprotein
ariax forge run "$SESSION" --tool ipsae --json -- python3 /inputs/science/ipsae-preflight.py /inputs/science/boltz2/handoff.json
ariax forge run "$SESSION" --tool base --json -- python3 /inputs/science/boltz2-affinity-check.py /inputs/science/affinity/affinity_affinity.json --record-id affinity
```

These files are synthetic format examples. No prediction produced the
affinity YAML or JSON; they illustrate the -3 log10(IC50 in µM) to pIC50 9
conversion. A successful check establishes the stated format constraints,
without demonstrating prediction quality.

## Use with actual results

For actual ipSAE work, fill the handoff record from the original predictor
metadata and supply the untouched same-sample files. `input_id` and `run_id`
are recorded labels, not an attestation. The helper checks consistency and
cannot identify a same-shaped PAE substituted from another run. Boltz2
filenames must encode the recorded sample; conservative parser restrictions
are documented in [ipSAE inputs](ipsae-inputs.md).

Checks are read-only and return nonzero on rejection. A successful check
does not prove common origin or complete scientific validation. The
FreeBindCraft helper does not validate advanced/filter JSON or atomic
completeness; read [target preparation](freebindcraft-inputs.md). The affinity
helper requires all six native aggregate/component values, but cannot verify
the originating chemistry or run; read [affinity interpretation](boltz2-affinity.md).
The ipSAE helper accepts only its AF2 and standard-protein Boltz2 mappings;
AF3, other predictors and mixed/modified entities require a separate adapter.
Native ipSAE writes alongside the structure, so score a copy under a fresh
writable workspace directory after checking the handoff.
