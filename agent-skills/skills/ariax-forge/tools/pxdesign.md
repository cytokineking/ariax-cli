# Native PXDesign

Use native PXDesign for protein binder backbone generation, with optional
ProteinMPNN sequence design and AF2/Protenix evaluation. The
[managed PXDesign protocol](../../ariax-pxdesign/SKILL.md) has its own project
lifecycle, schema and results; inspect the exact live mode before choosing a route.

## Inputs and model choices

Use `.yaml` or native JSON. The selected dispatch does not treat `.yml` as YAML.
Use mmCIF with full polymer sequences and explicit label-chain IDs. Example
source input, using the 1UBQ mmCIF software fixture:

```yaml
task_name: ubq_binder
binder_length: 40
target:
  file: /workspace/pxdesign/inputs/target.cif
  chains:
    A:
      crop: ["1-76"]
      hotspots: [8, 44, 68]
      sequence: MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG
```

The ubiquitin fixture is a software example, with no binding expectation. Choose
biological constructs/crops/hotspots deliberately. Hotspots guide sampling and do not prove
contacts. Native PXDesign can accept a hotspot outside the crop and still run;
check the effective mask rather than assuming that requested hotspot conditioned
the sampled structure. It can also return exit 0 after skipping a missing chain,
so inspect native errors and expected output counts. Validate positive binder
lengths and intended range endpoints yourself.
Lengths are scheduled per sample in `diffusion/length_schedule.json`;
`--length-min-per-len` influences coverage. A range is not one length per run.
Chain order determines native conditioning labels. Discontinuous crops preserve
the full register; they do not define a new full target sequence.

Direct mmCIF crop/hotspot numbers refer to full-chain, 1-based `label_seq_id`.
For PDB, native conversion maps integer author chain/residue IDs into a mmCIF
register and rejects ambiguous mappings. Reconcile missing residues and
insertion-code collisions through an explicit mmCIF and author/label map before
running. Record author chain, author residue/insertion, canonical position and
amino acid. Invalid sequence overrides can be ignored by the native YAML parser;
check the normalized input and full-coordinate correspondence.

The tool mounts read-only `pxdesign`, `proteinmpnn`, `alphafold2` and
`protenix-models` assets. Native original MPNN uses JAX `v_48_020.pkl` under
`colabdesign/v1.1.0`; a `.pt` is not that loader's input. Soluble JAX assets
remain unavailable. Extended evaluation uses Protenix base/mini-template v0.5
checkpoints. Native loaders report missing required files. MPNN/AF2 require CUDA
and have no CPU fallback.

Preserve every native source, model and output notice, including asset
`LICENSE`/`SOURCE.json`, `UPSTREAM-LICENSE.txt` and `SNAPSHOT-af-LICENSE.txt`.
PXDesign source Apache-2.0 does not settle checkpoint, data or output distribution
terms. Native original, AF2 and PTX CIF exports carry explicit noncommercial
notices; commercial CIF validation/use requires a compatible use decision or
upstream clarification. The shipped `run_monomer.py` is CC-BY-NC-4.0. Binder
preview uses a separate Apache-header AF2 script for monomer evaluation, which
supplies no exemption from the CIF terms. An unreadable upstream terms page
supplies no additional grant. The older JAX checkpoint tree has only a scoped
`af/LICENSE.txt`, with no root grant; applicability of the later root Beer-Ware
license to those checkpoints remains an unresolved distribution restriction.

Extended needs `pairing.a3m` and `non_pairing.a3m` for each selected full target
chain. Add `msa: /workspace/pxdesign/inputs/msa/A` to that chain only after checking
the query against its full sequence. Native automatic MSA searches are disabled.
An explicit `forge-pxdesign prepare-msa --yaml COPY.yaml --msa-mode mmseqs` submits
sequences to the selected ColabFold service and mutates that copy. It requires
separate disclosure authorization and service readiness. Preserve before/after
inputs. Missing alignments are a gate. Preview and infer need no target search.

