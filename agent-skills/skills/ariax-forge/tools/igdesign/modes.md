# Models, residue mapping and interpretation

Selected source is AbSciBio/igdesign commit `70431eef0afaf0496d7d84e22dfdc1980ec9e70e`. IgDesign uses `igdesign_acvr2b_holdout.ckpt`, `igmpnn_acvr2b_holdout.ckpt` and ESM2-3B. IgMPNN loads the latter structural checkpoint directly. The named asset includes both checkpoints and the local ESM2 tokenizer/model. Downloads at command time are disabled.

| Control | Meaning |
| --- | --- |
| `heavy_chain_id`, `light_chain_id`, `antigen_chain_id` | Three distinct original PDB chain IDs. The selected interface requires all three. |
| `region_order` | Any distinct selected hcdr1/2/3 and lcdr1/2/3, in decoding order. |
| `regions` | Exactly those selected regions, each with chain heavy/light and an explicit integer list of zero-based positions in the parsed Fv. |
| `epitope_idxs_or_all: all` | Full observed antigen, native dataset crop none. |
| Integer epitope list | Exact selected antigen indices, zero-based in the parsed antigen. The patch uses native custom crop; it retains the selected residues in source order. |
| Sampling counts | IgDesign rows equal decoding orders × IgMPNN sequences × LM samples. IgMPNN rows equal decoding orders × IgMPNN sequences; LM count has no role. |
| Temperatures | Positive logit divisors; example 0.5 for both stages. |
| Seed | Explicit native RNG seed; example 7. |

SEQRES records must match the ATOM/REMARK465 sequence and fixed PDB columns. [Header issue 7](https://github.com/AbSciBio/igdesign/issues/7) remains unanswered. The example generates SEQRES solely for its complete observed backbone. ANARCI trims antibody chains to Fv, which changes the relationship between author residue IDs and array indices. Compare the identity file before using a config from another structure. Supplied position lists contain no evaluated expressions. The example reuses creator config loop windows and labels their array convention explicitly.

[Issue 9](https://github.com/AbSciBio/igdesign/issues/9) reports an absent `structure_utils.crop`. The selected source still lacks it. Forge patches `predict.load_single_example` so an epitope list chooses the dataset's implemented custom exact-index crop. The native default `closest_continuos` path remains unavailable. The selected path preserves the antigen sequence and original residue indices in its identity file. An epitope list specifies included structural context; it supplies no binding constraint or guarantee.

The selected predict path always includes the paired antibody and antigen even though the creator config has context flags. Forge requires antigen context and derives the light-chain flag from the selected CDRs. Context removal is unqualified. Multiple antigen chains, CPU execution, training and arbitrary checkpoints are outside this package's qualified scope. The unanswered [nanobody question](https://github.com/AbSciBio/igdesign/issues/6) gives no support evidence.

Native IgDesign columns `hcdr3` and analogous names contain generated loop sequences. `ce_loss_independent_hcdr3` is mean cross entropy across that loop, in nats per residue; lower favors the sequence under that model/context. Native output rounds these values to four decimals. IgMPNN's adapter follows the native decoding order one selected position at a time, feeding sampled previous tokens back into the native structural model. It records mean untempered negative log probability of those sampled tokens as `ce_loss_igmpnn_CDR`. Its scores use structural logits, while IgDesign uses the language adapter; compare each on its own scale. Reconstructed FASTA chains copy the parsed frameworks and replace native CSV loops. Internal whole-sequence LM samples are not advertised as full-chain designs.

Code terms: [MIT](https://github.com/AbSciBio/igdesign/blob/70431eef0afaf0496d7d84e22dfdc1980ec9e70e/LICENSE). The creator download script provides no separate checkpoint license or model card; IgDesign/IgMPNN weight terms remain unknown. [ESM2-3B](https://huggingface.co/facebook/esm2_t36_3B_UR50D) declares MIT. ANARCI 2024.05.21 from the creator-recommended Bioconda distribution carries BSD-3-Clause code notices and packaged HMM numbering data; the selected derived HMM snapshot terms remain unverified. The [current IMGT data policy](https://www.imgt.org/about/termsofuse.php) states CC BY 4.0 for the underlying source data. No external search database is selected. These records grant no public redistribution rights.

The creator default samples 10 decoding orders × 10 structural samples × 10 LM samples. Forge's bounded examples use one order and one or two sequences. A tiny same-task comparison with AbMPNN reports editable-position recovery and changes; it cannot rank general antibody performance or establish experimental efficacy.

The bounded native matrix passed each individual CDR and paired all-six design for both checkpoints, plus exact HCDR3 antigen cropping. All full/cropped input sequences matched the independent accepted AbMPNN parser's view. The same-task four-position comparison produced two samples per method: selected amino-acid recovery was 0.75/0.75 for IgDesign and 0.50/0.50 for IgMPNN and AbMPNN. This single HER2 example does not estimate general model performance; HER2 is outside the selected ACVR2B holdout identity. Native score scales remain separate.

The selected loader uses PyTorch 2.0.1+cu118, Transformers 4.42.4 and Lightning 2.0.9. Creator-style strict=False loading reports absent ESM contact-regression keys and extra position_ids. The exercised masked-language-model logits path passed finite-output checks; contact prediction is outside this interface.
