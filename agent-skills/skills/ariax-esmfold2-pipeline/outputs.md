# ESMFold2 candidate evidence

See [candidate retrieval](../../core/candidates.md) for the common command and limits.
Use the shared [interpretation guide](../../core/interpretation.md) for confidence
scores, target-aligned pose comparisons, and biological objective checks.

- `--view final`: `ranked_results/combined_ranking.csv`, every ranking-eligible row.
- `--view all`: `esmfold2/metrics_all.csv`, design candidates, joined to ranking diagnostics when available.
- `--view diagnostics`: `ranked_results/ranking_diagnostics.csv`, including excluded rows and the producer's eligibility/reasons.

Native identity is `design_name` in the compact final table and `candidate_id` elsewhere. The adapter preserves eligibility, exclusion reasons, hotspot/ipSAE/RMSD pass flags, and named confidence/distance metrics. Consensus score is this pipeline's ranking metric, not a score that can be compared to other engines. Eligibility is not yet known for design rows lacking diagnostics.

Final ranking rows are **not** the copied top-k subset. `esmfold2` and `validator` roles identify reported original model structures when currently present. `top_ranked_esmfold2` and `top_ranked_validator` roles occur only when diagnostics explicitly report the copied path and the object is verified. A candidate can rank successfully without a top-ranked copy. No private diagnostic fields or internal model/config hashes are projected into candidate rows.

Inspect ESMFold2 critic and Protenix complexes together: high interface confidence
does not ensure they preserve the same pose. Target-aligned binder-pose agreement
and hotspot checks are separate evidence. For VHH/scFv, inspect designed CDRs and
their target contacts separately from the conserved framework's confidence.
The hosted workflow uses required structural templates; do not describe its
evaluation as template-free or blind validation.

In the current `ipsae.py` adapter path, primary `validation_ipSAE` uses the best
binder–target pair's native `max` score. `validation_ipSAE_min` and
`validation_ipSAE_max` preserve extrema from the scoped directional rows when
available. This is not a calculation against the union of all target protomers,
and the primary value is not a directional minimum. Inspect retained validation
artifacts for details; do not relabel fields or transplant thresholds from a
different ipSAE protocol. Missing confidence/pose evidence should be explained
through diagnostics, not silently treated as a pass.
