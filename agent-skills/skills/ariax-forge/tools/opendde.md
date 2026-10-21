# OpenDDE-Preview standalone and batch prediction

OpenDDE is an upstream preview, not intended for production pipelines. Native
flags, JSON fields and checkpoints can change between releases. This package
uses OpenDDE 1.1.1 source `ddfa1df8aff1babf1fddac4247b7d2351bd0ce9f`,
PyTorch 2.7.1 with CUDA 12.6, and the two public checkpoints at model revision
`eddd563ce96571f784012edd8f045181c8f8627d`.

Choose `general` (`opendde.pt`) for general prediction or `abag`
(`opendde_abag.pt`) for the native antibody-antigen checkpoint. Both use
`opendde_v1` and the named `opendde-v1` asset. Selection does not train or tune
weights. Checkpoint names retain their native meaning.


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

The first examples use a reduced schedule for bounded qualification. The upstream
schedule is ten cycles, 200 steps and five diffusion samples. The package
retains these defaults. The October 9 H100 panel passed both checkpoints on
single proteins of 128, 256 and 512 residues, the 327-residue VHH complex and
the 805-residue three-chain complex. The 805-residue profile requires at least
79 GiB reported device memory, 56 GiB host RAM and eight CPUs. Its allocation
used 250 GiB initially free payload space. The earlier bounded L40 cases retain
the accepted 47-GiB device and 100-GiB disk floors. Read the
completion guide for the finite profiles and
remaining delivery gates. GPU inference explicitly selects CUDA. Triangle
kernels and LayerNorm use the supported PyTorch implementation.

Input is the native nonempty job-list JSON, with one distinct safe `name` per
job and distinct explicit `modelSeeds`. `predict` requires one job; `batch`
runs jobs sequentially. The upstream entity format supports `proteinChain`,
`rnaSequence`, `dnaSequence`, `ligand`, `ion` and explicit `covalent_bonds`.
Use the original native JSON dialect, rather than the AF3 single-job dialect.
Native `opendde json` converts supported PDB/CIF inputs before prediction.
Use absolute workload paths for supplied A3M, template and ligand files.

MSA, template and RNA-MSA searches are disabled in the shown commands and in
the adapter defaults. Enable them explicitly with `--use-msa`,
`--use-template`, or `--use-rna-msa`. These require the native supplied features
or separately prepared upstream services/databases. Large search databases
are absent from this qualified asset. A selected online search needs its approved configuration. The completion
guide records the supplied-feature and molecular cases and their delivery gates. Legacy `constraint` fields are ignored
by upstream; do not interpret them as applied constraints.

`batch.json` retains original jobs/settings and each item's pending, running,
succeeded, failed or interrupted state. Each attempt has its exact command,
exit code, timestamps, log and untouched native output. A failed item does not
hide a later successful item. A failed batch returns exit code one. `failure-batch.json` deliberately uses an
unsupported entity followed by a protein/SMILES item to exercise failure and
explicit continuation. The original `invalid-ccd` label in `batch.json` is a
retained probe name: `NOT`, `A`, and `CCD` are genuine CCD entries and that item
succeeded. Cancellation
forwards termination to the current native process. No prediction starts when
reading saved state.

Continue saved unfinished items with a new explicit Forge command. Use the
same input/settings and name the items to attempt:

```bash
ariax forge run SESSION --tool opendde --gpus 0 --timeout-seconds 3600 -- \
  forge-opendde batch --input /inputs/batch.json \
  --output /workspace/opendde-batch --checkpoint general \
  --cycle 1 --step 20 --samples 2 --deterministic \
  --continue --items invalid-ccd mixed
```

Succeeded items are always skipped. Each explicit retry has a new attempt
directory, preserving prior failures. Checkpoint/save the ordinary workspace
before releasing the VM. Restoring its files does not rerun predictions; use
an explicit continuation command after preparation on the new allocation.
Changed jobs, settings or source are refused for an existing batch. Use a new
output directory for changed science.

