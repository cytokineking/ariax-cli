# Chai-1 molecular structure prediction

Chai-1 predicts proteins, complexes, ligands, nucleic acids and modified residues.
Forge selects source `66c38d1fe5c6756a89ff8596b1dea87d305ec06f`, whose package
version is 0.6.1, with the creator's models_v2 exports. The `chai1` asset supplies
those models, the ESM2 embedding model and conformer table at `/models/chai1`.
The image uses PyTorch 2.7.1 with CUDA 12.6 and Kalign 3.4.0.

Read this guide with `ariax skills forge --reference chai1 --read --json`.
Set `EXAMPLES` to the installed `data.examples.root` returned by
`ariax skills forge --json`; use the real session UUID for `SESSION`.
The [input inventory](examples/chai1/README.md) describes each small example.
Select the molecules, exact sequences and chemical identities before prediction.

## Prepare and run

```sh
ariax forge tools add "$SESSION" --tools chai1 --json
ariax forge tools wait "$SESSION" chai1 --timeout 1800 --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/chai1/monomer.fasta" --path chai1/monomer.fasta --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/chai1/predict.py" --path chai1/predict.py --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/chai1/check.py" --path chai1/check.py --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/chai1/monomer.expected.json" --path chai1/monomer.expected.json --json
ariax forge inputs list "$SESSION" --json
```

Require tool `ready` and each input `ready`. The supplied wrapper calls native
`chai_lab.chai1.run_inference` and saves its returned confidence arrays. Choose a
fresh output directory. This example uses three trunk recycles, 200 diffusion
steps and one diffusion sample:

```sh
ariax forge run "$SESSION" --tool chai1 --timeout-seconds 1800 --json -- python /inputs/chai1/predict.py /inputs/chai1/monomer.fasta /workspace/chai1/monomer1 --num-trunk-recycles 3 --num-diffn-timesteps 200 --num-diffn-samples 1 --seed 7
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 1800 --json
ariax forge logs "$SESSION" "$COMMAND_ID" --tail 1000 --json
```

Use the returned command ID. Inspect that same ID if a watch ends before the
command completes. An intentional correction uses a fresh output directory and
an explicit new command. The creator's defaults use five diffusion samples;
additional samples increase compute and output size.

Native CLI use is also available:

```sh
ariax forge run "$SESSION" --tool chai1 --timeout-seconds 1800 --json -- chai-lab fold /inputs/chai1/monomer.fasta /workspace/chai1/native1 --num-trunk-recycles 3 --num-diffn-timesteps 200 --num-diffn-samples 1 --seed 7
```

Native CLI outputs contain mmCIFs and ranking NPZ files. Use `predict.py` when
full PAE, PDE and token pLDDT arrays are needed for downstream inspection.

## Molecules and conditioning

Every FASTA entity needs a unique name. Standard proteins use `>protein|NAME`;
ligands use `>ligand|NAME` followed by a SMILES string. DNA and RNA use their
respective entity types. Parenthesized CCD identifiers encode modified protein
residues, such as `(MSE)`. Glycans use `>glycan|NAME` and the native glycan syntax.
Keep the original chemical specification with each result.

| Example | Inputs and native option |
| --- | --- |
| Protein monomer | `monomer.fasta` |
| Protein multimer | `multimer.fasta` |
| Protein plus caffeine | `ligand.fasta` |
| Protein, DNA and RNA | `nucleic.fasta` |
| Selenomethionine | `modified.fasta` |
| N-linked NAG | `glycan.fasta`, `--constraint-path /inputs/chai1/glycan.restraints` |
| Contact | `multimer.fasta`, `--constraint-path /inputs/chai1/contact.restraints` |
| Pocket | `multimer.fasta`, `--constraint-path /inputs/chai1/pocket.restraints` |
| Local alignment | `--msa-directory /workspace/chai1/my-msas` |
| Supplied structure template | `--template-hits-path /inputs/chai1/template.m8` |

