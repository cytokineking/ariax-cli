# BindCraft2 outputs and interpretation

Start with `ariax status PROJECT --json`. Its compact view separates lifecycle from campaign phase and recommends the next read-only action. Read `data.budget.attempts_used`, `data.designs.accepted/requested`, and `data.records.trajectories/refolded/ranked` together. Counts mean:

- `attempted`: native trajectory attempts reported by the campaign state.
- `trajectories`: published rows in `1_Trajectories/!_Trajectories.csv`.
- `refolded`: published rows in `2_Refolded/!_Refolded.csv`.
- `accepted` and `ranked`: designs accepted and published in `3_Ranked/!_Ranked.csv`.
- `requested`: the accepted-design goal.

These values can differ. Refolded rows may exceed trajectories because one trajectory can produce multiple sequence candidates. If attempted exceeds trajectories, one or more attempts has no published record; state that the reason is unavailable unless retained evidence establishes it. `attempt_limit_reached` with zero accepted designs is a valid exhausted scientific result, not a transport failure, proof of an undesignable target, or justification to spend more automatically.

Compact status exposes native stage exits in `data.rejections.native_stage_terminations` and final-filter results in `data.rejections.final_filter_state` and `data.rejections.final_filter_failures`. With `status --details`, these come from `data.bindcraft2_progress.rejections`. Native stage gates such as screen, refine, anneal, harden, mutate, or final precede final candidate filtering. When no candidates were scored, an empty final-filter list means those filters were not evaluated; it does not mean every trajectory passed. Interpret detailed effective `min_iptm_*` and `min_plddt_*` stage gates separately from final filter thresholds.

## Candidate views

`final` returns ranked accepted designs. `all` returns the available BC2 candidate population for the adapter's current source. `diagnostics` returns earlier trajectory/refold evidence when available. In compact rows, `selected`, `ranking.eligible`, and `native_outcome` are separate fields. Raw `selection.selected`, `ranking_eligible`, and `bindcraft2.outcome` appear only with `--details`. Missing eligibility or structures remain unknown; do not turn them into a failed filter or claim that a model was never produced.

Candidate `state: "completed_empty"` means a terminal publication exists and contains zero rows. `state: "missing"` means the source table for that view was not published; in an exhausted campaign this can be expected when no trajectory reached refolding or ranking. Check lifecycle, counts, sync status, and other views before treating `missing` as an infrastructure failure.

BC2 can design multiple binder chains. Use compact `binder_sequences` in order. Compact `target_scores.targets` keeps target names, signed weights, and i_pDAE values in producer order. A negative weight marks a detarget and must not be averaged with positive targets. With `--details`, the raw scalar `sequence` can be null and the ordered sequence array is `bindcraft2.binder_sequences`. For scFv, the two sequences are variable-domain chains and do not contain a designed linker.

Compact `optimization.state: "completed"` records successful native optimization and is not rejection evidence. A real native exit uses `optimization.state: "terminated"` and `rejection.terminated_stage`; final-filter failures remain separate in `rejection.failed_filters`.

The compact candidate view retains stable identity, native rank/outcome, key metrics, recorded rejection evidence, binder sequences, and available public structures. Use `--details` for the prior full API-oriented record, including source and adapter fields. Pagination can become stale while outputs change; restart without the old cursor. Download the CSV for repeated large-table analysis.

## Native files and CSV rules

The public `output/` tree contains sanitized campaign results, including:

- `3_Ranked/!_Ranked.csv`: ranked accepted designs and exported structures.
- `2_Refolded/!_Refolded.csv`: redesigned sequence validation outcomes.
- `1_Trajectories/!_Trajectories.csv`: attempts, stop points, and per-attempt settings.
- `summary.csv`: compact campaign counts and stage-level metric summaries.
- `sequences.fasta`: published accepted sequences; it can be empty when no design was accepted.
- `archives/bindcraft2-results.tar.gz`: verified archive when final publication produced one.

`2_Refolded/!_Refolded.csv` and `3_Ranked/!_Ranked.csv` can be absent when their corresponding counts are zero. Reconcile their absence with terminal lifecycle, progress counts, and sync status rather than assuming a truncated download.

Use a CSV parser. Quoted fields may contain commas. Multi-target vectors are semicolon-separated and align with `targets`; preserve empty positions. Keep target sign and order, and do not average positive-target and detarget values together.

`i_pDAE` is BC2's 0–1 interface ranking measure; higher is better. `i_pTM` is a 0–1 interface-confidence fraction. CSV mean binder `pLDDT` is a 0–1 fraction, while a structure B-factor field can use 0–100. Normalized `i_pAE` is not an ångström PAE matrix. Units and directions belong to each named metric; do not compare them directly with another engine's score.

Requested/saved campaign settings record the experiment. Resolved defaults describe effective starting settings. A trajectory's `autotuned` and related fields record per-attempt adaptation. Report all three scopes explicitly. `hard_target` and `large_complex` alter pose seeding; older saved settings may call them `initial_guess` and `bigbang`. Preserve those recorded spellings and the recorded engine identity when interpreting a historical campaign.

Rejected structures appear only when retention settings requested them. Native and relaxed complexes can represent different stages. A missing file may still be syncing or may not have been retained.

