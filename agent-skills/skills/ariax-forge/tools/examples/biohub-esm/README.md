# B32 native inputs

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

Bounded native qualification uses one loop, 14 sampling steps, seed 7 and two
diffusion samples for each folding variant. This is an execution fixture. The
adapter defaults are 20 loops, 200 steps, one sample and LM dropout 0.3. Record
the actual settings with every result. See the package qualification guide for
all cases and explicit interrupted-batch resume. The completed native campaign
preserves the original fixture identities. It compares each numeric export with that
inference's live values and checks native atom names/elements, directional
pair-chain confidence axes and preserved prior failed/interrupted records.
Native GPU execution and output readback passed. Folding measurements apply to the
recorded cases; folding launch minima remain unqualified. ESMC has a separate
[bounded capacity profile](../../biohub-esm/esmc-capacity.md).

`pairs-interrupt.csv` and `sequences-interrupt.fasta` are separate longer native
cancellation fixtures, with lengths 32/1040/32 and 16/1024 respectively. The
language fixture's second stable ID retains its historical suffix 512. They
exercise checkpoint/restore and explicit resume while retaining first results;
the original short inputs retain independent coverage.


SCI-06 completion fixtures keep the original inputs above unchanged:

- `length-batch.fasta` and `length-batch.json` contain the same eight items of
  1, 16, 76, 256, 512, 768, 1024 and 1024 residues. Every ESMC size/mode ran
  this batch in BF16 (FASTA) and FP32 (JSON), one item at a time.
- `alphabet.json` contains the 20 standard amino acids and X/B/Z/U/O. All
  twelve size/mode combinations ran it in BF16.
- `mask-ends.json` has 1024 residues. Each model ran simultaneous masks at
  positions 1 and 1024; a repeated 1024 was normalized. Zero and 1025 were
  rejected before inference.
- `interruption.json` contains one 16-residue item and seven 1024-residue
  items. The 6B BF16 hidden-state batch was cancelled after its first result,
  saved through Files, restored into an empty logical workspace, then
  explicitly continued. The first result and prior attempt files stayed equal.

These synthetic execution fixtures establish input, array and lifecycle behavior.
They do not establish biological accuracy or optional-kernel equivalence.

The folding-completion directory adds six-item monomer FASTA/JSON and two-chain
JSON fixtures for SCI-05's unrun native-default capacity matrix. Monomer lengths
are 1,32,76,256,512,1040; complex totals are 2,32,76,256,512,1040. See the
folding completion preparation for
precision, chunking, sample and remote-resource gates. Existing reduced-setting
and ESMC evidence keep their accepted meanings.
