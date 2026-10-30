# FAMPNN full-atom design, packing and mutation scoring

Use FAMPNN to design sequences and sidechains on a supplied protein backbone,
repack a fixed sequence, or compare mutation likelihoods in structural context.

| Model choice | Upstream training data/noise | Recommended native use |
| --- | --- | --- |
| fampnn_0_0 | Full PDB, 0.0 Angstrom | Sidechain packing |
| fampnn_0_3 | Full PDB, 0.3 Angstrom | Full-atom sequence design |
| fampnn_0_3_cath | CATH, 0.3 Angstrom | Mutation scoring |

These choices select their corresponding unmodified `.pt` files. Design defaults
to 0.3, packing to 0.0 and both scoring operations to CATH. An explicit `--model`
selects another native checkpoint. Check `ariax forge catalog --tool fampnn --json`
for available models and resource requirements.

## Explicit inputs and commands

Supply one standard-protein PDB with one model, complete N/CA/C/O atoms and resolved
alternate conformations. Heterogens, insertion codes and nonstandard residues
need explicit preprocessing and are rejected here. There is no ligand conditioning.
Original one-character chain IDs and residue numbers survive in `structures/`;
`native/` preserves the upstream writer's generated chain letters. The residue map
records both, with a zero-based position in concatenated chain order.

Find examples with `ariax skills forge --tool fampnn --json`, field
`data.examples.fampnn`. Copy [ubq.pdb](examples/fampnn/ubq.pdb) and
[mutations.csv](examples/fampnn/mutations.csv) into the project's inputs with `forge inputs add SESSION --file FILE --path NAME`.
Require each returned input ID ready using `forge inputs status SESSION INPUT_ID`.
The fixture contains ubiquitin coordinates with
chain Z and numbering 101–176. Use a fresh output directory for each invocation.
These are explicit scientific commands; no folding, relaxation or scoring is replayed.

```sh
ariax forge run "$SESSION" --tool fampnn --gpus 0 --timeout-seconds 1800 -- \
  fampnn design /inputs/ubq.pdb --out-dir /workspace/fampnn-design \
  --fixed-sequence Z101-110 --fixed-sidechains Z101-105 --seed 7 \
  --steps 10 --sidechain-steps 20 --temperature 0.1

ariax forge run "$SESSION" --tool fampnn --gpus 0 --timeout-seconds 1800 -- \
  fampnn pack /inputs/ubq.pdb --out-dir /workspace/fampnn-pack --seed 7

ariax forge run "$SESSION" --tool fampnn --gpus 0 --timeout-seconds 1800 -- \
  fampnn score-all /inputs/ubq.pdb --out-dir /workspace/fampnn-score-all \
  --batch-size 4 --seed 7

ariax forge run "$SESSION" --tool fampnn --gpus 0 --timeout-seconds 1800 -- \
  fampnn score-multi /inputs/ubq.pdb --mutations /inputs/mutations.csv \
  --out-dir /workspace/fampnn-score-multi --batch-size 4 --seed 7
```

Design defaults to 100 sequence denoising steps and 50 sidechain steps, native
repack-last and PSCE threshold 0.3. `--steps 10 --sidechain-steps 20` is an explicit
reduced execution example that makes no accuracy claim. Packing and score-multi use
50 native sidechain steps unless explicitly changed. The default batch/sample
counts are one, chosen to bound memory. `--samples` sets design/pack sample count.
`--seed`, `--batch-size`, `--temperature` and model selection are retained.

Fixed positions use upstream chain/number notation such as `Z101-110,Y4`.
Requested positions must exist. Fixed sidechains must be a subset of fixed
sequence positions. In design, positions outside the fixed sequence are designable.
In packing, omitting fixed-sequence positions preserves the full input sequence
and repacks all nonfixed sidechains. Supplying fixed-sequence positions restricts
packing to those positions under upstream semantics; other sequence positions
are not provided as conditioning context. Do not interpret it as a list of
sidechains to leave frozen. Use `--fixed-sidechains` for retained sidechain coordinates.

The [two-chain fixture](examples/fampnn/two-chain.pdb) and
[its mutation list](examples/fampnn/two-chain-mutations.csv) illustrate author IDs
Y101–132/Z201–232 and concatenated indexing across chains. The tested conditional
selection is `--fixed-sequence Y101-110,Z201-210 --fixed-sidechains Y101-105,Z201-205`,
with ten sequence steps, twenty sidechain steps and seed 7. Twenty of its 44
designable positions changed; its 20 fixed sequence positions and ten fixed
sidechains remained unchanged. The short synthetic pair is a mapping fixture.

