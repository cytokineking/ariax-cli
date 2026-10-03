# Verify results and preserve identity

With input `complex.yaml` and `--out_dir ROOT`, the actual native prefix is `ROOT/boltz_results_complex/`. Under `predictions/complex/`, rank `r` has:

| File | Meaning |
| --- | --- |
| `complex_model_r.cif` | Predicted coordinates (or `.pdb` when requested). |
| `confidence_complex_model_r.json` | Aggregate and chain-pair confidence for that rank. |
| `plddt_complex_model_r.npz` | Key `plddt`, per-token confidence in 0–1. |
| `pae_complex_model_r.npz` | Key `pae`, square token-by-token PAE in Å, when requested. |
| `pde_complex_model_r.npz` | Key `pde`, pairwise distance-error estimate in Å, when requested. |

The filename index is descending confidence rank, not the original diffusion sample index. Keep each rank's files together. Directory inputs add their own `boltz_results_<directory stem>` prefix; verify actual manifest IDs rather than flattening similarly named files.

Check finite coordinates and arrays, expected chain composition and complete input sequences, number of requested samples, square PAE shape and matching pLDDT/token count. Dimensions alone do not prove identity. Compare originating command, input record, sequences and rank before using a pair. Do not pair a relaxed, cropped, reordered, or renamed structure with the original PAE without an explicit verified mapping. Preserve the raw predictions.

Native standard residues occupy one token; nonstandard residues and ligands can occupy one token per atom. Chain-pair JSON uses internal numeric chain indices, not necessarily YAML chain labels. The schema groups identical entities and the writer can remove invalid chains; inspect processed records, structure chain tables, and emitted CIF identities to map them. Do not infer token order solely from FASTA length or assume a mixed complex PAE is a protein residue matrix. Modified/mixed-entity handoffs require validation of the downstream parser's token model.

Confidence JSON includes `confidence_score`, `ptm`, `iptm`, `ligand_iptm`, `protein_iptm`, `complex_plddt`, `complex_iplddt`, `complex_pde`, `complex_ipde`, `chains_ptm`, and `pair_chains_iptm`. The rank score weights complex pLDDT by 0.8 and ipTM by 0.2, using pTM when the model's ipTM vector is zero. pTM/ipTM/pLDDT summaries are 0–1; coordinate B-factor fields carry pLDDT scaled to 0–100, not experimental thermal motion. PAE/PDE are errors in Å; PAE is directional and need not be symmetric. Inspect the relevant chain pair rather than a global average. High confidence is not a measured affinity, correct biological state, or experimental validation; no universal score threshold qualifies a binder.

## Handoff to interface scoring

For a protein-complex ipSAE request retain the raw, same-rank CIF plus raw `pae_…npz`, pLDDT NPZ, confidence JSON, original YAML, sequences/MSAs/templates, and `processed/records/<id>.json`, `processed/structures/<id>.npz`, and processed manifest. Record an explicit input-chain → emitted-chain/internal-index mapping and biological residue → input-position mapping, including missing/modified residues. Retain the original native argv, seed/settings, input ID, rank, session and command IDs. Download the matched files from one completed checkpoint before handoff.

Read [ipSAE mapping and parser limits](ipsae-inputs.md), available as `ariax skills forge --reference ipsae-inputs --read --json`, before handoff. Do not invent JSON conversion keys, symmetrize PAE, silently discard ligand tokens, or treat pLDDT-only output as PAE. A missing, mismatched, or unverifiable structure/PAE pair blocks scoring until the original matching artifact is recovered; a fresh prediction needs its own authorized run and provenance. Protein–ligand affinity is a separate head, not an ipSAE output.

Source: [2.2.1 writer](https://github.com/jwohlwend/boltz/blob/v2.2.1/src/boltz/data/write/writer.py). Adapted from Forge archive `d8c0b040f553bf9e51a532cb4db693529f50cc70`. Read [shared interpretation](../../../core/interpretation.md) for structure-stage comparisons.
