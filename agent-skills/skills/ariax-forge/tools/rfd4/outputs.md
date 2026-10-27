# RFd4 outputs, identity and recovery

Generation writes annotated CIFs under `out_dir/inference_samples/`; requested
metrics, when configured, appear under `inference_metrics/`. Standalone
`rfd4-evaluate` uses `evaluation_samples/` and `evaluation_metrics/`. Per-example
names derive from the input spec's key or annotated-CIF stem. Plain CIF is the
native default; gzip and Zstandard input encodings are supported. Keep one
encoding per design ID in an output directory.

Output CIFs carry annotations such as `SA_SRC` and `SA_CRDSRC`, but native
inference rebuilds source labels from its assembled input. YAML contigs may
already have renumbered that input, and preexisting CIF source labels can be
overwritten. Retain a verified original-to-assembled mapping alongside the output
annotations; those annotations alone do not identify original `label_seq_id`
positions. The provenance helper preserves files and settings, not this residue
mapping. Preserve the full annotated CIF even when another tool needs a simpler
exported structure. Check candidate identity, designed sequence, chains and
residue mapping, expected component identities,
finite coordinates, geometry, fixed/soft masks and retained chemistry. Assess a
soft constraint's observed adherence. A computational confidence, geometry or
rank is not an experimental binding affinity or function.

Record the requested metric, its native name, units and direction, the structure
it scored, and the filter outcome. Missing scores, failed scores, scientific
rejections and command failures are different observations. Preserve rejected
candidates when applying filters; set `delete_failing_pre_oracle=false`. Do not
substitute a missing metric or an excluded oracle with a different predictor.
Use a separate, explicitly selected independent prediction on the actual designed
sequence; a sequence redesign is a new candidate.

For an independent [Boltz-2](../boltz2.md) handoff, extract the designed chain
from the generated annotated CIF in output residue order, use its exact sequence
and chain identity in the Boltz input, and retain the chain/residue mapping.
Compare Boltz's processed tokens and output structure identities with that input.
An empty-MSA policy (`msa: empty`) is an explicit choice, not a general quality
recommendation. A successful monomer handoff does not validate conditioned
target mapping, ligand transfer, binding or affinity.

For search, a score table alone does not prove which candidates the beam kept:
native CSVs have no selected-candidate marker, and saved states do not retain
their originating candidate IDs. The selected image provides an opt-in
observation trace. After Forge's `--`, begin the native argv with `env`, followed
by the [bounded thread variables](modes.md) and
`ARIAX_RFD4_SEARCH_TRACE=/workspace/rfd4/search-001/selection.jsonl`, then
`rfd4-generate` and its native arguments. Use a unique fresh trace path whose
ordinary parent directory already exists, one input per batch and one process.
Keep the task's native search arguments, adding `+search.save_rollouts=true` and
`search.save_states=true` when retaining candidate rollouts and interior states.

The JSONL records candidate IDs, raw metrics, reward, selected index and rank,
continuation decision, expected state paths, and any resume source and seed.
Nonfinite metrics remain explicit. The observer does not change native sampling,
rewards or selection; a trace failure stops the command. State paths are expected
locations until verified: correlate the trace with the native metrics, CIFs and
actual state files before drawing a selection conclusion. The bounded search
check covered a same-host Files restore and explicit continuation. Consult the
live catalog for the current installation and restoration scope; a restore does
not qualify arbitrary reward configurations or automatic replay.

Native RFd4 has no standalone run manifest. Set both `out_dir` and
`hydra.run.dir` under a unique `/workspace` run directory, and keep the input
specification, all companions, model/source identity, resolved Hydra settings,
seed, command and output checks. After the writer stops, run the helper described
in the [entrypoint](../rfd4.md) to capture the exact spec, explicitly referenced
CIF/BCIF companions and model metadata under `ariax_provenance/`. Simple relative
paths retain their layout; absolute or parent-relative paths require explicit
remapping after restore. Its separately resolved config uses the helper's capture
environment: retain the original Hydra config and overrides and the native logs
and metrics as evidence of the run. Use a new directory for each experiment:
native refold results can be cached by file name when an output directory is
reused, even after inputs change.

Standalone evaluation writes input-sidecar symlinks. Forge rejects symlinks and
special files in checkpoints. The helper's opt-in `--materialize-sidecars`
replaces only native evaluator structure links to the specified input, its
explicitly referenced structures or regular structures under the same run's
`inference_samples/`, or the evaluation input directory recorded in that run's
Hydra config under `/inputs` or `/workspace`. Other evaluation links are rejected.
Inspect its result and correct any remaining unsafe output rather than relaxing
the path policy. Do not assume a failed sync saved a result. Wait for writers,
sync, inspect the completed checkpoint and verify restored files. Restore does not
restart science. Preserve search state when an explicitly qualified continuation
needs it; verify original inputs, model and settings before a new intended
command. Native `skip_existing` never authorizes automatic replay of an uncertain
command ID.

Source: [native output format](https://github.com/RosettaCommons/RFD4-Proteina/blob/aaccdd2ad0720c180468df5f9cf037a713d403e5/docs/reference/output-format.md).
This Forge adaptation inherits the attribution in the [entrypoint](../rfd4.md).
