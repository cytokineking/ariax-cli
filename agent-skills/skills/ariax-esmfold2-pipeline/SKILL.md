---
name: ariax-esmfold2-pipeline
description: Configure, validate, submit, monitor, and retrieve ESMFold2-pipeline binder-design campaigns on Ariax for miniproteins, VHH nanobodies, or scFvs with author-numbered structure targeting and required Protenix v2 validation. Use for Ariax-hosted ESMFold2 inversion campaigns, not general structure prediction or upstream-only pipeline controls.
---

# ESMFold2-pipeline on Ariax

Use the Ariax CLI and public `/api/v1` API. Ariax translates the public job
specification into its installed ESMFold2-pipeline workflow and manages GPU
provisioning, checkpoints, Protenix v2 validation, final ranking, and retained
artifacts. Do not invoke the upstream pipeline directly or construct its YAML.
MCP is not part of the current Ariax workflow.

Use the [shared workflow](../../SKILL.md) for account access, existing user
authorization, durable recovery, and downloads.

## Choose the modality deliberately

ESMFold2-pipeline designs binders against a protein structure. It runs
ESMFold2 sequence inversion, re-folds candidates with an ESMFold2 critic,
validates selected complexes with Protenix v2, and ranks candidates using
confidence and pose agreement.

- Choose `miniprotein` for a fully de novo compact protein binder with a
  user-selected binder length.
- Choose `vhh` for a single-domain nanobody built on one or more of Ariax's
  bundled structural VHH frameworks. The designed regions are the heavy-chain
  CDRs.
- Choose `scfv` for a paired VH-linker-VL framework with both heavy- and
  light-chain CDR design. This is Ariax's dedicated scFv workflow.

The antibody modalities distribute the total requested design count across the
selected frameworks. Use all bundled frameworks for broader framework search,
or restrict the set when the user has a scientific reason to do so. The current
canonical framework IDs are:

- VHH: `caplacizumab_framework_vhh`,
  `ozoralizumab_tnf_framework_vhh`, and
  `vobarilizumab_il6r_framework_vhh`.
- scFv: `anifrolumab_framework_vhvl`, `atezolizumab_framework_vhvl`,
  `avelumab_framework_vhvl`, `belimumab_framework_vhvl`,
  `daratumumab_framework_vhvl`, `dupilumab_framework_vhvl`,
  `guselkumab_framework_vhvl`, `lebrikizumab_framework_vhvl`,
  `panitumumab_framework_vhvl`, `pembrolizumab_framework_vhvl`,
  `secukinumab_framework_vhvl`, `tezepelumab_framework_vhvl`,
  `tralokinumab_framework_vhvl`, and `trastuzumab_framework_vhvl`.

Use `binder.frameworks: "all"` for the full modality-specific set. Fetch the
live schema before selecting a subset because the inventory can change.

Do not use this Ariax protocol for ordinary ESMFold2 structure prediction,
direct-sequence targets, peptide or small-molecule design, custom framework
sequences/templates, or arbitrary upstream YAML. The local upstream repository
supports some of those controls, but Ariax does not expose them.

## Plan the campaign and GPU

If size is unspecified, suggest a **25–50-design pilot** and inspect both
ESMFold2 and Protenix results against the design objective. Then attempt
**1,000 designs initially**, review confidence, pose agreement, exclusion stages,
and distinct useful yield, and consider whether another campaign is worthwhile.
Preserve explicit smaller tests. Read [campaign planning](../../core/campaigns.md)
for the review criteria; recommend Turbo for long campaigns within the agreed
compute policy.

ESMFold2-pipeline requires **at least 80 GB of VRAM per GPU**; the minimum usable
class is an **A100 80 GB**, not an A100 40 GB. Use the live schema for compatible
larger classes. Very large complexes may still crash: count the effective
target across all selected chains **plus the binder**. This is especially
important for scFvs, which are roughly **300 amino acids**; keep **scFv targets
under 400 amino acids** as Ariax's practical operating recommendation.