Local alignments use the native `.aligned.pqt` schema: `sequence`,
`source_database`, `pairing_key` and `comment`. The first row is the query with
source `query`; filenames come from native `expected_basename(sequence)`.
Matching nonempty pairing keys pair homologous sequences across chains.
The native loader also packs unpaired alignments into shared rows; row coverage
alone does not establish pairing. The feature audit checks the native pairing keys.
`condition.py msa INPUT OUTPUT [--paired]` creates small synthetic alignments for
format checks. Use scientifically selected alignments for a real prediction.

Template m8 query IDs match FASTA entity names. The example selects deposited
1UBQ chain A. Keep its complete supplied mmCIF and place a working copy at
`/scratch/chai-templates/1UBQ.cif` before prediction. The selected upstream cache
path permits this copy while the model mount remains read-only. Record the PDB
selection and alignment. Public MSA/template server flags are native options;
server choice and its data terms belong to the project.

Contact and pocket restraints use zero-based dataframe processing internally,
while CSV residue positions are one-based and include the expected residue
letter. Chain IDs default to A, B and subsequent output chains. If
`--fasta-names-as-cif-chains` is selected, restraint chain names must match the
FASTA entity names. A covalent endpoint includes an atom name, for example
`N25@ND2` and `@C1`. The native parser uses the supplied maximum distance for
contact/pocket conditioning and currently ignores confidence/minimum-distance
columns. The native CLI can log a restraint feature error and continue with a
prediction. The supplied `predict.py` treats native feature errors as fatal when
constraints are supplied and saves the error in `run.json`. Review the realized
geometry in each saved prediction.

`condition.py audit INPUT OUTPUT` accepts the same local MSA, template and
constraint paths. It checks native token counts and nonempty conditioning
features. Add `--require-restraint` for contacts/pockets or `--require-covalent`
for a cross-chain covalent bond. It skips embedding calculation during this
input inspection; predictions retain the ESM model.

## Inspect and save

```sh
ariax forge run "$SESSION" --tool chai1 --timeout-seconds 180 --json -- python /inputs/chai1/check.py /workspace/chai1/monomer1 /inputs/chai1/monomer.expected.json --output /workspace/chai1/monomer1-check.json
ariax forge sync "$SESSION" --wait --json
ariax forge files "$SESSION" --path /workspace/chai1 --checkpoint "$CHECKPOINT" --json
```

Use the checkpoint ID from the completed sync. The inspector verifies chain
identity, polymer sequence, molecule atom coverage, finite coordinates and
confidence shapes. The glycan expectation also checks the N–C bond distance.
Expected files describe these specific fixtures; write corresponding expectations
for a changed input. Keep `run.json`, every `pred.model_idx_*.cif`, ranking NPZ,
`confidence.npz` and any MSA coverage plot. A failure retains its diagnostics.

PAE and PDE use angstroms. Token pLDDT and ranking confidence use 0–1; mmCIF
atom B factors carry pLDDT on 0–100. A high score supports confidence in a
prediction. Binding affinity and biological activity require separate evidence.
Inspect all samples and report restraints, templates, MSA choice and seed when
comparing predictions. Small 20-step examples exercise functionality; the primary
example uses the native 200-step setting.

The measured host was one 48 GiB L40 with 28 CPUs and 58 GiB RAM. Across
these small cases, sampled GPU use reached 7,857 MiB and container memory reached
16,865,185,792 bytes. The prepared model asset occupies 6,979,407,244 bytes.
For scheduling these cases, allow one GPU with 16 GiB VRAM, 32 GiB RAM, eight CPUs
and 40 GiB disk for the image, asset preparation, scratch and results. These are
conservative planning allowances; the measured hardware was the L40 profile.

The Wave 2 scope is one GPU and bounded examples within the 256-token native
padding size. Larger systems and additional sampling require their own capacity
assessment. Fresh restoration recovers saved inputs and outputs; inspect those
files before choosing further computation.

[Creator documentation](https://github.com/chaidiscovery/chai-lab/blob/66c38d1fe5c6756a89ff8596b1dea87d305ec06f/README.md),
[native inference](https://github.com/chaidiscovery/chai-lab/blob/66c38d1fe5c6756a89ff8596b1dea87d305ec06f/chai_lab/chai1.py).
Code and model weights use the creator's Apache 2.0 license.
