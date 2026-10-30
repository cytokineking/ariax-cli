# Tmol protein scoring and Cartesian minimization

Tmol evaluates a Rosetta-like all-atom energy function and can minimize selected
Cartesian coordinates. Use it for a defined canonical-protein structure when
weighted energy terms, an interaction contribution, or a bounded local
minimization are useful. Its energies are model-dependent scores, not measured
binding affinities, Kd, or calibrated physical energies. A score alone does not
establish folding, binding, or experimental activity. For predicted-complex
confidence or other analysis, consider [interface scoring](ipsae.md),
[structure tools](structure-tools.md), and independently qualified prediction.

The standalone `tmol` tool uses Tmol 0.2.0 from
[source commit 33fd3e9eed8b497638d8a7bf32955dcde0c181fd](https://github.com/uw-ipd/tmol/tree/33fd3e9eed8b497638d8a7bf32955dcde0c181fd).
It uses no model bundle. Score, interface and minimization have separate,
bounded qualification records. A guide or an image alone does not establish
readiness. Check the live catalog for actual
availability, status and measured resource scope; unknown minima are not zero.

```sh
ariax forge catalog --compact --tool tmol --json
ariax forge catalog --tool tmol --json
ariax skills forge --tool tmol --json
ariax skills forge --reference tmol --read --json
```

The first interface is the single uploadable [Python adapter](examples/tmol/run.py),
not a native `tmol` executable. The [example inventory](examples/tmol/README.md)
identifies its installed path. Upstream also documents
[packing](https://github.com/uw-ipd/tmol/blob/33fd3e9eed8b497638d8a7bf32955dcde0c181fd/docs/workflows/packing.md),
[FastRelax](https://github.com/uw-ipd/tmol/blob/33fd3e9eed8b497638d8a7bf32955dcde0c181fd/docs/user_guide/optimization.md),
[ligands](https://github.com/uw-ipd/tmol/blob/33fd3e9eed8b497638d8a7bf32955dcde0c181fd/docs/user_guide/ligands.md),
and [nucleic acids](https://github.com/uw-ipd/tmol/blob/33fd3e9eed8b497638d8a7bf32955dcde0c181fd/docs/workflows/nucleic_acids.md).
Those modes are outside this adapter's qualified scope.

## Input and preparation

Supply an uncompressed PDB or mmCIF, an explicit one-based model index, and each
included **author chain ID**. Resolve alternate locations first. Selected chains
must contain standard protein residues with complete, finite heavy atoms and
unique chain, residue number, insertion code, residue name and atom name. Unknown
residues, waters, ligands, nucleic acids, unsupported elements, ambiguous
identities, missing heavy atoms and nonfinite coordinates are rejected. The
input-reader check rejects changes to stated nonzero formal charges; pose
preparation is checked for lost input bonds. Noncanonical
inter-residue bonds are rejected; peptide and cysteine disulfide connections are
allowed. This narrow contract is not general structure repair. Input chains not
selected are excluded. Alternate locations anywhere in the selected model must
be resolved before submission.

Tmol prepares a new pose before scoring. The adapter sets `no_optH=True`, disables
ligand preparation, uses pH 7.4 for inferred protonation and fixes the preparation
seed; Tmol can add hydrogens or
rebuild coincident hydrogens and infer connections, termini and protonation from
the input and its parameters. Supplied heavy-atom coordinates and identities are
checked, but do not assume that preparation preserves every original hydrogen or
chemical state. Review residue types, inter-residue bonds, atom mapping and the
prepared CIF. This is **fixed prepared-coordinate** interface scoring: it performs
no further packing or minimization, and is not a separate bound/unbound free-energy
calculation. See the versioned [I/O](https://github.com/uw-ipd/tmol/blob/33fd3e9eed8b497638d8a7bf32955dcde0c181fd/docs/workflows/structure_io.md),
[scoring](https://github.com/uw-ipd/tmol/blob/33fd3e9eed8b497638d8a7bf32955dcde0c181fd/docs/user_guide/scoring.md)
and [interface](https://github.com/uw-ipd/tmol/blob/33fd3e9eed8b497638d8a7bf32955dcde0c181fd/docs/workflows/protein_interfaces.md) documentation.

## Stage and run

After selecting an authorized session, add the tool and wait for readiness. Set
`EXAMPLES` to the installed Tmol examples directory returned by scoped skill
discovery and `PROTEIN` to the user's local structure. This example assumes PDB
model 1 and chain A; replace them with the intended input and selection.

```sh
ariax forge tools add "$SESSION" --tools tmol --priority tmol --json
ariax forge tools wait "$SESSION" tmol --timeout 1800 --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/run.py" --path tmol/run.py --json
ariax forge inputs add "$SESSION" --file "$PROTEIN" --path tmol/protein.pdb --json
ariax forge inputs status "$SESSION" ADAPTER_INPUT_ID --json
ariax forge inputs status "$SESSION" PROTEIN_INPUT_ID --json
```

Wait for both returned IDs to be ready. Preserve the input's actual extension;
use `protein.cif` in the staging path and command for mmCIF. Choose a fresh
output directory for each experiment:

Bound numerical-library threads to stay within the session's process allowance;
temporary caches use the image's `/scratch` settings.

```sh
ariax forge run "$SESSION" --tool tmol --gpus 0 --timeout-seconds 600 -- \
  env OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 \
  python /inputs/tmol/run.py score --input /inputs/tmol/protein.pdb \
  --model 1 --chain A --device cuda:0 --out-dir /workspace/tmol/score-001
```

For a two-chain complex, upload a complete canonical-protein PDB/mmCIF and use
explicit, nonempty, disjoint partner chains. Repeat `--chain`, `--partner-a` or
`--partner-b` to include multiple chains in a set. Chains may be selected without
being assigned to a partner; they remain in the prepared pose but do not enter
the cross-partner sum.

```sh
ariax forge run "$SESSION" --tool tmol --gpus 0 --timeout-seconds 600 -- \
  env OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 \
  python /inputs/tmol/run.py interface-score --input /inputs/tmol/complex.cif \
  --model 1 --chain A --chain B --partner-a A --partner-b B \
  --device cuda:0 --out-dir /workspace/tmol/interface-001
```

For local Cartesian minimization, identify movable atoms from a prior prepared
mapping. Specify **every** movable atom as `CHAIN:RESID:ICODE:ATOM`, using `_`
for a blank insertion code. All other atoms are fixed. This example moves two
atoms; choose the actual intended atoms and consider geometry before interpreting
the result. The maximum iteration count is bounded to 1–200 (default 20), not a
convergence guarantee.

```sh
ariax forge run "$SESSION" --tool tmol --gpus 0 --timeout-seconds 600 -- \
  env OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 \
  python /inputs/tmol/run.py minimize --input /inputs/tmol/protein.pdb \
  --model 1 --chain A --move-atom A:5:_:CA --move-atom A:5:_:CB \
  --max-iter 20 --device cuda:0 --out-dir /workspace/tmol/minimize-001
```

The adapter rejects absent or duplicate atom selections, an increased objective
outside numerical tolerance, nonfinite results, identity loss and fixed-atom
movement. Inspect geometry and the before/after score; minimization is a local
optimization, not evidence of biological stability.

## Inspect and retain

Each successful output directory contains a copy of the original input,
`prepared.cif`, and `scores.json`; minimization also writes `minimized.cif`.
The JSON records input SHA-256, model and chains, selected partner or movable
atoms, author-to-prepared-to-pose atom mapping, residue types and inter-residue
bonds, score-function weights, weighted terms, total, device and package versions.
Check that these match the intended structure and chemistry. Coordinate
preparation and Tmol's `beta2016` weighted energy affect every comparison. The
interface value is a sum of weighted cross-partner terms, with both stored
orientations included by the Tmol API, not an affinity or dissociation constant.

Observe the returned command ID with `ariax forge watch` and inspect its logs;
a lost reply or watch timeout does not justify rerunning the science. After all
writers finish, use `ariax forge sync "$SESSION" --wait --json`, inspect the
current saved project files, and restore only for a new explicit command
as described in the [platform guide](../SKILL.md) and [outputs guide](../outputs.md).
Follow the session's normal close/status procedure.

Tmol's code is [Apache-2.0](https://github.com/uw-ipd/tmol/blob/33fd3e9eed8b497638d8a7bf32955dcde0c181fd/LICENSE).
Retain the upstream and component notices supplied with the runtime, including
attribution for the [Dunbrack rotamer library](https://dunbrack.fccc.edu/lab/bbdep2010).
