---
name: ariax-boltzgen
description: Design VHH nanobodies, miniproteins, linear or cyclic peptides, helicons, and miniproteins against one small molecule with BoltzGen on Ariax. Use for configuring, validating, launching, monitoring, or retrieving an Ariax BoltzGen campaign; not for generic structure prediction or upstream-only BoltzGen features.
---

# BoltzGen on Ariax

Use the Ariax CLI and public `/api/v1` API. Do not invoke BoltzGen directly or
construct its internal YAML: Ariax translates the public job specification into
the installed BoltzGen workflow and manages compute, recovery, logs, and object
storage.

Use the [shared workflow](../../SKILL.md) for account access, existing user
authorization, durable recovery, and downloads.

## Choose BoltzGen deliberately

BoltzGen is Ariax's all-atom, multi-stage binder-design engine. Prefer it when
the requested modality is VHH, cyclic peptide, helicon, or a miniprotein that
binds a small molecule. It is also available for ordinary miniprotein and
linear-peptide design when the user wants an alternative to BindCraft.

Ariax exposes exactly these BoltzGen project types:

| `project_type` | Ariax behavior | Length input | Target input |
| --- | --- | --- | --- |
| `miniprotein` | Variable-length protein binder | Required; minimum at least 31 | PDB or mmCIF plus selected protein chains |
| `peptide` | Linear peptide | Required; 8–30 | PDB or mmCIF plus selected protein chains |
| `cyclic-peptide` | N-to-C cyclic peptide | Required; 8–30 | PDB or mmCIF plus selected protein chains |
| `helicon` | Fixed stapled-helical peptide construction | Omit | PDB or mmCIF plus selected protein chains |
| `vhh` | Installed VHH scaffold set | Omit | PDB or mmCIF plus selected protein chains |
| `miniprotein-small-molecule` | Miniprotein against one ligand | Required; minimum at least 31 | Exactly one CCD code or SMILES; no structure file or `chains` |

Do not promise upstream-only modes through Ariax. The public contract does not
accept arbitrary BoltzGen YAML, Fab/whole-antibody design, protein redesign,
nucleic-acid targets, or arbitrary bond, insertion, secondary-structure, or
residue constraints.

## Plan the campaign and GPU

If size is unspecified, suggest a **25–50-design pilot**, inspect generated and
refolded poses, native filter outcomes, and objective-respecting yield, then
consider **10,000–20,000 generated designs** for a full campaign. Preserve an
explicit smaller test. Read [campaign planning](../../core/campaigns.md) before
scaling; recommend Turbo for long campaigns within the agreed compute policy.

BoltzGen's diffusion workflow has less stringent GPU requirements than the
inversion workflows, but increase GPU capability and VRAM as target size grows.
Include binder size and downstream refolding in that decision. More powerful
compatible GPUs generally finish faster, often offsetting higher hourly prices;
compare pilot time/cost instead of choosing solely by hourly price. Use the live
schema for eligible GPU classes. Trim targets when helpful while preserving the
intended site's fold and physical context.

## Build a job specification

Discover the current contract before preparing a job. The live schema wins over
this skill and the bundled example:

```sh
ariax protocols --json
ariax schema boltzgen --json
```

Start from [`../../examples/boltzgen.json`](../../examples/boltzgen.json) if
useful, then adapt it to the user's scientific intent. Do not include `user_id`
or a project name in the job file; authentication supplies identity and
`ariax submit --name` supplies the name.

For protein-target modes:

- Set `chains` to the comma-separated target-chain IDs found in the input.
- Supply `lengths: [min, max]` for miniprotein, peptide, and cyclic-peptide.
  Ariax requires miniprotein minimum length at least 31 and
  peptide/cyclic-peptide lengths within 8–30.
- Omit `lengths` for `vhh` and `helicon`; Ariax constructs those modalities from
  its installed scaffold or staple recipe.

For `miniprotein-small-molecule`, omit `chains` and `--input`, provide
miniprotein `lengths`, and set exactly one of `ligand_ccd` or `ligand_smiles`.
Do not provide both. A CCD value is a Chemical Component Dictionary code, not a
free-form ligand name.

`num_designs` is the number of candidates generated through the pipeline.
`budget` is the number selected into the final quality-and-diversity set; keep
it positive and no larger than `num_designs`. Neither field is a guaranteed
count of designs that pass filters or satisfy the biological objective.

## Select chains and binding regions

