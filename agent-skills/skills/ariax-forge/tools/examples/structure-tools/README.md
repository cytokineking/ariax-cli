# Structure-tool example inputs

`1ubq.pdb` is the deposited 1UBQ ubiquitin structure downloaded from
https://files.rcsb.org/download/1UBQ.pdb on October 4, 2026. It includes chain A,
76 standard amino acids and the deposited waters. Preserve its header for source
and experimental provenance. Cite the deposited structure and its primary paper:
Vijay-Kumar et al., J Mol Biol 194, 531-544 (1987), DOI 10.1016/0022-2836(87)90679-6.
RCSB structure record: https://www.rcsb.org/structure/1UBQ.

`1ubq-protein.pdb` contains exactly chain A's ATOM coordinates from the deposit,
without waters or header categories. `1ubq-transformed.pdb` applies the proper
rigid motion `(x,y,z) -> (-y+10,x-8,z+3)` in Angstrom. The expected CA Kabsch RMSD
is zero within PDB rounding, with 76 paired residues. Native TM-align/US-align
should align all 76 and return TM-scores near one under both normalizations.

`1ubq-missing-nz.pdb` retains the deposited file except for the single NZ atom of
LYS A27. The remote preparation case explicitly removes waters, adds that heavy
atom and hydrogens at pH 7 with seed 7, then minimizes Amber14/OBC2 with HBonds,
NoCutoff and a 1000 kJ/mol/nm^2 heavy-atom restraint for at most 200 iterations.
Keep raw, selected, repaired and relaxed files. This small preparation case
establishes execution and identity preservation; it does not prove a physically
accurate relaxed conformation or ligand parameterization.

`identity.pdb` is synthetic. It has A10 ALA, A10A GLY, B7 ALA, a water, a dummy
ligand and a zinc. CB A/B alternatives have occupancy 0.7/0.3. At a 4 Angstrom
cutoff, A10 and A10A each contact B7. It tests identity, alternate-location
selection and unsupported geometry atoms. It is not a protein preparation input.

The explicitly selected shared search database is `foldseek-fixture`, built from
`1ubq-protein.pdb` and `1ubq-transformed.pdb` only. Its archive root contains all
native `db*` files plus source/settings. Input basenames remain distinct. The
query is `1ubq-protein.pdb`. Native search must find its self-hit and rigid-copy
hit. Native clustering must include both members. No public PDB/AlphaFold database
is selected by these examples. For a larger search, choose an available
database snapshot and its resource requirements from the
[tool guide](../../structure-tools.md) and live catalog.