## Direct command recipe

Run on an authorized remote GPU VM. Require host `available` and each selected
tool `ready`; inspect actual devices, allowed CPU IDs and free disk. Set
`ALLOWED_CPUS` to eight actual allowed CPU IDs from that host inventory and use
the explicit in-container `taskset` prefix; OMP threads do not limit JAX startup
threads. Catalog admission requires 48 GiB per device, eight CPUs and 250 GiB
disk, with no fixed RAM floor. The larger H100 profile used 100 GiB RAM and
required at least 600 GiB initially usable free disk for preparation and full
restoration. Smaller resource envelopes are not established by small examples.
Check reported device memory against the floor; do not add device memory together.

Set `TASK_YAML` and `TARGET_CIF` to your prepared local input files. Stage them,
require ready input states, then copy them to the YAML's absolute workspace
paths. The example below expects `target.file` to be
`/workspace/pxdesign/inputs/target.cif`.

```sh
ariax forge inputs add "$SESSION" --file "$TASK_YAML" --path pxdesign/task.yaml --json
ariax forge inputs add "$SESSION" --file "$TARGET_CIF" --path pxdesign/target.cif --json
ariax forge inputs list "$SESSION" --json
ariax forge run "$SESSION" --tool base --timeout-seconds 60 --json -- sh -lc 'mkdir -p /workspace/pxdesign/inputs; cp /inputs/pxdesign/task.yaml /workspace/pxdesign/inputs/task.yaml; cp /inputs/pxdesign/target.cif /workspace/pxdesign/inputs/target.cif'
ariax forge run "$SESSION" --tool pxdesign --gpus 0 --timeout-seconds 120 --json -- taskset -c "$ALLOWED_CPUS" forge-pxdesign check-input --yaml /workspace/pxdesign/inputs/task.yaml
ariax forge run "$SESSION" --tool pxdesign --gpus 0 --timeout-seconds 120 --json -- taskset -c "$ALLOWED_CPUS" forge-pxdesign parse-target --yaml /workspace/pxdesign/inputs/task.yaml -o /workspace/pxdesign/preflight
```

Inspect the parsed target CIF against the original register and intended crop.
`check-input` establishes YAML/path/MSA filename parsing, not scientific identity
or complete model loading. Each `run` prints its durable command ID. Watch/log
that same ID; wait timeouts leave work running. Every new scientific attempt uses
a fresh output directory and command identity, except an explicitly authorized
native continuation after confirmed terminal failure and stopped writers.

The complete native preview path performs diffusion, native original MPNN,
AF2 complex and binder monomer, filtering and export. Counts here are explicit:
two backbones, one sequence each, one run. AF2 model ID 0 uses native
ColabDesign's three-recycle initial-guess/binder-template path. Its settings differ
from a standalone ColabFold prediction, even when using the same AF2 weights.

```sh
ariax forge run "$SESSION" --tool pxdesign --gpus 0 --timeout-seconds 3600 --json -- taskset -c "$ALLOWED_CPUS" forge-pxdesign pipeline --preset preview -i /workspace/pxdesign/inputs/task.yaml -o /workspace/pxdesign/preview-01 --N_sample 2 --N_max_runs 1 --N_step 400 --dtype bf16 --seeds 101 --num_workers 0 --analysis-workers 1 --early_stop false --use_fast_ln false --use_deepspeed_evo_attention false --eval.binder.num_seqs 1 --eval.binder.tools.mpnn.weights original --eval.binder.tools.mpnn.temperature 0.0001
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 3600 --json
ariax forge logs "$SESSION" "$COMMAND_ID" --tail 1000 --json
```

Extended requires its specialized assets and supplied full-query MSAs:

```sh
taskset -c "$ALLOWED_CPUS" forge-pxdesign pipeline --preset extended -i /workspace/pxdesign/inputs/task-with-msa.yaml -o /workspace/pxdesign/extended-01 --N_sample 2 --N_max_runs 1 --N_step 400 --dtype bf16 --seeds 101 --num_workers 0 --analysis-workers 1 --early_stop false --use_fast_ln false --use_deepspeed_evo_attention false
```

