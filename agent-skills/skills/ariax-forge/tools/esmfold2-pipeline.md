# Native ESMFold2 design pipeline

The [managed ESMFold2-pipeline protocol](../../ariax-esmfold2-pipeline/SKILL.md)
runs a defined project lifecycle with its own schema and results. Its 150-step
requirement does not qualify that setting or multi-GPU execution in Forge;
inspect this native guide and the exact live mode.

Use this pipeline in a ready, authorized Forge session. Design and critic stages
use the experimental ESMFold2 model selected in the campaign and the shared ESMC
asset. Integrated validation uses the separate Protenix v2 checkpoint. Preparation
installs these named assets before native execution. The hosted
`ariax-esmfold2-pipeline` skill describes a separate hosted API.

Native source is pipeline `062a75846e14cc96126a600079c4d516287c0779`, package
0.1.0. The candidate selects Biohub ESM `ba4d7124864eed323a93bf3cfefcd958f573b75a`,
Transformers `ef32577f55da19a4989cd7b22e004dc43a4998cb`, the `local` design
backend and optimization `off`. It uses a separate template-capable Protenix environment. Standalone folding
and this design/critic/validation workflow have separate execution settings.

## Required model agreement

The selected default inversion and critic are both
`ESMFold2-Experimental-Cutoff2025`. Native alias `cutoff2025` resolves to that
name. The experimental model is separate from the release `biohub/ESMFold2`.
Other aliases are `fast-cutoff2025`, `experimental` and `fast`. Set the intended
alias explicitly in both `campaign.inversion_model` and `campaign.critics`;
exactly one critic is supported.

| Named asset | Candidate read-only location |
| --- | --- |
| `esmfold2-pipeline-cutoff2025` | `/models/esmfold2-pipeline/ESMFold2-Experimental-Cutoff2025`, revision `9a7c65fc1fae998c39f448f9b4fd4c0e00b2325f` |
| `esmfold2-pipeline-fast-cutoff2025` | `/models/esmfold2-pipeline/ESMFold2-Experimental-Fast-Cutoff2025`, revision `13f892d3bc9de27aa475e8a12ec76dba4054f4a2` |
| `esmfold2-pipeline-experimental` | `/models/esmfold2-pipeline/ESMFold2-Experimental`, revision `61717221f7546753c1fdd5366ae507fe3a40d10f` |
| `esmfold2-pipeline-fast` | `/models/esmfold2-pipeline/ESMFold2-Experimental-Fast`, revision `ef1fbacdd089429397f09a2b7d9799197bc901f8` |
| `esmfold2-pipeline-esmc6b` | `/models/esmfold2-pipeline/esmc6b`, native ESMC-6B revision `45b0fa5d7fb06faefbd5e3b89bdcef35d564e79a`, complete six shards and tokenizer |
| `biohub-esmfold2` | Prepared folding asset at `/models/biohub-esmfold2`; reuse only `ccd.pkl` here |
| `protenix-v2` | `/models/protenix-v2/checkpoint/protenix-v2.pt` |
| `protenix-chemical` | Complete six-file `common/` asset at `/models/protenix-chemical` |

The native validator selects `protenix-v2`, and preflight requires
`protenix-v2.pt`. Native expected-TM export from Protenix revision
`646492dd2f874b7dd6ea6f85a554974f6f5ef30c` supplies the logical role scores.
A missing checkpoint or failed preflight requires preparation or diagnosis.
A separate prediction does not become a native validation table row.

The loader patch uses fixed named model directories and offline loading with
the native ESMC loading diagnostics. No automatic download occurs during
scientific execution. An absent API, model, shard or CCD is a preparation error.
Inspect the actual native error before a new command. Run these commands in the
ready Forge session and save required results through Files.

## Bounded configuration and native commands

The accompanying `esmfold2-pipeline/campaign.yaml` proposes full 1UBQ ubiquitin
chain A, a 40-residue miniprotein, `num_designs: 2`, `seed_start: 7` (seeds 7/8) and eight optimization steps.
It reuses the existing [1UBQ source fixture](boltzgen/1ubq.cif).
This is a small execution case, with no binding or hit-rate evidence.
The normal 150-step design setting remains unqualified.
Native design folds use one loop and one sampling step, or fifty when design
confidence is requested. Final critic uses three loops/two hundred steps.

`num_designs` means total seeds, not seeds per framework. The native planner resolves
`seed_start` and `num_designs` to explicit seeds. One seed creates one shard and one candidate;
framework choices rotate across seeds. Exactly one critic is supported.
Antibody frameworks and custom sequence/template CDR ranges are separate native
configurations; miniproteins have no antibody framework.

The completed small-case coverage includes these native configurations:

