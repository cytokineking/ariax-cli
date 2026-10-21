# Foundry output meanings at the shipped source

Source commit: `94c78ab125c6ef2cc7d1226de86d1bd578bf8bee`, with the additive
B28a RF3 annotation patch. Twelve RF3 panels completed; preprint 1/24 template
retains an AMP stereochemistry gate. B28b completed fourteen generation cases with
constraints and chemistry gates. B28c records the scientific follow-up. Keep
complete original native outputs and the exact input/model/seed.

| Field or output | Native meaning | Limit |
| --- | --- | --- |
| RFD3/RFD3NA `.cif.gz` and JSON | Atomic design and retained specification, sampled contig, checkpoint and seed | Decode actual sequence and author chain/residue map; trajectory/virtual atoms are not the final construct. |
| RFD3 B-factor | Sequence-head confidence when that head is used | Not a folding confidence or binding metric. |
| RF3 `atom_plddts`, `overall_plddt` | Predicted local confidence, 0–1 | Do not multiply/relabel silently; use the selected source's scale. |
| RF3 `pae`, `overall_pae` | Predicted aligned error, angstroms | Token count includes atomized components; not one token per residue in all inputs. |
| RF3 `token_res_ids` | Zero-based token indices | Not author or label residue numbering. |
| RF3 `token_chain_ids` | Token-level chain instance IDs | B28a checks native instance to output author-chain mapping. |
| RF3 `atom_token_ids`, `atom_res_ids`, `atom_res_names`, `atom_names`, `atom_elements` | Added exports of native annotations in structure atom order | Use the paired structure; multiple ligand atoms can have separate tokens within one residue. |
| RF3 `chain_ptm` | Mean chain pLDDT in this writer | The field name does not describe its actual contents. |
| RF3 overall `ptm`/`iptm` | Separate native TM-derived metrics | Leave unavailable values unavailable; pTM does not establish interface accuracy or binding. |
| RF3 ranking score | `0.8*iptm + 0.2*ptm - 100*has_clash`; absent iPTM substitutes pTM | Native ranking within a run, not a cross-engine or experimental score. |

RF3's highest-ranked files and individual sample files must remain paired with
their own confidence. Its early-stop path can finish without producing a structure.
Never call a missing prediction a completed fold. Source documentation retains an
inference/confidence API cleanup warning; use this pinned version's behavior.

The Foundry checker verifies observed polymer sequence/length, actual chemical atom
names/elements, finite coordinates, sample atom confidence order/count and PAE/token
dimensions and native token-to-structural-residue mapping. `consume.py` also checks
every requested seed-7 sample exists and that selected structure/confidence matches
the native maximum ranking score. Pass `--expected-samples` explicitly for a batch.
The separate AMP audit checks bond records and four coordinate-derived sugar centers;
the original preprint 1/24 template C1' remains unresolved. B28c
reproduces it at one recycle/50 steps and observes matching four-center chirality
at ten recycles/200 steps in a separate bounded comparison. Conditioning geometry
and experimental accuracy are separate gates. B35 owns interface-score interpretation using the mapped
protein subset. Native monomer iPTM is zero without interchain pairs; preserve that
context instead of treating it as a measured interface score.

Primary implementation: [confidence construction](https://github.com/RosettaCommons/foundry/blob/94c78ab125c6ef2cc7d1226de86d1bd578bf8bee/models/rf3/src/rf3/utils/predicted_error.py)
and [sample/ranking writer](https://github.com/RosettaCommons/foundry/blob/94c78ab125c6ef2cc7d1226de86d1bd578bf8bee/models/rf3/src/rf3/inference_engines/rf3.py).

B28b generation JSON retains `native_conditioning` from the actual model input.
The additive final writer also exports atom identity and `native_output.bonds` when
available; the inspected fresh ligand has a null final bond list and its CIF omits
bond categories. AMP topology remains unavailable despite matching fixed coordinates
and coordinate-derived chirality. Never replace that absence with claimed native bonds.

The current generation consumer preserves nonfinite native metrics as unavailable
nulls with named fields. Fixed atoms are compared through native correspondence and
a proper rigid fit. Partial/fixed-DNA tolerance, extra RNA pairing and unsatisfied
burial/atom selections remain individual outcomes. B28c corrects mixed-array SS
masks in the eligible matrix space while retaining global token IDs and real
HBPLUS geometry. Original extra RNA pairs remain.
Fresh JSON exports the actual final native token map; historical mapping is labelled
as reconstructed from CIF order and native ligand atomization.
See the generation report and
follow-up.

B28c also records native parsed input bonds and boolean model token adjacency
separately from final generated bonds. The input graph and the 25-heavy-bond
CCD reference are not evidence of generated bond order or aromaticity. Fixed-atom
reports retain the 0.05 Å threshold; full precision is an explicit RFD3 control
(`+trainer_precision=32-true`), with each result reported separately from its
original BF16 sample.

The complete writer restores intra-residue bonds of input-defined fixed ligands
from the actual native conditioning BondList. `bond_provenance` records this source,
restored count, unmatched external input bonds, and unchanged coordinates. Compare
the final native graph and exported CIF graph to the reference. This is retained
conditioning chemistry; no generated or model-predicted bond graph is claimed.
The original outputs with null bonds remain unchanged.
