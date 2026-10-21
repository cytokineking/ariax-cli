# Chai-1 examples

`monomer.fasta` contains the 76-residue ubiquitin sequence. `multimer.fasta`
adds the small GB1 sequence for a bounded two-chain input. Caffeine is supplied
as SMILES in `ligand.fasta`; `nucleic.fasta` has short protein, DNA and RNA
entities. `modified.fasta` replaces the first methionine with CCD MSE.
`glycan.fasta` and `glycan.restraints` specify NAG linked to ubiquitin N25 ND2.
These inputs exercise molecular formats and make no binding claim.

Each `.expected.json` records the expected output chains and sequences or
chemical atom coverage. `check.py` inspects saved structures and confidence.
`predict.py` calls the native predictor and saves full returned confidence
arrays. The contact, pocket and glycan restraint files use default A/B chain
names. `invalid.restraints` deliberately names the wrong residue at position 6
and is a failure-path example.

`condition.py msa` creates declared synthetic local alignments using the native
filename/schema. Its `audit` operation inspects native conditioning features.
`template.m8` selects the complete deposited 1UBQ chain A. Supply that structure
as `1UBQ.cif` and copy it to writable `/scratch/chai-templates/1UBQ.cif`.
The template is obtained from the [RCSB entry](https://www.rcsb.org/structure/1UBQ).

Read the [Chai-1 guide](../../chai1.md) for input staging, native settings,
inspection and checkpoint commands. Preserve the precise input files and
configuration alongside each result.
