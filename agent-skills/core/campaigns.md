# Campaign planning and review

Read this before choosing a campaign size, GPU policy, or next design wave.
These are Ariax operating recommendations, not automatic spending authorization
or guarantees of experimental success. Preserve explicit user limits, including
a one-design test. When size is unspecified, suggest a representative pilot
and a review point; carry forward any existing authorization. Comparable prior
campaign evidence can replace a new pilot.

## Establish the design objective

Briefly identify the exact target construct and biological state, intended
epitope/mechanism, binder modality, and any required selectivity. Check relevant
oligomeric partners, neighboring domains, glycans, cofactors, and membrane or
assay context. Use primary structures/literature to resolve uncertainties that
could change the design. Keep this note proportional to the task.

Trim targets to the smallest region that preserves the binding site's fold and
relevant physical context. A crop can expose an artificial surface; check
shortlisted poses against the larger biological assembly when available. Record
the chosen chains, numbering, and crop so structural comparisons remain clear.
Use only inputs and controls supported by the live Ariax schema.

## Choose a size and review point

| Engine | Suggested pilot when the user has not specified a size |
| --- | --- |
| PXDesign | **25–50 designs**, including downstream evaluation. |
| BoltzGen | **25–50 generated designs**. `num_designs` is generated volume; `budget` is the final selected-set size, not a dollar limit. |
| ESMFold2-pipeline | **25–50 designs**, including ESMFold2 and Protenix evaluation. Counts are total across frameworks. |
| BindCraft / FreeBindCraft | Choose an **accepted-design** target. Periodically review trajectories and acceptance; **zero accepted after 25–40 trajectories** is a reason to discuss stopping and revising settings, filters, hotspots, or target trim. |
| BindCraft2 | Start with **2 accepted designs** and, when a bounded pilot is wanted, **20 maximum trajectories**. Review attempted/accepted/refolded/ranked counts and per-attempt adaptation before scaling. |

These are starting suggestions, not required minimums or automatic scale-up
targets. A representative pilot uses the intended construct, binder modality,
models, and workflow stages, including downstream evaluation. A smoke test can
check execution without providing reliable evidence for scaling. Successful
validation or submission alone is insufficient. Review high-scoring, typical,
and failed examples instead of only the best candidate. A small pilot with no
passes does not prove the target is undesignable.

BindCraft runtime is especially uncertain: it stops on accepted designs, so
high acceptance can finish quickly while low or zero acceptance can continue
indefinitely. The 25–40-trajectory review point is not an automatic abort or
proof of a software failure. Follow the user's agreed lifecycle policy when
stopping or reconfiguring; scientific changes require a new project, not restart.
BindCraft2's `max_trajectories` is an attempt cap rather than a spend cap. A
pilot can finish with `attempt_limit_reached` and zero accepted designs; do not
relaunch it implicitly. Design counts and trajectory caps bound campaign scope,
not exact dollar spend. Neither a local monitor nor the account balance guarantees
an absolute spending ceiling. If the user requires one, explain the limitation
and resolve an acceptable scope before starting compute; do not promise an
arbitrary cutoff will enforce it.

## Choose compute for the whole workflow

Read the chosen engine's GPU guidance. Consider the effective target length
across selected chains plus the binder, and the largest structure actually
evaluated downstream. Missing coordinates do not necessarily remove residues
from a model's sequence input. Target-size recommendations are approximate;
model settings, binder size, and retained context also affect memory.

