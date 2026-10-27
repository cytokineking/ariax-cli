# RFd4 outputs, metrics and recovery

Generation writes annotated CIFs under `out_dir/inference_samples/` and requested
metrics under `inference_metrics/`. Standalone evaluation uses
`evaluation_samples/` and `evaluation_metrics/`. Generation IDs derive from the
spec key or annotated-CIF stem; evaluation IDs include a hash of the input's
relative path. Match each metric row to its actual structure, input and run.
Native output defaults to plain CIF; gzip and Zstandard input encodings are
supported. Keep one encoding per design ID in an output directory.

Preserve the full annotated CIF and the exact designed sequence, chain and
residue mapping, components, conditions, finite coordinates, geometry and
chemistry. Generated `SA_SRC` and `SA_CRDSRC` labels start from the **assembled**
input, so they need the saved original-to-assembled mapping to recover original
selections. The [input guide](inputs.md) exports that map. Compare it to each
output and independently check inserted and expanded regions. A soft condition
needs an observed adherence check. A computational score is not experimental
binding affinity or function; an MPNN redesign is a different sequence.

## Native metric interpretation

Columns are prefixed by their configured metric name. Tags select providers;
other tags can prohibit a metric. These examples have no universal pass cutoff.
Record the selected structure, requested tags, metric values, units, direction
and any filter outcome. A missing score, a nonfinite score, a scientific
rejection and a failed command are different observations.

| Native column(s) | Tag | Meaning and limit |
| --- | --- | --- |
| `hotspot_obedience.hotspot_obedience` | `hotspot_conditioning` | Fraction of marked hotspot atoms within 4.5 Å of a binder atom; higher means more of these atoms are contacted, not binding efficacy. |
| `sequence_adherence.sequence_adherence`, `.n_violations` | `design` | Fraction of sequence-conditioned residues matching and count that differ; ideal adherence is 1 and violations 0 for an intended fixed sequence. Pinned code reads `C_SEQ` from the generated array, including offline, if preserved. With no conditioned residues adherence is NaN and violations are 0; that zero does not establish adherence. |
| `design_motif_allatom_rmsd.rmsd`, `design_unindexed_motif_allatom_rmsd.rmsd` | `3d_coordinate_conditioning`, `internal_coordinate_conditioning` or `unindexed`; latter requires `unindexed` | Conditioned all-atom motif RMSD in Å after alignment, lower means closer to its recorded reference. Verify atom mapping and geometry separately. |
| `unindexed_insertion_mapping.n_unmapped_tokens`, `.n_sequence_mismatches` | `unindexed` | Generation-time counts of unmapped tokens and sequence-conditioned mismatches; with actual unindexed context, zero is the desired count. Verify source groups and identities as well. |
| `sequence_similarity_to_input.sequence_identity_to_input`, `ca_rmsd_to_input.rmsd` | `partial_diffusion` | Fraction of matching sequence and aligned protein Cα RMSD in Å against the seed. The latter can be omitted when CA counts differ; retain and compare the actual seed and mappings. |
| `amino_acid_composition.n_generated_unknown_residues` | Always | Count of generated unknown residues; inspect any nonzero value. Sequence-conditioned unknowns are exempt, so zero alone is not a sequence-quality certificate. |
| `interchain_interactions.hbond_atom_pair_count_coi`, `.hydrophobic_atom_pair_count_coi` | `interchain_interactions` | Counts used by the SAM search reward. The rule and clipping at each checkpoint matter; counts are not affinity measurements. |

