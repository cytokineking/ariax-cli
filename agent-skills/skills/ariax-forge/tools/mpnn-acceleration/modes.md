# Checkpoint and optimization scope

| Family | Checkpoints | `off` | `exact` |
| --- | --- | --- | --- |
| Vanilla full backbone | v_48_002, v_48_010, v_48_020, v_48_030 | Stock native controls | Optimized design |
| Original soluble | v_48_010, v_48_020 | Stock native controls | Optimized design |
| CA-only | v_48_002, v_48_010, v_48_020 | Use `--ca_only` | Refused |

Only `off` and `exact` are offered; `fast` and `big` are rejected. Exact rejects
scoring/probability-only operations, tied positions, supplied-FASTA scoring and
nonzero backbone noise. Its default `--bb_batch 16` batches backbones, while
`--batch_size` counts sequence clones per backbone. Sequence count follows
`floor(num_seq_per_target / batch_size) * batch_size`. The measured examples use
two sequences and `--batch_size 1`; the creator's eight-clone example needs its
own resource assessment.

The worker probes hybrid GEMM and fused random draws before design. A failed GPU
probe stops execution. `--hybrid_gemm 0` explicitly disables that optimization;
its agreement and timing need a separate comparison. Caches live under `/scratch`.
Cold compilation, graph capture and interpreter/model loading contribute to
startup; repeated commands still capture fresh graphs. Per-item worker timers
measure only the resident process's execution span.

## Measured scope and timing

The selected source combines ProteinMPNN `8907e667` and Anthropic kit `f4f62fa6`,
PyTorch 2.5.1/CUDA 12.4, NumPy 1.26.4 and Triton 3.1.0. The standard MPNN image uses
PyTorch 2.2.1/CUDA 12.1. Comparisons used an H100 PCIe with 81,559 MiB VRAM and driver
570.195.03, two 3HTN chain-A crops of 64/93 observed residues, dense design positions
11–20, seed 37, temperature 0.3, two samples, sequence batch 1 and backbone batch 16.
Within this case, all six full-backbone checkpoints produced matching sequences,
scores and probabilities in `exact`, `off` and the standard image. This observation
does not guarantee agreement for other shapes, hardware or constraints.

Exact took 3.538–3.693 seconds on the first call and 3.181–3.363 seconds on repeated
calls; standard-image repeated calls took 2.786–2.939 seconds. Native generation
spans alone showed 2.10–2.89× ratios, excluding preparation. Whole exact commands
were slower for these small inputs. First calls used empty checkpoint-specific
caches; isolated Triton compilation time is unknown.

Peak observed process RAM was 1,294,852 KiB. Device memory sampled every 100 ms
peaked at 963 MiB and may miss short peaks. Larger campaigns, other GPUs, clone
batches and constraints remain unmeasured. General resource minima are unknown;
use `ariax forge catalog --tool mpnn-acceleration --json` for current admission
requirements and offered model/mode IDs.
