# PXDesign candidate evidence

See [candidate retrieval](../../core/candidates.md) for the common command and limits.
Use the shared [interpretation guide](../../core/interpretation.md) for confidence
scores, target-aligned pose comparisons, and biological objective checks.

- `--view final`: `output/results/analysis/overall/filtered_summary.csv`.
- `--view all`: `output/results/analysis/overall/all_summary.csv`, with selected membership from the filtered table when available.

Native identity includes task, run index, sample name, and sequence index. The trimmed per-task `output/results/<project>/summary.csv` drops native run/sample identity; it is used only to join saved structure choices on task, rank, sequence, and sequence index. Rank is not a stable identity.

Selection can include failed designs used to pad the requested return count. Keep `pass_af2`, `pass_ptx`, AF2 success flags, and `ptx_*`/`ptx_mini_*` success flags separate. `ranking_eligible` remains null because the producer does not publish a universal eligibility flag. AlphaFold2, Protenix, and Protenix Mini metrics retain separate names. Raw `unscaled_i_pAE`/trimmed `af2_ipAE` are angstrom values; scaled `pAE`/`af2_pAE` are not.

Saved structures are verified under `structures/orig`, `structures/af2`, and `structures/ptx`. The chosen role reflects the producer's selected model; other saved evaluation copies remain separate. Final Protenix structures can be rerun versions; source table scores are not silently relabeled as fresh evaluations of those coordinates. Missing analysis tables or an unsafe/ambiguous chosen-structure join are not replaced with guessed identities or paths.

For pilot review, compare diffusion, AF2-IG, and Protenix poses after aligning
the target and resolving chain mapping. Favor candidates supported by both
evaluation workflows and the intended epitope; keep disagreements visible rather
than averaging away a failed model's result. A final selected row can be padding,
so count native filter passes separately from selected rows. Use producer
thresholds as the starting point and disclose any changed review criteria.
