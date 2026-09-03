---
name: ariax-bindcraft
description: Configure, submit, monitor, and retrieve Ariax BindCraft binder-design campaigns through the Ariax CLI. Use for de novo miniprotein or linear alpha-helical peptide design against a protein structure; use another Ariax protocol for VHH, cyclic-peptide, chemically modified helicon, small-molecule, or richer all-atom constraints.
---

# Ariax BindCraft

Use Ariax's hosted BindCraft workflow to generate de novo binders against a
protein target. BindCraft iterates AlphaFold2-guided binder hallucination,
ProteinMPNN sequence optimization, structural scoring, and filtering until the
requested accepted-design count is reached or the project is stopped.

Prefer the `ariax` CLI. It combines local structure checks with the public
versioned REST API; MCP is not part of this workflow.

Use the [shared workflow](../../SKILL.md) for account access, existing user
authorization, durable recovery, and downloads.

## Decide whether BindCraft fits

Choose BindCraft when the goal is an automated campaign of miniprotein binders
or short, linear alpha-helical peptide binders against one or more chains of a
protein structure and filter-based down-selection is appropriate.

BindCraft does not cyclize or chemically staple these peptides. Do not use it
for cyclic peptides, chemically modified helicons, VHH antibodies,
small-molecule targeting, or detailed all-atom constraint languages. Route
those requests to a protocol that exposes the required modality.

## Plan the campaign and GPU

Read [campaign planning](../../core/campaigns.md) before choosing the accepted
count or compute policy. BindCraft runtime depends on acceptance: periodically
inspect trajectory poses and acceptance, and review the setup if **no designs
are accepted after 25–40 trajectories**. Consider stopping and revising filters,
settings, hotspots, or target trim within the user's agreed scope. This is a
review trigger, not an automatic abort. Recommend Turbo for long campaigns
within the authorized compute policy.

For both BindCraft and FreeBindCraft, Ariax's practical GPU guidance is:

- Small targets of roughly **100–150 amino acids or fewer** can use any GPU
  supported for this protocol. Account for binder length as well.
- Above that range, allow more VRAM. For **300–700-residue targets**, an
  **H100, H200, B200, or B300 is strongly recommended**.
- **RTX 6000 Pro** offers outstanding value and similar BindCraft performance
  to an H100; distinguish it from RTX 6000 Ada and use the live schema's ID.
- Targets **over about 700 residues** may crash and generally become
  uneconomical. Prefer trimming to the relevant domain/site to reduce memory,
  runtime, and cost while preserving its fold and necessary structural context.

These size ranges are operating guidance, not hard validation limits or a
guarantee that a particular complex fits. Count the effective target across
selected chains and include the binder in memory planning. Faster GPUs can
offset higher hourly prices by completing runs sooner; use pilot observations
to assess the tradeoff and validate the current GPU eligibility policy.

## Discover the current contract

Treat discovery and validation as authoritative. Do not infer accepted fields,
preset names, GPU availability, or defaults from this skill.

```sh
ariax protocols --json
ariax schema bindcraft-v1.5 --json
```

Start from [the bundled BindCraft example](../../examples/bindcraft-v1.5.json),
then reconcile every field with the returned schema. The scientific job file
contains the protocol configuration; the project name is supplied separately
to `ariax submit`. Do not add `user_id` because the API key identifies the
owner.

The contract exposes the target chains, optional hotspots, binder-length
range, requested accepted-design count, filter preset, advanced protocol
preset, scoring choice, and compute preferences. Important setting families
include:

- Standard or beta-sheet-oriented four-stage miniprotein protocols, with
  optional target flexibility, hard-target initial-guess behavior, or MPNN
  interface redesign where a matching live preset exists.
- Peptide-specific three-stage protocols and filters for linear alpha-helical
  peptide design.
- Strict, relaxed, or no-filter profiles. Relaxed or disabled filters admit
  more candidates but increase experimental risk; do not silently weaken a
  user's requested acceptance criteria.
