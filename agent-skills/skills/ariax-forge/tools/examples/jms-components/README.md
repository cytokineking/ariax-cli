# JMS component input examples

`1crn.pdb` and `1crn.fasta` are crambin from [RCSB 1CRN](https://www.rcsb.org/structure/1CRN), chain A, residues 1–46. The PDB contains retained ATOM records plus TER/END, with original coordinates and residue identity. `ariax skills forge --tool jms-components --json` returns this directory as `data.examples["jms-components"]`.

For each MPNN checkpoint, use a fresh output directory with the documented
weight interface inside the corresponding Forge tool:

```sh
jms-components mpnn --sequence-file /inputs/jms/1crn.fasta --pdb /inputs/jms/1crn.pdb --chain A --model v_48_010 --mode both --seed 0 --weights /models/proteinmpnn/colabdesign/v1.1.0 --out /workspace/jms/mpnn010
jms-components mpnn --sequence-file /inputs/jms/1crn.fasta --pdb /inputs/jms/1crn.pdb --chain A --model v_48_020 --mode both --seed 0 --weights /models/proteinmpnn/colabdesign/v1.1.0 --out /workspace/jms/mpnn020
```

The `.pkl` files are official ColabDesign v1.1.0 parameters. Read the
[semantics reference](../../jms-components/semantics.md) for source, notice details
and the unresolved licensing scope of the older executable source. This directory
contains inputs; save output directories from your own commands with the
[Files guide](../../../outputs.md). A 46-residue example does not establish
larger-input capacity or experimental stability accuracy.