| Inversion and critic alias | Target and binder coverage |
| --- | --- |
| `cutoff2025` | Complete 76-residue ubiquitin with 40-residue miniproteins; built-in 242-residue trastuzumab scFv |
| `fast-cutoff2025` | Sequence-only ubiquitin with two 40-residue miniproteins, supplied target MSA and a genuine two-task v2 batch |
| `experimental` | Cropped two-chain target of 40/35 residues, three unresolved positions, assembly conditioning and a resolved hotspot; two v2 samples |
| `fast` | Two VHH frameworks of 129/122 residues with CDR contact loss, framework penalty and server MSAs; two custom 242-residue scFv frameworks using template or explicit sequence/CDRs |

The supported profile requires one GPU with at least 79 GiB usable VRAM,
eight CPUs and 80 GiB RAM. Qualification used one A100 80GB with about
79.25 GiB reported usable VRAM, eight assigned CPUs and a 96-GiB container
limit. The catalog RAM admission floor is 80 GiB; the recorded
qualification memory limit remains 96 GiB. The true minimum remains unknown. A package disk minimum has not been established,
so the catalog leaves it unknown and storage must still cover preparation,
outputs and restoration. These cases contain at most 318 polymer residues per complex, eight
design steps and unchanged final critic and v2 settings. Larger workloads,
the normal 150-step design setting and multi-GPU throughput remain unqualified.
The seven additional v2 samples were correctly rejected. The earlier two-sample
case had one passing validation, but neither candidate met the pose-agreement
gate. Custom scFv coverage is design/critic and ESM export, with the native
structural-template restriction on integrated validation preserved.

The commands below are conditional on deployed catalog admission and a ready
authorized session. Each `forge run` returns its durable command ID; inspect
that command and its logs before the dependent command. `watch` timeout ends
local waiting while remote work retains its state. On an uncertain response,
reconcile the original saved command ID before dispatching more work.

`EXAMPLES` is the installed `ariax-forge/tools` directory, or this repository's
same directory before admission. `SESSION` is the actual authorized session UUID.
Do not execute these examples on the workstation.

```sh
ariax forge tools add "$SESSION" --tools esmfold2-pipeline --priority esmfold2-pipeline --json
ariax forge tools wait "$SESSION" esmfold2-pipeline --timeout 1800 --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/esmfold2-pipeline/campaign.yaml" --path esmfold2-pipeline/campaign.yaml --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/boltzgen/1ubq.cif" --path esmfold2-pipeline/1ubq.cif --json
ariax forge inputs list "$SESSION" --json
ariax forge run "$SESSION" --tool esmfold2-pipeline --gpus 0 --timeout-seconds 180 --json -- forge-esmfold2-pipeline-case prepare
ariax forge run "$SESSION" --tool esmfold2-pipeline --gpus 0 --timeout-seconds 1800 --json -- forge-esmfold2-pipeline-case shard-one
```

`prepare` calls native `check YAML` and `plan YAML`. Before design, review the
resolved target, sequence/register and conditioning artifacts. `shard-one`
calls native `run CAMPAIGN --esm-repo /opt/esmfold2/esm --gpu-id 0 --max-shards 1`
and saves `status-after-shard-one.json`. Container GPU 0 means the assigned
visible device; it does not select unreserved host devices.

A completed first shard can leave another planned shard pending. Save the
workspace using the existing [Files commands](../outputs.md), stop
writers before a snapshot, and explicitly restore selected saved files.
Restore never replays science. Review the restored native status and preserved
successful artifacts before the next explicit phase:

```sh
ariax forge run "$SESSION" --tool esmfold2-pipeline --gpus 0 --timeout-seconds 1800 --json -- forge-esmfold2-pipeline-case continue-design
ariax forge run "$SESSION" --tool esmfold2-pipeline --gpus 0 --timeout-seconds 1200 --json -- forge-esmfold2-pipeline-case validate-one
ariax forge run "$SESSION" --tool esmfold2-pipeline --gpus 0 --timeout-seconds 180 --json -- forge-esmfold2-pipeline-case export
```

The native `validate` wrapper plans/runs MSAs, plans validation, performs required
preflight, invokes Protenix and writes integrated per-model reports/analysis.
The checked-in defaults select v2, top one, seed 101, one sample/task/attempt,
10 cycles/200 steps, target template and no MSAs. Debug files stay in workspace.
Zero ESM threshold admits a candidate for inspecting integration; validation
ipTM 0.6 and final ranking's RMSD 2.5 Å gate remain. ESM `select`/`export` also
uses ipTM 0.6. Zero accepted designs is a faithful possible outcome.

If both saved designs already have pending validation tasks, continue those exact
tasks after model preparation and native preflight:

```sh
ariax forge run "$SESSION" --tool esmfold2-pipeline --gpus 0 --timeout-seconds 2400 --json -- esmfold2-pipeline validate-run /workspace/esmfold2-pipeline/b47b --gpu-id 0 --max-tasks 2
ariax forge run "$SESSION" --tool esmfold2-pipeline --timeout-seconds 180 --json -- esmfold2-pipeline validate-report /workspace/esmfold2-pipeline/b47b
ariax forge run "$SESSION" --tool esmfold2-pipeline --timeout-seconds 180 --json -- esmfold2-pipeline analyze /workspace/esmfold2-pipeline/b47b --top-k 2
```

This preserves the existing tasks and saved settings. The high-level `validate`
command also replans. Installing a previously missing checkpoint changes its native
configuration identity and can enqueue duplicate tasks; inspect `status` before
choosing the next stage. Do not replan a saved queue merely to continue it.

For first-time validation planning of both completed designs, use explicit
`--validate-top-k 2 --min-esm-iptm 0 --require-hotspot-contact never`. This native
revision can replace `all` with the saved YAML top-count default. The 0.6
validation-result threshold and 2.5 Å ranking gate remain unchanged. If the
session has closed, restore its saved files into a new session first. Preserve
earlier settings and failed attempts. The bounded continuation produced one
passing validation and one rejected validation. Both failed the unchanged pose
agreement gate, leaving zero ranking-eligible designs. The original ESM selection
also rejected both; no binding or accepted-design claim follows.

For a different campaign, invoke native commands directly with the same current
Forge envelope. Native `status CAMPAIGN --json`, `aggregate`, `select`, `export`,
`validate-report` and `analyze` are real commands. Low-level `validate-plan`,
`validate-run`, `validate-msa-plan` and `validate-msa-run` support staged work.
Keep settings identical across those stages. There is no native `resume` or
external-validation import command. A changed target/register, seed count,
model, MSA, template or filter means a new scientific configuration/output.

## Target, template and MSA semantics

Structure and sequence targets are mutually exclusive. Full structure-chain
sequences belong in `target.structure.sequences` or native `structure_sequences`.
Keep actual author/label chain and residue IDs, insertion codes and unresolved
positions. Missing sequence identity cannot be inferred from shorter observed
coordinates. Cropping, hotspots, partial conditioning and assembly chain pairs
are deliberate scientific choices. Inspect `target/residue_map.csv`,
`chain_summary.json` and `normalized_target.cif` before inference.

The validator maps binder to A and targets to B onward, regardless of input chain
names. Retain `validation_chain_role_map` and original target register with every
same-sample output. Target template IDs must match normalized chains, sequences
and order. Grouped targets retain cross-chain geometry. Target/template pose
agreement under conditioning provides conditional evidence.

`--use-template auto` uses available target/built-in framework templates;
`true` requests them and `false` disables them. Built-in scFv validation requires
its structural framework and `--binder-msa-mode none`. Custom scFv without that
template is unsupported. VHH `auto` mode prepares grouped/template MSAs using native numbering and a
selected MSA server. Set `validation.protenix.use_msa: true` to request MSAs
alongside structural templates. VHH and scFv reject `single_sequence` binder
MSAs; that option belongs to miniproteins.

Provided target MSAs require `pairing.a3m` and `non_pairing.a3m` matched to the
full query, or `--target-msa-map-csv` for multiple target sequences. Use one path
option. The supplied 1UBQ A3Ms are query-only syntax fixtures, not an MSA search.
Templates can suppress automatic MSA use. To exercise supplied MSAs deliberately,
use a fresh campaign and these flags together:

```text
--use-msa --target-msa-mode provided --target-msa-dir /inputs/esmfold2-pipeline/provided-msa --binder-msa-mode none
```

Binder `single_sequence` is distinct from `auto`. Server mode uses the selected
authorized external endpoint and disclosed target sequences. A server-backed campaign sends the target and any automatic VHH group
representative sequences to that endpoint. Retain the resulting MSA records with
the candidate and native validation outputs.
`validate-conditioning` is a separate GPU diagnostic for a supplied binder
under structure conditioning. It cannot replace integrated validation.

## Choose a scaffold

For a sequence target, use `target: {name: public_ubiquitin, sequence: SEQUENCE}`
and omit structure, chain and conditioning fields. For an antibody binder, replace
the miniprotein binder block with one of these native configurations:

```yaml
binder:
  scaffold: vhh
  frameworks: [caplacizumab, vobarilizumab_il6r]
# Or:
# binder:
#   scaffold: scfv
#   framework: trastuzumab
```

Two designs rotate over two frameworks. The native output records the selected
framework, mutable CDR indices, fixed sequence and per-candidate structure.
`loss.binder_target_contact_mode: mosaic_cdr` restricts the antibody contact loss
to CDRs; `loss.mosaic_framework_contact_penalty_weight` enables the separate
framework-contact penalty. Keep both settings in the resolved campaign.

