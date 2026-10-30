# Foundry: RFD3, RFD3NA and RF3

Use RFD3 for protein sequence/atomic-structure generation, RFD3NA for RNA/DNA
generation, and RF3 to predict a specified molecular complex. Inspect generated
chemistry and conditioning geometry separately from folding confidence.

## Model choices and paths

| Tool | Model selection | Read-only checkpoint |
| --- | --- | --- |
| rfd3 | rfd3 | /models/foundry-rfd3/rfd3_latest.ckpt |
| rfd3na | rfd3na-1190 | /models/foundry-rfd3/rfd3na_1190.ckpt |
| rf3 | rf3, latest, January 2024 training cutoff | /models/foundry-rf3/rf3_foundry_01_24_latest_remapped.ckpt |
| rf3 | rf3_preprint_124, preprint, January 2024 | /models/foundry-rf3/rf3_foundry_01_24_preprint_remapped.ckpt |
| rf3 | rf3_preprint_921, benchmark, September 2021 | /models/foundry-rf3/rf3_foundry_09_21_preprint_remapped.ckpt |

Select the model through native `ckpt_path=...`. RF3's three offered choices use
the same inference interface and separate remapped checkpoints. Ariax mounts the
named `foundry-rfd3` and `foundry-rf3` bundles as the selected tools require them.
The alternate RFD3NA checkpoint 890 is not offered by this package. Do not install
weights into a workspace cache or silently substitute another checkpoint.

## Prepare inputs and run

Inspect the exact catalog selection, for example
`ariax forge catalog --tool rf3 --model rf3 --json`, and wait for tool readiness.
Use only tools and checkpoints available in that catalog. Find installed examples
with `ariax skills forge --tool foundry --json`; set `EXAMPLES` to
`data.examples.foundry`. See the [Forge guide](../SKILL.md) for session creation,
GPU selection, timeouts and cancellation.

The larger tested envelope uses one H100 80-GB GPU,
sixteen CPUs, 96 GiB RAM and 160 GiB session disk. Tested RF3 lengths are 256/512
at batch five and 1024 at batch one for each checkpoint; RFD3 lengths are
128/256/512 at batches 16/4/1, and RFD3NA RNA lengths are 64/128/256 at 16/4/1.
These measurements cover that GPU and those workloads; other envelopes remain
unmeasured. Choose one sample for a small functional run, or two samples when
checking batching.

The [native examples](examples/foundry/README.md) contain named generation,
prediction and capacity profiles with exact argv, structural expectations and
input identity. Upload the selected JSON and every referenced file at matching
paths. Require each imported input ID `ready` before execution, using
`forge inputs status SESSION INPUT_ID` for pending imports. For the mixed RFD3NA case:

```sh
ariax forge inputs add SESSION --file "$EXAMPLES/inputs/AMP-generation.pdb" --path foundry/inputs/AMP-generation.pdb
ariax forge inputs add SESSION --file "$EXAMPLES/inputs/rfd3na-multipolymer.json" --path foundry/inputs/rfd3na-multipolymer.json
ariax forge tools wait SESSION rfd3na
ariax forge run SESSION --tool rfd3na --timeout-seconds 3600 -- \
  python3 /opt/forge-foundry/fixtures/run_case.py rfd3na-multipolymer
```

The image helper selects one native case from its matching manifest and writes to `/workspace/outputs/CASE`. RF3 puts the record's files in
`/workspace/outputs/CASE/CASE` and its sample subdirectory. The helper refuses an
existing output directory; `--check-only` inspects retained files without another prediction.
Read the native logs and checker report before claiming completion. The examples
use one sample, seed 7, 50 diffusion steps and one RF3 recycle. They are reduced
execution cases with no expected design quality threshold.

For a user input, invoke native argv directly. Foundry uses Hydra `key=value`
arguments; quote a whole list/dictionary argument as one argv element:

```sh
ariax forge run SESSION --tool rfd3 --timeout-seconds 3600 -- \
  rfd3 design inputs=/inputs/design.json out_dir=/workspace/outputs/design-01 \
  ckpt_path=/models/foundry-rfd3/rfd3_latest.ckpt seed=7 \
  n_batches=1 diffusion_batch_size=1 skip_existing=False prevalidate_inputs=True

ariax forge run SESSION --tool rfd3na --timeout-seconds 3600 -- \
  rfd3na design inputs=/inputs/aptamer.json out_dir=/workspace/outputs/aptamer-01 \
  ckpt_path=/models/foundry-rfd3/rfd3na_1190.ckpt seed=7 \
  n_batches=1 diffusion_batch_size=1 read_sequence_from_sequence_head=False \
  skip_existing=False prevalidate_inputs=True

ariax forge run SESSION --tool rf3 --timeout-seconds 3600 -- \
  rf3 fold inputs=/inputs/prediction.json out_dir=/workspace/outputs/prediction-01 \
  ckpt_path=/models/foundry-rf3/rf3_foundry_01_24_latest_remapped.ckpt seed=7 \
  n_recycles=10 diffusion_batch_size=5 num_steps=50 skip_existing=False
```

