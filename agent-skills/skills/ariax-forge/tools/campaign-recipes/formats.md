# Campaign saved-output manifest

`campaign.json` contains `candidates`, with one or two rows for each path: minibinder, antibody, states, ligand-motif and nucleic-acid. Every row has an explicit `id`, original `native_decision`, original `generation` record and `states`. The states path requires separate positive and negative entries. Other paths use a descriptive state key.

Each state retains `identity`, `chains` and `observations`. Chains map molecular roles to `{kind,sequence}`; kind is protein, rna or dna. Each observation supplies model_family, same-task label, structure path, native chain map, run_record path, original native_rank and scores. A score has file, units, direction and JSON keys, or format=csv with exact match and column. A native run record contains command_id, sources, model, settings including actual seed, and hardware. Existing Forge run/source records remain the source of these fields. No new verification or identity protocol is added.

References are regular relative files under the restored campaign root. The consumer rejects missing files, ambiguous CSV identity, incomplete provenance, differing molecular sequences, unsupported modalities and missing campaign paths. An unavailable native score stays JSON null with its retained reason. A defined zero stays zero. Do not fill an unavailable measurement from another predictor. Native ranking remains per method and state.

For the positive/negative comparison, inspect the same field separately in each state within the same family and checkpoint/settings. Keep score direction and units visible. No inter-family score average, global rank or calibrated specificity transformation is supported. Pose RMSD uses a rigid fit of exact role/sequence-position correspondences. Receptor trimming must already be explicit in the retained native residue map.

The installed consumer writes complete structured tables and five per-path shortlists. A fresh recovery consumer must reproduce every byte. It makes no native science call.

Set alignment_role=target for a protein-binder pose comparison. Per-role RMSD then uses that target fit. Chemical roles declare heavy_element_counts and every observation declares chemical_chains explicitly. The consumer preserves native heavy-atom identity/coordinates and reports centroid displacement after the polymer fit. It infers no bonds or atomwise chemical correspondence. Positive-minus-negative score differences require exact matching source/model/scientific settings and identical native units.
