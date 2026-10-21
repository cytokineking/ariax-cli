# Models, numbering and outputs

| Family | Native checkpoint files | Required chain keys | Output order |
| --- | --- | --- | --- |
| abodybuilder2 | antibody_model_1 through antibody_model_4 | H and L | H then L |
| nanobodybuilder2 | nanobody_model_1 through nanobody_model_4 | H | H |
| tcrbuilder2-plus | tcr_model_1 through tcr_model_4 from Zenodo 10892159 | A and B | B then A |
| tcrbuilder2-original | tcr2_model_1 through tcr2_model_4, renamed from original Zenodo 7258553 files | A and B | B then A |

JSON input is a nonempty list of `{id, sequences, source_chains?}`. IDs use letters, digits, `_` and `-`. `sequences` maps native chain keys to uppercase amino-acid strings; optional `source_chains` maps them to original chain labels. Native ANARCI trims variable domains. A map records supplied-sequence positions, native number and insertion code for every retained residue. An ambiguous original mapping fails explicitly. Constant domains, linkers, antigen context and gamma/delta TCRs remain outside this adapter.

Each family exposes IMGT and raw numbering. Raw counts from one after native trimming. Native APIs also accept Chothia, Kabat, Martin, AHo and Wolfguy with chain restrictions; those paths remain unqualified. Native TCR CLI has no numbering flag, so use this API adapter. The selected upstream commit fixes the reported raw-numbering gaps [#45](https://github.com/brennanaba/ImmuneBuilder/issues/45); later [#53](https://github.com/brennanaba/ImmuneBuilder/issues/53) remains unconfirmed beyond this bounded case.

| Output | Meaning |
| --- | --- |
| rank0_unrefined.pdb through rank3_unrefined.pdb | Four aligned native predictions, sorted by average squared deviation from the ensemble mean |
| error_estimates.npy | Mean squared CA deviation from aligned ensemble average, shape residue count, Å² |
| per_model_squared_deviations.npy | Squared deviations by native checkpoint order, shape 4 × residue count |
| aligned_ca.npy | Aligned CA coordinates by native checkpoint order, shape 4 × residue count × 3, Å |
| final_model.pdb | Refined rank0, with sqrt(error_estimates) in B-factor, Å |
| result.json | Explicit status, refinement boolean, checkpoint order/ranking and timings |
| residue-mapping.json | Input/source chain and original supplied position to output chain/number/insertion; trimmed prefix/suffix |
| batch.json | One predictor initialization, per-item results and measured memory observations |

The native [error explanation](https://github.com/brennanaba/ImmuneBuilder/issues/14) agrees with the selected writer. There is no pLDDT, PAE, pTM or ipTM field. PDB error values are ensemble disagreement; an unrefined PDB B-factor of zero carries no uncertainty estimate. The output checker verifies original sequence, numbering, finite coordinates, ranking and arrays, then compares refined/unrefined CA coordinates and error B-factors.

Refinement uses native OpenMM ff14SB and strained-sidechain checks. The image requires CUDA for prediction and default refinement. The image corrects the native strained-bond recheck so zero remaining defects pass. The adapter records a false native return as a failed outcome and preserves diagnostics. `--no-sidechain-bond-check` exposes the native reduced check, with no current scientific qualification. `--unrefined-only` omits refinement deliberately. Positive native `--n_threads` chooses CPU refinement and remains unqualified.

The creator recommends [reusing a loaded predictor](https://github.com/oxpig/ImmuneBuilder/blob/0df4e2ad82a1aa60f37ea9dae335d1198159ef78/README.md). This adapter processes items sequentially. It releases each result before the next and records PyTorch allocated/reserved/peak bytes and process peak RSS. [The creator](https://github.com/brennanaba/ImmuneBuilder/issues/8) did not implement tensor batches. [Reported saving memory growth](https://github.com/brennanaba/ImmuneBuilder/issues/48) was attributed to OpenMM. PyTorch counters exclude OpenMM allocations; catalog evidence includes device-wide measurements. Two items provide a bounded observation, with long-batch behavior unmeasured.

Code [BSD-3-Clause](https://github.com/oxpig/ImmuneBuilder/blob/0df4e2ad82a1aa60f37ea9dae335d1198159ef78/LICENSE); [original weights](https://zenodo.org/records/7258553) and [plus weights](https://zenodo.org/records/10892159) CC BY 4.0. ANARCI source `79f6c575056dedef86cb8f405ebb039197923eec`, Bioconda `2024.05.21 pyhdfd78af_0`, [BSD-3-Clause](https://github.com/oxpig/ANARCI/blob/79f6c575056dedef86cb8f405ebb039197923eec/LICENCE). The underlying germline data has a [current IMGT CC BY 4.0 policy](https://www.imgt.org/about/termsofuse.php), checked October 2026. Separate terms for the packaged derived HMM snapshot remain unverified. IMGT tools have separate terms. Citation: Abanades et al. (2023), [ImmuneBuilder](https://doi.org/10.1038/s42003-023-04927-7); Dunbar and Deane (2016), [ANARCI](https://doi.org/10.1093/bioinformatics/btv552).
