# Bundled Forge examples

These small inputs, scripts and checkers accompany the Forge tool guides.
Base, ipSAE and Boltz2 use synthetic fixtures. BindCraft2 and FreeBindCraft use
the PD-L1 example target with one bounded design trajectory per tool:
BindCraft2 requests 31 binder
residues and FreeBindCraft requests 80. No generated binder is supplied.
These files do not establish prediction quality or successful binder design.

For a known tool, use its guide ID to discover only its references and examples:

```sh
ariax skills forge --tool boltz2 --json
ariax skills forge --reference boltz2 --read --json
ariax skills forge --reference boltz2-fixtures --read --json
```

Set `EXAMPLE` to the returned absolute `data.examples.boltz2` directory and
use paths such as `$EXAMPLE/complex.yaml`; do not append another `boltz2/`.
Substitute the selected guide and example key for another tool. The
`ariax-forge` alias works for discovery and reads. Scoped discovery omits
`data.examples.root`; use `ariax skills forge --json` only when the complete
reference/example inventory is needed.

| Example key | References to read |
| --- | --- |
| `base`, `ipsae`, `bindcraft2`, `freebindcraft` | The matching tool guide |
| `boltz2` | `boltz2`, `boltz2-modes`, `boltz2-fixtures` |
| `mpnn` (also individual MPNN tool aliases) | `mpnn`, `mpnn-fixtures`; PDB/plan files live beside the guide |
| `af2` | `af2`, `af2-msa`, `af2-fixtures` |
| `structure-tools`, `foldseek` | `structure-tools`, `structure-tools-definitions`, `structure-tools-fixtures` |

Boltz2's examples include molecular prediction, affinity and a SEP cyclic
peptide. The MSE-to-MET identity failure and unselected custom MSA service
remain unsupported by those examples. Read the live catalog for the exact
model/mode's current support, workload and resource limits; bundled inputs
do not establish support for broader workloads or hardware.

The base and ipSAE programs/checkers need Python; native ipSAE also needs
NumPy and is supplied by its image. The Boltz2 output checker needs the
image's NumPy and Gemmi packages. The BindCraft2 checker uses its image's
Biotite reader and NumPy; the FreeBindCraft checker uses its image's Gemmi.

Stage every input used by the chosen command through `forge inputs add`,
require ready inputs and invoke native argv in the selected image. The agent
chooses the executable, options or explicit shell. Settings contain absolute
container input/output paths, so update them when changing staged locations
or choosing a fresh output root. Use the actual checker and matching native
version from the tool guide. GPU execution and scientific interpretation
remain distinct gates.

Follow the [shared lifecycle](../../SKILL.md) for command monitoring, recovery,
billing and closure, and [checkpoint instructions](../../outputs.md) to save
outputs. Run scientific helpers and native commands on the authorized remote
VM with the required image dependencies.

The separate [`science/`](science/) directory contains synthetic preflight and
mapping cases plus a toy affinity output. Locate it with `data.examples.science`
in the complete index and read [scientific checks](../../references/science-checks.md)
through reference `science-checks`. These cases establish format constraints
only and make no prediction or experimental claim.