Use a fresh output location and retain the submitted command ID. Native skipping,
early stopping or preprocessing errors can leave missing results despite an exit
code of zero. An uncertain platform command outcome requires inspection of that
durable ID. Each deliberate further scientific attempt is explicit and retains
the original failed or rejected result.

## Sample counts and native controls

A small generation check uses one sample and 200 timesteps. Two samples exercise
batching. Keep the native iteration count when reducing the sample count. The
small `cases.json` examples use reduced settings, while `resource-*` entries
carry larger explicit controls. For a small generation run, select one seed,
one batch and a fresh output directory:

```sh
ariax forge run SESSION --tool rfd3 --gpus 0 --timeout-seconds 1800 -- \
  rfd3 design inputs=/inputs/design.json out_dir=/workspace/outputs/design-small-01 \
  ckpt_path=/models/foundry-rfd3/rfd3_latest.ckpt seed=7 n_batches=1 \
  diffusion_batch_size=1 inference_sampler.num_timesteps=200 skip_existing=False
```

The measured RF3 capacity profiles use ten recycles, five samples and fifty steps, with
`early_stopping_plddt_threshold=null` to request all completed samples. Its native
ranking CSV can be unsorted. `consume.py --expected-samples 5` checks every sample
and matches the selected output to the native maximum ranking score. Set
`--expected-samples` to the submitted count. Generation's full-batch example
`generation_consume.py --expected-samples 16` inspects all sixteen outputs. A
consumer's exit zero preserves false geometry outcomes in its report.

## Generation and conditioning

RFD3 designs protein sequence and atomic structure. Its keyed JSON specifications
support lengths, indexed `contig`, unindexed motifs, selected fixed atoms and
unfixed sequence, target hotspots, fixed ligands/nucleic acids, RASA bins, atom-wise
donor/acceptor selections, partial diffusion and symmetry. Use the current dialect
2 input grammar. A `/0` contig entry creates a chain break. Length includes the
selected polymer segments. Partial diffusion uses `partial_t` in angstroms and
must not also specify `length`. Symmetry uses the native symmetry sampler.

RFD3NA extends atomic generation to RNA and DNA. `24-24R` generates RNA, `12-12D`
generates DNA and an unsuffixed length generates protein. Keep each requested
polymer and chemical identity visible in the saved input and actual output.
Use `read_sequence_from_sequence_head=False`, the upstream recommendation, and
check the decoded atomic residue names. Protein design around fixed DNA through
RFD3 does not establish RFD3NA nucleic-acid generation.

RFD3NA supports direct RNA secondary-structure input through `ss_dbn`, local
`ss_dbn_dict`, paired-region/paired-position lists and loop-region lists. This
package’s measured secondary-structure example uses global dot-bracket input.
Other secondary-structure variants are outside that measured scope.
The input model permits extra fields for these controls, so prevalidation alone
does not prove that a misspelled field affected inference.

Preserve chain/residue/atom correspondence from the native sampled contig and
metadata. Fixed selections use input author numbering; output numbering can differ
after scaffolding or unindexing. Record the actual output sequence and residue map
before MPNN or prediction handoff. RFD3 sequence-head B-factors are not RF3 pLDDT.
Do not interpret a generated ligand contact or computational confidence as binding.

Donor/acceptor cases supply explicit atom selections. The inspected inference
pipeline routes automatic HBPLUS calculation through a training condition, while
post-generation native metrics and RNA pair analysis require HBPLUS. Inspect the
reported hydrogen bonds and burial for the actual sampled structure. Training
and automatic input annotation are outside this offered inference scope.
Soft constraints can remain unsatisfied; inspect each sample’s actual geometry.

Default precision can move selected fixed atoms beyond a strict tolerance.
`+trainer_precision=32-true` is an explicit RFD3 control; compare its results with
the original settings. RNA pair analysis uses global token IDs across the complete
mixed array. Requested RNA pairs, extra pairs and C2 symmetry need per-sample
inspection. The [output notes](foundry/outputs.md) retain the measured example
findings and their limits.

The complete writer retains the native parsed bond graph for input-defined fixed
ligands in the final AtomArray and CIF. Provenance names the input source, exact
atom correspondence and restored bond count. It adds no predicted bonds and
changes no coordinates. Check native and exported
bond order/aromaticity plus coordinate-derived chirality for every sample.
Unavailable final topology must remain unavailable in the report.

Generation ligands must use a chain separate from generated polymers. The shipped
AMP-generation copy uses chain L; RF3 keeps the original AMP input. Use explicit
NA ranges such as `24-24R`, since shorthand suffixes were rejected or produced
incorrect polymer identities at this pinned source.

