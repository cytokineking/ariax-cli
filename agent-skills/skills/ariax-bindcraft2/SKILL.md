---
name: ariax-bindcraft2
description: Configure, validate, submit, monitor, and interpret hosted Ariax BindCraft2 campaigns for de novo proteins, peptides, VHH, scFv, Fab, ankyrin-repeat, homo-oligomer, and multidomain binders, including compatible multi-target and detargeting experiments.
---

# Ariax BindCraft2

Read the shared [Ariax workflow](../../SKILL.md) before using this protocol. Fetch the live contract with `ariax schema bindcraft2 --raw`; this guide explains scientific choices and BC2-specific evidence. BindCraft2 is distinct from `bindcraft-v1.5`; the `bindcraft` CLI alias still means v1.5.

BindCraft2 optimizes a binder with AlphaFold2, redesigns sequences with ProteinMPNN, then validates and filters candidates. An accepted design passed computational filters. It does not establish affinity, specificity, immunogenicity, stability, or experimental success.

## Choose the format

Use the exact case-sensitive modality token in `protocol_config.modality`. `induced_fit` and `fold_switch` are optional modifiers after the base format and require one prepared target state.

| Modality | Project type | Setup |
| --- | --- | --- |
| `binder` | `miniprotein` | De novo, inclusive two-value length range |
| `large_binder` | `protein` | Longer de novo chain; review memory and target context |
| `peptide` | `peptide` | Linear peptide; inspect the bound pose |
| `cyclic_peptide` | `cyclic-peptide` | Head-to-tail intent; inspect closure geometry |
| `VHH` | `vhh` | Bundled or custom single-chain scaffold |
| `scFv` | `scfv` | Two designed variable-domain chains; BC2 does not design a linker |
| `Fab` | `fab` | Heavy/light scaffold with constant domains |
| `ARP` | `arp` | Ankyrin-repeat scaffold; `DARPin`/`darpin` are legacy aliases |
| `homo_oligomer` | `protein` | Per-copy length, `copies`, and optional tying policy |
| `multidomain` | `protein` | One multi-domain chain; set compatible domain controls |

Do not substitute Helicon for cyclic peptide: Helicon chemistry is a BoltzGen workflow. Use BC1 for explicitly requested v1.5 campaigns, PXDesign for its diffusion plus AF2-IG/Protenix workflow, and ESMFold2-pipeline for inversion plus independent Protenix validation. Do not compare unrelated engine scores as a common quality scale.

## Prepare the input bundle

The first target must be a structure named `input.pdb` or `input.cif`. Primary FASTA is deferred. Up to eight targets and nine unique files are accepted, including an optional custom scaffold. Additional targets may be PDB, mmCIF, or FASTA. Filenames in the config are exact local bundle basenames, not URLs or server paths.

Use `ariax inputs inspect` to review filenames and roles, selected chains or FASTA records, lengths, selector validation, scaffold edits, warnings, and the proposed epitope. The compact response omits hashes and preparation bookkeeping. Add `--full` for complete sequences and residue maps; add `--details` for the prior diagnostic manifest fields. The flags are orthogonal and can be combined. This local evidence comes from the supplied coordinate and polymer metadata. It does not determine biological assembly or target accessibility, which require separate biological review. Preserve explicit hotspots and coldspots. BC2 uses its native author-numbered residue selections; do not reuse BoltzGen canonical positions or another engine's coordinate transformation.

For a secondary FASTA target, select the intended record. FASTA targets cannot carry structure-numbered hotspots or coldspots. Cropping can produce states such as `idr_epitope_1`; state-scoped filters must name the expanded state. Detargeting requires an explicit `objective: "detarget"` and a final ceiling. A computational negative-selection score is not experimental specificity.

Bundled scaffold formats use hosted defaults. Do not download or redistribute bundled scaffold assets. A custom scaffold requires a PDB/mmCIF `scaffold_file` and native `mutate_positions`, such as `A50-55(5-8)` for a variable-length edit; omit de novo `lengths`. Validate positions against that exact scaffold rather than copying an edit range from another construct.

## Configure properties and controls

The nine optional properties are `bigbang`, `disulfide_staple`, `forced_targeting`, `humanize`, `initial_guess`, `mixed_topology`, `protease_stable`, `termini_accessible`, and `termini_together`. Compatibility depends on format and targets. Humanization, protease, and disulfide objectives optimize proxies.

`bigbang` seeds gradient stages and re-prediction from coordinates on hand; de novo binders start at the origin. `initial_guess` seeds re-prediction from the trajectory pose while ordinary gradient initialization remains unchanged.

Use only fields accepted by the live schema. Preserve omitted fields, explicit zeroes, and `false`: they are different requests. `sequence_candidates` controls ProteinMPNN proposals; `kept_sequences` controls retained proposals. Detarget rotation thresholds and `max_detarget_iptm_final` serve different stages. Filters have exact native names, directions, units, and optional state scope. Shell commands, model paths, arbitrary native settings, provider knobs, upstream sweeps, and custom reranking are outside the hosted contract.