Trim large targets to the relevant structural region while preserving its fold
and physical context. Size guidance is approximate, not a guarantee that every
complex fits. Faster compatible GPUs can offset higher hourly rates by finishing
sooner; compare observed pilot runtime/cost. Turbo parallelizes designs and does
not pool GPU memory for one oversized complex.

## Discover the current contract

Treat the live protocol schema as authoritative. Do not copy a remembered
schema, framework list, GPU list, or default into a job.

```sh
ariax protocols --json
ariax schema esmfold2-pipeline --json
```

Start from [the bundled example](../../examples/esmfold2-pipeline.json) when
useful, then reconcile it with the returned schema. The job uses protocol
`esmfold2-pipeline` and nests its scientific settings under `protocol_config`.
Do not include `user_id`; the API key identifies the owner. Supply the project
name separately with `ariax submit --name`.

Important Ariax invariants are not user settings:

- Production campaigns always use 150 optimization steps.
- The critic follows the selected inversion model.
- Protenix v2 validation and structural templates are required.
- Analysis copies at most 100 top-ranked structure pairs. Ranking rows for
  all eligible designs remain in the combined ranking table.

Do not add upstream `steps`, `critics`, validation-model, template-disable,
output-path, or worker controls. Configure only fields present in the live public schema.

For miniproteins, use `binder.length`. For VHH or scFv, use
`binder.frameworks` with `"all"` or a supported nonempty subset. The campaign's
`num_designs` is the total candidate count, not a per-framework count.

Ariax exposes the supported inversion-model choices, a shared ipTM gate used
for ESMFold2 selection and Protenix validation acceptance, an optional validation
top-k, final analysis top-k, public MSA use,
and contact-loss controls under `protocol_config.advanced`. Omit advanced
fields unless the user needs them. Current contact controls are:

- `binder_target_contact_mode`: `legacy` (default for miniproteins) or
  antibody-only `mosaic_cdr` (default for VHH/scFv);
- `mosaic_cdr_contact_weight`: nonnegative, default `0.5`;
- `mosaic_cdr_contact_cutoff_angstrom`: positive, default `22`;
- `mosaic_cdr_num_target_contacts`: positive integer, default `3`;
- `mosaic_framework_contact_penalty_weight`: nonnegative, default `0`;
- `mosaic_framework_contact_penalty_cutoff_angstrom`: positive, default `22`;
- `mosaic_framework_contact_probability_threshold`: greater than `0` and at
  most `1`, default `0.2`;
- `mosaic_framework_contact_penalty_scope`: `auto`, `hotspot`, or `target_all`;
  and
- `hotspot_critic_contact_cutoff_angstrom`: positive, default `5`.

Mosaic CDR scoring focuses attraction on antibody CDR residues. The framework
penalty discourages framework-mediated binding and applies only to VHH/scFv.
Fetch the live schema for the remaining advanced fields and current model IDs.

Public MSA use may be disabled, but Protenix and structural templates remain
enabled. In scFv validation, public MSA applies to the target; the bundled
structural framework supplies the binder template and no scFv binder MSA is
used.

## Select a structure target

Ariax supports two target sources:

- **Upload:** set `protocol_config.target.source` to `upload`, select target
  chains, and pass a local `.pdb`, `.cif`, or `.mmcif` file with `--input`.
  Let the CLI and upload authorization bind the stored object; never place a
  workstation path. Do not send `target.object_key`; Ariax derives the canonical
  storage key from the validated upload intent.
- **RCSB:** set the source to `rcsb`, provide an exact four-character `pdb_id`,
  and omit `--input`. The public API accepts an exact ID; keyword search and
  interactive entry selection belong to the web setup page, not the agent API.

