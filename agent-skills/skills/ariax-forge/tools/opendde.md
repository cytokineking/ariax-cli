# OpenDDE-Preview standalone and batch prediction

Use OpenDDE for preview molecular structure prediction from native job-list
JSON. Choose `general` (`opendde.pt`) for general prediction or `abag`
(`opendde_abag.pt`) for the antibody-antigen checkpoint. Both use native model
`opendde_v1` and the named `opendde-v1` asset; selection does not train or tune
weights. OpenDDE is an upstream preview, not intended for production pipelines.
Native flags, JSON fields and checkpoints can change between releases.

This package uses OpenDDE 1.1.1 source
`ddfa1df8aff1babf1fddac4247b7d2351bd0ce9f`, PyTorch 2.7.1 with CUDA 12.6,
and public checkpoints at revision `eddd563ce96571f784012edd8f045181c8f8627d`.
GPU inference explicitly selects CUDA; triangle kernels and LayerNorm use the
supported PyTorch implementation.

## Select the model and prepare inputs

```sh
ariax forge catalog --task molecular-prediction --compact --json
ariax forge catalog --tool opendde --model MODEL --json
ariax skills forge --tool opendde --json
```

Copy `MODEL` from the compact result's `models[].id`; omit `--model` for a
model-less tool and select a listed mode with `--mode MODE` when needed.
Read the exact selection's current support and resource requirements before
allocation. Set `OPENDDE_EXAMPLES` to
`data.examples.opendde` from the scoped skill lookup. Stage the chosen input
and its companion files using the [Forge input workflow](../SKILL.md).

Input is a nonempty native job-list JSON, with one distinct safe `name` per job
and distinct explicit `modelSeeds`. `predict` requires one job; `batch` runs
jobs sequentially. The upstream entity format supports `proteinChain`,
`rnaSequence`, `dnaSequence`, `ligand`, `ion` and explicit `covalent_bonds`.
Use the original native JSON dialect; AF3's single-job dialect is unsupported.
Native `opendde json` converts supported PDB/CIF inputs before prediction.
Use absolute workload paths for supplied A3M, template and ligand files.

MSA, template and RNA-MSA searches are disabled in the adapter defaults. Enable
them explicitly with `--use-msa`, `--use-template`, or `--use-rna-msa` only when
the selected mode supports them. Supply native features or separately prepared
upstream services/databases; large search databases are absent from this asset.
Online search requires its approved configuration. Legacy `constraint` fields
are ignored by upstream and do not apply constraints.

The synthetic insulin pairing input is
`$OPENDDE_EXAMPLES/supplied-paired-msa.json`, with four A3M files under
`$OPENDDE_EXAMPLES/features/`. Its JSON names
`/inputs/completion/features/`; stage the companions there or update every
feature path together. This small example does not establish general MSA or
molecular prediction accuracy.

## Run and continue a batch

These examples use one cycle and 20 diffusion steps for a short run. The
upstream defaults remain ten cycles, 200 steps and five diffusion samples;
choose the schedule for the scientific task.

```bash
ariax forge run SESSION --tool opendde --gpus 0 --timeout-seconds 3600 -- \
  forge-opendde predict --input /inputs/monomer.json \
  --output /workspace/opendde-single --checkpoint general \
  --cycle 1 --step 20 --samples 1 --deterministic

ariax forge run SESSION --tool opendde --gpus 0 --timeout-seconds 3600 -- \
  forge-opendde batch --input /inputs/batch.json \
  --output /workspace/opendde-batch --checkpoint general \
  --cycle 1 --step 20 --samples 2 --deterministic --max-items 1
```

The bounded L40 examples require at least 47 GiB reported device memory and
100 GiB disk. The 805-residue three-chain profile requires at least 79 GiB
reported device memory, 56 GiB host RAM and eight CPUs. Allow 250 GiB initially
free payload space for that documented setup; this is not a measured disk
minimum. These examples do not establish capacity for larger inputs; use the
current catalog's exact profile and resource floors.

`batch.json` retains original jobs/settings and each item's pending, running,
succeeded, failed or interrupted state. Each attempt records its exact command,
exit code, timestamps, log and untouched native output. A failed item does not
hide a later successful item; a failed batch returns exit code one.
Cancellation forwards termination to the current native process. Reading saved
state starts no prediction.

