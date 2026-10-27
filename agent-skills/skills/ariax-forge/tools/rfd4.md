# RFdiffusion4 / RFD4-Proteina on Forge

RFd4 has bounded native scientific evidence and explicit held modes. Check the
live catalog for availability, precise qualification and resource requirements
before choosing a tool or running the illustrative commands below. A packaged
guide or example alone does not establish readiness.

RFd4 jointly designs a protein sequence and all-atom structure, including
unconditional generation and molecular conditioning for a target, motif, ligand,
DNA or an existing structure. The native tool key and guide alias are
`rfd4` (`rfdiffusion4` also locates this guide); it is not a managed project
protocol. Compare a requested experiment with the live qualified scope of
[Foundry RFD3/RFD3NA](foundry.md), [Proteina-Complexa](proteina-complexa.md),
[BoltzGen](boltzgen.md) and [BindCraft2](bindcraft2.md). These methods have
different inputs and scoring, and their scores do not establish a universal best
choice. Preserve an explicit user choice.

RFd4's sequence is part of its design. Preserve that exact sequence when
validating the generated structure. An MPNN redesign changes the candidate and
is a separate, explicit experiment that needs its own validation.

## Discover and prepare

```sh
ariax forge catalog --compact --task binder-design --json
ariax forge catalog --tool rfd4 --json
ariax skills forge --tool rfd4 --json
ariax skills forge --reference rfd4 --read --json
```

Use the live catalog to check availability, allowed modes, and measured resource
scope. A missing resource minimum is unknown, not zero. Read [inputs](rfd4/inputs.md),
[modes and controls](rfd4/modes.md), [generation and evaluation recipes](rfd4/recipes.md),
[search and continuation](rfd4/search.md), [outputs](rfd4/outputs.md) and the
[example inventory](examples/rfd4/README.md). The [Forge platform guide](../SKILL.md)
explains session creation, authorization, command recovery, cancellation and close.

When a qualified `rfd4` tool is available to the account, select it in an
appropriately authorized session and wait for readiness:

```sh
ariax forge tools add "$SESSION" --tools rfd4 --priority rfd4 --json
ariax forge tools wait "$SESSION" rfd4 --timeout 1800 --json
```

The package uses the matched October 19, 2026 flow-model/autoencoder
bundle at `/models/rfd4-proteina`. Do not substitute Proteina-Complexa weights
or mix components across releases. The reviewed code is RFD4-Proteina 0.0.3,
commit `aaccdd2ad0720c180468df5f9cf037a713d403e5`; the selected public model
snapshot is `nvidia/RFD4-Proteina` revision
`48377e45eb25a4fce8d2aff56c1a659b726d2106`. The release manifest's original
bundle lineage is a separate provenance field and must be retained.

## Stage inputs

Set `EXAMPLES` to the `data.examples.rfd4` path returned by
`ariax skills forge --tool rfd4 --json`. The small [baseline inputs](examples/rfd4/README.md)
are bounded cases; check the live catalog's scientific scope. Stage the monomer
specification and its annotated CIF; inspect both returned input IDs:

```sh
ariax forge inputs add "$SESSION" --file "$EXAMPLES/baseline/monomer.yaml" --path rfd4/baseline/monomer.yaml --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/baseline/monomer-short.cif.zst" --path rfd4/baseline/monomer-short.cif.zst --json
ariax forge inputs status "$SESSION" MONOMER_INPUT_ID --json
ariax forge inputs status "$SESSION" MONOMER_CIF_INPUT_ID --json
```

For the PD-L1 binder example, stage its specification and its cropped target:

```sh
ariax forge inputs add "$SESSION" --file "$EXAMPLES/baseline/binder.yaml" --path rfd4/baseline/binder.yaml --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/baseline/5o45_cropped.cif.zst" --path rfd4/baseline/5o45_cropped.cif.zst --json
ariax forge inputs status "$SESSION" BINDER_INPUT_ID --json
ariax forge inputs status "$SESSION" TARGET_INPUT_ID --json
```

