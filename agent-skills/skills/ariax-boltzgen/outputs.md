# BoltzGen candidate evidence

See [candidate retrieval](../../core/candidates.md) for the common command and limits.
Use the shared [interpretation guide](../../core/interpretation.md) for confidence
scores, target-aligned pose comparisons, and biological objective checks.

The adapter discovers the newest timestamped `output/final_ranked_designs-<timestamp>` directory, falling back to the legacy non-timestamped directory.

- `--view final`: `final_designs_metrics_<budget>.csv`, the final diversity-selected subset.
- `--view all`: `all_designs_metrics.csv`, all quality-ranked designs with diversity membership when its final table is available.

`id` is native identity. `final_rank` remains the native **quality rank**, even in diversity-selected row order. `quality_score`, ipTM, PAE, RMSD and interaction metrics remain distinct. Native `pass_filters` and `pass_<feature>_filter` outcomes can be false even for ranked or selected rows. Ranking eligibility is null because the producer exports no universal eligibility flag; `--eligible` is therefore not a general BoltzGen shortlist selector.

Verified final structures use `final_<budget>_designs/rank<quality-rank>_<file_name>`, with rank padding determined by the full quality table. Copying prefers a refolded complex but can fall back to the original, so the role is `diversity_selected_complex`, not an asserted refolding model. Multiple final budget CSVs in one result directory are ambiguous and return an explicit error with an artifact fallback.

Compare the generated binding pose with the refolded **complex**; a binder-only
refold answers a fold question, not an epitope question. Inspect CDR contacts for
VHHs. A generated complex can contact the intended site while its refolded
prediction moves elsewhere; report both observations without assuming a software
fault. Confirm which stage a final copied structure represents before claiming
that refolding preserved the design.

Use native pass flags and distinct objective-respecting candidates to evaluate
pilot yield. `quality_score` describes ordering within its scored pool, not an
affinity scale or a score comparable across campaigns. A diversity-selected
candidate is not necessarily a passing candidate.