It first predicts the target with base-default v0.5. If target RMSD is at least
2 Å, it switches PTX evaluation to `protenix_mini_tmpl_v0.5.0`, with native target
conditioning and MSA disabled for that evaluation. Otherwise it keeps the base
model/full-target MSA route. Initial PTX defaults are four cycles, one sample,
two steps. Finalization may run selected PTX-pass candidates at twenty steps and
seed 2025. Retain that effective model/configuration, the decision artifacts and
both initial and refinement scores.
`custom` leaves evaluation choices to the caller. Extra native overrides follow
preset flags, so record the final argv and effective config.
The Click default is `custom`, five samples and one run. It sets both return
caps to the explicit sample count; an upstream preset table alone does not
establish the count that ran.

Generation-only command, in the same admitted GPU envelope:

```sh
taskset -c "$ALLOWED_CPUS" forge-pxdesign infer -i /workspace/pxdesign/inputs/task.yaml -o /workspace/pxdesign/infer-01 --N_sample 1 --N_step 400 --dtype bf16 --seeds 101 --num_workers 0 --use_fast_ln false --use_deepspeed_evo_attention false
```

Its outputs are backbone CIFs and sequence/register metadata. They establish no
sequence design, AF2/PTX evaluation or final binder selection.

## Results, decisions and mappings

Keep `config.yaml`, `pipeline_input.json`, `pipeline_state.json`, native status/
errors/logs, each `runs/run_XXX/diffusion/{structures,orig_seqs.json,length_schedule.json}`,
`runs/run_XXX/eval/TASK/{sample_level_output.csv,seqs,chain_authority.json,af2_pred,ptx_pred,ptx_mini_pred}`
and `runs/run_XXX/final/`. Retain `ptx_final_outputs` when finalization refines
candidates. Not every mode produces every directory. The final CSV
retains all raw candidate and decision fields as well as native presentation
aliases. Missing success values stay unavailable and do not become passes.

Finalized snapshots are `results`, then `results_v2`, `results_v3`. An incomplete
snapshot can be reused by finalization. Select an explicit completed manifest;
do not pick alphabetically. Keep snapshot all/filtered/by-run tables, task summary,
`task_info.json`, original and actual predictor structures, and the selected
`(task_name, run_idx, name, seq_idx)` tuple. Rank alone is not a candidate ID.

| Native ranking mode | Selection and interpretation |
| --- | --- |
| Preview | Buckets 1..4 are AF2-pass; bucket 5 is RMSD-only and still fails AF2; bucket 6 fails. Successful rows come first, then failed rows can fill `min_total_return`. |
| Extended | Buckets 1..4 pass AF2 and PTX; 5..6 pass PTX only; 7..8 pass AF2 only; 9 fails both. Failed padding uses weighted AF2/PTX ordinal ranks. |

Preserve `pass_af2`, `pass_ptx`, all native `*_success` and
`*_success_ignore_missing` fields, bucket and scores. Native success thresholds
are strict source heuristics. Final rank, return count and a nonempty CSV do not
prove a passing design. Ranking mode follows usable PTX columns; a requested
extended run without required PTX output is partial even if native finalization
chooses preview. Keep disagreements and missing stages visible. Chosen structures
prefer refined PTX, then AF2, then original diffusion according to the flags;
failed selections can carry only original coordinates.

| Quantity | Native units/scope |
| --- | --- |
| AF2 `pLDDT`, `pTM`, `i_pTM` | 0–1 in this ColabDesign filter; displayed pLDDT is not the usual 0–100 array scale |
| AF2 `pAE`, `i_pAE` | Normalized by 31; `unscaled_i_pAE` and displayed `af2_ipAE` are Å |
| PTX pLDDT/pTM/ipTM and chain scores | Native dimensionless confidence, tied to the actual base/mini-template model; no affinity units |
| RMSD, `Rg` | Å; retain alignment/chain scope. `ref_ratio` is dimensionless. Secondary alpha/beta/loop values are fractions. |