- `use_pyrosetta: false` selects Ariax's PyRosetta-free FreeBindCraft path.
  This replaces Rosetta-dependent relaxation and metrics with alternative
  implementations. Its metrics and relaxed structures are not numerically
  interchangeable with PyRosetta results. Some fields, including energy scores,
  hydrogen-bond counts, and PackStat, use fixed placeholder values; they do not
  represent computed results. Set this field explicitly because omission
  currently selects PyRosetta.
- `use_pyrosetta: true` selects traditional PyRosetta scoring. Use it only
  after the user confirms that their intended use is covered by an applicable
  PyRosetta/Rosetta license. Otherwise choose the open-source path or ask.
- Turbo Mode is exposed through the live compute fields. It parallelizes the
  campaign across multiple GPUs using supported multiples (currently 2x, 4x,
  or 8x). It can reduce wall time but increases concurrent spend; never enable
  it without the user's authorization.

`design_override: true` explicitly permits combinations across the known
miniprotein and peptide preset families, matching the website's Design Override
control. Keep it omitted in normal mode. Override does not allow arbitrary
preset paths or relax project-type length limits. Do not substitute a different
filter or scoring workflow without authorization for that scientific change.

## Prepare the target PDB

BindCraft on Ariax currently requires a PDB file; CIF/mmCIF input is rejected.
With `--input`, the CLI requires a nonempty UTF-8 structure no larger than 10
MB with recognizable protein `ATOM` records.

Keep only the target chains and structural context needed for the desired
epitope. Smaller targets usually need less memory and compute, but do not trim
away residues or domains needed to preserve the binding site's conformation.
Remove complete residues rather than leaving partial residues or orphan atoms.

Set `chains` to the comma-separated PDB chain identifiers BindCraft should
consider. An unselected chain is ignored by the design model, which may place a
binder where that chain appears in the uploaded structure. Select every chain
whose physical occupancy must constrain the design.

`hotspots` is optional. An empty value lets BindCraft search for a favorable
surface. Otherwise use PDB **author residue numbers**, not canonical sequence
positions:

- `A45` targets one residue.
- `A45-50` targets an inclusive range.
- `A45,A50-55,B20` combines chains and ranges.
- `A` targets the whole selected chain.

The CLI verifies that selected chains and hotspot author residues exist and
that hotspots resolve to protein residues. BindCraft treats hotspots as a
preference within its optimization objective, not a guarantee; inspect early
trajectories to confirm that designs occupy the intended site.

