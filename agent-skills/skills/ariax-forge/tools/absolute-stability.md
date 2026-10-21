# Forge absolute stability

B36 carries forward the 20 exact native comparisons from October 6 and adds
28 comparisons on one L40 for all four three-member ensembles. The qualified
execution envelope is DG through 512 selected residues, two-chain complexes
through 512 total residues, and full scans through 128 residues with mutation
batch sizes 1 through 4. The measured cases, artificial boundary fixtures and
resource recommendation are in qualification.
Use a tool after it appears in the deployment catalog and is ready. Both family
images and complete named assets use the existing private delivery. The
coordinator integrates the owned resource fragment into the deployment catalog.

The pinned [absolute-stability-predictor source](https://github.com/yehlincho/absolute-stability-predictor/tree/c55db530f67dcaefb083954750af66212e4da76b)
is package 0.1.0. It supplies fine-tuned LoRA rank-4 stability heads and
three-checkpoint ensembles for ESM3 and SaProt 650M. The adapter runs each
member sequentially on one selected GPU and retains every member's output.

| Tool | Explicit model IDs | Base and named mounts |
| --- | --- | --- |
| `absolute-stability-esm3` | `esm3-augmented`, `esm3-base` | `biohub/esm3-sm-open-v1`; `/models/stability-esm3` |
| `absolute-stability-saprot` | `saprot-augmented`, `saprot-base` | Transformers `westlake-repl/SaProt_650M_AF2`; `/models/stability-saprot`, B34 `/models/foldseek` |

`base` here selects the non-augmented fine-tuned three-member ensemble.
It still includes LoRA and stability heads. Both augmented and base ensembles
support `dg`, `scan` and `complex`. [Assets and access](absolute-stability/assets.md)
give the exact layouts and selected MIT source route. Qualification
records the qualified cases and remaining gates.

## Input and identity

Supply one uncompressed PDB/CIF/mmCIF containing exactly one structural model.
Specify author chain IDs exactly as Gemmi reads them, including case. For
complexes, select two distinct chains and identify binder and target explicitly.
No default chain or guessed binder is used. Chains with duplicate author IDs,
alternate atom locations, noncanonical protein residues, missing N/CA/C or
nonfinite coordinates are rejected. Resolve those choices in an explicit
preparation step, preserving the original file.

The adapter writes selected protein chains into a temporary scratch CIF as
native A/B in requested order, with sequential residue indices. Coordinates
are retained; every output position maps to original author chain, residue
number and insertion code. Waters and non-protein residues are omitted. The
tool scores the selected protein construct. Missing side-chain coordinates
retain upstream ESM3's zero-fill behavior. Complex SaProt preparation also
uses upstream's isolated-chain temporary PDB serialization.

The [domain PDB](examples/absolute-stability/stability_1998469.pdb) and
[matched CIF](examples/absolute-stability/stability_1998469.cif) have chain A
and 60 residues. The [nanobody CIF](examples/absolute-stability/nanobody_1zvh.cif)
has chain A and 125 residues. The [TrkA complex](examples/absolute-stability/Trka_binder_AF2_10.pdb)
uses binder A and target B. These are retained upstream structures under the
adjacent MIT license, with no B36 model outputs. Their provenance is in
[the fixture notes](examples/absolute-stability/README.md).

## Prepare an authorized session

`SESSION` is the actual session UUID; `EXAMPLES` is the absolute
`data.examples.root` from `ariax skills forge --json`. Read the bundled reference with
`ariax skills forge --reference absolute-stability --read --json`.
The commands below use the frozen B13/B22 GPU-selection interface, which
is integrated in the accepted CLI base. Select the matching
deployed tool, then require host available and
tool ready. The example below uses SaProt. Use the matching ESM3 tool/model
pair after deployment.

```sh
ariax forge tools add "$SESSION" --tools absolute-stability-saprot --json
ariax forge tools wait "$SESSION" absolute-stability-saprot --timeout 1800 --json
ariax forge status "$SESSION" --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/absolute-stability/stability_1998469.pdb" --path absolute-stability/domain.pdb --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/absolute-stability/stability_1998469.cif" --path absolute-stability/domain.cif --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/absolute-stability/Trka_binder_AF2_10.pdb" --path absolute-stability/complex.pdb --json
ariax forge inputs list "$SESSION" --json
```

Require every input ready. Keep the returned input and command IDs. Use a
fresh output directory for each command. Explicit GPU 0 is shown; on a
multi-GPU session choose an available device without combining VRAM across
devices. No CPU substitute or scientific retry is automatic.

## Delta G

```sh
ariax forge run "$SESSION" --tool absolute-stability-saprot --gpus 0 --timeout-seconds 3600 --json -- absolute-stability dg --input /inputs/absolute-stability/domain.pdb --chain A --model saprot-augmented --output /workspace/stability/domain-pdb
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 3600 --json
ariax forge logs "$SESSION" "$COMMAND_ID" --tail 1000 --json
ariax forge run "$SESSION" --tool absolute-stability-saprot --gpus 0 --timeout-seconds 120 --json -- absolute-stability-check /workspace/stability/domain-pdb --input /inputs/absolute-stability/domain.pdb --chains A --model saprot-augmented --mode dg
```

Require the prediction and checker commands to succeed. `result.json` has
`dg.per_checkpoint`, `dg.mean`, `dg.std_population`, the checkpoint names and
author residue mapping. `dg.npz` retains raw per-residue arrays `(3,L)` and
their ensemble mean `(L)`, excluding BOS/EOS tokens. Delta G is the raw
learned stability-head output averaged over protein residues and then
checkpoints, in upstream kcal/mol units. It is a model estimate, with no
thermodynamic calculation performed on the coordinates. Population ensemble
spread is model disagreement, without calibrated experimental uncertainty.

## Supported mutation scanning

```sh
ariax forge run "$SESSION" --tool absolute-stability-saprot --gpus 0 --timeout-seconds 14400 --json -- absolute-stability scan --input /inputs/absolute-stability/domain.pdb --chain A --model saprot-augmented --scan-batch-size 1 --output /workspace/stability/domain-scan
ariax forge run "$SESSION" --tool absolute-stability-saprot --gpus 0 --timeout-seconds 120 --json -- absolute-stability-check /workspace/stability/domain-scan --input /inputs/absolute-stability/domain.pdb --chains A --model saprot-augmented --mode scan
```

Wait for prediction success before submitting its checker. Native scanning
substitutes each of the 20 canonical amino acids at every selected position,
keeping structure tokens/coordinates fixed. Raw delta delta G is mutant
minus wild-type raw stability-head output, averaged over scored residues and
then ensemble members. A positive number means the mutant's predicted score
is higher. This definition does not imply a relaxed mutant structure or a
binding-affinity change.

`scan.npz` retains raw and separately learned-scaled tensors `(3,L,20,1,L)`,
raw residue means `(3,L,20)` and ensemble means `(L,20)`. The last dimension
is scored residue, and the first L dimension is mutation position. The
alphabet is `ACDEFGHIKLMNPQRSTVWY`. `mutations.csv` lists author chain/number,
insertion code, wild type, mutant, raw mean and population spread. The
scaled tensor is a difference after upstream `SigmoidScaling`, distinct from
the raw reported DDG. Self substitutions must remain numerically zero.

Default `--max-scan-residues 128` bounds the expensive full scan. Full scans at
128 residues passed with batches 1 and 4 for every ensemble; batches 2 and 3
also passed at 60 and 59 residues, respectively. The 59-residue batch-3
case exercises a final one-mutation chunk. Use batch sizes 1 through 4 within
this execution envelope; the default stays 1. Memory includes quadratic scan arrays, and
runtime includes 20L substitutions per checkpoint. Raising the guard or batch
above this envelope requires separate qualification and assigned resources.
Independent proteins run as explicit serial commands; native scan batching
groups mutations within one selected protein.
SaProt rejects sequences beyond its base model's token capacity rather than
silently accepting the upstream tokenizer's truncation.

## Complex delta G_AB

```sh
ariax forge run "$SESSION" --tool absolute-stability-saprot --gpus 0 --timeout-seconds 3600 --json -- absolute-stability complex --input /inputs/absolute-stability/complex.pdb --binder-chain A --target-chain B --model saprot-augmented --output /workspace/stability/trka-complex
ariax forge run "$SESSION" --tool absolute-stability-saprot --gpus 0 --timeout-seconds 120 --json -- absolute-stability-check /workspace/stability/trka-complex --input /inputs/absolute-stability/complex.pdb --chains A B --model saprot-augmented --mode complex
```

Wait for prediction success before checking. `result.json` retains
`dg_binder`, `dg_target` and `dg_AB`, each with all three checkpoint scores,
mean and population spread. These are the native `*_predict_complex`
components. Delta G_AB is predicted full-complex stability. Preserve the
paper's metric as supplied. It is not direct binding affinity, Kd, or
delta G_AB minus the two component scores. SaProt builds isolated-chain
and selected-pair 3Di tokens, then concatenates binder and target. ESM3
scores the selected chains in that order using its native complex function.

## Save and inspect

`absolute-stability inspect --input FILE --chain AUTHOR_ID` prints the
model-free residue map; pass two IDs after `--chain` to inspect a complex
in binder then target order. It performs no prediction. For each completed model
run, inspect saved mapping, source, ensemble completeness, arrays and logs.
A command can fail after partial files were written; only a completed
`result.json` plus a successful checker marks a usable output.

```sh
ariax forge sync "$SESSION" --wait --json
ariax forge files "$SESSION" --path /workspace/stability --json
ariax forge download "$SESSION" /workspace/stability/domain-pdb/result.json --dest ./stability-result.json --json
```

Checkpoint before sharing the project/result link or closing compute. A lost
reply or watch timeout requires inspection of the same durable command ID.
Correct a scientific failure explicitly and retain the failed run. The
models were trained for small-domain stability. Larger complexes and novel
constructs require appropriate scientific scrutiny; execution success alone
does not establish calibration, binding or experimental success.

Use [saved results](../outputs.md) for checkpoint-pinned `forge link` paths,
and [project controls](../SKILL.md#project-controls-and-resume) for human
pause and same-project resume. Web approval clears a hold without allocating
compute; restoration leaves the next scientific command explicit.
