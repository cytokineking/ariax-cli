# Campaign planning and review

Read this before choosing a campaign size, GPU policy, or next design wave.
These are Ariax operating recommendations, not automatic spending authorization
or guarantees of experimental success. Preserve explicit user limits, including
a one-design test. When size is unspecified, suggest a pilot and a larger
campaign option with a review point; carry forward any existing authorization.

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

| Engine | Suggested progression when the user has not specified a size |
| --- | --- |
| PXDesign | Pilot of **25–50 designs**, inspect outputs, then typically **10,000–20,000** for a full campaign. |
| BoltzGen | Pilot of **25–50 designs**, inspect outputs, then typically **10,000–20,000** for a full campaign. `num_designs` is generated volume; `budget` is the final selected-set size. |
| ESMFold2-pipeline | Pilot of **25–50 designs**, then **1,000** initially. Review quality, diversity, and useful candidate yield before recommending another campaign. Counts are total across frameworks. |
| BindCraft / FreeBindCraft | Choose an **accepted-design** target. Periodically review trajectories and acceptance; **zero accepted after 25–40 trajectories** is a reason to discuss stopping and revising settings, filters, hotspots, or target trim. |

Pilots check that the actual pipeline produces interpretable candidates at the
intended site. Inspect final evaluation outputs as well as generation; successful
validation or submission alone is insufficient. Review high-scoring, typical,
and failed examples instead of only the best candidate. A small pilot with no
passes does not prove the target is undesignable.

BindCraft runtime is especially uncertain: it stops on accepted designs, so
high acceptance can finish quickly while low or zero acceptance can continue
indefinitely. The 25–40-trajectory review point is not an automatic abort or
proof of a software failure. Follow the user's agreed lifecycle policy when
stopping or reconfiguring; scientific changes require a new project, not restart.

## Choose compute for the whole workflow

Read the chosen engine's GPU guidance. Consider the effective target length
across selected chains plus the binder, and the largest structure actually
evaluated downstream. Missing coordinates do not necessarily remove residues
from a model's sequence input. Target-size recommendations are approximate;
model settings, binder size, and retained context also affect memory.

More powerful compatible GPUs generally finish faster. Higher hourly prices
can be offset by shorter runs, so compare time and cost per useful result rather
than hourly price alone. Use pilot runtime and recorded allocation costs when
available; do not promise a fixed speedup or cheaper total. Retain necessary
VRAM even when choosing for cost. Verify current identifiers and eligibility
with `ariax schema PROTOCOL --json` before setting GPU preferences.

Recommend **Turbo mode for long campaigns** within the user's authorized compute
policy. Turbo distributes campaign work across GPUs; it does not combine their
VRAM to make an oversized individual design fit. It can reduce campaign wall
time while increasing concurrent spend; it does not improve individual design
quality or guarantee a lower total cost. Read the shared workflow for supported
GPU-policy changes and recovery.

## Decide the next wave from evidence

Use the [interpretation guide](interpretation.md) and engine output reference to
separate confidence, pose agreement, native filter passes, and biological
objective fulfillment. Keep criteria consistent within a comparison; disclose
changes instead of silently relaxing filters to obtain a desired count.

Report generated/attempted, evaluated, native filter-passing, objective-respecting,
and distinct shortlisted counts **where supported by evidence**. Label the unit:
BindCraft trajectories and accepted sequence variants are different populations.
Use the [shared count-source guidance](../SKILL.md#results-and-errors) and complete
[candidate retrieval](candidates.md); state unavailable counts rather than
inventing them. Retain result paths and the settings used for the comparison.

For ESMFold2 after the first 1,000, inspect exclusion stages, confidence/pose
distributions, framework coverage, and distinct useful yield. Projecting another
wave from that yield is approximate and does not estimate experimental hit rate.
Across multiple targets, allocate effort according to each objective's unmet
needs, useful yield, diversity, and marginal improvement; raw scores across
unrelated targets are not a common measure of progress. Recommend a deliberate
change of settings, epitope, crop, or engine when further identical sampling
looks unproductive, within the user's scientific scope.

End a review with a concise evidence-backed recommendation: scale, continue
monitoring, revise, or stop. Include important limitations and the candidate
artifacts supporting that recommendation. Retain useful partial results before
considering recovery or another compute attempt.