## Mutation-score meaning and indexing

The CSV requires exactly a `mutations` header. Each token contains the wild-type
letter, **zero-based concatenated position**, then mutant letter. `M0A` targets
Z101 in the fixture. Positions continue across chains; they are not author residue
numbers and do not reset for each chain. Join simultaneous mutations with a colon,
for example `M0A:Q1R`. `wt` requests the native zero control. Mismatched wild types,
out-of-range positions and repeated positions within a group fail before scoring.

`score-all` produces native `all_scores.csv`, with a row for each position and
20 amino-acid columns. The row label is upstream one-based concatenated position
followed by wild-type letter. Use `residue-map.json` for chain/author identity.
Each number is `log p(mutant | masked-position context) - log p(wild type | same
context)`, with that position's sequence and sidechain masked. Wild-type entries
are zero. The units are natural-log likelihood ratios.

`score-multi` produces native `score_multi.csv`, preserving mutation labels.
Upstream first packs the mutant sidechains, then evaluates and sums masked-position
log likelihood ratios in the mutant context, including the native cumulative
sidechain-mask behavior across successive positions. This score is not generally the sum
of independently evaluated single-mutant scores. Preserve the selected checkpoint,
seed, batch grouping and sidechain diffusion settings when comparing it.
Neither operation is calibrated delta-G, binding affinity, experimental fitness,
or a substitute for ProteinMPNN/LigandMPNN scores.

## Inspect and save

`result.json` appears after native success. `settings.json`, `native-config.yaml`,
`command.json`, `residue-map.json`, Hydra records and `native.log` retain the exact
request and native outcome. Failures keep partial native files and their log;
invoke any deliberate retry into a new directory.

Design saves native FASTAs, structures and sample PKLs with original/predicted
amino-acid types, fixed masks, sequence probabilities and PSCE. Packing saves native
full-atom PDBs. The B-factor column contains upstream predicted sidechain coordinate
error (PSCE); backbone values are zero. It is not pLDDT or experimental temperature
factor. `structures/` changes only the upstream chain letter to the corresponding
input chain ID. Keep the complete native directory alongside mapped exports.

Save unique outputs and modifications through ordinary Forge project file synchronization.
An explicit restore recovers files; scientific execution is not automatically
replayed. Public unmodified weights can be prepared again from the recorded source
revision, layout and upstream model card.

The measured profile uses one L40 with 49,140 MiB VRAM. The catalog floor is
47.9 GiB per GPU, two CPUs and 25 GiB payload storage, with no fixed RAM floor.
Observed memory alone does not establish smaller-device support for the wider
inputs below. An eight-GiB allowance applies only to the original small examples;
use the selected catalog’s admission requirements for scheduling.

| Measured input | Checkpoints and operations | Batch / samples |
| --- | --- | --- |
| 76-residue ubiquitin | All three checkpoints in each of the four operations | Batch 4; four design/packing samples; 76x20 single-site scores; eight mutation groups |
| 247-residue 1TIM monomer | 0.3 design, 0.0 packing, CATH single/multiple scoring | Batch 4; four design/packing samples; 247x20 single-site scores; eight mutation groups |
| 494-residue 1TIM dimer | Same recommended pairs | Batch 8; eight design/packing samples; 494x20 single-site scores; sixteen mutation groups |

The listed design runs use native 100/50-step defaults. Packing and
multiple-mutation scoring use 50 sidechain steps. Batch-one observations also cover 76-residue default design and the synthetic
two-chain conditional case. Other checkpoint/operation pairs have measured scope
only where listed. Lengths above 494, batches above eight and sample counts above
eight have no current capacity evidence.

The [profile recipe](examples/fampnn/prepare_profiles.py) takes the public 1TIM PDB
and explicitly selects its protein chains, removes heterogens/OXT and records the
source-to-input residue map. It preserves author numbering gaps while renaming
A/B to Y/Z and adding 1000/2000 to author numbers. Its `profiles.json` lists exact
present fixed positions. A range spanning an absent author residue is rejected.

Use [saved results](../outputs.md) for current project exports and
[project controls](../SKILL.md#project-controls-and-resume) for pause, closure
and explicit continuation.