`binding_rules` is a list of per-chain rules. Each item names the chain in `id`
and may contain `binding`, `not_binding`, or both:

- `binding` identifies canonical target positions the binder should contact.
- `not_binding` identifies canonical target positions it should avoid.
- Masks accept positive positions separated by commas, inclusive ranges using
  `..`, and `all`. For example: `5..7,13`.
- Do not use `-` for a BoltzGen range and do not prefix positions with a chain;
  the rule's `id` supplies the chain.
- Do not overlap `binding` and `not_binding`. Omit a rule to leave that chain
  unconstrained; use `binding: all` only when the user explicitly wants the
  whole selected chain available as the binding region.

Example:

```json
{
  "binding_rules": [
    {"id": "A", "binding": "5..7,13", "not_binding": "30..40"}
  ]
}
```

BoltzGen selectors are canonical, 1-based sequence positions—not displayed PDB
author residue numbers:

- For mmCIF, BoltzGen expects `label_asym_id` chain IDs and absolute
  `label_seq_id` residue positions. The CLI preserves those absolute positions
  when validating binding rules.
- For PDB, the first observed author residue maps to canonical position 1. The
  CLI reports the shift when author numbering does not begin at 1.
- Missing residues still occupy canonical sequence positions. A gapped PDB
  without `SEQRES`, or a gapped mmCIF without polymer sequence metadata, cannot
  establish those positions safely; the CLI rejects it before upload. Repair it
  with Ariax Prep Inputs or use an mmCIF containing polymer metadata.

Never translate author hotspots by guesswork. Run local validation and resolve
every reported chain, numbering, gap, mask, water, or ligand-residue error.

## Validate, launch, and wait

Protein-target campaign:

```sh
ariax validate -f job.json --input ./target.cif --json
ariax submit -f job.json --input ./target.cif --name my-boltzgen-run \
  --wait --root-dir "$PWD"
```

Small-molecule campaign:

```sh
ariax validate -f job.json --json
ariax submit -f job.json --name my-boltzgen-run \
  --wait --root-dir "$PWD"
```

For an uncertain submission or interrupted wait, follow the shared
[operation recovery workflow](../../SKILL.md#submit-and-recover). Reuse the
original operation with `ariax recover OPERATION_ID --wait`.

The CLI parses protein structures and validates canonical selectors locally,
then uploads the bytes directly to object storage. User file bytes do not pass
through Ariax application servers. The raw API verifies only object existence
and size, so prefer the CLI for structure-backed BoltzGen submissions.

GPU fields are an eligibility policy, not a reservation. Use the current schema
and known Ariax GPU identifiers; `priority_mode` chooses performance or cost
ordering. Turbo is genuinely exposed: set `turbo_mode: true` and an acceptable
subset of `turbo_multiples` from 2, 4, and 8 only when the user has chosen the
additional parallel compute. Do not infer Turbo authorization from a desire for
fast results.

Submission and restart can incur real compute charges and remain subject to
credit and compute admission. Ariax has no compute-quote endpoint. Validate
freely, but submit or restart only with clear user authorization for the job's
campaign size and compute policy. Pause or abort within the user's existing campaign authorization.
Interrupting a local `--wait` leaves the remote job running.

## Monitor and retrieve results

```sh
ariax status "$PROJECT_ID" --wait
ariax jobs --project "$PROJECT_ID" --json
ariax logs "$JOB_ID" --tail 200
ariax results "$PROJECT_ID" --json
ariax results "$PROJECT_ID" --download ./boltzgen-results
```

BoltzGen progresses through generation, inverse folding, folding/refolding,
analysis, and filtering; exact stages vary by modality, with affinity analysis
enabled for the Ariax small-molecule mode. `ariax logs` returns only the
campaign's retained compute log, never Ariax application or worker logs.

Under the `output` artifact tree, expect intermediate designs,
inverse-folded/refolded outputs and metrics, and a timestamped
`final_ranked_designs-*` directory. Its `final_<budget>_designs` set is the main
quality-and-diversity-selected output. Inverse-folded intermediate CIFs can
contain placeholder zero coordinates for designed sidechains; use refolded or
final-ranked complexes for structural inspection.

If the CLI is unavailable, read
[`../../core/raw-curl.md`](../../core/raw-curl.md) and preserve the same
canonical-numbering, direct-upload, idempotency, and authorization boundaries.
Use REST, not MCP; Ariax MCP support is deferred.

Read [output interpretation](outputs.md) before choosing candidates or interpreting ranks.