AF2-opt requires pLDDT >0.9, raw interface PAE <7 Å and binder-design RMSD <1.5 Å.
AF2-easy requires pLDDT >0.8, ipTM >0.5, normalized interface PAE <0.35 and
bound/unbound RMSD <3.5 Å. Native PTX strict requires binder ipTM >0.85, binder
pTM >0.88 and design RMSD <2.5 Å; basic uses >0.8 for both scores with the same
RMSD. No threshold is relaxed. Keep scores from different models/settings apart.

The selected targets become `A0`, `B0`, etc., and the single generated binder is
last. `orig_seqs.json` keeps full target sequences and crop information. Native
CIF-to-PDB conversion trims IDs to one character, rejects collisions and maps
`xpb` placeholders to GLY for coordinate handling. MPNN fixes conditioning chains
and emits the last chain's designed sequence. Final original CIF export replaces
the binder placeholders with that sequence. AF2 rebuilds predicted residue IDs
from the design reference and permits target-chain permutation for RMSD; PTX
reconstructs sequences/conditioning and can remap labels again. Read the actual
`chain_authority.json`, converted inputs and predicted CIF/PDB identities. Never
infer binder identity from chain length, rank filename or sorted chain labels.

Reranking preview must restore the original settings and sample bound explicitly:

```sh
taskset -c "$ALLOWED_CPUS" forge-pxdesign rank --dump_dir /workspace/pxdesign/preview-01 --run_id 0 --preset custom --N_sample 2 --min_total_return 2 --max_success_return 2 --dtype bf16 --use_fast_ln false --use_deepspeed_evo_attention false --eval.binder.eval_complex true --eval.binder.eval_binder_monomer true --eval.binder.eval_protenix false --eval.binder.eval_protenix_mini false
```

`rank` does not reload the original config automatically. An extended rerank also
needs its effective post-decision model/template/MSA settings, evaluation flags,
sample caps and rank weights. It can perform PTX refinement, so authorize its
GPU work explicitly. It is not a harmless CPU table sort.

Each actual AF2 complex/monomer forward is retained as
`<candidate>_modelN.aux.pkl` beside its PDB/JSON, including native residue indices,
atom identities/coordinates, confidence arrays and unrounded metrics before PDB
remapping. Binder MPNN's complete sample return is `<backbone>.mpnn-native.pkl`
beside its input PDB. Inspect these with the matching native interpreter on the
GPU host and retain native chain authority and converted structures. For results
without these files, the raw arrays remain unavailable; no automatic prediction
fills the gap. A rounded summary cannot supply a full PAE map.
Diffusion additionally saves `native_forwards/forward_XXXXXX.pt` and stream
chunks as `sample_XXXXXX.cif.native.pt`. Native PTX saves `native-forward.pt`
before its rounded writers. Keep these files with their inputs and chain maps.
Cyclic flags affect native AF2/PTX evaluation masks; native diffusion exposes no
cyclic-closure generation option.

## Explicit selected-candidate evaluation and save

After choosing a completed snapshot and row, export its exact sequence/full-target
identity through the source helper. This requires the final ID columns
and native chain authority; the helper never assumes the selected candidate passed.

