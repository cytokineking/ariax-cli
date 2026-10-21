# FreeBindCraft finite native examples

Read the main FreeBindCraft guide and completion evidence before use. These
complete configurations retain native miniprotein/linear-peptide defaults,
with two maximum trajectories, accepted goal one and complete output retention.
They write distinct directories for each family and scoring route. Stage the
retained PDL1.pdb as /inputs/freebindcraft/PDL1.pdb. All workloads run remotely.

The miniprotein example uses A115+B80 and soluble MPNN batch20/cap2; the
peptide example uses A115+B20 and batch10/cap2. Validation uses three recycles.
Select OpenMM explicitly with --no-pyrosetta; PyRosetta requires the complete
named authorized mount. Do not clear filters to obtain an accepted candidate.
Native rejection, missing metrics and actual failures stay in the saved result.

check.py verifies saved native-array/PDB correspondence. Use --diagnostic
only on the separate freebindcraft-refold directory. The original rejected
B45 campaigns use the older b45/check.py. Restoration does not replay design.