Wait for every input ID used by the selected case to become ready. For a custom
target, upload the specification **and every referenced companion**, keeping
their relative layout under `/inputs`. Check the target, chain and residue
mapping, chemistry, desired design/fixed regions, and the materialized conditions
before generation; a structure by itself does not express the experiment.

## Generate one design

After the tool, example and profile have been qualified and the input is ready,
use a fresh run directory. Native RFd4 takes Hydra `key=value` arguments after
Forge's `--` separator:

```sh
ariax forge run "$SESSION" --tool rfd4 --gpus 0 --timeout-seconds 1800 -- \
  env OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 \
  rfd4-generate \
  inference_experiment=quickstart \
  hf_ckpt_path=/models/rfd4-proteina hf_ckpt_revision=null \
  inputs=/inputs/rfd4/baseline/monomer.yaml \
  out_dir=/workspace/rfd4/monomer-001 \
  hydra.run.dir=/workspace/rfd4/monomer-001/hydra \
  num_replicates=1 batch_size=1 num_workers=0 seed=7 \
  delete_failing_pre_oracle=false
```

For the binder, use the reviewed non-oracle [recipe](rfd4/recipes.md). Retain
its hotspot and target conditions; the fixture is not a general target template.

The native quickstart is an eager, no-metrics smoke profile: it disables compile
warm-up and does not produce refolding scores. It does not by itself reduce the
native sampling schedule. For the qualified bounded compiled and non-oracle
cases, consult the live catalog and [recipes](rfd4/recipes.md); other schedules
and larger workloads need their own evidence. A longer input or larger batch has
an unmeasured resource cost. Check the remote command's exit state and logs. A local watch timeout does
not stop the command.

Observe the same command ID after a lost reply. Starting another command may run
science twice. Native `skip_existing` is not authorization to replay an uncertain
run. Use a new output directory for a new experiment so cached files do not
silently affect its results.

## Inspect and preserve

Check the full annotated CIFs, designed sequence, chain/residue mapping,
conditions and chemistry; preserve rejections and distinguish absent metrics
from failed metrics or acceptance. Use an independently qualified predictor as
a separate downstream command when appropriate; its outputs are not coupled
RFd4 search results or experimental evidence of binding.

After the writer stops, follow [outputs](rfd4/outputs.md) to capture the
input, model, Hydra settings and mapping, and to materialize any evaluation
sidecars before checkpointing.

Once all writers have stopped, save and inspect a checkpoint:

```sh
ariax forge sync "$SESSION" --wait --json
ariax forge checkpoints "$SESSION" --json
ariax forge checkpoint "$SESSION" CHECKPOINT_ID --json
ariax forge files "$SESSION" --path /workspace/rfd4/monomer-001 --checkpoint CHECKPOINT_ID --json
```

Inspect the completed checkpoint and persistence error before closing. When the
session's authorized work is finished, close it and inspect status until `closed`
confirms resource release:

```sh
ariax forge close "$SESSION" --json
ariax forge status "$SESSION" --json
```

The [outputs guide](../outputs.md) covers pinned downloads, restore and the
remaining persistence checks. Restoration saves files, not automatic scientific
replay. Continue only with an explicit intended command after completed
restoration and verification of inputs, outputs and configuration.

This guide adapts the [RFd4 generation skill](https://github.com/RosettaCommons/RFD4-Proteina/blob/aaccdd2ad0720c180468df5f9cf037a713d403e5/skills/rfd4-proteina-generate/SKILL.md)
and related documentation by the Institute for Protein Design / Baker Lab and
NVIDIA GenAIR. Local setup and scheduler instructions were replaced with Forge
paths, readiness and persistence. Upstream skill text and documentation declare
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); code and weights have
separate notices and terms.
