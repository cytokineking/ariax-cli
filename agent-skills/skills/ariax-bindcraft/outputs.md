# BindCraft candidate evidence

See [candidate retrieval](../../core/candidates.md) for the common command and limits.
Use the shared [interpretation guide](../../core/interpretation.md) for confidence
scores, target-aligned pose comparisons, and biological objective checks.

- `--view final`: `output/final_design_stats.csv`, accepted designs reranked by the producer. `Design` is native identity; `Rank` is native rank. Acceptance implies eligibility for this accepted-design ranking.
- `--view all`: aliases `final`, using the same retained accepted-design rows, acceptance flags, ranks, and structures. It is not a complete history of attempted MPNN sequences. Use `diagnostics` for trajectories.
- `--view diagnostics`: `output/trajectory_stats.csv`. Trajectories and MPNN variants have different native design names. Trajectory statistics do not establish final acceptance.

Ariax retains `output/final_design_stats.csv`, `output/trajectory_stats.csv`, PDBs under `output/Accepted/` (including `Ranked/`), and `output/Trajectory/Relaxed/`. Root compute logs are available through `ariax logs`. Attempted MPNN statistics, rejected designs, animations, plots, and other intermediate files are not retained. Discover actual files with `ariax results`; absence of these intermediates is expected.

Metrics preserve names such as `Average_i_pTM`, `Average_pLDDT`, `Average_i_pAE`, and `MPNN_score`; model-scaled PAE is not raw angstrom PAE. The adapter does not reconstruct per-design filter failures from aggregate failure counters. Verified accepted structures use `output/Accepted/<Design>_model<N>.pdb`; trajectory structures use `output/Trajectory/Relaxed/<Design>.pdb` when present.

During a campaign, inspect trajectory complexes for hotspot engagement and
compare accepted sequence variants separately. One trajectory can yield two
accepted designs, so accepted designs per trajectory is a yield, not a success
probability, and the final accepted count can exceed the requested target. Review
zero acceptance after 25–40 trajectories using the [campaign guide](../../core/campaigns.md).

With `use_pyrosetta: false`, some energy, hydrogen-bond, and PackStat fields are
fixed placeholders. Do not rank on them or interpret constant values as measured
quality or a pipeline failure. Assess confidence and actual structures within
the selected scoring workflow; computational acceptance is not experimental
binding or stability.