```sh
ariax forge run "$SESSION" --tool pxdesign --gpus 0 --timeout-seconds 120 --json -- python /opt/forge-pxdesign/export_selected.py /workspace/pxdesign/preview-01 --snapshot results --task ubq_binder --rank 1 --output /workspace/pxdesign/selection-01
ariax forge run "$SESSION" --tool protenix-models --gpus 0 --timeout-seconds 1800 --json -- taskset -c "$ALLOWED_CPUS" forge-protenix --model_name protenix_base_default_v1.0.0 --input_json_path /workspace/pxdesign/selection-01/protenix.json --dump_dir /workspace/pxdesign/protenix-01 --use_msa false --use_template false --sample_diffusion.N_sample 1 --model.N_cycle 3 --sample_diffusion.N_step 20 --seeds 101 --dtype bf16 --need_atom_confidence true
ariax forge run "$SESSION" --tool protenix-models --gpus 0 --timeout-seconds 120 --json -- python /opt/forge-protenix-check.py /workspace/pxdesign/selection-01/protenix.json /workspace/pxdesign/protenix-01
ariax forge run "$SESSION" --tool protenix-models --gpus 0 --timeout-seconds 120 --json -- python /opt/forge-protenix-handoff.py /workspace/pxdesign/selection-01/protenix.json /workspace/pxdesign/protenix-01 --run-id "$PREDICTION_COMMAND_ID"
ariax forge run "$SESSION" --tool interface-scores --timeout-seconds 120 --json -- interface-scores "$EXACT_HANDOFF_JSON" --output /workspace/pxdesign/interface-01.json
```

Require each tool ready with its compatible image and check its actual native output.
`PREDICTION_COMMAND_ID` identifies the Protenix prediction, not the export command.
`EXACT_HANDOFF_JSON` is its returned same-sample handoff path. The Protenix producer
derives actual token/atom/asym maps; interface scoring retains directional metrics
and missing values. No PAE map is inferred from the PXDesign score table. Native PXDesign
AF2 summary JSON lacks full matched residue PAE/pLDDT arrays, so it alone cannot
supply ipSAE. The exported `af2.fasta` is suitable for a separate authorized AF2
prediction if that route is chosen; use its original processed token sidecars.

The Protenix evaluation above uses full targets and unconditioned base-v1 prediction.
It is independent of the native cropped-target AF2 and native PTX branch scores;
it does not populate or replace native PXDesign success columns. For deliberate
grouped-template Protenix evaluation, construct its explicit zero-based query/template
maps from observed coordinates and full sequences under the
[Protenix guide](protenix-models.md), using a fresh command/output path.
No implicit predictor or model substitution
occurs. A confidence score does not establish binding or experimental success.

Inspect counts, identities, flags, structures, errors and exact settings before
accepting a result. After a failure, retain partial output and stop writers
before an explicit bounded continuation. Watch, restoration and tool
preparation never replay a scientific command. Changed scientific intent needs
a new output directory. Respect human holds and the original cap/deadline.

Native diffusion continuation restarts its original random seed while generating
only missing indices, so new indices can repeat earlier coordinates. A 500-index
continuation repeated prior coordinates at indices 470–499. Do not count returned
rows as independent backbones or assume equivalence to an uninterrupted run.
Keep continuation provenance and check duplicates; use a fresh run when
independence is required.

Set `PROJECT` to the session's returned `project_id`.

```sh
ariax forge sync "$SESSION" --wait --timeout 900 --json
ariax forge files "$PROJECT" --path /workspace/pxdesign --json
ariax forge close "$SESSION" --json
ariax forge status "$SESSION" --json
```

The 5o45 software example contains 129 source residues: crop 116 + binder 80 = 196
and full 129 + binder 80 = 209. A synthetic 247-residue target + binder 80 = 327
is a separate capacity fixture, not biological PD-L1. These examples establish
execution bounds only, not broader sequence-length or independent-sample support.
Query-only A3Ms test supplied-MSA plumbing and provide no evolutionary evidence.

For large native trees, create a gzip tar on the remote host and split it into
ordered Files parts of at most 4 GiB, with a JSON manifest listing order and sizes.
Keep the closed raw tree outside the saved workspace until the complete
export is saved and restored. Flush the parts and verify every saved file before relying on the export;
a flush is not an atomic snapshot. Keep
every part and the original selected inputs. After restoration, concatenate and
unpack into `/workspace/pxdesign`, compare native files and rerun output checks.
Files lists archive parts until they are explicitly unpacked. Retain failed
transfer operations and use new IDs for explicit retries; restoration does not
replay scientific commands. See the [output/file workflow](../outputs.md).
