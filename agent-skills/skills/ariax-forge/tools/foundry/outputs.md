# Foundry output meanings

These definitions apply to source commit
`94c78ab125c6ef2cc7d1226de86d1bd578bf8bee` with the RF3 atom-annotation exports
and fixed-ligand bond writer. Keep complete native outputs with their exact
input, checkpoint, seed and inference settings.

| Field or output | Native meaning | Limit |
| --- | --- | --- |
| RFD3/RFD3NA `.cif.gz` and JSON | Atomic design and retained specification, sampled contig, checkpoint and seed | Decode actual sequence and author chain/residue map; trajectory/virtual atoms are not the final construct. |
| RFD3 B-factor | Sequence-head confidence when that head is used | Not a folding confidence or binding metric. |
| RF3 `atom_plddts`, `overall_plddt` | Predicted local confidence, 0–1 | Preserve the selected source’s scale. |
| RF3 `pae`, `overall_pae` | Predicted aligned error, angstroms | Atomized components mean tokens are not always residues. |
| RF3 `token_res_ids` | Zero-based token indices | Not author or label residue numbering. |
| RF3 `token_chain_ids` | Token-level chain instance IDs | Map native instances to output author chains using the paired structure. |
| RF3 `atom_token_ids`, `atom_res_ids`, `atom_res_names`, `atom_names`, `atom_elements` | Native annotations exported in structure atom order | Multiple ligand atoms can have separate tokens within one residue. |
| RF3 `chain_ptm` | Mean chain pLDDT in this writer | It is not per-chain pTM despite its name. |
| RF3 overall `ptm`/`iptm` | Separate native TM-derived metrics | Preserve unavailable values; native monomer iPTM is zero without interchain pairs. |
| RF3 ranking score | `0.8*iptm + 0.2*ptm - 100*has_clash`; absent iPTM substitutes pTM | Ranks within a run; not a cross-engine or experimental score. |

RF3’s highest-ranked files and individual sample files must remain paired with
their own confidence arrays. Its early-stop path can finish without a structure.
Source documentation warns that the inference/confidence API may change; use
this pinned version’s behavior. A mixed-molecule PAE array requires an explicitly
mapped protein subset for a protein-residue interface metric. See
[interface scores](../interface-scores.md).

The checker verifies polymer identity/length, chemical atom names/elements,
finite coordinates, confidence order/count, PAE dimensions and native
atom/token/residue correspondence. `consume.py` checks requested seed-7 samples
and matches the selected structure/confidence to the maximum native ranking
score. Pass `--expected-samples` explicitly for a batch. These checks do not
establish useful geometry, prediction accuracy or binding.

## Generation chemistry and geometry

Generation JSON retains `native_conditioning` from the model input, final atom
identity and the native token map. Nonfinite native metrics are reported as
unavailable nulls with named fields. If a map was reconstructed from CIF order
and native ligand atomization, retain that provenance rather than treating it as
a native export. Secondary-structure analysis uses global mixed-array token IDs
and evaluates only eligible matrix positions, with HBPLUS for pair geometry.

Fixed atoms are compared through native correspondence and a proper rigid fit.
The writer restores intra-residue bonds for input-defined fixed ligands from the
native conditioning BondList. `bond_provenance` records the source, restored
count, unmatched external input bonds and unchanged coordinates. This is retained
conditioning chemistry. Input graphs, boolean model-token adjacency and CCD
reference graphs do not establish generated bond order or aromaticity.
Compare the final native graph and exported CIF graph with the reference. If
final bonds are null or the CIF omits bond categories, report topology unavailable
even when coordinates and chirality match.

## Observed example limits

These are outcomes of the supplied examples, not general success rates or
performance guarantees. Keep each sample’s settings and false/unavailable outcomes
with its geometry report; diagnostic exit zero does not clear a failed criterion.

| Example observation | Consequence for inspection |
| --- | --- |
| Default partial diffusion and fixed DNA: 0/16 samples within a 0.05 Å fixed-atom tolerance; maximum errors 0.055745/0.054320 Å | Inspect fixed-atom errors. Separate explicit `+trainer_precision=32-true` RFD3 comparisons passed the same tolerance at about 0.000004/0.000002 Å; they do not replace the default outcomes. |
| Four soft-constraint batches: 0/16 samples in each satisfied every selected hydrogen-bond atom | Inspect burial and individual donor/acceptor selections on the actual structure. |
| Mixed RNA: requested pairs present in 15/16 samples, extra pairs in every sample | Report both missing and extra pairs. |
| C2: 11/16 samples passed the recorded geometry checks | Check symmetry per sample. |
| RF3 AMP templates: selected preprint 1/24 and 9/21 outputs have coordinate-derived chirality failures despite matching bond records | Check all four sugar centers. A single preprint 1/24 case failed C1′ at one recycle/50 steps and matched all four centers in a separate ten-recycle/200-step comparison using the same input, seed and sample count. This does not establish general stereochemical reliability. |

RF3 full precision is outside the offered modes because the native
cuEquivariance path requires BF16. Confidence, motif geometry, chemistry and
experimental accuracy remain separate assessments.

Primary implementation: [confidence construction](https://github.com/RosettaCommons/foundry/blob/94c78ab125c6ef2cc7d1226de86d1bd578bf8bee/models/rf3/src/rf3/utils/predicted_error.py)
and [sample/ranking writer](https://github.com/RosettaCommons/foundry/blob/94c78ab125c6ef2cc7d1226de86d1bd578bf8bee/models/rf3/src/rf3/inference_engines/rf3.py).
