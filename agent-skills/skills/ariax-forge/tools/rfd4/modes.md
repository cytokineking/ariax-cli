# RFd4 modes and controls

Use the live catalog for availability and the exact native, installation,
restoration and resource scope. Bounded native passes cover unconditional
protein, protein hotspots, indexed and unindexed motifs, resolved-seed partial
diffusion, one VHH case, no-oracle metrics and structure-only search. They do
not establish experimental binding, catalytic activity or a general success
rate. The [recipes](recipes.md) and [search guide](search.md) reproduce these
finite profiles; larger inputs, different schedules or other combinations need
their own evidence.

Three modes remain held: fixed-ligand geometry, fixed DNA-duplex geometry and
fixed-backbone sequence redesign. Preserving ligand identity and bonds is not a
fixed-geometry pass; do not relax a requested tolerance silently. Per-group DNA
motif RMSD does not establish the strands' relative pose. A low Cα RMSD does
not establish full-backbone preservation or that the sequence was redesigned.
Use whole-complex geometry and atom identity checks appropriate to the task.

AF3 and coupled oracle routes are excluded. The upstream OpenFold3-in-AF3
runtime is not the standalone Forge OpenFold3 tool. RNA, glycans, modified
residues, BioIR, training, arbitrary adapters, custom metrics and unreviewed
sampling transforms are not independently qualified. Optional Foldseek
aggregation/novelty, nested PyRosetta and CDR reference assets have their own
external dependencies and are not enabled by this guide. An upstream model
vocabulary or a standalone Forge predictor does not qualify these paths.

## Native controls

Hydra accepts the following keys after the native executable. Quote list
arguments so the shell passes one argument, for example
`'metrics_tags=[design,hotspot_conditioning]'`. Settings are controls, not
claims that every value or combination has passed Forge qualification.

| Setting | Practical effect |
| --- | --- |
| `num_replicates=1` | Replicates per input example. For ordinary generation the requested total is selected examples × replicates; count actual unique generated CIFs and failures. Search has its own branch/beam accounting. |
| `batch_size=1`, `num_workers=0` | GPU batch and data-loader workers. Batch, total tokens and metric workers affect time and memory; use the demonstrated values for the bounded recipes. |
| `seed=7` | Base random seed; `job_id` is added when set. Save both, input order and all settings. A seed alone does not guarantee identical results after changing batch, order, hardware or profile. |
| `torch_deterministic=true` | Requests deterministic algorithms at a throughput cost. It does not establish cross-hardware identity or qualify an otherwise untested profile. |
| `generation.args.nsteps=60` | Number of trajectory steps in the pinned default. Changing it also changes search checkpoints and partial trajectories. |
| `recycle_strategy=thinking_medium` | Pinned default is a front-loaded schedule. The checked VHH recipe uses `high/front_loaded`; use other schedules only within their own evidence. More recycling does not guarantee better function. |
| `compile_lengths=null` | Eager execution. The normal compiled configuration selects a bucket from its default list; the catalog records a bounded compiled 100-residue/128-token case. Warm-up costs time and different lengths are not automatically qualified. |
| `skip_existing=true` | Default can skip generation and rescore existing outputs into reevaluation output. It is not proof that a new design ran or permission to replay an uncertain command. Use a fresh directory for each experiment. |
| `prevalidate_inputs=true` | Validates authored inputs, but skips sampling transforms and can miss nonfinite partial seeds; use the explicit [finite checks](inputs.md). |
| `compress_outputs=true` | Compresses persistent structure outputs; retain one encoding per design ID. |
| `generation.args.save_trajectory_every=0` | Default disables trajectory snapshots. Nonzero intervals and `generation.args.bb_ca_only_trajectories` control saved snapshots; they add storage and do not change acceptance. |
| `save_chain_of_interest=true` | Writes extra chain CIFs for operations such as Foldseek; these are not additional candidates. |

For the catalog's bounded compiled monomer profile, stage the same baseline
monomer pair as in the [entrypoint](../rfd4.md), then use the native default
compile buckets and remove the default metrics group explicitly:

```sh
ariax forge run "$SESSION" --tool rfd4 --gpus 0 --timeout-seconds 2400 -- \
  env OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 \
  rfd4-generate inference_experiment=inference_on_user_inputs '~metrics' \
  inputs=/inputs/rfd4/baseline/monomer.yaml \
  hf_ckpt_path=/models/rfd4-proteina hf_ckpt_revision=null \
  out_dir=/workspace/rfd4/compiled-monomer-001 \
  hydra.run.dir=/workspace/rfd4/compiled-monomer-001/hydra \
  seed=7 batch_size=1 num_workers=0 num_replicates=1 delete_failing_pre_oracle=false
```

The selected 100-residue input uses the 128-token bucket. Check the run's
finite annotated output and capture it as for other generation. This does not
qualify a larger token bucket or a different host.

The image directs writable caches into `/scratch`, which is disposable and
excluded from checkpoints; keep intended outputs and Hydra directories under
`/workspace`. Bound metric threads as shown in the recipes. The selected CUDA
12.8 profile has limited hardware/driver evidence in the catalog. In the
specific recorded Blackwell fallback case, pass
`CUEQ_TRIMUL_BLACKWELL_INFERENCE=0` through `env` only when that matching host
and workload are allowed; it selects a Torch fallback, not a fused-kernel pass.
No probe establishes a general driver minimum or resource minimum.

Partial diffusion uses either `generation.args.partial_trajectory_fraction_steps`
or per-modality `partial_t_*` controls, never both. These are trajectory time
controls, not distances in angstroms; per-modality schedules are nonlinear and
near-zero `partial_t` runs more of the trajectory. See the pinned
[partial diffusion reference](https://github.com/RosettaCommons/RFD4-Proteina/blob/aaccdd2ad0720c180468df5f9cf037a713d403e5/docs/concepts/partial-diffusion.md)
and [sampling controls](https://github.com/RosettaCommons/RFD4-Proteina/blob/aaccdd2ad0720c180468df5f9cf037a713d403e5/docs/how-to/run-the-model.md)
for native temperature, ODE and guidance settings; these alternatives are not
independently qualified here.

Native default metrics can register excluded AF3 oracles. The image's
`metrics=no_oracle` group provides inline metrics without oracles, filters or
pass criteria. Tags gate which metrics run; a missing score is neither zero nor
a pass. When adding a filter, retain all rejections with
`delete_failing_pre_oracle=false`. An independent predictor is a separate
explicit command on the exact designed sequence, with its own mapping and
qualification, not a coupled RFd4 search result.

This Forge adaptation inherits the attribution in the [entrypoint](../rfd4.md).