## Plan a bounded pilot

A useful starting suggestion is two accepted designs with `max_trajectories: 20`, leaving native scientific defaults unchanged. This is a review point, not a guarantee or spend cap. Accepted designs and attempted trajectories are separate counts; an exhausted pilot can complete with zero accepted designs.

Read `ariax pricing --json` and report the current hourly GPU rate. Do not estimate duration or total campaign cost. Turbo permits 2, 4, or 8 GPUs when authorized and available; the server assigns workers. More GPUs increase combined hourly cost and do not pool memory for one worker. Preserve the user's compute and spending authorization, and do not relaunch an exhausted pilot automatically.

Treat canonical `RTX6000PRO` as a primary/core BindCraft2 option when the live
schema advertises it, alongside other compatible primary choices. It is not
`RTX6000ADA` or `A6000`. New bundled examples include it in their eligible GPU
range; keep saved or explicitly supplied project selections unchanged unless
the user authorizes a replacement policy.

## Inspect, validate, and submit

Start from [`bindcraft2-pilot.json`](../../examples/bindcraft2-pilot.json) or an example in [`bindcraft2-formats/`](../../examples/bindcraft2-formats/). Put every configured input file in one directory.

```sh
ariax inputs inspect --input-dir ./bc2-inputs -f bc2-job.json --json
ariax inputs prepare --input-dir ./bc2-inputs -f bc2-job.json --output ./bc2-prepared --json
ariax validate -f ./bc2-prepared/job.json --input-dir ./bc2-prepared --json
ariax submit -f ./bc2-prepared/job.json --input-dir ./bc2-prepared --name bc2-pilot --wait --json
```

`--input-dir` is mutually exclusive with `--input`. Single-file `--input` is valid only when the config requires exactly one file named `input.pdb` or `input.cif`. The prepared directory contains `job.json`, `input-manifest.json`, and the exact configured files. The output path may be absent or an existing empty real directory; an identical rerun is accepted, while any different content is refused. Keep the prepared bundle intact. Local preparation checks bytes and selectors; server validation is authoritative for the API schema; native runtime preflight is the final execution check. Validation alone does not prove execution or binder quality.

Submission starts billable compute; carry forward the user's authorization as described in the shared workflow.

## Review the campaign

```sh
ariax status PROJECT_UUID --json
```

Follow `data.action.command` from this response; do not fetch every candidate view. It chooses `final` for accepted designs, `all` for refolded candidates, or `diagnostics` for earlier native exits. Add `--json` for structured rows. Use `meta.next_cursor` or `--all` only when more pages are needed; unfinished publication alone does not mean another page exists.

Use `ariax results PROJECT_UUID --json` to locate artifacts, then `ariax results PROJECT_UUID --download ./bc2-results --json` when files are needed. Read logs only when the reported failure or missing evidence calls for them. Default output keeps scientific evidence; `--details` restores the prior diagnostic fields.

Project lifecycle and campaign phase answer different questions. Always read attempted, accepted/requested, saved trajectory, refolded, and ranked counts together. A completed campaign with zero accepted designs is a scientific outcome, not an execution failure and not evidence that more compute will help. If attempts exceed saved trajectory records, report the discrepancy and preserve the stated uncertainty.

Native stage termination precedes final filtering. When no candidates were scored, an empty final-filter list means those filters were not evaluated. Do not infer pass/fail from rounded metrics or treat missing eligibility as false. BindCraft2 can publish more refold rows than trajectories because multiple sequence candidates can be evaluated from one trajectory.

Read [BindCraft2 outputs](outputs.md) for candidate fields, missing tables, native score units, and recovery. Follow each download failure's `action`; rerunning a transiently interrupted download resumes saved files.

### Saved structures

Use the live server schema and validation with the existing job JSON `protocol_config.advanced`. New campaigns default `save_design_trajectory`, `save_failed_trajectories`, `save_failed_refolds`, and `save_binder_monomers` to true; explicit false values are preserved. Packaged BindCraft2 examples show these choices. No additional flags or settings DSL are needed. Retain these values when exporting or reusing a job.

`save_design_trajectory` saves the terminal prediction per predicted state, including rejected/early-terminated trajectories when predictions exist. Accepted/ranked structures are always saved. `save_binder_monomers` controls refolded monomers; terminal trajectory output may also write monomers. Intermediate frames, animations, and relaxation remain separate and are not enabled by these choices.

A missing saved structure is distinct from scientific rejection or acceptance. No finite prediction can mean no structure; an early exit can have a structure but no scored metrics. Never invent scores or claim to recover historical unsaved structures. The website defaults to trajectories with structures while keeping full CSV downloads and attempt counts. The candidates API supports `view=diagnostics&structures_only=true` for BindCraft2; it filters before pagination, reports `total` and `overall_total`, and invalidates cursors when publication/filter changes. Omitted/false keeps all rows. Older publications use bounded discovery and may require retrieving the CSV and artifacts directly.
