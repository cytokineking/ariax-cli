# Predictor adapters and matched inputs

The current image preserves ipSAE v3 with Ariax's chain-index and partner-mask corrections. Its vendored source matches the archived implementation after whitespace normalization. Only the AF2 JSON/PDB fixture has live Forge qualification. Standard-protein Boltz2 handoffs below have source review and synthetic offline checks.

| Adapter | Positional PAE / structure files | Confidence contract |
| --- | --- | --- |
| AF2 | `scores.json model.pdb PAE_CUTOFF DIST_CUTOFF` | JSON object with `pae` or `predicted_aligned_error`, square residue matrix in Å; `plddt` residue vector on 0–100 scale. Optional `iptm`/`ptm`; missing native ipTM is -1. No list-wrapped generic PAE format. |
| Boltz1-named, compatible Boltz2 standard proteins | `pae_case_model_0.npz case_model_0.cif PAE_CUTOFF DIST_CUTOFF` | NPZ key `pae` in Å; companion `plddt_case_model_0.npz`, key `plddt`, on 0–1 scale (native multiplies by 100). Companion `confidence_case_model_0.json` has `pair_chains_iptm` keyed by string numeric chain indices. |

All invocation rows follow native `ipsae` inside a ready `ipsae` tool, through `ariax forge run "$SESSION" --tool ipsae -- ipsae ...`. Stage every referenced sidecar; copy the structure into a fresh writable `/workspace` directory for native outputs. The launcher accepts JSON/PDB for AF2 and NPZ/CIF for Boltz. Other combinations, including CIF/JSON and pickle, are rejected before reading scientific files. AF3 is unsupported. Preserve actual predictor provenance; changing extensions cannot establish a supported origin.

Boltz sidecar discovery replaces **every** `pae` substring in the full PAE path with `plddt` or `confidence`; summary extension changes to `.json`. Directory names containing `pae` can therefore break discovery. Stage a verified copy in a neutral directory and record the original-to-copy path correspondence. Missing summaries leave native ipTM at zero and may print a warning; that is unavailable imported ipTM, not a measured zero. This helper requires the summary for Boltz to prevent that ambiguity.

## Coordinate and token identity

The PDB parser reads fixed columns and ignores insertion codes, alternative locations and MODEL boundaries. CIF parsing splits whitespace and reads `_atom_site` field order; it uses `label_asym_id` and `label_seq_id`, not author identifiers. It is not a general CIF parser. Accept one model, one conformer, unique residue identifiers, consistent atom order and finite Å coordinates; use a proper structural inspection for any layout not covered by the helper.

Native residue representatives are CA or atom names containing `C1`; distance representatives are CB, glycine CA, or names containing `C3`. They must describe the same residues in the same order. Missing CB can corrupt dimensions. Standard residues contribute one token; ligand atoms (CIF label sequence `.`) contribute excluded tokens. Nonstandard residues contribute atom tokens with only the CA/C1 representative selected. Nucleic residues trigger a different d0 minimum. These are implementation rules, not proof that every predictor's modified-residue or ligand tokenization matches. Mixed polymers, ligands, PTMs, insertions, missing residues, multiple models and arbitrary CIF quoting remain outside this helper's accepted standard-protein workflow. Preserve the full originals and obtain a separately qualified adapter rather than deleting rows to fit.

Within the supported scope, require exact ordered CA residue identities, matching ordered CB/glycine representatives, complete sequence/register metadata, square N×N PAE and N-length residue pLDDT. Require finite nonnegative PAE; pLDDT must use the adapter's documented scale. Range checks cannot distinguish a legitimately low 0–100 confidence from an incorrectly scaled 0–1 vector: verify predictor provenance and units as well. Never convert PAE to probabilities or substitute PDE, averaged PAE, confidence summary or B-factors.

Boltz uses **sorted unique retained chain labels** as numeric indices; compare this to the predictor's original asym-index map. Nonalphabetical input ordering or omitted chains may mislabel imported pair ipTM even when PAE scoring looks plausible. The helper conservatively requires sorted structure chain order and contiguous explicit index mapping for Boltz.

## Boltz2 handoff

The Boltz 2.2.1 writer writes matched files below `predictions/<record-id>/`: `<record-id>_model_<rank>.cif`, `pae_<record-id>_model_<rank>.npz`, `plddt_<record-id>_model_<rank>.npz`, and `confidence_<record-id>_model_<rank>.json`. The suffix is confidence rank, not the original sample index. PAE output must have been enabled. Require one matched quartet from the same run/record/rank, original inputs and MSAs, seed/model configuration, processed record/structure and original chain/asym/register map. The writer removes invalid chains, so compare the final map, not a guess from input names. Standard residues use one token in the pinned tokenizer. That establishes source compatibility for standard protein complexes; synthetic CPU adapter tests do not establish prediction quality or all-atom adapter support.

## Protenix and other predictors

Pinned Protenix `b806d2540ab326d71edcc47128343e627248c099` emits `token_pair_pae`, `atom_plddt` (0–1), `atom_to_token_idx`, `token_asym_id`, and `token_has_frame`, with `<task>_summary_confidence_sample_<rank>.json`. There is no Protenix adapter here. Preserve its matched CIF/full-data/summary and explicit mapping for future adapter development; do not rename fields or reshape arrays to claim support. Chai and arbitrary PAE-only exports are likewise pending.

## Check the recorded handoff

Use the [preflight helper](../scripts/ipsae-preflight.py) with a local JSON
record. Its format belongs to this helper and is neither native ipSAE input
nor a Forge API body. Resolve its installed path through reference
`ipsae-preflight`. File paths are relative to the record. Supply `run_id`,
`input_id`, `seed` and `sample` from the original prediction, along with
`predictor`, `pae_units`, `plddt_scale`, `chain_order`, `sequences` and the exact
ordered `[chain, residue_number, residue_name]` list in `residues`.

`files` maps roles to local paths: `structure` and `pae` for AF2; add `summary`
plus `plddt` for Boltz2. Boltz2 also requires the original
numeric `chain_indices`. Its sample record must carry `record_id` and the
integer confidence `rank`; AF2 records its sample `index`. Native filenames are checked against the Boltz record/rank. See the
complete [offline examples](science-checks.md).

The checker makes no changes. It rejects mismatched sequence/register/order,
array shapes, confidence scales, summary mappings and sample filenames. The records must come from the predictor; making
a new identity map by copying the structure cannot prove an unmatched PAE
belongs to it. File dimensions and caller-supplied provenance cannot establish
independent lineage.

Run scoring only after the check passes and the original prediction records
establish common origin. Qualification of a new Boltz2 input needs its remote prediction, its processed chain/token map, matched raw files,
a native ipSAE run in the deployed image, and checked directional tables.
Mixed/modified entities require a separate adapter. No automatic fresh
prediction follows a failed handoff.

Sources: [vendored-source ancestor](https://github.com/DunbrackLab/IPSAE/blob/f892de5ba6f8567912764c990aae59ee8ce781c4/ipsae.py),
[Boltz 2.2.1 tokenizer](https://github.com/jwohlwend/boltz/blob/v2.2.1/src/boltz/data/tokenize/boltz2.py).
Adapted from Forge archive `d8c0b040f553bf9e51a532cb4db693529f50cc70`.
