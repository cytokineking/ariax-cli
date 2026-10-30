# Biohub ESM example inputs

`monomer.fasta` is the 76-residue ubiquitin sequence associated with PDB 1UBQ.
`sequences.fasta` adds an artificial 16-residue sequence to exercise unequal
sequence lengths in all three ESMC sizes. Each ESMC item has one chain.

`complex.json` contains two artificial 16-residue protein chains named `binder`
and `target`. Their names do not establish a biological interaction. `msa.json`
adds two-row synthetic unpaired A3Ms with exact query/chain matches. These test
the supplied-MSA path, with no MSA service or database dependency. No pairing or
coevolution claim follows from these synthetic alignments.

`pairs.csv` is the standalone extraction of the local batch project's strict
binder/target/wide-decoy format. It expands to three items: row000001-target,
row000001-decoy, row000002-target. Chain A is the binder; chain B is its target
or decoy. Names are preserved as labels. An entirely blank decoy slot creates
no item. Missing required cells or half-filled decoy slots fail before inference.

The folding example uses one loop, 14 sampling steps, seed 7 and two diffusion
samples. Adapter defaults are 20 loops, 200 steps, one sample and LM dropout 0.3.
Record actual settings; the reduced example does not establish native-default
capacity. Folding launch minima remain unknown. See the
[tool guide](../../biohub-esm.md) for commands and interrupted-batch resume, and
the [ESMC capacity guide](../../biohub-esm/esmc-capacity.md) for language-model limits.

`pairs-interrupt.csv` and `sequences-interrupt.fasta` are separate longer native
cancellation fixtures, with lengths 32/1040/32 and 16/1024 respectively. The
language fixture's second stable ID retains its historical suffix 512. They
exercise file synchronization and explicit resume while retaining first results;
the original short inputs retain independent coverage.


Additional ESMC inputs:

- `length-batch.fasta` and `length-batch.json` contain the same eight items of
  1, 16, 76, 256, 512, 768, 1024 and 1024 residues.
- `alphabet.json` contains the 20 standard amino acids and X/B/Z/U/O.
- `mask-ends.json` has 1024 residues for masks at positions 1 and 1024.
  Repeated mask positions are normalized; positions outside the sequence fail.
- `interruption.json` contains one 16-residue item and seven 1024-residue items
  for explicit interruption/resume exercises. Preserve completed items and
  prior attempts when resuming.

These synthetic execution fixtures establish input, array and lifecycle behavior.
They do not establish biological accuracy or optional-kernel equivalence.

The `folding-completion` directory contains optional native-default capacity
fixtures, which remain unrun: monomer lengths 1,32,76,256,512,1040 and complex
totals 2,32,76,256,512,1040. Their presence does not establish support for those
profiles. Check the current tool scope and resources before selecting one.
