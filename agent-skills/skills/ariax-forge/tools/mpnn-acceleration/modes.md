# Checkpoint and optimization scope

| Family | Checkpoints | off | exact |
| --- | --- | --- | --- |
| Vanilla full backbone | v_48_002, v_48_010, v_48_020, v_48_030 | Stock native controls | Design candidate |
| Original soluble | v_48_010, v_48_020 | Stock native controls | Design candidate |
| CA-only | v_48_002, v_48_010, v_48_020 | Use --ca_only | Refused |

The kit ships off and exact. fast and big are rejected. Exact rejects scoring/probability-only operations, tied positions, supplied-FASTA scoring and nonzero backbone noise. Its default --bb_batch 16 batches backbones, while --batch_size counts sequence clones per backbone. Sequence count follows floor(num_seq_per_target / batch_size) * batch_size. Qualification uses two sequences and batch_size 1. The creator's example uses eight clones; that larger envelope needs separate measurements.

The upstream worker probes hybrid GEMM and fused random draws before design. --hybrid_gemm 0 explicitly removes that one lever; any claim for that setting requires its own comparison. Caches live under /scratch. Cold compilation, graph capture and interpreter/model loading contribute to preparation; a repeated command still captures fresh graphs. Per-item worker timers describe the resident process's execution span.

Candidate source: ProteinMPNN 8907e667 and Anthropic kit f4f62fa6, PyTorch2.5.1/CUDA12.4, NumPy1.26.4, Triton3.1.0. The accepted baseline uses PyTorch2.2.1/CUDA12.1. Compare candidate exact to candidate off for exactness and record accepted-image agreement separately. Native equality and timing measurements below cover this selected source/model/mode/hardware envelope. Managed delivery and saved-file recovery have separate catalog gates.


## Measured native envelope

NVIDIA H100 PCIe, 81,559 MiB, driver 570.195.03; ProteinMPNN 8907e667, kit f4f62fa6, candidate PyTorch 2.5.1/CUDA12.4, NumPy1.26.4 and Triton3.1.0. The accepted comparison image uses PyTorch2.2.1/CUDA12.1. Two 3HTN chain-A crops contain 64 and 93 observed residues. Dense positions 11–20 are designed, with two samples per crop, seed37, temperature0.3, sequence batch1 and backbone batch16. Every exact lever passed its GPU probe.

| Checkpoint | First exact call s | Repeated exact call s | Accepted repeated call s | Generation-span ratio |
| --- | ---: | ---: | ---: | ---: |
| vanilla-v_48_002 | 3.591 | 3.256 | 2.855 | 2.81× |
| vanilla-v_48_010 | 3.690 | 3.238 | 2.939 | 2.83× |
| vanilla-v_48_020 | 3.690 | 3.363 | 2.786 | 2.10× |
| vanilla-v_48_030 | 3.693 | 3.288 | 2.938 | 2.28× |
| soluble-v_48_010 | 3.539 | 3.181 | 2.787 | 2.89× |
| soluble-v_48_020 | 3.538 | 3.288 | 2.937 | 2.72× |

All six full-backbone rows produced byte-identical FASTA and identical score/probability arrays against candidate off and the accepted image. Candidate off also matched all three CA-only checkpoints. The original 276-residue A/B prepared input passed sequence/constraint checks and exact output agreement. Probability normalization and fixed residue identities passed the saved-array checks.

The generation-span ratio compares stock's native generation timers with the worker's sampling/rescoring/write event spans. It excludes preparation. Whole command calls remained slower for this small case, and the accepted defaults remain unchanged. A repeated call reuses disk compiler cache and captures fresh graphs. The first exact call used an empty checkpoint-specific cache; startup/probe/compilation time is reported together with interpreter/model/GPU startup. Isolated Triton compiler time is unknown. Larger campaigns, other GPUs, different clone batches and different constraints remain unmeasured.

Peak observed process RAM across these batch comparisons was 1,294,852 KiB. Device memory sampled every100ms peaked at963 MiB, with short peaks potentially missed. The worker separately reported its allocator peak. General resource minima remain unknown; use the selected catalog's admission profile and qualification scope.
