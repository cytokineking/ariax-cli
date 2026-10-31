# Biohub ESMFold2 and ESM Cambrian

| Forge tool and named asset | Native choice | Operations |
| --- | --- | --- |
| biohub-esmfold2 | biohub/ESMFold2 | Protein monomer/complex, supplied unpaired protein MSAs, batch, explicit resume |
| biohub-esmfold2-fast | biohub/ESMFold2-Fast | Protein monomer/complex, single-sequence batch, explicit resume |
| esmc-300m | biohub/ESMC-300M | Embeddings, logits, layer states, masked logits, batch, explicit resume |
| esmc-600m | biohub/ESMC-600M | Same operations at 600M |
| esmc-6b | biohub/ESMC-6B | Same operations at 6B |

Each tool mounts its own compatible asset at `/models/<tool>`. The folding
checkpoints bundle their ESMC backbone and Chemical Component Dictionary.
The Fast asset includes the full model's CCD. No Hub login or model downloads
run inside workloads.

Upstream describes ESMFold2 as MSA capable and Fast as single sequence.
Fast rejects supplied MSAs before inference. The selected native release reads
the current safetensors checkpoints directly. See the
[Biohub model card](https://huggingface.co/biohub/ESMFold2) and
[native package release](https://pypi.org/project/esm/3.4.1.post1/).
Older ESMFold/ESM2 quantities used by Joint Model Stability have separate
scientific definitions and environments.

## Inputs and settings

FASTA creates one monomer item per header. The first header word is its stable
ID. IDs must be distinct, 1-64 characters, begin with a letter or digit, and
use letters, digits, dots, underscores or hyphens. JSON accepts
`{"items":[{"id":"complex1","chains":[{"id":"binder","sequence":"ACDE"},
{"id":"target","sequence":"MKTAY"}]}]}`. Chain IDs must be distinct per item
and fit 16 characters. Separate chains explicitly; use no colon/pipe separators.
Folding accepts the 20 standard amino acids and X. ESMC also accepts B/Z/U/O
and requires one sequence per item.

For ESMFold2, a chain's optional `msa` is an A3M path, resolved relative to its
JSON input or supplied as an absolute container path. Its first aligned row
must exactly match the chain sequence. The adapter reads the supplied A3M;
it does not contact an MSA server. Paired alignments, MSA generation, DNA/RNA,
ligands, modifications and design optimization are outside this adapter.

[Pair CSV](examples/biohub-esm/pairs.csv) uses exact columns
`binder_name,binder_sequence,target_name,target_sequence`, with optional
`decoy_name,decoy_sequence,decoy2_name,decoy2_sequence,...`. Each row/partner
slot is an independent complex: chain A is the binder and chain B is its
partner. Both blank decoy cells omit a slot; half-filled slots fail. Labels
are retained in metadata; paths use row/slot IDs. No implicit scoring, ranking
or automatic target/decoy comparison runs.

The [fixtures](examples/biohub-esm/README.md) include ubiquitin, artificial
short sequences, a two-chain complex and query-matched synthetic A3Ms. They
test execution and identity. They do not establish binding or accuracy.

Fold defaults are 20 loops, 200 sampling steps, one diffusion sample, seed 7,
LM dropout 0.3, MSA depth 1024 and MSA column mask rate 0.1. `--chunk-size N`
optionally sets native chunking. `--precision bf16` controls the folding ESMC
backbone; `fp32` is an explicit alternative. ESMC applies that precision to the
language model. All settings and normalized inputs are saved in `batch.json`.
ESMC defaults to BF16 and native SDPA. Its supported capacity profile is one L40,
1..1024 residues per item and 1..8 sequential items, in BF16 or explicit FP32.
Both FASTA and single-chain JSON accept X/B/Z/U/O.
See the [capacity profile](biohub-esm/esmc-capacity.md) for required host resources
and output-space needs. The adapter does not enforce these bounds; larger
requests remain unverified. Folding capacity coverage is limited to 76-residue
monomers and short complexes/pairs at reduced settings. Longer interruption
fixtures do not establish general folding capacity. Folding launch minima and
default 20-loop/200-step capacity remain unknown. Use authorized hardware
within the deployed catalog's scope.

## Run a bounded case

Use an existing authorized `SESSION`. Require host `available` and the selected
tool `ready`. `EXAMPLES` is `data.examples.biohub-esm` from `ariax skills forge --tool biohub-esm --json`.
Upload required files individually and confirm their input records are ready:

```sh
ariax forge tools add "$SESSION" --tools biohub-esmfold2-fast --priority biohub-esmfold2-fast --json
ariax forge tools wait "$SESSION" biohub-esmfold2-fast --timeout 1800 --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/complex.json" --path biohub-esm/complex.json --json
ariax forge inputs list "$SESSION" --json
ariax forge run "$SESSION" --tool biohub-esmfold2-fast --gpus 0 --timeout-seconds 3600 --json -- biohub-esm fold --model biohub-esmfold2-fast --input /inputs/biohub-esm/complex.json --output /workspace/biohub-esm/fast-complex --num-loops 1 --num-sampling-steps 14 --num-diffusion-samples 2 --seed 7
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 3600 --json
ariax forge logs "$SESSION" "$COMMAND_ID" --tail 1000 --json
```

Use the returned command ID. The reduced loop/step counts demonstrate only
this small example. For full ESMFold2, select
`biohub-esmfold2` and pass that exact model name. Upload `msa.json`, `binder.a3m`
and `target.a3m` under the same input directory to exercise its MSA case.

ESMC examples, after selecting the matching tool and uploading
[sequences.fasta](examples/biohub-esm/sequences.fasta):

```sh
ariax forge run "$SESSION" --tool esmc-300m --gpus 0 --timeout-seconds 3600 --json -- biohub-esm esmc --model esmc-300m --mode embeddings --input /inputs/biohub-esm/sequences.fasta --output /workspace/biohub-esm/esmc-300m-embeddings
ariax forge run "$SESSION" --tool esmc-600m --gpus 0 --timeout-seconds 3600 --json -- biohub-esm esmc --model esmc-600m --mode logits --input /inputs/biohub-esm/sequences.fasta --output /workspace/biohub-esm/esmc-600m-logits
ariax forge run "$SESSION" --tool esmc-6b --gpus 0 --timeout-seconds 3600 --json -- biohub-esm esmc --model esmc-6b --mode hidden-states --input /inputs/biohub-esm/sequences.fasta --output /workspace/biohub-esm/esmc-6b-hidden
ariax forge run "$SESSION" --tool esmc-6b --gpus 0 --timeout-seconds 3600 --json -- biohub-esm esmc --model esmc-6b --mode masked-logits --mask-position 3 --input /inputs/biohub-esm/sequences.fasta --output /workspace/biohub-esm/esmc-6b-masked
```

Run each command to a terminal outcome before submitting another on that GPU.
All four modes are available at each size. `--mask-position` is one based and
repeatable, and applies to each input item. It is required for masked logits
and forbidden for other modes. A multi-position request masks all those positions
in the same forward pass. Every position must fit every input sequence.

## Read and check outputs

`batch.json` has normalized inputs/settings and per-item `pending`, `running`,
`succeeded` or `failed` outcomes. Each attempt lives in
`items/<item-id>/attempt-<uuid>/`. A failure retains its directory and an error
type. Inspect command logs to diagnose it. Exit 1 means unfinished items remain;
exit 2 means invalid input/output/resume use. No successful exit means that a
prediction is scientifically useful.

Each fold sample exports `sample-NNN.cif`, `.json` and `.npz`. The mmCIF
preserves chain IDs and one-based residue numbering. JSON maps chain/token
identity and settings. NPZ includes atom coordinates, token-to-atom ranges,
numeric chain IDs, raw token pLDDT and full PAE. pLDDT is 0-1; mmCIF B factors
are 100 times pLDDT. PAE is in angstroms with rows/columns in the JSON's token
chain/residue order. pTM and available ipTM are 0-1 predictions; monomer ipTM
can be absent. Pair-chain ipTM is exported when available, with ordered
`pair_chain_ids` naming both axes. Axis 0 selects the chain whose residue columns
are averaged; axis 1 selects the chain whose residue rows are maximized. This
directional matrix need not be symmetric. Complex ipTM is its maximum
off-diagonal value. JSON also retains native atom names/elements, checked against
mmCIF. Confidence is not affinity, experimental binding or specificity.

ESMC writes `sequence.json` and `sequence.npz`. For L residues, D is 960,
1152 or 2560 for 300M, 600M or 6B; N is 30, 36 or 80 transformer blocks:

| Mode | Array | Meaning |
| --- | --- | --- |
| embeddings | `[L,D]`, mean `[D]` | Final post-LayerNorm residue states; mean excludes BOS/EOS |
| logits | `[L,64]` | Unmasked native language-model logits; channels use saved vocabulary, unused channels are null |
| hidden-states | `[N+1,L,D]` | Block inputs 0 through N-1, followed by final post-LayerNorm output N |
| masked-logits | `[L,64]` | Native logits with the recorded input residue positions masked |

The saved `input_ids` has length L+2 including native BOS/EOS. All representation
arrays exclude these special tokens. Logits are raw scores, not probabilities
or a calibrated stability/affinity measurement. Unmasked logits are conditioned
on the visible residue. Use the explicit masked mode for masked-residue analysis;
multiple masks do not compute single-site pseudo-likelihood independently.
ESMC does not export structures or folding confidence. Trained downstream
classification heads and SAEs are outside this interface.

Check a terminal batch through its selected tool:

```sh
ariax forge run "$SESSION" --tool biohub-esmfold2-fast --timeout-seconds 120 --json -- biohub-esm-check /workspace/biohub-esm/fast-complex
ariax forge watch "$SESSION" "$CHECK_COMMAND_ID" --timeout 180 --json
```

The checker parses real exports and confirms identity, finite coordinates and
arrays, confidence ranges, PAE dimensions, mmCIF B-factor scaling, ESMC token
and representation shapes and special-token exclusion. It fails if any item
is unfinished. `resources.json` supplies Torch allocator peaks only. Use the
[capacity profile](biohub-esm/esmc-capacity.md) for ESMC resource needs;
allocator peaks alone do not establish total VRAM or host-memory requirements.
Folding requires a separately admitted hardware choice.
Numeric files are read back and directly compared with the live arrays from
that inference. No second native invocation is needed for this comparison.

## Explicit resume, saving and custom code

Use a fresh output directory for a new scientific request. Existing batches
require `--resume`; only their unfinished items receive new attempts. Inputs,
MSA contents, variant and settings must match by direct field comparison.
Completed files remain unchanged. Missing completed exports produce an error
requiring a new run directory. An ordinary file lock prevents two commands
writing the same batch. Prior running/failed records remain in
`previous_attempts`, with their original attempt directories. Resume never runs
because a session was restored.

After an interrupted command is terminal and its GPU reservation is released,
an explicitly chosen continuation can use a fresh command ID:

```sh
ariax forge run "$SESSION" --tool biohub-esmfold2-fast --gpus 0 --timeout-seconds 3600 --json -- biohub-esm fold --model biohub-esmfold2-fast --input /inputs/biohub-esm/complex.json --output /workspace/biohub-esm/fast-complex --num-loops 1 --num-sampling-steps 14 --num-diffusion-samples 2 --seed 7 --resume
```

An uncertain delivery is resolved with its saved command ID before any new
scientific submission. Diagnose failed items and preserve all prior outcomes.
The adapter runs once per unfinished item during an explicitly submitted command.

After all writers are terminal, flush the changed files:

Set `PROJECT` to the session's returned `project_id`.

```sh
ariax forge sync "$SESSION" --wait --timeout 1800 --json
ariax forge files "$PROJECT" --path /workspace/biohub-esm/fast-complex --json
ariax forge download "$PROJECT" "$EXPORTED_CIF_PATH" --dest ./sample.cif --json
```

Use a file path from `batch.json`; attempt UUIDs are generated per execution.
Restore through the platform's accepted same-project control path, honor any
human hold, and read/check completed files before an explicit unfinished-item
resume. Restoration reinstalls named assets normally and starts no inference.
Close and confirm cleanup within the user's task scope. Follow the
[saved-output guide](../outputs.md) for current project downloads and links.

Project-local source and environments belong in workspace/scratch. Shared `/opt`
and `/models` remain read-only. Record the custom revision, edits and compatibility
with the selected native asset layout. Save ordinary source/bootstrap instructions
or a regular archive; recreate environments explicitly after restoration.

The [ESMC continuation example](biohub-esm/esmc-capacity.md#explicit-continuation)
uses the eight-item hidden-state batch and the same explicit resume contract.

The adapter handles Docker SIGTERM and retains unfinished attempt records.
The [larger pair fixture](examples/biohub-esm/pairs-interrupt.csv) and
[layer-state fixture](examples/biohub-esm/sequences-interrupt.fasta) are
interruption examples without a biological accuracy claim.

Use [saved results](../outputs.md) for current project `forge link` paths,
and [project controls](../SKILL.md#project-controls-and-resume) for human
pause and same-project resume. **Resume workspace** starts a same-project
session; inspect and use it. **Allow agent to resume later** leaves compute
stopped until an authorized agent resume. Never automatically replay science.
