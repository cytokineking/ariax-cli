---
name: ariax-pxdesign
description: Configure, launch, monitor, and retrieve PXDesign miniprotein-binder campaigns on Ariax, including target-chain sequences and input-format-specific hotspot or crop numbering.
---

# PXDesign on Ariax

Use the Ariax CLI to run PXDesign. The REST API is the fallback described in
[`../../core/raw-curl.md`](../../core/raw-curl.md). Do not claim an MCP
integration; it is not part of the current interface.

Use the [shared workflow](../../SKILL.md) for account access, existing user
authorization, durable recovery, and downloads.

## Choose PXDesign for the right campaign

PXDesign is Ariax's diffusion-based option for de novo **miniprotein binder**
design. Choose it when the user wants a diffusion alternative to BindCraft,
structurally diverse candidates, or candidates evaluated by both AF2-IG and
Protenix. Ariax runs the full Extended pipeline:

1. diffusion backbone generation;
2. AF2-IG evaluation;
3. Protenix evaluation; and
4. final combined ranking.

Do not route VHH, peptide, cyclic-peptide, helicon, scFv, or small-molecule
design requests to PXDesign. Ariax exposes only its miniprotein project type and
does not expose PXDesign's preview-only or generation-only modes. API v1 also
does not expose evaluation thresholds, MSA mode, seeds, diffusion steps,
numeric precision, or analysis-worker controls.

## Plan the campaign and GPU

If size is unspecified, suggest a **25–50-design pilot**, inspect the generated,
AF2-IG, and Protenix complexes and their separate pass flags, then consider
**10,000–20,000 designs** for a full campaign. Preserve an explicit smaller test.
Read [campaign planning](../../core/campaigns.md) before scaling; recommend Turbo
for long campaigns within the user's agreed compute policy.

PXDesign's diffusion workflow has less stringent GPU requirements than the
inversion workflows, but increase GPU capability and VRAM as target size grows.
Include binder size and the AF2/Protenix evaluation stages in memory planning.
More powerful compatible GPUs generally finish faster, often offsetting higher
hourly prices; use pilot runtime/cost to compare options. Trim targets when
helpful while preserving their fold, epitope, and relevant physical context.
PXDesign currently excludes Blackwell GPUs and RTX 6000 Pro; choose a compatible
class from the live schema rather than assuming the newest GPU is supported.

## Discover the current contract

Treat the live catalog and schema as authoritative. Do not invent defaults or
copy an old schema into the conversation.

```sh
ariax protocols --json
ariax schema pxdesign --json
```

Start from [`../../examples/pxdesign.json`](../../examples/pxdesign.json) when
useful, then reconcile it with the returned schema. In the public job file:

- use protocol `pxdesign` and project type `miniprotein`;
- set `chains` as a comma-separated string such as `"A,B"`;
- set `binder_length` and `num_designs`;
- represent optional fields canonically, for example
  `hotspots_by_chain: {"A": [10, 14, 18]}`,
  `crop_by_chain: {"A": ["1-50", "80-100"]}`, and
  `sequence_by_chain: {"A": "MKT..."}`;
- set GPU preferences and Turbo fields within the user's authorized compute policy; and
- keep PXDesign fields at the top level, not inside `protocol_config`.

Do not put `user_id`, the project name, or a normal upload-intent ID in the job
file. The API key supplies identity, `--name` supplies the project name, and
`submit --input` handles the upload intent.

The public API does not accept `msa_by_chain`: a workstation path would not be
transferred with the target structure. Let Ariax prepare target-chain MSAs.

## Prepare the target correctly

Pass a local PDB or mmCIF structure with `--input`. PXDesign accepts both, but
their residue registers are not interchangeable. Use PDB only when its resolved full sequence and observed sequence match.
The deployed converter discards SEQRES and compacts coordinates, so gapped or
unresolved PDB targets are rejected even when their full sequence is known.
Use canonical mmCIF with matching selected author/label selectors for those
targets; do not remove missing residues from the biological sequence.

For every selected target chain, the CLI obtains the full sequence in this
order:

1. `sequence_by_chain` in the job file;
2. PDB `SEQRES` or mmCIF polymer metadata;
3. coordinate residues, only when their PXDesign author register is contiguous;
4. an interactive prompt when reconstruction is unsafe.

In `--json`, piped, or other non-interactive use, the CLI never prompts. If it
cannot reconstruct a sequence, ask the user for the exact full chain sequence
and add it to `sequence_by_chain`; do not guess across missing residues. The
full sequence remains necessary even when `crop_by_chain` selects only a
domain. For mmCIF input, the CLI repairs missing polymer metadata in the copy
sent to object storage when it has a safe sequence.