For RCSB jobs, plain JSON validation has no structure bytes. Prefer fetching
and preparing an exact snapshot with `ariax inputs prepare --pdb 2B5I -f
job.json --output prepared --json`, then validate/submit the saved job and input.
This uses the validated upload path and records the entry checksum. Inspect
chains, author selectors, and full sequences before submission.

Select every target chain whose structure or occupancy matters to the design.
Multichain targets are supported. Ariax uses the selected structure as
distogram conditioning during design and critic folds; when a full sequence is
known, unresolved residues remain in the sequence while their missing geometry
is masked. This conditioning is not an agent-facing toggle.

The public contract requires one-character alphanumeric chain IDs. For RCSB
targets, verify chain and residue identifiers against the chosen entry before
submitting. For uploaded mmCIF files, the CLI performs the same safe author-chain
normalization as the browser setup page and remaps chain-addressed target fields
in the prepared job. It changes only the upload copy, never the local source.

The deployed ESMFold2 reader requires both `_atom_site.label_atom_id` and
`_atom_site.auth_atom_id`. Before any API or storage call, the CLI preserves
existing author atom IDs, or adds a missing `auth_atom_id` column by copying the
corresponding `label_atom_id` token in every atom row. It must stop if label atom
IDs are also absent, an atom row is incomplete, or another required atom-site
field is missing. The other reader-required fields are `label_seq_id`,
`auth_seq_id`, `label_asym_id`, `label_entity_id`, `auth_asym_id`,
`pdbx_PDB_ins_code`, `auth_comp_id`, and `label_comp_id`. Do not invent chain,
entity, residue, or component metadata.

Use optional hotspots to steer design toward an epitope and participate in
contact gating. Use optional crop ranges to retain only relevant target
regions. Both use the structure's **author residue numbers** (`auth_seq_id` or
PDB residue numbers), not mmCIF label/canonical sequence positions. Examples
of the public representation are `target.hotspots: ["C:1-10"]` and
`target.crop: {"C": ["1-180", "190"]}`; always confirm the accepted shape
against the live schema.

The CLI verifies selected chains, hotspot author residues, and crop spans for
uploaded files. ESMFold2-pipeline cannot safely address author insertion codes;
renumber the structure before use rather than silently translating selectors.
The raw API validates JSON shape but never downloads or parses user structure
content.

## Preserve full target sequences

Structure coordinates can omit unresolved residues even though the full chain
sequence is required for design and partial-template conditioning. With
`--input`, the CLI resolves every selected chain's sequence in this order:

1. `protocol_config.target.sequences` supplied in the job;
2. PDB `SEQRES` or mmCIF polymer sequence metadata;
3. coordinate residues, only when they form a safely contiguous register; or
4. an interactive prompt for the full one-letter sequence.

Supplied and reconstructed ESMFold2 sequences must use the 20 standard
one-letter amino-acid codes and align unambiguously to observed coordinate
residues. In `--json`, piped, or other non-interactive use, the CLI never
prompts. If reconstruction is unsafe, ask the user for the exact full sequence
and place it under `protocol_config.target.sequences.<chain>`; never close a
coordinate gap by guessing. Validation fails before API or object-storage work
when this local preparation cannot be completed.

The uploaded bytes go directly from the CLI to private object storage using a short-lived
URL; they do not pass through Ariax application servers. The API verifies the
reserved object's existence and size but does not inspect its molecular
content. Prefer the CLI over raw REST for uploaded structures. Raw REST clients
must perform the same mmCIF normalization and compatibility checks themselves.

## Validate and submit

For an uploaded structure, run local preparation and side-effect-free server
validation together:

```sh
ariax validate -f esmfold2-job.json --input ./target.cif --json
```

For an RCSB target, omit `--input`:

```sh
ariax validate -f esmfold2-rcsb-job.json --json
```

Resolve every validation error. Before starting compute, summarize the target,
selected chains and author-numbered regions, modality, framework or length,
design count, validation gate, and compute preferences. Submission and restart
can spend credits; obtain the user's authorization unless it was already given.
Ariax has no compute-quote operation.

