---
name: ariax-bindcraft2
description: Configure, validate, submit, monitor, and interpret hosted Ariax BindCraft2 campaigns for de novo proteins, peptides, cyclic peptides, VHH, scFv, Fab, ARP, homo-oligomers, multidomain, and multi-target binders.
---

# Ariax BindCraft2

Default hosted AF2-optimization + ProteinMPNN + refolding/filtering protocol
across protein, peptide, scaffold, and antibody modalities. See
[engine choice](../../core/engine-choice.md) to compare protocols,
[managed lifecycle](../../core/managed-projects.md) for auth/GPU/pricing/upload/results,
and [recovery](../../core/recovery.md) for retries or failures. Native Forge
BindCraft2 is a separate runtime ([Forge BindCraft2](../ariax-forge/tools/bindcraft2.md)).

## Engine version & modalities

Fetch `ariax schema bindcraft2 --json` (or `--raw` for JSON Schema) for current
`native_capabilities` (v1.0.4+). `ariax restart` preserves the recorded engine
and settings; never add runtime identity fields to `advanced`.

Use exact case-sensitive tokens in `protocol_config.modality` (`induced_fit` and
`fold_switch` are optional modifiers requiring one prepared target state):

| Modality | `project_type` | Setup notes |
| --- | --- | --- |
| `binder` / `large_binder` | `miniprotein` / `protein` | De novo two-value `lengths` range (`large_binder` needs larger VRAM review) |
| `peptide` / `cyclic_peptide` | `peptide` / `cyclic-peptide` | Linear or head-to-tail cyclic peptide (stapled helicons use BoltzGen) |
| `VHH` / `scFv` / `Fab` | `vhh` / `scfv` / `fab` | Bundled or custom scaffold (`scFv` designs VH+VL without a linker) |
| `ARP` | `arp` | Ankyrin-repeat scaffold (`DARPin`/`darpin` legacy aliases) |
| `homo_oligomer` / `multidomain` | `protein` | Per-copy `lengths` + `copies` or multi-domain controls |

## Multi-file input bundle & scaffolds

- First target must be `input.pdb` or `input.cif` (primary FASTA is deferred). Up to 8 targets and 9 unique files (including optional custom scaffold); secondary targets may be PDB, mmCIF, or FASTA. Config filenames are local bundle basenames.
- Uses **author residue numbering**; whole-chain hotspot/coldspot shorthands (`A`, `A,B12-16`) are supported on structured targets (not FASTA or scaffold edits). Do not translate BoltzGen canonical numbers.
- Secondary FASTA targets select the named record and cannot carry hotspots/coldspots. Detargeting requires `objective: "detarget"` and a final ceiling.
- **Custom scaffolds:** supply `scaffold_file` + `mutate_positions` (e.g., `A50-55(5-8)` for variable length; omit de novo `lengths`). `!` or `-DESIGN` holds a span fixed (cannot resize: `A50-55(6)!` valid, `A50-55(5-8)!` invalid); `+DESIGN` re-enables editing.
- **Bundled VHH scaffold:** omit `binder` to inherit the qualified mutation selection. Supplying `mutate_positions` replaces it; plain spans mark editable paratope and `*` marks editable framework (`DESIGN` without `CONTACT`). Editing only paratope requires `advanced.weights_binder_intra_coldspot: 0` if accepted by the live schema.

## Properties, v1.0.4 controls & `aa_bias`

- **Nine canonical optional properties:** `hard_target`, `large_complex`, `disulfide_staple`, `forced_targeting`, `humanize`, `mixed_topology`, `protease_stable`, `termini_accessible`, `termini_together` (`bigbang`/`initial_guess` are deprecated aliases for `large_complex`/`hard_target`).
  - `forced_targeting` requires hotspots on every target state and cannot combine with `objective: "detarget"` or FASTA targets — ask the user before dropping either.
  - Preserve omitted vs. `0` vs. `false` distinctly.
- **v1.0.4 `protocol_config.advanced` controls:**
  - `confidence_floor` (`0..1`, default `0.7`): weight threshold for conformational / `Induced_Fit_*` checks (`induced_fit` asks ≥2 Å movement; `fold_switch` asks `Induced_Fit_TM <= 0.85` and `Induced_Fit_RMSD >= 1` Å).
  - `mutate_gate_draws` (`1..8`, default `1`): fresh predictions per mutate-stage gate (selects lowest weighted design loss).
  - `desperation_trajectories` (default `750` when omitted; `0` triggers rung 1 immediately when `desperation` is enabled): warn if threshold exceeds `campaign.max_trajectories`.
  - `aa_bias`: relative propensities (`0` exclude, `<1` discourage, `1` neutral override, `>1` favor) over standard uppercase 1-letter codes. Submit only explicit overrides so unset residues inherit preset defaults (e.g., VHH `C=0, F=0.9, Y=0.9`); never exclude all 20 residues. Check normalized map via `ariax validate ... --details --json`.
  - **Saved structures:** `save_design_trajectory`, `save_failed_trajectories`, `save_failed_refolds`, and `save_binder_monomers` default to `true` on new campaigns; explicit `false` is preserved.

## Inspect, validate, submit & review

Start from [`bindcraft2-pilot.json`](../../examples/bindcraft2-pilot.json) or
[`bindcraft2-formats/`](../../examples/bindcraft2-formats/) (note the cyclic
example intentionally uses `lengths: [8, 14]`):

```sh
ariax inputs inspect --input-dir ./bc2-inputs -f bc2-job.json --json
ariax inputs prepare --input-dir ./bc2-inputs -f bc2-job.json --output ./bc2-prepared --json
ariax validate -f ./bc2-prepared/job.json --input-dir ./bc2-prepared --json
ariax submit -f ./bc2-prepared/job.json --input-dir ./bc2-prepared --name bc2-pilot --wait --json
```

Use `--input-dir` (or single-file `--input` only when config requires solely
`input.pdb`/`input.cif`). Core GPUs: `H100`, `A100_80GB`, `L40S`, `RTX6000PRO`
([GPU policy](../../core/managed-projects.md#3-pricing-and-gpu-policy)).
`max_trajectories` caps attempts, not spend.

After completion, run `ariax status PROJECT_UUID --json` and follow
`data.action.command` (`final` → `all` → `diagnostics`; `view=diagnostics&structures_only=true`
filters to trajectories with structures). Always read attempted, accepted,
trajectory, refolded, and ranked counts together; zero accepted designs is a
scientific outcome, not an execution failure. Read [BindCraft2 outputs](outputs.md)
for metric units and candidate tables.