`$OPENDDE_EXAMPLES/failure-batch.json` contains an unsupported entity followed
by a protein/SMILES item for inspecting failure and explicit continuation.
The `invalid-ccd` label in the separate `batch.json` is misleading: `NOT`, `A`
and `CCD` are genuine CCD entries, so that item is not an invalid-input case.

Continue saved unfinished items with the same input/settings and an explicit
list of item names:

```bash
ariax forge run SESSION --tool opendde --gpus 0 --timeout-seconds 3600 -- \
  forge-opendde batch --input /inputs/batch.json \
  --output /workspace/opendde-batch --checkpoint general \
  --cycle 1 --step 20 --samples 2 --deterministic \
  --continue --items invalid-ccd mixed
```

Succeeded items are skipped. Each explicit retry gets a new attempt directory,
preserving prior failures. Changed jobs, settings or source are refused for an
existing batch; use a new output directory for changed science. Follow the
[saved-results workflow](../outputs.md) before releasing a VM and the
[project controls](../SKILL.md#project-controls-and-resume) for same-project
resume. Restoring files leaves the next prediction command explicit.

## Inspect outputs and score a protein interface

For every native job/seed/sample, keep the CIF, full-data confidence JSON,
summary-confidence JSON and `identity_sample` sidecar together. Native atom
pLDDT uses 0–1; CIF B-factors use 0–100; PAE/PDE use angstrom. The native
filename suffix is confidence rank, distinct from diffusion sample index.
The sidecar retains both identities, original asym IDs, atom-to-token indices,
per-token atom members and processed atom identities. Mixed chemical tokens
may be atom-wise; never infer residue order from array dimensions.

```bash
ariax forge run SESSION --tool opendde --gpus 0 -- \
  python /opt/forge-opendde/opendde_outputs.py /workspace/opendde-batch
```

The checker inspects coordinates, native identities and confidence axes.
For interface scoring, export an explicitly selected completed protein sample
with the shipped handoff script. Keep the original prediction command/run
identity through restoration:

```bash
ariax forge run SESSION --tool opendde --gpus 0 --timeout-seconds 120 -- \
  python /opt/forge-opendde/handoff.py /workspace/opendde-batch \
  --item insulin --seed 102 --rank 0 --chains A B \
  --run-id ORIGINAL_PREDICTION_COMMAND_ID --output /workspace/handoffs/insulin.json

ariax forge tools add SESSION --tools interface-scores --json
ariax forge tools wait SESSION interface-scores --timeout 1800 --json
ariax forge run SESSION --tool interface-scores --timeout-seconds 120 -- \
  interface-scores /workspace/handoffs/insulin.json \
  --output /workspace/interface-scores/opendde-insulin.json --pae-cutoff 10
```

The [interface-scoring consumer](interface-scores.md) requires
`files.native_identity` and `files.original_input` beside structure, confidence
and summary. Keep original batch/run labels, input IDs, seed, diffusion sample
index and separate filename rank. Only complete standard protein chains with
one token per residue are supported; chemical tokens need explicit exclusions
and split protein tokens are rejected. A single selected protein returns
`no_protein_interface`.

Keep the handoff and referenced native files together. The scorer refuses
output paths that replace the handoff or a declared original input. Native
atom pLDDT remains 0–1, with conversion to 0–100 only in the scoring/reference
dialect. PAE retains its original axes and angstrom units. Pair-ipTM preserves
matrix order; complex ipTM remains separate. Scores do not establish
experimental binding. For iterative design, use the separate
[OpenDDE-Harness guide](opendde-harness.md). AF3 is outside Ariax support.

Sources: [upstream source](https://github.com/aurekaresearch/OpenDDE/tree/ddfa1df8aff1babf1fddac4247b7d2351bd0ce9f),
[native input format](https://github.com/aurekaresearch/OpenDDE/blob/ddfa1df8aff1babf1fddac4247b7d2351bd0ce9f/docs/infer_json_format.md),
[model card and weights](https://huggingface.co/aurekaresearch/OpenDDE/tree/eddd563ce96571f784012edd8f045181c8f8627d).
