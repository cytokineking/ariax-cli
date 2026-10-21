1UBQ chain A from the accepted B34 fixture, renamed Z and numbered 101–176. OXT removed because native atom37 excludes it. All retained coordinates are unchanged. Mutation positions concatenate chains and are zero-based: M0 is Z101, Q1 is Z102.
two-chain.pdb contains two copies of ubiquitin residues 1–32, chains Y101–132 and Z201–232. The second copy is translated +40 Angstrom along x. This synthetic mapping fixture does not establish binding. Zero-based position 33 is Z202 (Q).

`prepare_profiles.py` prepares the natural 1TIM monomer (247 residues) and dimer
(494 residues) from a caller-supplied `1TIM-original.pdb`. Run explicitly:

```sh
python3 prepare_profiles.py 1TIM-original.pdb --out-dir tim-inputs
```

The source is https://files.rcsb.org/download/1TIM.pdb. The recipe keeps ATOM records
for chain A or A/B, removes OXT and requires standard residues without insertion
codes. Output chains are Y/Z with author numbers offset by 1000/2000; coordinates
and existing numbering gaps are preserved. Each source-map JSON records both
identities. The output PDBs and mutation lists equal the actual qualification
inputs byte for byte. `profiles.json` lists fixed sequence/sidechain selections
using only present residues; use its `all_sequence_positions` for full-sequence
packing with frozen sidechains.

The monomer uses batch four, four design/packing samples and eight mutation groups.
The dimer uses batch eight, eight samples and sixteen groups. Design uses 100/50
steps and the recommended 0.3 checkpoint; packing uses 50 steps and 0.0; both
mutation-scoring modes use CATH. All three checkpoints also passed all four
operations on the 76-residue input at batch four. These are measured qualification
workloads. Larger inputs and batches have no current capacity claim.