## Conformational metrics in v1.0.4

These meanings are verified against upstream v1.0.4 commit
`d502f19a187a1bc8c05e833ca9cbab7bc1934fe7`. Check recorded engine metadata
before applying them to an older campaign; absent historical metadata is
unknown. The current schema's capability metadata describes the default for
new campaigns and does not establish the engine used by a saved campaign.

| Metric | Meaning in v1.0.4 |
| --- | --- |
| `Binder_RMSD` | Aligned free-to-bound binder displacement in Å over shared coordinates; it does not apply the conformational confidence weighting. |
| `Induced_Fit_RMSD` | Aligned free-to-bound binder displacement in Å, weighted by confidence in both states. |
| `Induced_Fit_Interface_RMSD` | Confidence-weighted binding-surface movement in Å after core alignment. Larger values support requested induced fit. |
| `Induced_Fit_TM` | Confidence-weighted aligned free-to-bound fold similarity from 0 to 1; 1 means unchanged. Its length scale uses the structurally paired length. A switching design requests a ceiling. |

`advanced.confidence_floor` is a finite fraction from `0` through `1`, with
native default `0.7` on omission. The lower per-residue pLDDT of the two states
sets the weight: at or below the floor the weight is zero, and above it the
weight rises toward one. The conformational objectives and all three
`Induced_Fit_*` checks use this campaign-wide value. Insufficient confident
coordinate support makes a metric unavailable; do not replace it with zero.
A floor of `1` leaves no confident support. `Binder_RMSD` and a final confidence
filter answer different questions from these weighted conformational checks.

The v1.0.4 `induced_fit` preset optimizes toward 5 Å of interface movement and
uses an acceptance minimum of 2 Å for `Induced_Fit_Interface_RMSD`. The
`fold_switch` preset optimizes toward TM `0.6` and 1 Å displacement; its
acceptance gates are `Induced_Fit_TM` at most `0.85` and `Induced_Fit_RMSD`
at least 1 Å. Both presets disable the ordinary `Binder_RMSD` acceptance gate.
Explicit named `filters` can override these choices; inspect the resolved
settings and native outcomes rather than inferring acceptance from a rounded
CSV value. Reporting `Induced_Fit_RMSD` alone does not prove it was a rejecting
gate, since it can also be installed for measurement.

`advanced.mutate_gate_draws` selects the lowest weighted-loss prediction from
1–8 fresh draws at the mutate gate, with native default 1 when omitted. More
draws add prediction work. The selected draw supplies the gate's metrics;
scores are not averages or evidence of independent experimental replication.

## Downloads and troubleshooting

`ariax results PROJECT` lists user-facing paths, roles, and sizes. A download reports its destination and downloaded/resumed/skipped/failed counts. Successful verification and recovery bookkeeping stay quiet; add `--details` only for hashes, verification state, manifests, request IDs, or checkpoint diagnostics.

Repeating the same command resumes completed files. A partial failure lists every affected path with a stable code, reason, retryability, and recovery action. Rerun transient transfers; correct destination or access problems first; never use bytes after an integrity mismatch. For accepted settings and provenance troubleshooting, read the shared [recorded settings reference](../../core/recorded-settings.md). Keep original inputs because accepted-input retrieval is not released.

## Scientific review

Inspect target assembly, interface accessibility, glycans, membrane geometry, clashes, binder fold, modality suitability, and agreement across relevant structures. Preserve the CSVs, config, and structures for each shortlist. Rank and computational acceptance are prioritization evidence; confirm binding, specificity, stability, expression, and function experimentally.

### Saved structures

Use the live server schema and validation with the existing job JSON `protocol_config.advanced`. New campaigns default `save_design_trajectory`, `save_failed_trajectories`, `save_failed_refolds`, and `save_binder_monomers` to true; explicit false values are preserved. Packaged BindCraft2 examples show these choices. No additional flags or settings DSL are needed. Retain these values when exporting or reusing a job.

`save_design_trajectory` saves the terminal prediction per predicted state, including rejected/early-terminated trajectories when predictions exist. Accepted/ranked structures are always saved. `save_binder_monomers` controls refolded monomers; terminal trajectory output may also write monomers. Intermediate frames, animations, and relaxation remain separate and are not enabled by these choices.

A missing saved structure is distinct from scientific rejection or acceptance. No finite prediction can mean no structure; an early exit can have a structure but no scored metrics. Never invent scores or claim to recover historical unsaved structures. The website defaults to trajectories with structures while keeping full CSV downloads and attempt counts. The candidates API supports `view=diagnostics&structures_only=true` for BindCraft2; it filters before pagination, reports `total` and `overall_total`, and invalidates cursors when publication/filter changes. Omitted/false keeps all rows. Older publications use bounded discovery and may require retrieving the CSV and artifacts directly.

Whole-chain hotspot/coldspot selectors are supported: `A` means all protein residues in selected chain A; mix with numbered selections such as `A,B12-16`. The accepted job retains the shorthand. The server validates author numbering against uploaded bytes and expands whole chains before native execution. Missing/unselected chains and negative numbering are rejected; insertion-code restrictions remain. This applies to structured targets only, not FASTA or scaffold edits. Preserve chain IDs and do not renumber inputs implicitly.
