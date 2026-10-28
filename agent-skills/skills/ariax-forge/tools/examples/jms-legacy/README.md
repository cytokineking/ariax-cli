# Legacy JMS inputs

`6MRR-A.pdb` preserves 68 observed residues of chain A, numbered 1–68, from
[RCSB 6MRR](https://files.rcsb.org/download/6MRR.pdb). Preparation retained alternate
location A, removed B and cleared the retained alternate-location flags.
`6MRR-A.fasta` contains that exact observed sequence. This public
TrROS example does not reproduce the
unavailable historical r9_900 backbone or its original results.

`two-sequence.fasta` contains the query and a constructed E-to-Q last-residue
variant with one aligned gap at position 10. It exercises MSA handling;
it is not an evolutionary alignment or evidence of stability.

Use `ariax skills forge --tool jms-legacy --json` to locate this directory in
`data.examples["jms-legacy"]`. Read the [JMS legacy guide](../../jms-legacy.md)
for input requirements, model definitions and commands.