Ariax's browser-based Prep Inputs tool can trim structures and select hotspots
locally when visual preparation is useful. See the
[public preparation guide](https://www.ariax.bio/docs/prepare-inputs) and
[BindCraft setup guide](https://www.ariax.bio/docs/bindcraft-project-setup).

## Configure miniprotein campaigns

Set `project_type` to `miniprotein`. `lengths` is a two-integer `[minimum,
maximum]` range with both values at least 31 and minimum no greater than
maximum; the website starts at `[65, 150]`. Set `num_designs` to a positive
accepted-design target; the website starts at 100.
A trajectory can yield two accepted designs with the default settings, so the
final count can exceed `num_designs`; this is expected.

Choose one miniprotein filter preset:

- `default_filters` for the standard acceptance criteria;
- `relaxed_filters` for more permissive acceptance; or
- `no_filters` to disable the preset threshold filters. This does not guarantee
  that every attempted trajectory becomes an accepted final design.

Choose one of the 16 advanced presets by combining a base with a suffix:

- Base: `default_4stage_multimer` or `betasheet_4stage_multimer`.
- Suffix: none, `_flexible`, `_hardtarget`, `_flexible_hardtarget`, `_mpnn`,
  `_mpnn_flexible`, `_mpnn_hardtarget`, or
  `_mpnn_flexible_hardtarget`.

For example, `default_4stage_multimer_mpnn_flexible` and
`betasheet_4stage_multimer_hardtarget` are complete preset IDs. The beta-sheet
base biases the binder topology toward beta structure. Flexible variants allow
target flexibility, Hard Target variants use an initial guess for difficult
targets, and MPNN variants allow interface-position redesign. Use the plain
`default_4stage_multimer` unless the user has a reason to select a specialized
variant.

## Configure peptide campaigns

Set `project_type` to `peptide` and keep both `lengths` values between 8 and 30
residues; Ariax's web default is 8–25. Use one of the peptide filter presets:
`peptide_filters`, `peptide_relaxed_filters`, or `no_filters`. Use one of the
linear-peptide protocols: `peptide_3stage_multimer`,
`peptide_3stage_multimer_flexible`, `peptide_3stage_multimer_mpnn`, or
`peptide_3stage_multimer_mpnn_flexible`.

The target PDB, selected chains, author-numbered hotspots, design count,
scoring choice, GPU policy, submission, and result workflow are otherwise the
same as for miniproteins. These presets generate linear alpha-helical peptide
binders. They do not create a cyclic peptide or add a staple or other chemical
modification; use the predicted complex as a starting point for any later
experimental chemistry.

For the rationale and experimental context, see Ariax's
[therapeutic peptide design guide](https://www.ariax.bio/resources/bindcraft-peptide-design).

## Validate, submit, and wait

Validation performs no upload and starts no compute:

```sh
ariax validate -f bindcraft-job.json --input ./target.pdb --json
```

Resolve all local and server validation errors. Submission uploads the prepared
PDB directly from the CLI to private object storage using a short-lived URL;
the bytes do not pass through Ariax application servers. The API verifies the
reserved object's presence and size, but does not parse its content.

After the user authorizes the paid compute work, submit the project:

```sh
ariax submit -f bindcraft-job.json --input ./target.pdb \
  --name my-bindcraft-run --wait
```

Project names contain only letters, numbers, and dashes and are at most 27
characters. There is no compute-quote API. Submission and restart use the
account's existing credit and compute-admission checks.

If waiting is interrupted, remote compute continues. Resume polling rather
than submitting again:

```sh
ariax recover OPERATION_ID --wait
# or
ariax status "$PROJECT_ID" --wait
```

For an uncertain submission or interrupted wait, follow the shared
[operation recovery workflow](../../SKILL.md#submit-and-recover). Reuse the
original operation with `ariax recover OPERATION_ID --wait`.

## Monitor and retrieve results

```sh
ariax status "$PROJECT_ID"
ariax jobs --project "$PROJECT_ID" --json
ariax logs "$JOB_ID" --tail 200
ariax results "$PROJECT_ID" --json
ariax results "$PROJECT_ID" --download ./bindcraft-results
```

Status exposes tested and accepted progress. Low acceptance can be a valid
scientific outcome rather than a stalled job; use the compute log and new
trajectory artifacts together to distinguish slow filtering from failure.
`ariax logs` reads only BindCraft compute-log objects stored with the project;
it never exposes Ariax API, worker, infrastructure, or other platform logs.

Discover paths with `ariax results` instead of guessing them. Ariax retains
accepted-design PDBs (including ranked copies), relaxed trajectory PDBs,
`final_design_stats.csv`, `trajectory_stats.csv`, and compute logs. Attempted
MPNN statistics, rejected designs, animations, and other intermediates are not
retained. An accepted design
has passed the selected computational filters; it is not proof of folding,
binding affinity, specificity, safety, or experimental success. Compare
metrics within the scoring/filter workflow that produced them and plan wet-lab
validation.

Use pause, abort, or restart within the user's existing campaign authorization. Public v1 restart
preserves the existing scientific and compute configuration; it is not a way
to change hotspots, filters, scoring, or GPU settings. A restart starts paid
compute; retain existing authorization when it already covers recovery.

## Operational boundaries

- Follow the shared skill's login guidance. If Ariax is not connected, ask the
  user to run `ariax login`; never request, print, or place the key in job JSON,
  a URL, or a command argument.
- Validation and discovery are read-only. Submission and restart can spend
  credits; Turbo Mode multiplies concurrent allocation.
- A local timeout or interrupted wait never authorizes aborting the project.
- If the CLI is unavailable, use the [raw REST fallback](../../core/raw-curl.md),
  understanding that raw API upload does not reproduce the CLI's local PDB,
  chain, or author-residue validation.

Read [output interpretation](outputs.md) before choosing candidates or interpreting ranks.