For an uploaded target, validate and submit the same local file with the same
CLI version so the prepared job and normalized upload bytes remain paired.

```sh
ariax submit -f esmfold2-job.json --input ./target.cif \
  --name my-esmfold2-run --wait
```

For RCSB jobs, use the same command without `--input`. Recover an uncertain
submission with `ariax recover OPERATION_ID --wait`; see the shared guide.

The current public contract exposes Ariax Turbo through `turbo_mode` and
`turbo_multiples`; verify this in the live schema before setting them. Turbo
allows supported multi-GPU allocations and can reduce wall-clock time while
increasing concurrent spend. Enable it only when the user authorizes that
compute policy. GPU preferences express eligible classes and cost/performance
ordering, not a guaranteed reservation; ESMFold2-pipeline requires a supported
80 GB-or-larger GPU class.

## Monitor and interpret results

```sh
ariax status "$PROJECT_ID" --wait
ariax jobs --project "$PROJECT_ID" --json
ariax logs "$JOB_ID" --tail 200
ariax results "$PROJECT_ID" --path esmfold2 --json
ariax results "$PROJECT_ID" --path validation --json
ariax results "$PROJECT_ID" --path ranked_results --json
ariax results "$PROJECT_ID" --path archives --json
```

Status progresses through planning, ESMFold2 inversion/critic work, selection,
required Protenix v2 validation, consensus ranking, and completion. Intermediate
artifacts can appear before completion. `ariax logs` reads only retained
ESMFold2 campaign compute logs stored with the project's outputs; it never exposes
Ariax API, worker, infrastructure, or other platform logs.

A job that fails within seconds at 0% with an `auth_atom_id` or other atom-site
field error is an input-compatibility failure, not a GPU-capacity failure. Do not
retry the unchanged upload or switch GPU/settings. Re-run current CLI validation
and submit a newly normalized upload copy; if current validation still accepts
it, report the parser mismatch instead of spending more credits.

Bare `ariax results` discovers these result roots together; use `--path` to
narrow the listing:

- `esmfold2/` contains predicted complexes, aggregate metrics,
  ESMFold2-selected designs, and the ESMFold2 campaign summary.
- `validation/protenix_v2/` contains Protenix structures, per-design validation
  results, and the validation summary.
- `ranked_results/` contains `combined_ranking.csv`, complete diagnostics, and
  paired top-ranked ESMFold2/Protenix structures.
- `archives/` contains verified packaged downloads produced at successful
  completion.

Start final review with `ranked_results/combined_ranking.csv`. Its rank combines
ESMFold2 binder-target ipTM, Protenix ipTM/ipSAE, and target-aligned binder-pose
agreement. Use `ranking_diagnostics.csv` to understand exclusions rather than
assuming every generated design reached the final list. VHH exports include
heavy-chain CDR sequences; scFv exports include heavy- and light-chain CDR
sequences. Inspect both models' structures and metrics before choosing designs
for synthesis.

If waiting is interrupted, remote compute continues; resume with
`ariax recover OPERATION_ID --wait` instead of resubmitting. Use pause, abort, or restart
within the user's existing campaign authorization. Public restart preserves the existing
scientific and compute configuration; it cannot edit the campaign. Existing
authorization applies when it covers recovery.

If the CLI is unavailable, use the [raw REST fallback](../../core/raw-curl.md)
while preserving direct-upload, sequence, author-numbering, and
authorization constraints.

For scientific context, use Ariax's
[setup guide](https://www.ariax.bio/docs/esmfold2-pipeline-project-setup) and
[launch overview](https://www.ariax.bio/resources/esmfold2-pipeline-arrives-at-ariax-bio).

Read [output interpretation](outputs.md) before choosing candidates or interpreting ranks.

If the target file is missing, request that file first. Inspect its polymer metadata before requesting a separate full sequence; do not ask the user to resupply information the structure already contains.
