# RFd4 example inputs and checks

`data.examples.rfd4` from `ariax skills forge --tool rfd4 --json` locates this
installed directory. Stage only the files needed for an authorized case and keep
each YAML's companion paths together. The [RFd4 recipes](../../rfd4/recipes.md)
and [search guide](../../rfd4/search.md) give native arguments and checks. Consult
the live catalog for the current bounded scope and resources. These examples
are not evidence of binding, activity or a general success rate.

| Files | Origin and intended use |
| --- | --- |
| [`baseline/`](baseline/README.md) | Upstream-derived annotated monomer and PD-L1 binder spec and target; includes the upstream license notice. |
| `protein/indexed_1qjg.cif.zst`, `protein/unindexed_1qjg.cif.zst` | Unchanged [indexed](https://github.com/RosettaCommons/RFD4-Proteina/blob/aaccdd2ad0720c180468df5f9cf037a713d403e5/data/benchmarks/motif_scaffolding/motif_indexed/1QJG_AA.cif.zst) and [unindexed](https://github.com/RosettaCommons/RFD4-Proteina/blob/aaccdd2ad0720c180468df5f9cf037a713d403e5/data/benchmarks/motif_scaffolding/motif_unindexed/1QJG_AA.cif.zst) 1QJG motif inputs from the pinned upstream commit. Preserve generation-time metrics and insertion annotations for the latter. |
| `partial/resolved_seed.yaml`, `partial/1ubq.cif` | A condition spec selecting chain A residues 1–76 of the deposited [1UBQ](https://www.rcsb.org/structure/1UBQ) CIF; water is excluded. Check assembled heavy atoms and output coordinates for finiteness. |
| `antibody/mzb1_7AAH__h-NbBCII10_cdr123.cif.zst` | Unchanged [upstream VHH input](https://github.com/RosettaCommons/RFD4-Proteina/tree/aaccdd2ad0720c180468df5f9cf037a713d403e5/examples/antibody_design/structures/vhh), with cropped MZB1 target, framework and expandable CDRs. |
| `search/SAM_hbonds.cif.zst` | Unchanged [upstream SAM input](https://github.com/RosettaCommons/RFD4-Proteina/blob/aaccdd2ad0720c180468df5f9cf037a713d403e5/data/benchmarks/small_molecule_binder/SAM_hbonds.cif.zst) for the structure-only H-bond search preset. |
| `checks/` | RFd4-image Python readers for finite structures and per-example metrics, fixture-specific protein/partial/VHH checks, search trace and continuation checks, plus a general pre-generation condition-spec mapping export. Upload helpers with `rfd4.py` in the same directory. |

The upstream inputs are from RFD4-Proteina commit
`aaccdd2ad0720c180468df5f9cf037a713d403e5` and retain the adjacent
[BSD 3-Clause notice](baseline/LICENSE); the 1UBQ deposited structure is from
RCSB PDB. The checkers report observed results, not a mode qualification.
The `rfd4.py`, protein, partial, antibody and search checks are the same finite
case readers used for Forge qualification; `check_search_settings.py` compares
the saved continuation settings. The general mapping exporter verifies
pre-sampling assembly only; check the generated annotations independently.

The baseline binder specification adapts upstream documentation, whose text
declares [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); see the
attribution in the [RFd4 guide](../../rfd4.md).
