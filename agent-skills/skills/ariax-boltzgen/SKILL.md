---
name: ariax-boltzgen
description: Design VHH nanobodies, miniproteins, linear or cyclic peptides, stapled helicons, and small-molecule binders with hosted BoltzGen on Ariax.
---

# BoltzGen on Ariax

All-atom diffusion + inverse-folding + refolding/filtering binder protocol.
Default managed choice for VHH/nanobodies, small-molecule targets, and stapled
helicons (see [engine choice](../../core/engine-choice.md)). For shared auth,
GPU/pricing policy, direct upload, recovery, logs, and results, see
[managed lifecycle](../../core/managed-projects.md) and
[recovery](../../core/recovery.md). Native Forge BoltzGen is separate
([Forge BoltzGen](../ariax-forge/tools/boltzgen.md)).

## Supported project types

| `project_type` | Behavior | `lengths` | Target input |
| --- | --- | --- | --- |
| `vhh` | Bundled VHH scaffold set | Omit | PDB/mmCIF + `chains` |
| `miniprotein-small-molecule` | Miniprotein vs. one ligand | `[min, max]` (`min >= 31`) | Exactly one of `ligand_ccd` (CCD code) or `ligand_smiles`; omit `chains` and `--input` |
| `helicon` | Fixed stapled-helical peptide | Omit | PDB/mmCIF + `chains` |
| `cyclic-peptide` | N-to-C cyclic peptide | `[min, max]` (`8–30`) | PDB/mmCIF + `chains` |
| `peptide` | Linear peptide | `[min, max]` (`8–30`) | PDB/mmCIF + `chains` |
| `miniprotein` | Variable-length miniprotein | `[min, max]` (`min >= 31`) | PDB/mmCIF + `chains` |

Not supported in managed BoltzGen: arbitrary upstream YAML, Fab/whole-antibody
design, protein redesign, nucleic-acid targets, or custom bond/secondary-structure
constraints. Core GPUs: `H100`, `A100_80GB`, `L40S`, `RTX6000PRO` (scale VRAM
with target + binder size; see [GPU policy](../../core/managed-projects.md#3-pricing-and-gpu-policy)).

## Job spec & canonical `binding_rules`

Fetch `ariax schema boltzgen --json` and start from
[`boltzgen.json`](../../examples/boltzgen.json). `num_designs` is generated
volume; `budget` (`1..num_designs`) is the quality-and-diversity final set size
(not a dollar cap or guaranteed pass count).

`binding_rules` is a list of `{id, binding?, not_binding?}` using **canonical
1-based sequence positions** (not PDB author numbers):

- Masks use commas, `..` inclusive ranges, and `all` (e.g., `{"id": "A", "binding": "5..7,13", "not_binding": "30..40"}`). Never use `-` or chain prefixes inside masks; never overlap `binding` and `not_binding`.
- **mmCIF:** uses `label_asym_id` chain IDs and absolute `label_seq_id` positions (avoid solvent label chains).
- **PDB:** first observed residue maps to canonical `1` (the CLI reports shifts). Gapped PDBs without `SEQRES` or gapped mmCIFs without polymer metadata are rejected — repair or supply complete mmCIF metadata rather than guessing across gaps.

## Validate, submit & outputs

```sh
# Protein-target mode (--input required on both validate and submit):
ariax inputs inspect --input ./target.cif -f job.json --json
ariax validate -f job.json --input ./target.cif --json
ariax submit -f job.json --input ./target.cif --name my-boltzgen-run --wait

# Small-molecule mode (omit --input):
ariax validate -f job.json --json
ariax submit -f job.json --name my-boltzgen-run --wait
```

Outputs live under `output/` (intermediates, refolds, and
`final_ranked_designs-*/final_<budget>_designs`; small-molecule mode adds
affinity analysis). Inverse-folded intermediate CIFs can hold zero-placeholder
sidechains — inspect refolded or final-ranked complexes. Read
[output interpretation](outputs.md) before shortlisting; fallback REST guidance
is in [raw REST](../../core/raw-curl.md).
