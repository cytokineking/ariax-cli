# Native MPNN sequence design and scoring

Use this family to design sequences for a supplied backbone or score sequence support under a selected model. Choose ProteinMPNN for protein context, SolubleMPNN for soluble-trained weights, LigandMPNN for atomic chemical context, and AbMPNN for explicitly mapped antibody CDRs.

| Tool | Named mount and checkpoint choices | Native operations |
| --- | --- | --- |
| `proteinmpnn` | `/models/proteinmpnn/vanilla/v_48_{002, 010, 020, 030}.pt`; CA-only `/models/proteinmpnn/ca/v_48_{002, 010, 020}.pt` | Design, supplied-sequence/backbone scoring, conditional/backbone-conditional/unconditional probabilities |
| `solublempnn` | `/models/solublempnn/v_48_{010, 020}.pt` | The same full-backbone operations with original soluble-trained weights |
| `ligandmpnn` | `/models/ligandmpnn/ligandmpnn_v_32_{005, 010, 020, 030}_25.pt` | Native atomic-conditioned design; autoregressive, single-AA and backbone-only scoring |
| `abmpnn` | `/models/abmpnn/abmpnn.pt` | ProteinMPNN operations with explicit paired VH/VL, VHH or scFv CDR constraints |

ProteinMPNN is pinned to `8907e6671bfbfc92303b5f79c4b5e6ce47cdef57`, LigandMPNN to `26ec57ac976ade5379920dbd43c7f97a91cf82de`, with PyTorch 2.2.1/CUDA 12.1. AbMPNN retains [Zenodo 8164693](https://zenodo.org/records/8164693), CC-BY 4.0 attribution and its distinct checkpoint. Protein/soluble default to `v_48_020`; ligand defaults to `ligandmpnn_v_32_010_25.pt`. CA-only requires `proteinmpnn --ca_only` and CA preparation. SolubleMPNN and AbMPNN require a full backbone. RFantibody retains its own native stage/checkpoint.


The offered LigandMPNN modes exclude membrane checkpoints and sidechain packing. Use each executable’s `--help` for native flags, and retain exact checkpoint choices in comparisons.

LigandMPNN’s separate soluble checkpoint is used by Protein-Hunter and Harness; it is distinct from original SolubleMPNN. The older JMS JAX loader uses its own versioned checkpoint layout.


## Older JAX cross-entropy scores

For a deployment whose authenticated catalog offers `jms-mpnn`, use the
[older JMS workflow](jms-components.md#run-available-tools)
and wait for tool readiness. This route retains ColabDesign 1.1.0 at
`e7c38e5e70cac56f20f99efbf9d98707c1383ff1`, with explicit `v_48_010` or
`v_48_020` checkpoints under `/models/proteinmpnn/colabdesign/v1.1.0`.
Supply one matching canonical FASTA sequence and a complete single-chain backbone.
Use `--mode both --seed 0`; the runner keeps backbone noise and dropout at zero.

Conditional CE calls the original `get_logits()` with a seeded autoregressive
order. Unconditional CE calls `get_unconditional_logits()`. Each score averages
native-residue negative natural-log probabilities over the complete chain, using
all 21 softmax columns including X. Native ProteinMPNN's conditional-probability
operation uses different conditioning. Keep the chosen model, seed, alphabet,
structure identity and exact arguments with comparisons.

Retain `result.json`, both raw logits NPZ files and per-residue NLL values with
the registered inputs and logs. Restoring saved results leaves new scoring
commands explicit. These quantities describe model sequence support and do not
establish experimental stability or binding.

## Prepare explicit source constraints

Establish the exact backbone/constructs, chain identities, source numbering
and positions the user wants redesigned. Preserve the raw PDB. The examples
next to this guide are real structural fixtures with disclosed crops and
loop annotations; read [their preparation notes](mpnn/README.md).

`MPNN_EXAMPLES` is the absolute installed `ariax-forge/tools/mpnn` directory.
Use `data.examples.mpnn` from `ariax skills forge --tool mpnn --json`. `SESSION` is
the authorized session UUID. Check the selected tool’s catalog record for available models and resources, for example `ariax forge catalog --tool proteinmpnn --json`.

```sh
ariax forge tools add "$SESSION" --tools proteinmpnn --priority proteinmpnn --json
ariax forge tools wait "$SESSION" proteinmpnn --timeout 1800 --json
ariax forge status "$SESSION" --json
ariax forge inputs add "$SESSION" --file "$MPNN_EXAMPLES/protein.pdb" --path mpnn/protein.pdb --json
ariax forge inputs add "$SESSION" --file "$MPNN_EXAMPLES/protein.plan.json" --path mpnn/protein.plan.json --json
ariax forge run "$SESSION" --tool proteinmpnn --gpus 0 --timeout-seconds 60 --json -- mpnn-prepare --pdb /inputs/mpnn/protein.pdb --plan /inputs/mpnn/protein.plan.json --out /workspace/mpnn-demo/prepared-protein
```

Require input paths ready, host available and tool ready. Watch the returned
command UUID and inspect logs before using the prepared files. The helper
rejects missing backbone atoms, unknown protein residues, unresolved alternate
locations, zero occupancy, ambiguous atoms and multiple PDB models. Convert
or repair these explicitly while retaining the raw input and preparation
record. No coordinates are synthesized by this helper.

Plans contain `source.structure_id`, `source.description` and a nonempty
`design_positions` list such as `["A:10", "A:10A"]`. Identifiers refer to
the supplied PDB's original residue number plus insertion code. Unselected
protein residues and chains are fixed. `mpnn-prepare` writes a fresh
`backbone.pdb`, `fixed_positions.jsonl`, `plan.json` and `residue-map.json`.
It maps observed residues to dense one-based native positions while retaining
original chain, residue number, insertion code and amino acid. It preserves
non-protein chemical context and geometry. Nucleotide ATOM records become
HETATM records so original ProteinMPNN does not treat them as protein chains.

Do not pass source PDB numbers directly to ProteinMPNN fixed-position maps.
Its native maps use one-based sequence indices. Use the prepared directory
or supply a separately validated native map. Each run needs a new output
directory so stale sequences cannot pass inspection.

## Design and inspect actual sequences

```sh
ariax forge run "$SESSION" --tool proteinmpnn --gpus 0 --timeout-seconds 1800 --json -- proteinmpnn --prepared /workspace/mpnn-demo/prepared-protein --model_name v_48_020 --seed 7 --num_seq_per_target 2 --batch_size 1 --sampling_temp 0.3 --save_score 1 --save_probs 1 --out_folder /workspace/mpnn-demo/protein-design
ariax forge watch "$SESSION" "$DESIGN_COMMAND_ID" --timeout 1800 --json
ariax forge logs "$SESSION" "$DESIGN_COMMAND_ID" --tail 1000 --json
ariax forge run "$SESSION" --tool proteinmpnn --gpus 0 --timeout-seconds 60 --json -- mpnn-check --prepared /workspace/mpnn-demo/prepared-protein --output /workspace/mpnn-demo/protein-design --family protein --mode design --report /workspace/mpnn-demo/protein-design/check.json
```

Use the actual returned command UUIDs. Require terminal success and checker
success. The checker validates `seqs/backbone.fa` against native sampled
sequence arrays in `probs/backbone.npz`, verifies the requested chain identities
and checks every fixed residue including entire fixed chains. It reports
actual sequences by chain, observed substitution counts and native scores.
The checker reads each saved native batch chain order and supports batch sizes
one and four. Larger custom batches need separate checking. Optional
`--require-change` rejects unchanged designs; a design that retains the input
sequence can still be a valid model outcome.

ProteinMPNN FASTA contains only designed chains in alphabetical order, with
`/` separators. Keep the residue map, input backbone and full-chain checker
report together. Retain fixed context when constructing downstream complexes.
The native `git_hash=unknown` header can appear because the image omits `.git`;
the catalog/source manifest supplies the shipped source commit.

For SolubleMPNN, prepare the same full backbone and use `--tool solublempnn`
with `solublempnn --prepared ... --model_name v_48_020` and the same native
sampling/output flags. For CA-only ProteinMPNN, prepare with
`mpnn-prepare --ca-only ...`, then run `proteinmpnn --ca_only --prepared ...`.
CA and full-backbone weights remain in separate directories.

## Native scoring and probabilities

To score the supplied backbone sequence with the same fixed-region mask:

```sh
ariax forge run "$SESSION" --tool proteinmpnn --gpus 0 --timeout-seconds 1800 --json -- proteinmpnn --prepared /workspace/mpnn-demo/prepared-protein --model_name v_48_020 --seed 7 --num_seq_per_target 2 --batch_size 1 --score_only 1 --out_folder /workspace/mpnn-demo/protein-score
ariax forge run "$SESSION" --tool proteinmpnn --gpus 0 --timeout-seconds 60 --json -- mpnn-check --prepared /workspace/mpnn-demo/prepared-protein --output /workspace/mpnn-demo/protein-score --family protein --mode score --report /workspace/mpnn-demo/protein-score/check.json
```

Native `score` is mean negative log probability over valid designable
residues, in nats. `global_score` averages over all valid residues. Lower
values mean greater likelihood under that model/conditioning. They are not
stability energies, binding affinities or experimental success probabilities.
Record mask, checkpoint, seed, noise, sampling settings and repeat count.

For actual candidate scoring, add `--path_to_fasta /workspace/candidates.fa`
to the native score command. Each FASTA record must contain complete designed
chain sequences, alphabetically sorted, separated by `/`. Fixed chains come
from the input backbone. Validate exact chain lengths before submission;
upstream assumes the sequence alignment. Add `--score-fasta` with that same
file to `mpnn-check` to require and inspect the native `backbone_fasta_N.npz`
outputs and ensure the scored sequence matches. A design FASTA's first record
is the input sequence, so choose actual sample records deliberately.

For probability outputs, replace `--score_only 1` with one of the native
flags below and select the matching checker mode:

| Native flags | Checker mode and meaning |
| --- | --- |
| `--conditional_probs_only 1` | `conditional`, each amino acid conditioned on the backbone and other supplied residues |
| `--conditional_probs_only 1 --conditional_probs_only_backbone 1` | `backbone`, each amino acid conditioned on the backbone |
| `--unconditional_probs_only 1` | `unconditional`, upstream one-pass unconditional probabilities |

Files contain `log_p`, input sequence indices, validity mask and design mask.
Fixed-position zeros in native conditional arrays are placeholders, not
probabilities. The checker validates normalization at evaluated positions.
These operations also apply to the selected soluble and AbMPNN checkpoint.

## LigandMPNN conditioning and scoring

Preserve ligand/nucleotide/metal atom identities and coordinates. Use the
included `ligand.pdb` and `ligand.plan.json` to prepare
`/workspace/mpnn-demo/prepared-ligand` through `--tool ligandmpnn`. This real
1BC8 case contains DNA and zinc. Add/select/wait for `ligandmpnn` as above.

```sh
ariax forge run "$SESSION" --tool ligandmpnn --gpus 0 --timeout-seconds 1800 --json -- ligandmpnn --prepared /workspace/mpnn-demo/prepared-ligand --checkpoint_ligand_mpnn /models/ligandmpnn/ligandmpnn_v_32_010_25.pt --seed 7 --batch_size 1 --number_of_batches 2 --temperature 0.3 --save_stats 1 --out_folder /workspace/mpnn-demo/ligand-design
ariax forge run "$SESSION" --tool ligandmpnn --gpus 0 --timeout-seconds 60 --json -- mpnn-check --prepared /workspace/mpnn-demo/prepared-ligand --output /workspace/mpnn-demo/ligand-design --family ligand --mode design --report /workspace/mpnn-demo/ligand-design/check.json
ariax forge run "$SESSION" --tool ligandmpnn --gpus 0 --timeout-seconds 1800 --json -- ligandmpnn-score --prepared /workspace/mpnn-demo/prepared-ligand --checkpoint_ligand_mpnn /models/ligandmpnn/ligandmpnn_v_32_010_25.pt --seed 7 --batch_size 1 --number_of_batches 2 --autoregressive_score 1 --single_aa_score 0 --use_sequence 1 --out_folder /workspace/mpnn-demo/ligand-score
ariax forge run "$SESSION" --tool ligandmpnn --gpus 0 --timeout-seconds 60 --json -- mpnn-check --prepared /workspace/mpnn-demo/prepared-ligand --output /workspace/mpnn-demo/ligand-score --family ligand --mode autoregressive --report /workspace/mpnn-demo/ligand-score/check.json
```

Watch each returned command before the dependent checker. Native design
outputs include sequences, generated backbone PDBs and optional statistics.
The checker verifies fixed protein residues plus retained non-protein atom
identities and coordinates. Native backbone PDBs use prepared numbering;
keep the source residue map for interpretation/export.

Native `overall_confidence` is `exp(-mean negative log probability)` over
redesigned residues, using native T=1 score evaluation. `ligand_confidence`
uses the native ligand-distance subset; the cutoff only changes that
reported subset. Keep its residue count/cutoff visible and report it
unavailable if there are no applicable residues. Neither number measures
binding affinity.

`ligandmpnn-score` writes native probabilities, input sequence indices,
alphabet and exact residue names. The checker derives an NLL by gathering
supplied amino acids and averaging over requested design positions. The
autoregressive mode conditions on the decoding sequence prefix.
`--autoregressive_score 0 --single_aa_score 1 --use_sequence 1` evaluates
each position given other amino acids; checker mode `single-aa`.
The same flags with `--use_sequence 0` give backbone-only scoring; checker
mode `backbone`. Explicitly select one scoring operation.

`--ligand_mpnn_use_atom_context 0` is an explicit ablation. Preserve both
runs and state that conditioning was removed. The native optional
`--ligand_mpnn_use_side_chain_context 1` includes fixed-residue sidechain
atoms; it needs complete relevant sidechains and separate validation for
that workload. Native raw constraint/bias/symmetry options remain available
without `--prepared`; record and validate their native residue identifiers.

## Optional AbMPNN antibody checkpoint

AbMPNN requires `--prepared` from an antibody plan. Each plan records
`antibody.format` (`paired`, `vhh`, `scfv`), `numbering_scheme`, domain `role`,
explicit original domain `positions`, `cdrs.CDR1/CDR2/CDR3`, and optional
fixed `linker_positions`. Only selected residues within those annotated CDRs
can be redesigned. Framework, remaining CDR residues, linkers and antigen
context stay fixed. Paired VH/VL must occupy separate chains; scFv VH/VL
must occupy one source chain. VHH is one explicitly annotated VHH domain.

Use `paired.pdb`/`paired.plan.json`, `vhh.pdb`/`vhh.plan.json`, or
`scfv.pdb`/`scfv.plan.json` to prepare a fresh directory and select/wait for
`abmpnn`. The fixture plans declare manual loop windows in author numbering.
For the user's antibody use their actual numbered domains, explicit CDR
definition and source map. The original AbMPNN paper uses North CDR definitions;
IMGT/Kabat coordinates cannot be substituted by name alone.

```sh
ariax forge run "$SESSION" --tool abmpnn --gpus 0 --timeout-seconds 60 --json -- mpnn-prepare --pdb /inputs/mpnn/paired.pdb --plan /inputs/mpnn/paired.plan.json --out /workspace/mpnn-demo/prepared-paired
ariax forge run "$SESSION" --tool abmpnn --gpus 0 --timeout-seconds 1800 --json -- abmpnn --prepared /workspace/mpnn-demo/prepared-paired --seed 7 --num_seq_per_target 2 --batch_size 1 --sampling_temp 0.3 --save_score 1 --save_probs 1 --out_folder /workspace/mpnn-demo/paired-design
ariax forge run "$SESSION" --tool abmpnn --gpus 0 --timeout-seconds 60 --json -- mpnn-check --prepared /workspace/mpnn-demo/prepared-paired --output /workspace/mpnn-demo/paired-design --family protein --mode design --report /workspace/mpnn-demo/paired-design/check.json
```

Upload both chosen files through the ordinary input path first. Watch and
inspect each dependent command. Run VHH and scFv cases separately with their
own plans, directories and command IDs. A flexible scFv linker needs resolved
input coordinates and its explicit fixed map. The included scFv is a
crystallographic domain-swapped fragment and has no invented linker.

Checkpoint attribution: Frédéric A. Dreyer, Daniel Cutting, Constantin
Schneider, Henry Kenlay and Charlotte M. Deane, *Inverse folding for antibody
sequence design using deep learning*, Zenodo
[10.5281/zenodo.8164693](https://doi.org/10.5281/zenodo.8164693), 2023.
Weights are unchanged under CC-BY-4.0; source MIT notices are retained with
the image/assets. The checkpoint does not replace RFantibody's sequence stage.

## Save results and preserve their meaning

Keep source structures, plans, residue maps, actual sequences, scores,
checker reports, native settings and command IDs together. Save before
sharing or closing compute:

Set `PROJECT` to the session's returned `project_id`.

```sh
ariax forge sync "$SESSION" --wait --timeout 1800 --json
ariax forge files "$PROJECT" --path /workspace/mpnn-demo --json
ariax forge download "$PROJECT" /workspace/mpnn-demo/protein-design/check.json --dest ./mpnn-check.json --json
```

Require a successful flush before exporting current project files.

Measured examples span 93–805 protein residues, batch one, two samples and
explicit selected positions, including paired/VHH/scFv constraints and DNA/zinc
context. Peak observed process RAM was 1,082,056 KiB and sampled GPU use was
1,169 MiB on the L40 stack; sampling can miss short peaks. These observations do
not establish a general resource minimum or design-quality claim. Keep the
antibody-input restrictions above.

Use [saved results](../outputs.md) for current project exports and
[project controls](../SKILL.md#project-controls-and-resume) for pause, closure
and explicit continuation.
