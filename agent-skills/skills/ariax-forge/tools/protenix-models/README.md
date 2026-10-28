# Protenix input examples

Every input has explicit entity/chain identity. See the
[model guide](../protenix-models.md) for model-specific features and commands.

`monomer.json` contains ubiquitin. `complex.json` uses the pinned fork's
545-residue pMHC/VHH constructs from `7st3_base`. `consumer-complex.json`
contains the genuine 21-residue/30-residue human insulin A/B protein pair,
providing a small native-default example. This execution fixture
makes no predictive-accuracy or binding claim. `chemical.json` adds ATP/MG
to ubiquitin. `nucleic.json` contains short RNA and DNA. These molecular
execution cases do not assert biological complexes.

`constraint.json`, `constraint-pocket.json` and
`constraint-atom-contact.json` request native soft priors. `substructure.json`
provides fifteen explicit CA token-centre coordinates from the unchanged
pinned 2LWU template. `substructure-unconstrained.json` uses the same sequence
without the prior. Substructure encodes native binned pair distances and does
not fix absolute coordinates. Keep actual predicted geometry beside the input.

MSA/template paths refer to `/opt/forge-protenix-fixtures` in the image.
Uploaded copies must rewrite those paths to the actual uploaded files.
Query-only A3Ms test supplied-MSA parsing and contain no searched homologs.
`templates/2lwu.cif` is unchanged from the pinned fork.

The exact source is `b806d2540ab326d71edcc47128343e627248c099` under Apache-2.0.
The v2 checkpoint has bounded internal-development coverage; its small
standalone examples are described in the [package guide](../protenix-models.md#v2-standalone-example).
Its customer/public distribution and production delivery retain their separate
scope. The CLI guide follows the repository license.

Grouped direct PDB/minimal mmCIF/full mmCIF examples use explicit
`residueMappings`, author insertion codes and gap masks. `template-batch.json`
contains two such native tasks. See the package guide for explicit per-item
continuation after save/restore. `grouped-soft-prior.json` uses the constraint
checkpoint's native token-centre distance features in one shared frame; it
does not guarantee fixed coordinates.
