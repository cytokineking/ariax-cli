# Absolute-stability examples

Copied from absolute-stability-predictor commit
`c55db530f67dcaefb083954750af66212e4da76b`, under the adjacent MIT LICENSE.
This directory contains structures and their license, without model outputs.

- `stability_1998469.pdb`: upstream MGnify stability domain, author chain A,
  60 residues. `stability_1998469.cif` is a Gemmi 0.7.3 conversion of the same
  coordinates and author residue IDs. Use this pair for native PDB/CIF
  agreement and full single-point scanning. Each scan evaluates 20 × 60
  substitutions per checkpoint. Batch size 1 is the default; the supported
  mutation batch sizes are 1 through 4.
- `nanobody_1zvh.cif`: upstream Boltz-predicted 1ZVH nanobody, author chain A,
  125 residues. Use as a second real CIF construct for delta G.
- `Trka_binder_AF2_10.pdb`: upstream AF2-predicted TrkA complex. Author chain A
  is binder, B is target. The README identifies this as an experimentally
  tested binder. Use it to exercise the complex command; its example scores
  establish neither a pass threshold nor new experimental evidence.

The adapter normalizes only selected protein chains to a scratch CIF, in
requested order, as native A/B with sequential residue indices. Saved results
map every position back to author chain, number and insertion code. Input
coordinates are retained through CIF; upstream SaProt separately isolated
chains use its temporary PDB preparation. Resolve alternate conformations,
noncanonical protein residues and multiple structural models explicitly first.

Locate this directory with `ariax skills forge --tool absolute-stability --json`
and read `data.examples["absolute-stability"]`. Follow the
[tool guide](../../absolute-stability.md) for uploads, model selection and
commands. The examples illustrate execution and input identity; they do not
calibrate stability estimates for new constructs or establish resource needs
for larger inputs.