**Unindexed offline caveat:** when `full_array_with_unindexed` is absent,
including in standalone rescoring, pinned `UnindexedInsertionMappingMetric`
returns **both counts as zero**. Those zeros are not evidence that an insertion
mapped correctly. Retain generation-time metrics and inspect `SA_UII`,
`SA_IDXGRPSRC`, the original mapping and conditioned identities in the output.
Even generation-time zeros are meaningful only with the intended unindexed
context present. See the pinned [implementation](https://github.com/RosettaCommons/RFD4-Proteina/blob/aaccdd2ad0720c180468df5f9cf037a713d403e5/src/rfproteina/metrics/unindexed_insertion_metric.py)
and [sequence adherence code](https://github.com/RosettaCommons/RFD4-Proteina/blob/aaccdd2ad0720c180468df5f9cf037a713d403e5/src/rfproteina/metrics/sequence_adherence_metric.py).

`SA_CWI` stores absolute conditioned coordinates and internally conditioned
reference groups superposed **individually** onto the generated structure. The
motif metric aligns and aggregates by coordinate group. A low group RMSD can
therefore coexist with an incorrect relative pose across groups: evaluate
whole-complex geometry, atom identities, bond order and an explicitly chosen
tolerance when those matter, especially for DNA or ligand context. Do not infer
full-backbone preservation from a Cα-only measure.

Use a separately qualified predictor on the exact designed sequence when
appropriate; its results are independent of RFd4's inline metrics. For a
[Boltz-2](../boltz2.md) handoff, extract the designed chain in output residue
order, retain its chain/residue mapping and compare processed tokens and output
identities. Empty MSA is a choice, not a general quality recommendation. A
monomer handoff does not validate target mapping, ligand transfer or binding.

## Capture and checkpoint

Native RFd4 has no standalone run manifest. Use unique `out_dir` and
`hydra.run.dir` paths under `/workspace`, preserve input specs and companions,
original-to-assembled and output mapping, native command/logs, metrics, model
identity, seed and the original Hydra `config.yaml` and `overrides.yaml`. Use a
fresh run directory: native refold results can be cached by filename after an
input changes. `skip_existing` can rescore existing structures and never
justifies automatic replay of an uncertain command ID.

After the writer stops, set `RUN` to its absolute output directory and `SPEC`
to the exact condition spec or annotated CIF supplied to generation. Run:

```sh
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 600 -- \
  python /opt/ariax/rfd4/prepare_outputs.py --run-dir "$RUN" --input-spec "$SPEC" \
  --model-dir /models/rfd4-proteina --materialize-sidecars
```

The helper snapshots the spec, explicitly referenced CIF/BCIF files and model
metadata under `ariax_provenance/`. Simple relative paths retain their layout;
absolute or parent-relative paths need explicit remapping after restore. Its
separately resolved configuration uses the capture environment, so the original
Hydra config, overrides and logs remain the run-time record. The helper does not
reconstruct or validate residue mapping.

For the standalone evaluation recipe set `RUN=/workspace/rfd4/eval-001` and
`SPEC=/workspace/rfd4/eval-input-001/monomer_0_generated.cif`. Its Hydra
`inputs` must point to the selected directory under `/inputs` or `/workspace`.
Evaluation creates structure symlinks; `--materialize-sidecars` replaces only
native evaluator links to the specified input, its referenced structures,
regular structures in that run's `inference_samples/`, or regular files under
the recorded evaluation input directory. It rejects other links. Keep the
selected input directory as well as the regular sidecars and ID/path crosswalk.
Inspect helper output and correct remaining unsafe files; Forge checkpoints
reject symlinks and special files.

When all writers stop, run `ariax forge sync "$SESSION" --wait --json`, inspect
the completed checkpoint, then list or download its files as described in the
[Forge outputs guide](../../outputs.md). A failed sync does not save results.
Verify restored files before an explicitly intended new command. The current
catalog describes the bounded monomer, no-oracle and search restore scope; it
does not establish restoration for every mode, arbitrary search rewards or
automatic replay. Search trace and selected-state checks are in the
[search guide](search.md).

Sources: [native output format](https://github.com/RosettaCommons/RFD4-Proteina/blob/aaccdd2ad0720c180468df5f9cf037a713d403e5/docs/reference/output-format.md)
and [metric definitions](https://github.com/RosettaCommons/RFD4-Proteina/blob/aaccdd2ad0720c180468df5f9cf037a713d403e5/docs/reference/metrics.md),
except where the pinned code above differs from prose. This Forge adaptation
inherits the attribution in the [entrypoint](../rfd4.md).