Custom scFv `framework` mappings accept either a fixed `template` with named
`{hcdr1}` through `{lcdr3}` placeholders and matching `cdr_lengths`, or a full
`sequence` with explicit 1-based inclusive `cdrs` ranges and `mutate: cdrs`.
Only CDR positions are mutable. These custom inputs support design and critic;
integrated scFv validation requires a supported structural framework template.

Check and plan a new configuration, then explicitly run its pending shards:

```text
esmfold2-pipeline check /inputs/campaign.yaml
esmfold2-pipeline plan /inputs/campaign.yaml
esmfold2-pipeline run /workspace/my-campaign --esm-repo /opt/esmfold2/esm --gpu-id 0
esmfold2-pipeline aggregate /workspace/my-campaign
esmfold2-pipeline validate-plan /workspace/my-campaign
esmfold2-pipeline validate-msa-run /workspace/my-campaign
esmfold2-pipeline validate-run /workspace/my-campaign --gpu-id 0
esmfold2-pipeline validate-report /workspace/my-campaign
esmfold2-pipeline analyze /workspace/my-campaign
```

Use the existing Forge command envelope for each command and inspect its result
before the next stage. Set the YAML `output` to the same campaign path. A failed
or pending validation task remains visible; a successfully exited command alone
does not establish that every intended task produced a prediction.

## Read native results

| Saved output | Meaning |
| --- | --- |
| Original/resolved YAML and `campaign.sqlite` | Task identity, settings, actual planned/completed/failed/pending counts |
| Target residue map, chain summary and normalized CIF | Original target identity and canonical model register |
| `esmfold2/metrics_all.csv`, `structures/` | Candidate/critic metrics and actual structures |
| `esmfold2/selected_designs.csv`, `selected_structures/selected_manifest.csv` | Deduplicated ESM selection and exported sequence/structure mapping |
| `validation/protenix_v2/validation_results.csv`, `structure_samples.csv`, `validation_summary.json` | Actual native model/task/sample, raw metric provenance, passing/rejected structure rows |
| `validation-debug/` | Native input, CIF/full/summary JSON and unrounded confidence sidecars; keep all same-sample files |
| `ranked_results/combined_ranking.csv`, `ranking_diagnostics.csv`, `ranking_summary.json`, `top_ranked/` | Eligible validated rows, all exclusion reasons and paired final exports |
| `status-*.json` | Shard/candidate/critic/validation/MSA/attempt counts, missing and untracked artifacts |

Join candidate → validation ID → model → actual seed/sample. Native full-data,
summary and CIF must share sample stem and seed directory. Filename ordering,
matching dimensions or independent predictions cannot establish identity.
Keep incomplete/failed/excluded rows attached to their original settings.
Inspect actual chain sequences against the generated role map and target register.

Native primary validator ipTM/ipSAE uses logical binder-target token masks;
supplementary positional chain-pair scores and the [interface scorer](interface-scores.md)
have their own scope/cutoffs. Use matched prediction files and preserve the
split-token availability boundary. V2 scoring remains a native gate.
Do not substitute one aggregation for another or label Protenix output AF3.

ESM pLDDT/B-factors are normalized to 0–100; raw Protenix atom pLDDT is 0–1.
ipTM/ipSAE are 0–1 confidence metrics. PAE and binder RMSD after target alignment
are in Å. Preserve native unrounded arrays when available. This pipeline publishes
ESM scalars/PDB B-factors, not complete ESM confidence arrays. Report those full
arrays unavailable instead of synthesizing them.

Native consensus confidence is sqrt(ESM ipTM × evaluator score). Evaluator is
sqrt(validator ipTM × ipSAE), or validator ipTM if ipSAE is absent. Default final
score applies a 0.10 agreement weight with exp(-0.5 × (RMSD / 2.5)^2).
Non-completed/failed validation, invalid confidence, absent required RMSD and
RMSD over 2.5 Å exclude rows. Missing ipSAE can still permit ranking; preserve
the metric basis and warnings. Optimization losses, confidence and ranking do
not establish binding, affinity or experimental success.
Scientific rejection is a valid completed outcome. A correctly rejected candidate
demonstrates that the pipeline ran and applied its filters; acceptance of the
software does not require a passing binder.

After a failed phase, read its command/logs and native status, confirm no worker
is active, and diagnose the actual preparation/MSA/artifact error. Stale-task
recovery controls are in this pinned native `run --help`. Do not manually reset
SQLite, start duplicate workers, silently retry or change backend/model to evade
an error. Unsaved output remains unavailable after compute loss. Before closing
the session, save required workspace files through Files and confirm the save
completed. Resume the same project to load its current saved files when continuing the campaign.