For each native job/seed/sample, retain the CIF, full-data confidence JSON,
summary-confidence JSON and `identity_sample` sidecar together. Native atom
pLDDT uses 0–1; CIF B-factors use 0–100. PAE/PDE use angstrom. The native
filename suffix is confidence rank, distinct from diffusion sample index.
The sidecar retains both identities, original asym IDs, atom-to-token indices,
per-token atom members and the processed atom identities. Mixed chemical
tokens may be atom-wise; never infer residue order from array dimensions.

```bash
ariax forge run SESSION --tool opendde --gpus 0 -- \
  python /opt/forge-opendde/opendde_outputs.py /workspace/opendde-batch
```

The checker validates actual coordinates, native identities and confidence
axes. B35q's corrected `interface-scores-v1` consumer passed eight retained
general and two ABAG samples. It requires `files.native_identity` and
`files.original_input` beside structure, confidence and summary. Keep original
batch/run labels, input IDs, seed, diffusion sample index and separate native
filename rank. Only complete standard protein chains with one token per
residue are supported; chemical tokens retain explicit exclusions. Split
protein tokens are rejected. B52 owns OpenDDE-Harness separately.

Sources: [upstream](https://github.com/aurekaresearch/OpenDDE/tree/ddfa1df8aff1babf1fddac4247b7d2351bd0ce9f),
[input format](https://github.com/aurekaresearch/OpenDDE/blob/ddfa1df8aff1babf1fddac4247b7d2351bd0ce9f/docs/infer_json_format.md),
[model card](https://huggingface.co/aurekaresearch/OpenDDE/tree/eddd563ce96571f784012edd8f045181c8f8627d).

Export an explicitly selected completed protein sample with the producer’s
shipped handoff script. Retain the original prediction command/run identity
across restoration:

```bash
ariax forge run SESSION --tool opendde --gpus 0 --timeout-seconds 120 -- \
  python /opt/forge-opendde/handoff.py /workspace/opendde-batch \
  --item insulin --seed 102 --rank 0 --chains A B \
  --run-id ORIGINAL_PREDICTION_COMMAND_ID --output /workspace/handoffs/insulin.json
```


```bash
ariax forge tools add SESSION --tools interface-scores --json
ariax forge tools wait SESSION interface-scores --timeout 1800 --json
ariax forge run SESSION --tool interface-scores --timeout-seconds 120 -- \
  interface-scores /workspace/handoffs/insulin.json \
  --output /workspace/interface-scores/opendde-insulin.json --pae-cutoff 10
```

Keep the handoff and its referenced native files together through checkpoint
and restoration. Retained producer handoffs can carry earlier consumer-dependency
notes; B35q accepts the matching native roles and reports current availability.
The corrected scorer refuses output paths that replace the handoff or any
declared original input.

Native atom pLDDT remains 0–1, with conversion to 0–100 only in the
scoring/reference dialect. PAE keeps angstrom units and original axes.
OpenDDE pair-ipTM preserves original matrix order; complex ipTM remains
separate. A single selected protein returns `no_protein_interface`.
B35q's four-checkpoint panel passed 920 unchanged positional-v3 comparisons.
Profiles beyond the finite completion matrix retain their qualification gates.
Preview support and changed-candidate delivery remain explicit. AF3 is outside Ariax support.

Use [saved results](../outputs.md) for checkpoint-pinned `forge link` paths,
and [project controls](../SKILL.md#project-controls-and-resume) for human
pause and same-project resume. Web approval clears a hold without allocating
compute; restoration leaves the next scientific command explicit.


The October 9 completion guide records the
finite larger profiles and the supplied-feature workflow. Its synthetic insulin
pairing example ships at `examples/opendde/supplied-paired-msa.json`, beside the
four A3M files in `examples/opendde/features/`.
