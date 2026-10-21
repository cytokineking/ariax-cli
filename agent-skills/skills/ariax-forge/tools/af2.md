# Forge ColabFold / AlphaFold2


The image pins [ColabFold 1.6.3](https://github.com/sokrypton/ColabFold/tree/84c27d9cc500489fd9b97545d2325b9d00f251d5),
commit `84c27d9cc500489fd9b97545d2325b9d00f251d5`,
`alphafold-colabfold==2.3.20`, Python 3.12 and JAX/CUDA12 0.11.1 in its own
environment. Native `colabfold_batch` is on PATH. The managed-parameters
patch disables automatic weight downloads; the CSV patch fixes supplied
A3M paths in complex detection and MSA-depth sorting. The token-order patch
retains each sample's processed residue order beside the native outputs.
The MSA-channel patch preserves each chain's query when a combined A3M starts
with padded unpaired rows, and preserves absent alignment channels without
adding homologs or pairing rows.

Read [common MSA choices](af2/msa.md) before submitting sequences to a
service. Supplied alignments work without a service when templates are off
or explicitly supplied. Preserve the user's constructs, sequence order,
stoichiometry and selected MSA/template policy.

## Models and inputs

| `--model-type` | Five checkpoint choices | Native quantities |
| --- | --- | --- |
| `alphafold2` | `model_1` through `model_5` | pLDDT, unrelaxed PDB; PAE/pTM unavailable |
| `alphafold2_ptm` | `model_1_ptm` through `model_5_ptm` | pLDDT, PAE, pTM, unrelaxed PDB |
| `alphafold2_multimer_v3` | `model_1_multimer_v3` through `model_5_multimer_v3` | pLDDT, PAE, pTM, ipTM, complex PDB |

`--num-models` and `--model-order` select the models to execute. `auto`
chooses pTM for a monomer batch and multimer v3 if any query is a complex.
Choose modes explicitly and group batches by mode. The fifteen native
parameter files share the unchanged `alphafold2` mount at
`/models/alphafold2`; the image connects it to `/opt/af2-data/params`.
Use the managed default `--data`. Multimer v1/v2 and DeepFold selectors
are rejected by this image's argument parser.

Native inputs include one FASTA, CSV/TSV (`id,sequence`), A3M, or a directory
of input files. Colons separate chains in a FASTA/CSV sequence. A multi-record
FASTA passed as a file runs every record. A directory takes only the first
record from each FASTA file. CSV `a3mpath` binds each row to a supplied A3M;
paths must exist inside the container. Keep IDs unique after native filename
sanitization. Preserve the exact A3M header, unique chain lengths and copy
counts for a complex. ColabFold groups repeated identical sequences by
first occurrence, so map the resulting chain order and copies explicitly.

The [examples](examples/af2/README.md) include a supplied 76-residue ubiquitin
alignment, the 21/30-residue pig-insulin chains from 4INS, synthetic
paired/homomer alignments, two monomer FASTA records, CSV paths and
experimental 1UBQ/4INS template inputs. Reduced settings exercise
execution. They have no biological success threshold. Admission minima and broader length/depth envelopes remain unknown.

## Run with a supplied alignment

Use an authorized session whose deployed catalog includes `af2`, require
host `available` and tool `ready`, and record the returned input/command IDs.
`EXAMPLES` is `data.examples.root` from `ariax skills forge --json`.

```sh
ariax forge tools add "$SESSION" --tools af2 --priority af2 --json
ariax forge tools wait "$SESSION" af2 --timeout 1800 --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/af2/monomer.a3m" --path af2/monomer.a3m --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/af2/alphafold2_ptm.json" --path af2/alphafold2_ptm.json --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/af2/af2_outputs.py" --path af2/af2_outputs.py --json
ariax forge inputs list "$SESSION" --json
ariax forge run "$SESSION" --tool af2 --gpus 0 --timeout-seconds 3600 --json -- colabfold_batch /inputs/af2/monomer.a3m /workspace/af2-ptm-UNIQUE --model-type alphafold2_ptm --num-models 5 --model-order 1,2,3,4,5 --num-seeds 1 --random-seed 7 --num-recycle 1 --num-ensemble 1 --max-msa 32:64 --num-relax 0 --pair-mode unpaired_paired --pair-strategy greedy --stop-at-score 100 --disable-unified-memory --save-all
ariax forge watch "$SESSION" "$COMMAND" --timeout 3600 --json
ariax forge logs "$SESSION" "$COMMAND" --tail 1000 --json
ariax forge run "$SESSION" --tool af2 --gpus 0 --timeout-seconds 60 --json -- python3 /inputs/af2/af2_outputs.py /workspace/af2-ptm-UNIQUE /inputs/af2/alphafold2_ptm.json
```

Replace `UNIQUE` with a fresh run name and `COMMAND` with its returned UUID.
Require all inputs ready before running. A watch timeout leaves the remote
command intact. Observe that ID before deciding the next action. Native
batch exceptions may skip queries while the process exits successfully;
require the output check for every requested job/model/seed.

For plain monomer inference use `alphafold2` with its matching manifest.
For a complex upload `insulin.a3m` and `alphafold2_multimer_v3.json`, and use
that input and selector. The [remote mode script](examples/af2/run_modes.sh)
prepares all fifteen model checks. For ordinary scientific work choose
recycles, MSA depth and sampling for the question, then retain those exact
settings. `--msa-mode single_sequence` on 1.6.3 discards supplied homologs
and pairing; use it only when that is the intended inference mode.

## Explicit affinity for the observed wide-CPU startup limit

B26b's first unrestricted JAX startup on a 184-CPU qualification guest reached the
existing 512-process container limit. A new explicit command used the prefix
below before its controlled 15-checkpoint mode runner and passed with the
same scientific settings. It selects the first eight CPUs already allowed
to the process, prints them and executes the requested program. Children
inherit that affinity. Use this approach when addressing the observed wide-CPU
startup failure, then observe the new command ID and check every output.

The example applies the exact tested prefix to the shipped `run_modes.sh`.
Stage that runner, `monomer.a3m`, `insulin.a3m`, all three mode manifests and
`af2_outputs.py` under `/inputs/af2`, and choose a fresh workspace root:

```sh
ariax forge run "$SESSION" --tool af2 --gpus 0 --timeout-seconds 3600 --json -- python -c "import json,os,sys; cpus=sorted(os.sched_getaffinity(0))[:8]; os.sched_setaffinity(0,cpus); print(json.dumps({'qualification_cpu_affinity':cpus}),flush=True); os.execvp(sys.argv[1],sys.argv[1:])" sh /inputs/af2/run_modes.sh /workspace/af2-wide-UNIQUE
```

This command choice leaves scientific flags intact. Unrestricted startup on
that wide guest retains the recorded boundary. Other guests have their own
observed behavior; general CPU/RAM/VRAM/disk minima remain unknown. The
container process limit and production CPU policy remain unchanged.

## Supported templates and batches

Templates require `--templates`. Monomer/pTM templates affect only models
1/2. Multimer v3 uses chain templates; it does not preserve a supplied
multi-chain assembly as fixed complex geometry. Directory templates accept
PDB or mmCIF. Copy only the selected structures to a fresh writable scratch
directory first: native preparation converts/repairs files and creates an
HHsearch database there. Use `--custom-template-path /scratch/selected`.
Supplied A3M plus custom templates can stay offline. Plain `--templates`
uses the selected MSA server even with supplied A3M input.

CSV can select one mmCIF file per row with `templatepath` and an accompanying
`a3mpath`; supply `--custom-template-cache-path /scratch/template-cache`.
The per-entry native path copies the selected mmCIF to `1dmy.cif`. Preserve
the original path with the resulting `1dmy_CHAIN` domain name. Use the
directory path for a selected PDB. `--max-template-date YYYY-MM-DD` and
`--max-template-hits N` bound eligibility and selection. Inspect the native
logs and `JOB_template_domain_names.json` for a real selected hit. Empty
domains mean no usable template was selected. Keep this outcome explicit.
[Native template code](https://github.com/sokrypton/ColabFold/blob/84c27d9cc500489fd9b97545d2325b9d00f251d5/colabfold/batch.py)

Upload `batch.fasta` as one input for the two-record fixture. Its bounded
single-sequence command uses `--model-type alphafold2_ptm --msa-mode
single_sequence --num-models 1 --model-order 1` with seed/recycle/raw flags
as above, and `batch.json` for the check. Supplied A3M directories or CSVs
avoid a server for ordinary batches. FASTA/CSV without alignments searches
the chosen service by default. Use a new output directory when inputs,
templates, server or settings change. Native done markers can otherwise
skip existing jobs. Restoration does not authorize a scientific replay.

## Raw outputs and review

Native filenames include job, rank, model family, model number and seed:

```text
JOB_unrelaxed_rank_001_alphafold2_ptm_model_1_seed_007.pdb
JOB_scores_rank_001_alphafold2_ptm_model_1_seed_007.json
JOB_all_rank_001_alphafold2_ptm_model_1_seed_007.pickle  # --save-all
JOB_tokens_rank_001_alphafold2_ptm_model_1_seed_007.json # processed residue axis
JOB_predicted_aligned_error_v1.json                    # pTM/multimer
JOB.a3m
JOB.done.txt
config.json
log.txt
```

Ranks reorder by native confidence and need not correspond to model order.
JSON pLDDT and PDB B-factor confidence use 0–100; PAE is in Angstroms;
pTM/ipTM use 0–1. Multimer ranking uses 0.8 ipTM + 0.2 pTM. Plain monomer
has no PAE/pTM, and monomer pTM has no ipTM. Preserve unavailable quantities.
`--save-recycles` retains intermediate predictions; representation flags
retain embeddings. Keep raw pickles from your trusted run, but do not load
untrusted pickles for review. The checker reads PDB/JSON and checks opaque
pickle presence. Native token maps and PDB/JSON pLDDT must match the selected
sample. It does not compute independent interface metrics or
impose a confidence threshold. Confidence does not establish binding,
specificity, expression or experimental success.

Retain actual structures, confidence, alignments, template selection and
native `config.json` together. Preserve server/pairing settings from the
MSA-generation run separately when prediction consumes saved alignments.
Then save through the existing file path:

```sh
ariax forge sync "$SESSION" --wait --timeout 1800 --json
ariax forge files "$SESSION" --path /workspace/af2-ptm-UNIQUE --checkpoint "$CHECKPOINT" --json
ariax forge download "$SESSION" /workspace/af2-ptm-UNIQUE/config.json --checkpoint "$CHECKPOINT" --dest ./af2-config.json --json
```

Use the completed checkpoint UUID. Follow the shared outputs guide for
saved result links, explicit resume and cleanup. The bounded 25-prediction
offline matrix, all fifteen checkpoints and selected
template families passed native CUDA/output checks on one L40. Public
monomer and all three public multimer modes passed native search, prediction
and unchanged output/handoff checks on October 6, 2026. The retained original
unpaired failure input exactly matches the fresh service response. These public
cases used model 1, seed 7, one recycle/ensemble and MSA cap 32:64.


## Selected sample for interface scores

Stage `af2_handoff.py` beside `af2_outputs.py`. After the output check passes,
select the original job, model and seed explicitly:

```sh
ariax forge run "$SESSION" --tool af2 --gpus 0 --timeout-seconds 120 --json -- python3 /inputs/af2/af2_handoff.py /workspace/af2-ptm-UNIQUE /inputs/af2/alphafold2_ptm.json --job monomer --model 1 --seed 7 --run-id ORIGINAL_PREDICTION_COMMAND_ID --output /workspace/af2-ptm-UNIQUE/handoff.json
```

The exporter accepts native token sidecars emitted during `--save-all`.
It reads identities from the same processed native Protein used for the PDB,
checks the confidence axis and preserves native rank separately from sample
index. Native confidence JSON has two-decimal rounding; the full-precision
pickle remains untouched. Original PDB/JSON/raw/config/A3M/template outputs
are preserved. The handoff retains settings, token derivation and template
source/alias mapping. It implements B35's `interface-scores-v1` boundary.

On a ready interface-scores tool sharing this workspace:

```sh
ariax forge run "$SESSION" --tool interface-scores --timeout-seconds 120 --json -- interface-scores /workspace/af2-ptm-UNIQUE/handoff.json --output /workspace/af2-ptm-UNIQUE/interface.json
```

A monomer reports no protein interface. For the paired fixture, use
`--job insulin`, `alphafold2_multimer_v3.json` and the multimer result directory.
Both directional pairs are retained. Predictor ipTM remains a complex
quantity, separate from recomputed ipSAE/pDockQ/pDockQ2/LIS. Save the original
handoff with the scorer result because the scorer does not copy all added
lineage fields. The October 5 selected monomer/insulin handoffs passed B35's
116-comparison audit. Preserve the original native files and handoff alongside
scorer results.

The [ordered runner](examples/af2/run_native.sh) and
[matrix](examples/af2/matrix.json) prepare 25 bounded offline predictions,
including all fifteen checkpoints and selected template families. The
[service runner](examples/af2/run_services.sh) takes one selected case and
an explicit search/predict stage. The offline matrix passed in the assigned
2026-10-05 native run. October 6 checked all 25 offline outputs again across
core, batch and remaining-case commands. Two multi-command runner attempts
stopped on CUDA initialization after host systemd reloads; both failures were
retained. Completed predictions were preserved, and unfinished cases passed
in fresh accepted-runtime containers. B26b then reproduced fresh-process
CUDA loss and accepted Docker cgroupfs bootstrap. Repeated source controls
passed, and the fresh reload run kept its container, PID and start time
through all 15 predictions. The original failed attempts remain in the
historical B31q evidence. Public monomer and all three multimer cases passed
independently. October11 added native public URL override, three-chain greedy/complete pairing,
monomer/heteromer template selection and endpoint failure without fallback.
Broader envelopes and broader reload workloads remain unqualified.

Use [saved results](../outputs.md) for checkpoint-pinned `forge link` paths,
and [project controls](../SKILL.md#project-controls-and-resume) for human
pause and same-project resume. Web approval clears a hold without allocating
compute; restoration leaves the next scientific command explicit.


Read small functional completion for the wave-seven finite
matrix, native service templates, three-chain pairing, installed commands and
full saved-project restoration. Public ColabFold is now
selected under the recovered user requirement; no separate MSA deployment is
required. S05-S08 and E01 passed on October11; final restoration proofs are in the
wave-seven completion handoff. The frozen image requires writable JAX scratch
cache setup, included in that guide’s command prefix.
