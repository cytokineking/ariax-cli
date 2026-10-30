# Forge ColabFold / AlphaFold2

Use `af2` for protein monomer or complex structure prediction with
[ColabFold 1.6.3](https://github.com/sokrypton/ColabFold/tree/84c27d9cc500489fd9b97545d2325b9d00f251d5).
Native `colabfold_batch` is on PATH. Weights come from the managed model
asset; workloads do not download them. Outputs retain each sample's
processed residue order. Supplied combined A3Ms preserve chain queries
and absent alignment channels without adding homologs or pairing rows.

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
execution. They have no biological success threshold. Capacity coverage is
limited to small examples on one L40; CPU/RAM/VRAM/disk minima and broader
sequence-length/MSA-depth limits remain unknown.

## Run with a supplied alignment

Use an authorized session whose deployed catalog includes `af2`, require
host `available` and tool `ready`, and record the returned input/command IDs.
`EXAMPLES` is `data.examples.af2` from `ariax skills forge --tool af2 --json`.
JAX scratch and cache directories must be writable.

```sh
ariax forge tools add "$SESSION" --tools af2 --priority af2 --json
ariax forge tools wait "$SESSION" af2 --timeout 1800 --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/monomer.a3m" --path af2/monomer.a3m --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/alphafold2_ptm.json" --path af2/alphafold2_ptm.json --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/af2_outputs.py" --path af2/af2_outputs.py --json
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

## CPU affinity for JAX startup

On hosts with many CPUs, unrestricted JAX startup can reach the container's
512-process limit. The prefix below selects the first eight CPUs already
allowed to the process, prints them and executes the requested program.
Children inherit that affinity. Use it when addressing this startup failure,
then observe the new command ID and check every output.

The example applies the prefix to the shipped `run_modes.sh`.
Stage that runner, `monomer.a3m`, `insulin.a3m`, all three mode manifests and
`af2_outputs.py` under `/inputs/af2`, and choose a fresh workspace root:

```sh
ariax forge run "$SESSION" --tool af2 --gpus 0 --timeout-seconds 3600 --json -- python -c "import json,os,sys; cpus=sorted(os.sched_getaffinity(0))[:8]; os.sched_setaffinity(0,cpus); print(json.dumps({'cpu_affinity':cpus}),flush=True); os.execvp(sys.argv[1],sys.argv[1:])" sh /inputs/af2/run_modes.sh /workspace/af2-wide-UNIQUE
```

This command leaves scientific flags intact and does not establish general
resource minima or change the container process limit.

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

Set `PROJECT` to the session's returned `project_id`.

```sh
ariax forge sync "$SESSION" --wait --timeout 1800 --json
ariax forge files "$PROJECT" --path /workspace/af2-ptm-UNIQUE --json
ariax forge download "$PROJECT" /workspace/af2-ptm-UNIQUE/config.json --dest ./af2-config.json --json
```

Require a successful flush. Follow the shared outputs guide for
saved result links, explicit resume and cleanup.

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
source/alias mapping in the `interface-scores-v1` format.

On a ready interface-scores tool sharing this workspace:

```sh
ariax forge run "$SESSION" --tool interface-scores --timeout-seconds 120 --json -- interface-scores /workspace/af2-ptm-UNIQUE/handoff.json --output /workspace/af2-ptm-UNIQUE/interface.json
```

A monomer reports no protein interface. For the paired fixture, use
`--job insulin`, `alphafold2_multimer_v3.json` and the multimer result directory.
Both directional pairs are retained. Predictor ipTM remains a complex
quantity, separate from recomputed ipSAE/pDockQ/pDockQ2/LIS. Save the original
handoff with the scorer result because the scorer does not copy all added
lineage fields. Preserve the original native files and handoff alongside
scorer results.

The [ordered runner](examples/af2/run_native.sh) and
[matrix](examples/af2/matrix.json) cover all fifteen checkpoints and selected
template families at reduced settings. The
[service runner](examples/af2/run_services.sh) takes one selected case and
an explicit search/predict stage. A CUDA initialization failure remains a
failed command; preserve completed outputs and inspect the runtime before
explicitly submitting unfinished work. Broader capacity and host-reload
workloads remain unverified.

Use [saved results](../outputs.md) for current project `forge link` paths,
and [project controls](../SKILL.md#project-controls-and-resume) for human
pause and same-project resume. Web approval clears a hold without allocating
compute; restoration leaves the next scientific command explicit.