The file is parsed locally and uploaded directly to private object storage with
a short-lived URL. Its bytes do not pass through the Ariax application server.

## Use the correct residue register

For PDB input, express `hotspots_by_chain` and `crop_by_chain` with the
**author residue numbers shown in the PDB**. PXDesign's PDB-to-mmCIF conversion
maps them to its internal canonical register.

For direct mmCIF input, PXDesign instead consumes `label_asym_id` chain IDs and
1-based `label_seq_id` residue positions. It does not perform the PDB author-ID
translation. The Ariax CLI and web setup reject direct mmCIF when selected protein
chains have different author and label identifiers. Differences on unselected
chains do not block a run. Use PDB only if its sequence is fully represented,
or prepare compatible mmCIF; never translate selectors by guesswork.

- Hotspots focus generation on a specified interface.
- Omitting hotspots lets PXDesign search for a binding site.
- The setup page's **Bind Anywhere** control is not an API boolean. To reproduce
  it for PDB, populate that chain's hotspots with every observed author
  residue retained by its effective crop. For mmCIF, use the verified canonical label positions.
- Crop ranges limit the target region used for design but do not renumber the
  full chain. Every explicit hotspot must remain within that effective crop.
- The full resolved sequence is sent for every selected chain, including PDB
  SEQRES-derived sequences, and is used in target MSA preparation.

Selectors are integer-based and cannot identify an insertion code such as
`27A`. If the desired site depends on insertion codes, have the user provide a
cleanly renumbered structure rather than silently choosing a residue.

## Validate before spending compute

Run both local structure preparation and the server's side-effect-free schema
validation:

```sh
ariax validate -f pxdesign-job.json --input ./target.pdb --json
```

Resolve every error. Before submission, summarize the selected chains,
hotspots/crops, binder-length request, design count, and compute preferences.
Submission and restart can spend credits; obtain authorization unless the user
has already provided it. Ariax has no compute-quote operation.

Submit the same validated job and input:

```sh
ariax submit -f pxdesign-job.json --input ./target.pdb \
  --name my-pxdesign-project --wait
```

For an uncertain submission or interrupted wait, follow the shared
[operation recovery workflow](../../SKILL.md#submit-and-recover). Reuse the
original operation with `ariax recover OPERATION_ID --wait`.

PXDesign supports Ariax Turbo through the job-file `turbo_mode` and
`turbo_multiples` fields. Fetch their allowed values from the live schema
(currently 2x, 4x, and 8x). These values allow Ariax to select a parallel GPU
allocation; they do not guarantee a particular multiple. PXDesign rejects
Blackwell GPUs and RTX 6000 Pro. Select `allowed_gpus` when needed for the agreed
capacity/cost policy, and validate the selection before submission.

## Monitor and retrieve results

```sh
ariax status "$PROJECT_ID" --wait
ariax jobs --project "$PROJECT_ID" --json
ariax logs "$JOB_ID" --tail 200
ariax results "$PROJECT_ID" --json
ariax results "$PROJECT_ID" --download ./pxdesign-results
```

Status/progress spans diffusion, AF2 evaluation, Protenix evaluation, and final
ranking. Intermediate artifacts can appear before completion, so the absence
of `summary.csv` while a job is running is not a failure. `ariax logs` returns
only the PXDesign compute log stored with the project; it never exposes Ariax
API, worker, infrastructure, or other platform logs.

In completed output, start with `output/results/<project-name>/summary.csv`.
Use its AF2-IG and Protenix scores/pass indicators to shortlist candidates, and
inspect the associated structures rather than ranking on a single metric alone.
The artifact tree can also contain:

- original diffusion structures;
- AF2-predicted complexes;
- Protenix-predicted complexes;
- aggregate analysis tables and a results manifest; and
- consolidated archives after completion.

PXDesign output condition chains may be deterministically relabeled (`A0`,
`B0`, and so on), and the designed binder is the final chain. Do not assume
that output chain labels preserve the input author's labels.

If waiting is interrupted, remote work continues; resume with
`ariax recover OPERATION_ID --wait` instead of submitting again. Use pause, restart, or
abort within the user's existing campaign authorization. Restart preserves the project's existing
scientific and compute configuration; it is recovery, not a way to edit the
campaign.

For scientific background and the web setup equivalent, consult the
[Ariax PXDesign guide](https://www.ariax.bio/docs/pxdesign-project-setup) and
[PXDesign announcement](https://www.ariax.bio/resources/pxdesign-miniprotein-design).

Read [output interpretation](outputs.md) before choosing candidates or interpreting ranks.