Run `ariax pricing --json` to check current hourly prices. Select a range of
compatible GPU models within the user's hourly price preferences to maximize
availability, retaining the necessary VRAM. Verify identifiers and eligibility
with `ariax schema PROTOCOL --json` before setting GPU preferences. Follow the
[shared pricing guidance](../SKILL.md#check-prices-and-choose-gpus) for allocation
rates and use the evidence rules below for campaign forecasts.
The [shared GPU policy table](../SKILL.md#check-prices-and-choose-gpus) requires
at least one protocol-compatible core GPU; supplemental classes alone are
insufficient. A single core GPU is valid but has fewer availability options.
Select every compatible class within the authorized memory and hourly budget
limits. If none fits, explain the conflict instead of broadening the policy or
adding a GPU that cannot fit the workload. `priority_mode` ranks eligible
alternatives; it does not set a GPU count.

Recommend **Turbo mode for long campaigns** within the user's authorized compute
policy. Turbo distributes campaign work across GPUs; it does not combine their
VRAM to make an oversized individual design fit. It can reduce campaign wall
time while increasing concurrent spend; it does not improve individual design
quality or guarantee a lower total cost. Read the shared workflow for supported
GPU-policy changes and recovery.

## Forecast from observed work

Before comparable execution evidence exists, report current allocation-hour
prices and explain the uncertainty in runtime and total cost. After a
representative pilot or comparable prior campaign, use observed work, runtime,
and recorded charges to forecast the proposed scope. State the assumptions and
material differences in construct, settings, GPU class, concurrency, or evaluation
stages. A forecast is not a quote or guarantee.

Inspect every job and allocation across attempts, including retries; follow any
remaining pagination and use `--details` when compact views omit needed evidence.
Sum recorded charges across allocations and attempts; distinguish total
allocation runtime from elapsed wall time when allocations overlap. Prefer
recorded costs to calculations from rates and runtime, and label those calculations
as estimates. Distinguish historical costs from future forecasts and leave missing
values unknown. The newest `started_at` is not the whole campaign.
Allocation-hour rates already cover the full allocation: do not multiply by GPU
count again. Separate startup overhead from repeated work only when the records
support it, and give ranges only when evidence supports their bounds.

Use the unit that drives work: generated designs or attempted trajectories,
with downstream evaluation included. BindCraft2 trajectories can take different
paths through expensive stages; a trajectory cap alone does not fix runtime.
Zero accepted designs provides no cost-per-accepted-design estimate. Positive
pilot acceptance is still uncertain at small sample sizes. Do not assume linear
Turbo speedup or identical performance across GPU classes.

Choose the next scope from useful candidate yield, observed cost, the user's
objective, and remaining authorized spending. Carry forward existing approval;
ask only for a material change outside it. A pilot review is a decision point,
not an automatic stop, restart, or large campaign launch.

## Decide the next wave from evidence

Use the [interpretation guide](interpretation.md) and engine output reference to
separate confidence, pose agreement, native filter passes, and biological
objective fulfillment. Keep criteria consistent within a comparison; disclose
changes instead of silently relaxing filters to obtain a desired count.

Report generated/attempted, evaluated, native filter-passing, objective-respecting,
and distinct shortlisted counts **where supported by evidence**. Label the unit:
BindCraft and BindCraft2 trajectories and accepted sequence variants are different populations.
Use the [shared count-source guidance](../SKILL.md#results-and-errors) and complete
[candidate retrieval](candidates.md); state unavailable counts rather than
inventing them. Retain result paths and the settings used for the comparison.

For ESMFold2, inspect exclusion stages, confidence/pose
distributions, framework coverage, and distinct useful yield. Projecting another
wave from that yield is approximate and does not estimate experimental hit rate.
Across multiple targets, allocate effort according to each objective's unmet
needs, useful yield, diversity, and marginal improvement; raw scores across
unrelated targets are not a common measure of progress. Recommend a deliberate
change of settings, epitope, crop, or engine when further identical sampling
looks unproductive, within the user's scientific scope.

End a review with a concise evidence-backed recommendation: scale, continue
monitoring, revise, or stop. Explain whether the intended workflow completed,
whether credible candidates meet the user's criteria at the intended site, and
what observed cost and yield justify the proposed next scope. Identify any
recommended change and whether the hosted schema supports it. Include important
limitations and supporting candidate artifacts; retain useful partial results
before considering recovery or another compute attempt.
