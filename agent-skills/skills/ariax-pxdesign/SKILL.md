---
name: ariax-pxdesign
description: Configure, launch, monitor, and retrieve hosted PXDesign Extended miniprotein-binder campaigns on Ariax with target-chain sequences and format-specific residue registers.
---

# PXDesign on Ariax

Diffusion-based de novo **miniprotein binder** workflow running the full
Extended pipeline: (1) diffusion backbone generation, (2) AF2-IG evaluation,
(3) Protenix evaluation, and (4) combined ranking. For other modalities or
engines, see [engine choice](../../core/engine-choice.md); for auth, pricing,
uploads, recovery, logs, and results, see
[managed lifecycle](../../core/managed-projects.md) and
[recovery](../../core/recovery.md). Native Forge PXDesign (including preview
mode) is separate ([Forge PXDesign](../ariax-forge/tools/pxdesign.md)).

## Scope, GPU rules & job contract

- **Miniprotein only** (`protocol: "pxdesign"`, `project_type: "miniprotein"`). Does not support VHH, peptides, cyclic peptides, helicons, scFvs, small molecules, preview-only mode, or custom `msa_by_chain` (Ariax builds MSAs automatically).
- **Core GPUs:** `H100`, `A100_80GB`, `L40S`. **Excludes Blackwell GPUs and `RTX6000PRO`** (see [GPU policy](../../core/managed-projects.md#3-pricing-and-gpu-policy)).
- Fetch `ariax schema pxdesign --json` and start from [`pxdesign.json`](../../examples/pxdesign.json). Keep PXDesign fields at the **top level** (not inside `protocol_config`): `chains` (comma-separated string, e.g., `"A,B"`), `binder_length`, `num_designs`, and optional canonical maps `hotspots_by_chain: {"A": [10, 14, 18]}`, `crop_by_chain: {"A": ["1-50", "80-100"]}`, `sequence_by_chain: {"A": "MKT..."}`.

## Target preparation & residue registers

PDB and mmCIF registers are **not interchangeable**:

- **PDB input:** allowed **only** when the resolved full sequence and observed coordinates are contiguous (gapped PDBs are rejected because the converter discards `SEQRES`). `hotspots_by_chain` and `crop_by_chain` use **PDB author residue numbers**.
- **Direct mmCIF input:** required for gapped structures; uses `label_asym_id` and 1-based `label_seq_id`. Selected protein chains must have matching author and label IDs (unselected-chain mismatches are ignored). The CLI repairs missing mmCIF polymer metadata in the uploaded copy when a full sequence is available.
- **Full-sequence resolution order:** `sequence_by_chain` → PDB `SEQRES` / mmCIF polymer metadata → contiguous coordinates → interactive prompt (never prompts in `--json`/piped mode; ask the user for the exact sequence rather than guessing across gaps). Full sequences remain required even when `crop_by_chain` selects a domain.
- Every hotspot must fall inside its effective crop; insertion codes (e.g., `27A`) are unsupported (renumber cleanly first). To match web **Bind Anywhere**, populate hotspots with every observed residue in the effective crop.

## Validate, submit & outputs

```sh
ariax inputs inspect --input ./target.cif -f pxdesign-job.json --json
ariax validate -f pxdesign-job.json --input ./target.cif --json
ariax submit -f pxdesign-job.json --input ./target.cif --name my-pxdesign-run --wait
```

Start final review with `output/results/<project-name>/summary.csv` (AF2-IG and
Protenix scores and separate pass flags) alongside diffusion, AF2, and Protenix
complexes. Output condition chains may be deterministically relabeled (`A0`,
`B0`, ...) with the designed binder as the final chain. Read
[output interpretation](outputs.md) before shortlisting; fallback REST guidance
is in [raw REST](../../core/raw-curl.md).
