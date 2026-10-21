# Legacy JMS inputs

6MRR-A.pdb preserves 68 observed residues of chain A, numbered 1–68, from
https://files.rcsb.org/download/6MRR.pdb. Preparation retained alternate
location A, removed B and cleared the retained alternate-location flags.
6MRR-A.fasta contains that exact observed sequence. This is the public
TrROS example used for functional qualification; it does not reproduce the
unavailable historical r9_900 backbone or its original results.

two-sequence.fasta contains the query and a constructed E-to-Q last-residue
variant with one aligned gap at position 10. It exercises MSA handling;
it is not an evolutionary alignment or evidence of stability.

Read jms-legacy for input requirements, model definitions and commands.
