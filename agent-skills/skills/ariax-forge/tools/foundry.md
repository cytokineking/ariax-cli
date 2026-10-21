# Foundry: RFD3, RFD3NA and RF3


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

First inspect the configured catalog and wait for the selected tool. Use the
platform Forge guide for session creation, GPU selection, timeout, cancellation,
checkpointing, human holds and explicit restoration. Run only tools returned by
the configured catalog. The larger tested envelope uses one H100 80-GB GPU,
sixteen CPUs, 96 GiB RAM and 160 GiB session disk. Tested RF3 lengths are 256/512
at batch five and 1024 at batch one for each checkpoint; RFD3 lengths are
128/256/512 at batches 16/4/1, and RFD3NA RNA lengths are 64/128/256 at 16/4/1.
These observations qualify that GPU and those workloads. Choose one sample for a
small functional run, or two samples when checking batching.

The [native examples](examples/foundry/README.md) include the original twenty-six modes and fifteen resource cases with
recorded case status, exact argv, structural expectations and input identity. Upload the selected
JSON and every file it refers to with matching paths. For the mixed RFD3NA case:
Require each imported input ID `ready` before invoking the helper, using
`forge inputs status SESSION INPUT_ID` for pending imports.

```sh
ariax forge inputs add SESSION --file EXAMPLES/inputs/AMP-generation.pdb --path foundry/inputs/AMP-generation.pdb
ariax forge inputs add SESSION --file EXAMPLES/inputs/rfd3na-multipolymer.json --path foundry/inputs/rfd3na-multipolymer.json
ariax forge tools wait SESSION rfd3na
ariax forge run SESSION --tool rfd3na --timeout-seconds 3600 -- \
  python3 /opt/forge-foundry/fixtures/run_case.py rfd3na-multipolymer
```

`EXAMPLES` means this guide's sibling `tools/examples/foundry` directory in the
installed skill. The image helper selects one native case from its matching
manifest and writes to `/workspace/outputs/CASE`. RF3 puts the record's files in
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
original twenty-six `cases.json` entries keep their reduced settings. The
fifteen `resource-*` cases carry their explicit larger controls for optional
capacity work. For a small generation run, select one seed, one batch and a fresh
output directory:

```sh
ariax forge run SESSION --tool rfd3 --gpus 0 --timeout-seconds 1800 -- \
  rfd3 design inputs=/inputs/design.json out_dir=/workspace/outputs/design-small-01 \
  ckpt_path=/models/foundry-rfd3/rfd3_latest.ckpt seed=7 n_batches=1 \
  diffusion_batch_size=1 inference_sampler.num_timesteps=200 skip_existing=False
```

RF3 qualification uses ten recycles, five samples and fifty steps, with
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
package's prepared mode uses the global dot-bracket case. The other secondary-
structure variants need distinct native qualification before support claims.
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
reported hydrogen bonds and burial for the actual sampled structure. The four
retained soft-constraint batches each have zero of sixteen samples satisfying
every selected hydrogen-bond atom. Training and automatic input annotation are
outside this offered inference scope.

The retained default partial-diffusion and fixed-DNA batches each have zero of
sixteen samples within the declared 0.05 Å fixed-atom tolerance, with maximum
errors 0.055745 Å and 0.054320 Å. Explicit `+trainer_precision=32-true` comparisons
pass the same tolerance, at about 0.000004 Å and 0.000002 Å. Preserve the original
default failures alongside those full-precision results.

RNA pair analysis uses global token IDs across the complete mixed array. All
requested pairs occur in fifteen of sixteen samples; every sample also has extra
pairs. C2 geometry passes eleven of sixteen under the recorded checks. Inspect
each sample's missing pairs, extra pairs and symmetry result.

The complete writer retains the native parsed bond graph for input-defined fixed
ligands in the final AtomArray and CIF. Provenance names the input source, exact
atom correspondence and restored bond count. It adds no predicted bonds and
changes no coordinates. Check native and exported bond order/aromaticity plus
coordinate-derived chirality for every sample. Earlier outputs with unavailable
final topology retain that finding.

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
bonds and cyclic chains. These additional panels remain unqualified. Custom
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
residue numbers or per-chain pTM. B28a's atom identity and native atom-to-token
annotations are verified against each paired structure. B35 owns the interface-score
consumer using those mappings. Mixed molecule PAE requires a mapped protein subset
before a protein-residue metric. Monomer iPTM is native zero with no interchain pairs.

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
confidence dimensions and native token mapping. In the retained one-recycle,
50-step, single-sample panel, all six AMP outputs have matching bond records and
five match all four stereocenters. The preprint 1/24 template retains its C1'
failure. A separate ten-recycle, 200-step comparison clears all four centers with
the same input, seed and sample count. The full retained panel has matching AMP
bond records in all 31 distinct sampled structures and matching chirality in 25.
Selected preprint 1/24 and 9/21 template outputs retain a chirality failure.
Keep each result with its exact settings. An RF3 full-precision probe failed the
native cuEquivariance BF16 guard and is not an offered precision mode. Motif
geometry, design quality and experimental accuracy need separate evidence.

Sync actual outputs before sharing a saved-file link or ending compute:

```sh
ariax forge sync SESSION --wait
ariax forge files SESSION --path /workspace/outputs
```

RFD3/RFD3NA outputs are `.cif.gz` plus native JSON. Decompress a separate copy for
the project preview, which accepts uncompressed structures up to 10,000,000 bytes.
Keep the original compressed output and identity metadata. Explicit restoration
recovers saved files; it does not rerun predictions or recreate a scratch venv.

## Primary source

Use the pinned [Foundry source](https://github.com/RosettaCommons/foundry/tree/94c78ab125c6ef2cc7d1226de86d1bd578bf8bee),
[RFD3NA guide](https://github.com/RosettaCommons/foundry/blob/94c78ab125c6ef2cc7d1226de86d1bd578bf8bee/models/rfd3na/README.md)
and [RF3 guide](https://github.com/RosettaCommons/foundry/blob/94c78ab125c6ef2cc7d1226de86d1bd578bf8bee/models/rf3/README.md).
HBPLUS source access follows the
[current EBI download page](https://www.ebi.ac.uk/thornton-srv/software/HBPLUS/download.html).

Use [saved results](../outputs.md) for checkpoint-pinned `forge link` paths,
and [project controls](../SKILL.md#project-controls-and-resume) for human
pause and same-project resume. Web approval clears a hold without allocating
compute; restoration leaves the next scientific command explicit.
