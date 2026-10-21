# JMS component input examples

`1crn.pdb` and `1crn.fasta` are crambin from [RCSB 1CRN](https://www.rcsb.org/structure/1CRN), chain A, residues 1–46. The PDB contains retained ATOM records plus TER/END, fetched October 4, 2026. Coordinates and native residue identity were preserved. These are native qualification inputs, not stored model results.

For each MPNN checkpoint, use a fresh output directory with the documented
weight interface inside the corresponding Forge tool:

```sh
jms-components mpnn --sequence-file /inputs/jms/1crn.fasta --pdb /inputs/jms/1crn.pdb --chain A --model v_48_010 --mode both --seed 0 --weights /models/proteinmpnn/colabdesign/v1.1.0 --out /workspace/jms/mpnn010
jms-components mpnn --sequence-file /inputs/jms/1crn.fasta --pdb /inputs/jms/1crn.pdb --chain A --model v_48_020 --mode both --seed 0 --weights /models/proteinmpnn/colabdesign/v1.1.0 --out /workspace/jms/mpnn020
```

The `.pkl` files are unchanged official ColabDesign v1.1.0 parameters. Both
JAX checkpoints and their one-byte weight initializer match the later repository-wide
Beer-Ware licensed tree. The selected older executable source scope remains unresolved.
Read the [semantics reference](../../jms-components/semantics.md) for source and notice details. No native model values are stored here.

## Qualification scope

These exact inputs passed ESM2, both MPNN checkpoint/CE-mode comparisons, full and exact half-mask ESMFold, and real hybrid 1/3 arithmetic at absolute and relative tolerance 1e-4. The bundled files contain inputs; save the full output directories from your own available tools. Read this reference with `ariax skills forge --reference jms-components-fixtures --read --json`. Larger-input capacity and experimental stability accuracy remain unestablished.
