---
name: ariax-esmfold2-pipeline
description: Configure, validate, submit, monitor, and retrieve hosted ESMFold2-pipeline binder campaigns for miniproteins, VHH nanobodies, or scFvs with Protenix v2 validation.
---

# ESMFold2-pipeline on Ariax

Hosted ESMFold2 sequence inversion + ESMFold2 critic refolding + mandatory
Protenix v2 validation and consensus ranking. See
[engine choice](../../core/engine-choice.md) to compare protocols,
[managed lifecycle](../../core/managed-projects.md) for auth/GPU/pricing/upload/results,
and [recovery](../../core/recovery.md) for retries or failures. Native Forge
ESMFold2-pipeline has a separate bounded qualification
([Forge ESMFold2-pipeline](../ariax-forge/tools/esmfold2-pipeline.md)).

## Modalities, frameworks & VRAM

- **`miniprotein`:** de novo binder using `binder.length`.
- **`vhh`:** single-domain nanobody CDR design on bundled VHH frameworks (`caplacizumab_framework_vhh`, `ozoralizumab_tnf_framework_vhh`, `vobarilizumab_il6r_framework_vhh`).
- **`scfv`:** paired VH-linker-VL heavy+light CDR design on bundled scFv frameworks (`anifrolumab`, `atezolizumab`, `avelumab`, `belimumab`, `daratumumab`, `dupilumab`, `guselkumab`, `lebrikizumab`, `panitumumab`, `pembrolizumab`, `secukinumab`, `tezepelumab`, `tralokinumab`, `trastuzumab` — each suffixed `_framework_vhvl`).
- Use `binder.frameworks: "all"` or a live-schema-verified subset; `num_designs` is the total count across frameworks. Not for plain ESMFold2 folding, peptides, small molecules, or custom frameworks.
- **VRAM & core GPUs:** requires **≥80 GB VRAM per GPU** (`A100_80GB` minimum; core GPUs: `H100`, `A100_80GB`, `RTX6000PRO`; see [GPU policy](../../core/managed-projects.md#3-pricing-and-gpu-policy)). Keep **scFv targets under 400 aa** (scFv itself is ~300 aa).

## Contract invariants & advanced controls

Fetch `ariax schema esmfold2-pipeline --json` and start from
[`esmfold2-pipeline.json`](../../examples/esmfold2-pipeline.json) (scientific
fields nest under `protocol_config`). Fixed invariants (not user-configurable):
150 optimization steps, critic tied to inversion model, mandatory Protenix v2
validation with structural templates, and up to 100 copied top-ranked structure
pairs (all eligible rows stay in the ranking table).

Optional `protocol_config.advanced` contact controls (omit unless needed):
- `binder_target_contact_mode`: `legacy` (default for miniprotein) or antibody-only `mosaic_cdr` (default for VHH/scFv).
- `mosaic_cdr_contact_weight` (`0.5`), `mosaic_cdr_contact_cutoff_angstrom` (`22`), `mosaic_cdr_num_target_contacts` (`3`).
- `mosaic_framework_contact_penalty_weight` (`0`, VHH/scFv only), `mosaic_framework_contact_penalty_cutoff_angstrom` (`22`), `mosaic_framework_contact_probability_threshold` (`0.2`), `mosaic_framework_contact_penalty_scope` (`auto`|`hotspot`|`target_all`), `hotspot_critic_contact_cutoff_angstrom` (`5`).
- Public MSA can be disabled; in scFv validation, public MSA applies to the target only (framework supplies the binder template).

## Target preparation & sequences

- **Upload (`target.source: "upload"`):** pass `.pdb`/`.cif`/`.mmcif` via `--input` (omit `target.object_key`). One-char alphanumeric chain IDs required; the CLI normalizes mmCIF author chains and fills missing `_atom_site.auth_atom_id` from `label_atom_id` in the uploaded copy.
- **RCSB (`target.source: "rcsb"`):** 4-char `pdb_id`, omit `--input` — or prefer `ariax inputs prepare --pdb ID -f job.json --output ./prepared` to pin an exact checked snapshot.
- **Author residue numbers:** `target.hotspots` (e.g., `["C:1-10"]`) and `target.crop` (e.g., `{"C": ["1-180", "190"]}`) use author numbering; insertion codes are unsupported.
- **Full sequences:** required for distogram/template conditioning even across unresolved gaps. Resolution order: `protocol_config.target.sequences` → `SEQRES`/polymer metadata → contiguous coordinates → prompt (never prompts in `--json`; ask the user for the exact 20-AA sequence rather than guessing).

## Validate, submit & outputs

```sh
ariax inputs inspect --input ./target.cif -f esmfold2-job.json --json
ariax validate -f esmfold2-job.json --input ./target.cif --json
ariax submit -f esmfold2-job.json --input ./target.cif --name my-esmfold2-run --wait
```

Immediate 0% failure with an `auth_atom_id` or atom-site error is an input
parser mismatch — do not retry unchanged inputs or switch GPUs; re-validate
with the current CLI.

Result roots (`ariax results PROJECT --path <root>`): `esmfold2/`,
`validation/protenix_v2/`, `ranked_results/` (start with `combined_ranking.csv`
and `ranking_diagnostics.csv`), and `archives/`. Read
[output interpretation](outputs.md) before shortlisting; fallback REST guidance
is in [raw REST](../../core/raw-curl.md).
