# RFd4 modes and compute

RFd4 has bounded native cases and explicit held modes. The live catalog governs
availability and the finite native, installation, restoration and resource scope;
these research targets are not a promise of live availability.

The selected native profile uses Torch 2.11.0 with CUDA 12.8. Native checks
include eager and compiled execution on H100 and the bounded Blackwell cases
below. These do not establish resource minima or general GPU/driver
compatibility. Verify the live profile and its requirements before use.

In a separate Blackwell SM120 operator probe of this CUDA 12.8 profile, the
default fused cuEquivariance output-tail failed with `invalid-image` on drivers
570.133.20 and 570.211.01. On 580.196.07, the same fused operation and a compiled
100-residue native monomer passed without a fallback. These results do not
establish a general driver minimum. On 570.211.01, setting
`CUEQ_TRIMUL_BLACKWELL_INFERENCE=0` enabled the native Torch fallback for one
fresh-cache compiled, 384-residue model-shaped triangle operation and one
compiled 100-residue monomer generation with structure checks. That fallback is
not a fused-kernel pass, and neither probe establishes broader Blackwell
qualification. For a matching host and an allowed workload, pass the variable
through `env` after Forge's `--`; do not infer wider host or driver compatibility
from these bounded checks.

| Research goal | Input and validation needed |
| --- | --- |
| Unconditional protein | Native monomer spec, intended length and sampling settings; inspect sequence and geometry. |
| Protein binder | Target context, backbone/sequence conditions, intended hotspots and designed chain; check mappings and interface. |
| Motif or enzyme scaffold | Indexed or unindexed motif, catalytic atoms and complete ligand/metal context; verify fixed/soft conditions and chemistry. |
| Small-molecule binder | Intended compound, charge, bonds, stereochemistry and contacts; use chemistry-aware validation. |
| DNA binder | Retained nucleic-acid context and explicit protein design region; check component identities and mapping. |
| Antibody or nanobody | Framework and CDR conditions, numbering and sequence/structure checks. |
| Fixed-backbone sequence design | Backbone conditions, finite seed coordinates and explicit designed/fixed sequence masks. |
| Partial diffusion | Starting annotated structure with finite coordinates and explicit corruption settings; retain and compare the original. |
| Structure-only search | Explicit non-oracle metric providers and reward directions, bounded branching, retained rejections and saved state for intended continuation. |

Bounded native passes cover unconditional protein generation,
protein hotspots, indexed and unindexed motifs, resolved-seed partial diffusion,
VHH design, no-oracle metrics and structure-only search. Consult the catalog for
the exact workloads and bounds. These checks do not establish experimental
binding, catalytic activity or a general design success rate.

Three modes remain held: fixed-ligand geometry, fixed DNA-duplex geometry and
fixed-backbone sequence redesign. Their checks preserve useful distinctions:

- Retaining ligand identities and bonds does not prove fixed geometry. Do not
  silently relax a requested geometry tolerance after a failure.
- A small per-group DNA motif RMSD does not establish the relative pose of both
  strands. Atom reassignment must preserve chemical identity and bond order.
- A low Cα RMSD does not establish full-backbone preservation or sequence
  redesign. Check all required backbone atoms and whether the sequence changed.

For partial diffusion, use the explicit [finite-coordinate checks](inputs.md)
before and after generation; native prevalidation can accept an unresolved seed
that later produces nonfinite output. For antibodies, expanded CDR residues can
lack source labels, so locate them using the mapped framework flanks. For search,
retain and verify selection and continuation evidence as described in
[outputs](outputs.md). Each metric, reward and search configuration needs its
own support scope.

`inference_experiment=quickstart` is a one-replicate eager/no-metrics profile;
it sets `compile_lengths=null` and does not provide refolding or qualify normal
compiled runs. Without that preset the native configuration lists compile
lengths and can incur warm-up; its ordinary metrics group also registers AF3
oracles. Native defaults
use 60 sampling steps and `thinking_medium` recycling, an alias for a
front-loaded schedule. The upstream task table distinguishes front-loaded,
midpeak and flat recycling. Choose task-specific settings only after they have
been qualified. Compilation warm-up, total tokens, batch size, replicates,
branching and metric execution affect time and memory. Start any later measured
profile with batch size one; a timeout bounds remote work, not cost exactly.
Partial-diffusion time controls are not distances in angstroms. More recycling
does not establish better experimental function.

Plain generation may omit metrics. For scoring or search, use only an explicitly
qualified non-oracle configuration, check required tags/providers and verify
every requested score. Tags can cause a metric to be skipped without a score;
missing is not zero or a pass. When filters are enabled set
`delete_failing_pre_oracle=false` and retain rejected structures and their
outcomes. Quickstart composes no metric group. The image includes a native Hydra
group selected with `--config-dir /opt/ariax/rfd4` and
`metrics=no_oracle`; it composes inline metrics without refolding oracles, pass
criteria or pre-oracle filters. Each metric dependency and tag combination needs
its own evidence; a passed example does not qualify every combination.
`antibody` and `*_refolding` tags need particular care.
AF3 and coupled oracle search are excluded. Upstream's OpenFold3-in-AF3 runtime
is not the standalone Forge OpenFold3 tool. No Docker socket, nested privileged
runtime or silent oracle replacement is part of this integration.

For metrics or search, bound the numerical-library thread pools so concurrent
metric workers fit Forge's existing process limit. After the Forge `--`, prefix
the native `rfd4-generate` or `rfd4-evaluate` executable with
`env OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1`,
then retain the task's native Hydra arguments after the executable. An unbounded
OpenBLAS pool exhausted the process limit in a CUDA 12.8 Forge search; the
bounded-thread retry completed. Do not raise the isolation limit to work around
that failure.

If qualified, run independent predictors in separate explicit Forge commands and
preserve conversion, chain and ligand mapping, input sequence, confidence units
and provenance. RNA, glycans, modified residues, BioIR, training, arbitrary
adapters and coupled refolding need separate scope and evidence. A model
vocabulary or upstream feature alone does not qualify a case in Forge.

Sources: [sampling and recycling](https://github.com/RosettaCommons/RFD4-Proteina/blob/aaccdd2ad0720c180468df5f9cf037a713d403e5/docs/how-to/run-the-model.md),
[metrics](https://github.com/RosettaCommons/RFD4-Proteina/blob/aaccdd2ad0720c180468df5f9cf037a713d403e5/docs/how-to/evaluate-with-metrics.md),
[search](https://github.com/RosettaCommons/RFD4-Proteina/blob/aaccdd2ad0720c180468df5f9cf037a713d403e5/docs/how-to/search.md)
and [refolding](https://github.com/RosettaCommons/RFD4-Proteina/blob/aaccdd2ad0720c180468df5f9cf037a713d403e5/docs/how-to/refolding.md).
This Forge adaptation inherits the attribution in the [entrypoint](../rfd4.md).