Inspect a saved generation case without inference:

```sh
ariax forge run SESSION --tool rfd3na -- \
  python3 /opt/forge-foundry/fixtures/generation_consume.py \
  /workspace/outputs/rfd3na-multipolymer --case rfd3na-multipolymer
```

Each report keeps actual sequence/atom identities, fixed correspondence, conditioning
fields and false/unavailable scientific outcomes. Diagnostic completion does not
clear them. Keep the sample count, native controls and actual scientific findings
with the saved files.

## RF3 input and output interpretation

RF3 accepts PDB/CIF and JSON component lists. Offered input panels are monomer,
protein/DNA/RNA/ligand complex, supplied A3M and polymer/ligand templating. JSON
components name chains explicitly, use `seq` plus `chain_type` for unambiguous
polymers, `ccd_code` for known chemicals, and `path` for structural components.
DNA uses `chain_type: "POLYDEOXYRIBONUCLEOTIDE"`; RNA uses
`chain_type: "POLYRIBONUCLEOTIDE"`, as in the completed mixed fixtures.
MSAs are supplied through the component's `msa_path`. RF3 does not acquire a
public or custom-server MSA for you; prepare/upload it explicitly under the
platform MSA guidance. Templates use `template_selection` for polymer/token
distances and `ground_truth_conformer_selection` for complete ligand conformers.

The native interface also accepts SMILES/SDF, noncanonical residues, covalent
bonds and cyclic chains. These additional inputs are outside the supported scope. Custom
chemical names must avoid CCD name collisions, and atom naming,
bond endpoints and chirality need actual inspection before scientific interpretation.

At the pinned source, RF3 writes top-ranked `_model.cif`, `_summary_confidences.json`,
`_confidences.json` and `_ranking_scores.csv`, plus individual sample files under
seed/sample directories. Preserve the selected sample, checkpoint, seed and input
construct together. Early-stopped outputs have no completed structure; retain that
outcome. Disabling early stopping for an execution fixture does not make its result
scientifically useful.

The [output notes](foundry/outputs.md) record the exact confidence meanings. Native
pLDDT uses 0–1 and PAE uses angstroms. `token_res_ids` is a zero-based token index,
and `chain_ptm` is populated from mean chain pLDDT. Do not relabel them as structure
residue numbers or per-chain pTM. Match atom identity and native atom-to-token
annotations to each paired structure. The [interface-score guide](interface-scores.md) explains their use.
Mixed-molecule PAE requires a mapped protein subset before a protein-residue
metric. Monomer iPTM is native zero with no interchain pairs.

The image's checker inspects a selected structure against ordinary expected fields:

```sh
ariax forge run SESSION --tool rf3 -- \
  python3 /opt/forge-foundry/foundry_outputs.py /workspace/outputs/run/sample_model.cif \
  --expected /inputs/expected.json \
  --summary /workspace/outputs/run/sample_summary_confidences.json \
  --confidences /workspace/outputs/run/sample_confidences.json \
  --fasta /workspace/outputs/run/observed-sequences.fasta
```

Expected fields and examples are in the native examples directory. The checker
records chain IDs, residue names/numbers, sequences, chemical atom identity and
confidence dimensions and native token mapping. Matching ligand atom and bond
records do not guarantee correct stereochemistry; inspect coordinate-derived
chirality in each sample. The [output notes](foundry/outputs.md) describe the AMP
example failures. RF3 full precision is not offered: the native cuEquivariance
path requires BF16. Motif geometry, design quality and experimental accuracy
need separate evidence.

Sync actual outputs before sharing a saved-file link or ending compute:

Set `PROJECT` to the session's returned `project_id`.

```sh
ariax forge sync SESSION --wait
ariax forge files "$PROJECT" --path /workspace/outputs
```

RFD3/RFD3NA outputs are `.cif.gz` plus native JSON. Decompress a separate copy for
the project preview, which accepts uncompressed structures up to 10,000,000 bytes.
Keep the original compressed output and identity metadata.

## Primary source

Use the pinned [Foundry source](https://github.com/RosettaCommons/foundry/tree/94c78ab125c6ef2cc7d1226de86d1bd578bf8bee),
[RFD3NA guide](https://github.com/RosettaCommons/foundry/blob/94c78ab125c6ef2cc7d1226de86d1bd578bf8bee/models/rfd3na/README.md)
and [RF3 guide](https://github.com/RosettaCommons/foundry/blob/94c78ab125c6ef2cc7d1226de86d1bd578bf8bee/models/rf3/README.md).
HBPLUS source access follows the
[current EBI download page](https://www.ebi.ac.uk/thornton-srv/software/HBPLUS/download.html).

Use [saved results](../outputs.md) for current project exports and
[project controls](../SKILL.md#project-controls-and-resume) for pause, closure
and explicit continuation.
