---
name: ariax-bindcraft
description: Configure, submit, monitor, and retrieve Ariax BindCraft v1.5 campaigns for de novo miniprotein or linear alpha-helical peptide binders against a protein PDB.
---

# Ariax BindCraft v1.5

Classic AlphaFold2-hallucination + ProteinMPNN + structural-filtering workflow for
de novo miniprotein or linear alpha-helical peptide binders. For new campaigns
(or VHH, cyclic peptide, multi-target, scaffold, or small-molecule design),
compare options in [engine choice](../../core/engine-choice.md). For shared
auth, GPU/pricing rules, direct upload, recovery, logs, and results, see
[managed lifecycle](../../core/managed-projects.md) and
[recovery](../../core/recovery.md). Native Forge commands are separate
([FreeBindCraft](../ariax-forge/tools/freebindcraft.md)).

## Scope & GPU sizing

- **Supported:** `miniprotein` (`lengths` `[min, max]` with `min >= 31`, web default `[65, 150]`) and linear alpha-helical `peptide` (`lengths` within `8–30`, web default `[8, 25]`). Not for cyclic peptides, stapled helicons, VHH/antibodies, or small-molecule targets.
- **Core GPUs:** `H100`, `A100_80GB`, `L40S`, `RTX6000PRO` (see [GPU policy](../../core/managed-projects.md#3-pricing-and-gpu-policy)).
- **Target size guidance:** targets ≤150 aa fit any supported GPU; 300–700 aa strongly prefer H100/H200/B200/B300 (or `RTX6000PRO`); targets >700 aa risk OOM/high cost — trim to the relevant domain while keeping fold context.

## Contract, presets & scoring

Fetch `ariax schema bindcraft-v1.5 --json` and start from
[bindcraft-v1.5.json](../../examples/bindcraft-v1.5.json).

- **Scoring (`use_pyrosetta`):** Always set explicitly (omission selects PyRosetta).
  - `use_pyrosetta: false`: open-source FreeBindCraft path (OpenMM relaxation/scoring). Metrics are not numerically interchangeable with PyRosetta; Rosetta energy/H-bond/PackStat columns carry fixed placeholders.
  - `use_pyrosetta: true`: traditional PyRosetta scoring — use only after the user confirms PyRosetta/Rosetta license eligibility.
- **Miniprotein filter presets:** `default_filters`, `relaxed_filters`, `no_filters`.
- **Miniprotein advanced presets (16 combinations):** base (`default_4stage_multimer` or `betasheet_4stage_multimer`) + optional suffix (`""`, `_flexible`, `_hardtarget`, `_flexible_hardtarget`, `_mpnn`, `_mpnn_flexible`, `_mpnn_hardtarget`, `_mpnn_flexible_hardtarget`). Default to `default_4stage_multimer` unless a specialized variant is requested.
- **Peptide filter presets:** `peptide_filters`, `peptide_relaxed_filters`, `no_filters`.
- **Peptide advanced presets:** `peptide_3stage_multimer`, `peptide_3stage_multimer_flexible`, `peptide_3stage_multimer_mpnn`, `peptide_3stage_multimer_mpnn_flexible`.
- `design_override: true` permits cross-family preset combinations (keep omitted normally; never relaxes length bounds). Do not silently weaken filter presets.
- `num_designs` is the accepted-design target (a trajectory can yield two designs, so final count may exceed `num_designs`). Runtime depends on acceptance; review early trajectories via [campaign planning](../../core/campaigns.md).

## Target PDB & author numbering

- **PDB required** (mmCIF is rejected; ≤10 MB UTF-8 with protein `ATOM` records).
- `chains`: comma-separated PDB chain IDs; include every chain whose physical occupancy constrains the binder.
- `hotspots` (optional; empty searches the whole surface): PDB **author residue numbers** (`A45`, `A45-50`, `A45,A50-55,B20`, or whole-chain `A`). Hotspots steer optimization rather than guaranteeing contact.

## Validate, submit & outputs

```sh
ariax inputs inspect --input ./target.pdb -f bindcraft-job.json --json
ariax validate -f bindcraft-job.json --input ./target.pdb --json
ariax submit -f bindcraft-job.json --input ./target.pdb --name my-bindcraft-run --wait
```

Retained outputs: accepted-design PDBs (including ranked copies), relaxed
trajectory PDBs, `final_design_stats.csv`, `trajectory_stats.csv`, and compute
logs (rejected designs/animations are not retained). Read
[output interpretation](outputs.md) before shortlisting; fallback REST guidance
is in [raw REST](../../core/raw-curl.md).
