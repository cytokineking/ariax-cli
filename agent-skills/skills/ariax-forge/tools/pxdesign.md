# Native PXDesign

The [managed PXDesign protocol](../../ariax-pxdesign/SKILL.md) runs a defined
project lifecycle with its own schema and results. This native guide has
separate settings and qualification; inspect the exact live mode.


## Inputs and stage assets

Use `.yaml` or native JSON. The selected dispatch does not treat `.yml` as YAML.
Use mmCIF with full polymer sequences and explicit label-chain IDs. Example
source input, using the retained B31 1UBQ mmCIF:

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

The ubiquitin fixture is a software qualification case, with no binding expectation. Choose biological
constructs/crops/hotspots deliberately. Hotspots guide sampling and do not prove
contacts. Native PXDesign can accept a hotspot outside the crop and still run;
check the effective mask rather than assuming that requested hotspot conditioned
the sampled structure. It can also return exit0 after skipping a missing chain,
so inspect native errors and expected output counts. Validate positive binder lengths and intended range endpoints yourself.
This revision schedules ranges per sample in `diffusion/length_schedule.json`;
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

The complete candidate mounts read-only `pxdesign`, `proteinmpnn`,
`alphafold2` and `protenix-models`. PXDesign supplies diffusion and specialized
mini-template checkpoints plus its dated three-file CCD cache. B27 supplies
native original JAX `v_48_020.pkl` under `colabdesign/v1.1.0`; a `.pt` is not that
loader's input. B31 supplies LICENSE and all fifteen AF2 NPZ files. Shared
Protenix supplies base/mini-default v0.5 checkpoints. The source recipe uses
ordinary static image paths and complete named downloads; scientific commands
do not download weights or inspect all assets per invocation. Native loaders
report missing required files. Soluble JAX assets remain unavailable for this
recipe. Source Apache-2.0 does not settle checkpoint/data/output distribution terms.
Native original, AF2 and PTX CIF exports all carry the noncommercial terms notice.
The shipped `run_monomer.py` is CC-BY-NC-4.0; binder monomer evaluation instead
uses the separate Apache-header AF2 script. That source call graph supplies no
terms exemption. Preserve every native notice. The monomer runner is not invoked
by binder preview; it remains in the image's distribution review. CIF use must
respect its explicit noncommercial notice; commercial CIF validation/use requires
a compatible use decision or upstream clarification. The unreadable terms page
supplies no grant and no evidence that all private qualification is forbidden.
B27r completed the named canonical asset and validated the older JMS JAX
consumer against all 184 native per-residue NLL values. The newer PXDesign consumer strictly loaded the original checkpoint and matched
all captured native sample arrays in the independent stage comparison. B46b found retained PXDesign checkpoint/CCD
members for remote reuse, with a full seven-member payload of 1,669,456,719
bytes and a conservative 2GB uncompressed-tar bound. These metadata findings
establish no ready PXDesign tool. The exact JAX contract is `joblib.load` of old
`v_48_020.pkl` (`num_edges` and `model_state_dict`). The native canonical root is
`colabdesign/v1.1.0/{v_48_010.pkl,v_48_020.pkl,__init__.py,UPSTREAM-LICENSE.txt}`
with `SNAPSHOT-af-LICENSE.txt`, the native asset's LICENSE/SOURCE.json and all
original `.pt` members.
The old tree has a scoped `af/LICENSE.txt`, no root grant; later root Beer-Ware
applicability to its JAX checkpoints remains an explicit distribution gate.

The recipe keeps unchanged native Protenix/Torch2.3.1 in its CUDA11.8 interpreter
and uses B45's qualified JAX0.6/CUDA12.8 family in a separate predictor interpreter.
CPU Torch there supplies parser/seeding imports; MPNN/AF2 require CUDA and have
no CPU fallback. Native Protenix source is unchanged. Declared packaging patches separate the
interpreters, use managed assets and preserve raw outputs. Both pip checks and
both Torch/JAX import orders passed on the allocated GPU. The JAX subprocess
uses its Torch parser layernorm while CUDA computation remains in JAX; outer
diffusion/PTX retain their selected native Torch kernels.

Extended needs `pairing.a3m` and `non_pairing.a3m` for each selected full target
chain. Add `msa: /workspace/pxdesign/inputs/msa/A` to that chain only after checking
the query against its full sequence. Native automatic MSA searches are disabled.
An explicit `forge-pxdesign prepare-msa --yaml COPY.yaml --msa-mode mmseqs` submits
sequences to the selected ColabFold service and mutates that copy. It requires
separate disclosure authorization and service readiness. Preserve before/after
inputs. Missing alignments are a gate. Preview and infer need no target search.

## Direct command recipe

All execution, installation, tests, images and models belong on an authorized
remote GPU VM. Require host `available` and each selected tool `ready`; record
actual devices, allowed CPU IDs and free disk. The measured finite profiles are recorded in completion evidence; small-case
observations do not establish general resource minima. Set `QUALIFIED_CPUS` to eight actual allowed CPU IDs
from that host inventory and use the explicit in-container `taskset` prefix;
OMP threads do not limit JAX startup threads. The catalog requires
48 GiB/device, CPU8 and disk250 GiB, with no fixed RAM floor. The observed ECC A6000 at
46,068 MiB/device fails that memory floor. The later quote selects one nominal
80GB H100/850-GiB root and requires >=600 GiB initially usable free for build and
full restoration. Do not lower catalog floors or add device memory together.

Stage the small YAML and retained target source through the existing input path,
require ready input states, then copy them to the YAML's absolute workspace
paths. `SOURCE` is the owned runtime source checkout, containing source fixtures.

```sh
ariax forge inputs add "$SESSION" --file "$SOURCE/science/fixtures/pxdesign/ubiquitin.yaml" --path pxdesign/task.yaml --json
ariax forge inputs add "$SESSION" --file "$SOURCE/science/fixtures/af2/templates/1ubq.cif" --path pxdesign/target.cif --json
ariax forge inputs list "$SESSION" --json
ariax forge run "$SESSION" --tool base --timeout-seconds 60 --json -- sh -lc 'mkdir -p /workspace/pxdesign/inputs; cp /inputs/pxdesign/task.yaml /workspace/pxdesign/inputs/task.yaml; cp /inputs/pxdesign/target.cif /workspace/pxdesign/inputs/target.cif'
ariax forge run "$SESSION" --tool pxdesign --gpus 0 --timeout-seconds 120 --json -- taskset -c "$QUALIFIED_CPUS" forge-pxdesign check-input --yaml /workspace/pxdesign/inputs/task.yaml
ariax forge run "$SESSION" --tool pxdesign --gpus 0 --timeout-seconds 120 --json -- taskset -c "$QUALIFIED_CPUS" forge-pxdesign parse-target --yaml /workspace/pxdesign/inputs/task.yaml -o /workspace/pxdesign/preflight
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
ColabDesign's three-recycle initial-guess/binder-template path. This is distinct
from B31's qualified ColabFold prediction, while reusing its AF2 asset.

```sh
ariax forge run "$SESSION" --tool pxdesign --gpus 0 --timeout-seconds 3600 --json -- taskset -c "$QUALIFIED_CPUS" forge-pxdesign pipeline --preset preview -i /workspace/pxdesign/inputs/task.yaml -o /workspace/pxdesign/preview-01 --N_sample 2 --N_max_runs 1 --N_step 400 --dtype bf16 --seeds 101 --num_workers 0 --analysis-workers 1 --early_stop false --use_fast_ln false --use_deepspeed_evo_attention false --eval.binder.num_seqs 1 --eval.binder.tools.mpnn.weights original --eval.binder.tools.mpnn.temperature 0.0001
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 3600 --json
ariax forge logs "$SESSION" "$COMMAND_ID" --tail 1000 --json
```

Native extended executed in the completion candidate with its specialized
assets and supplied full-query test MSAs. Its exact mode argv is:

```sh
taskset -c "$QUALIFIED_CPUS" forge-pxdesign pipeline --preset extended -i /workspace/pxdesign/inputs/task-with-msa.yaml -o /workspace/pxdesign/extended-01 --N_sample 2 --N_max_runs 1 --N_step 400 --dtype bf16 --seeds 101 --num_workers 0 --analysis-workers 1 --early_stop false --use_fast_ln false --use_deepspeed_evo_attention false
```

It first predicts the target with base-default v0.5. If target RMSD is at least
2 Å, it switches PTX evaluation to `protenix_mini_tmpl_v0.5.0`, with native target
conditioning and MSA disabled for that evaluation. Otherwise it keeps the base
model/full-target MSA route. Initial PTX defaults are four cycles, one sample,
two steps. Finalization may run selected PTX-pass candidates at twenty steps and
seed 2025. Retain that effective model/configuration, the decision artifacts and
both initial and refinement scores. The completion evidence records each branch and its actual effective settings.
`custom` leaves evaluation choices to the caller. Extra native overrides follow
preset flags, so record the final argv and effective config.
The Click default is `custom`, five samples and one run. It sets both return
caps to the explicit sample count; an upstream preset table alone does not
establish the count that ran.

Generation-only command, in the same admitted GPU envelope:

```sh
taskset -c "$QUALIFIED_CPUS" forge-pxdesign infer -i /workspace/pxdesign/inputs/task.yaml -o /workspace/pxdesign/infer-01 --N_sample 1 --N_step 400 --dtype bf16 --seeds 101 --num_workers 0 --use_fast_ln false --use_deepspeed_evo_attention false
```

Its outputs are backbone CIFs and sequence/register metadata. They establish no
sequence design, AF2/PTX evaluation or final binder selection.

## Results, decisions and mappings

Keep `config.yaml`, `pipeline_input.json`, `pipeline_state.json`, native status/
errors/logs, each `runs/run_XXX/diffusion/{structures,orig_seqs.json,length_schedule.json}`,
`runs/run_XXX/eval/TASK/{sample_level_output.csv,seqs,chain_authority.json,af2_pred,ptx_pred,ptx_mini_pred}`
and `runs/run_XXX/final/`. Retain `ptx_final_outputs` when finalization refines
candidates. Not every mode produces every directory. The patched final CSV
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
taskset -c "$QUALIFIED_CPUS" forge-pxdesign rank --dump_dir /workspace/pxdesign/preview-01 --run_id 0 --preset custom --N_sample 2 --min_total_return 2 --max_success_return 2 --dtype bf16 --use_fast_ln false --use_deepspeed_evo_attention false --eval.binder.eval_complex true --eval.binder.eval_binder_monomer true --eval.binder.eval_protenix false --eval.binder.eval_protenix_mini false
```

`rank` does not reload the original config automatically. An extended rerank also
needs its effective post-decision model/template/MSA settings, evaluation flags,
sample caps and rank weights. It can perform PTX refinement, so authorize its
GPU work explicitly. It is not a harmless CPU table sort.

B46d's source patch retains each actual AF2 complex/monomer forward as
`<candidate>_modelN.aux.pkl` beside its PDB/JSON, including native residue indices,
atom identities/coordinates, confidence arrays and unrounded metrics before PDB
remapping. Binder MPNN's complete sample return is `<backbone>.mpnn-native.pkl`
beside its input PDB. Inspect these with the matching native interpreter on the
GPU host and retain native chain authority and converted structures. Historical
completed results without these files remain unavailable; no automatic prediction
fills the gap. The existing rounded summary still cannot supply a full PAE map.
The completion candidate retains and checks these actual native forwards.
Diffusion additionally saves `native_forwards/forward_XXXXXX.pt` and stream
chunks as `sample_XXXXXX.cif.native.pt`. Native PTX saves `native-forward.pt`
before its rounded writers. Keep these files with their inputs and chain maps.
Cyclic flags affect native AF2/PTX evaluation masks; native diffusion exposes no
cyclic-closure generation option.

## Explicit selected-candidate evaluation and save

After choosing a completed snapshot and row, export its exact sequence/full-target
identity through the source helper. This requires the patched final ID columns
and native chain authority; the helper never assumes the selected candidate passed.

```sh
ariax forge run "$SESSION" --tool pxdesign --gpus 0 --timeout-seconds 120 --json -- python /opt/forge-pxdesign/export_selected.py /workspace/pxdesign/preview-01 --snapshot results --task ubq_binder --rank 1 --output /workspace/pxdesign/selection-01
ariax forge run "$SESSION" --tool protenix-models --gpus 0 --timeout-seconds 1800 --json -- taskset -c "$QUALIFIED_CPUS" forge-protenix --model_name protenix_base_default_v1.0.0 --input_json_path /workspace/pxdesign/selection-01/protenix.json --dump_dir /workspace/pxdesign/protenix-01 --use_msa false --use_template false --sample_diffusion.N_sample 1 --model.N_cycle 3 --sample_diffusion.N_step 20 --seeds 101 --dtype bf16 --need_atom_confidence true
ariax forge run "$SESSION" --tool protenix-models --gpus 0 --timeout-seconds 120 --json -- python /opt/forge-protenix-check.py /workspace/pxdesign/selection-01/protenix.json /workspace/pxdesign/protenix-01
ariax forge run "$SESSION" --tool protenix-models --gpus 0 --timeout-seconds 120 --json -- python /opt/forge-protenix-handoff.py /workspace/pxdesign/selection-01/protenix.json /workspace/pxdesign/protenix-01 --run-id "$PREDICTION_COMMAND_ID"
ariax forge run "$SESSION" --tool interface-scores --timeout-seconds 120 --json -- interface-scores "$EXACT_HANDOFF_JSON" --output /workspace/pxdesign/interface-01.json
```

Require each tool's admitted compatible image and actual native output check.
`PREDICTION_COMMAND_ID` identifies the B30 prediction, not the export command.
`EXACT_HANDOFF_JSON` is its returned same-sample handoff path. The B30 producer
derives actual token/atom/asym maps; B35 retains directional metrics and missing
values. No PAE map is inferred from the PXDesign score table. Native PXDesign
AF2 summary JSON lacks full matched residue PAE/pLDDT arrays, so it alone cannot
supply ipSAE. The exported `af2.fasta` is suitable for a separate authorized B31
prediction if that route is chosen; use its original processed token sidecars.

The B30 evaluation above uses full targets and unconditioned base-v1 prediction.
It is independent of the native cropped-target AF2 and native PTX branch scores;
it does not populate or replace native PXDesign success columns. For deliberate
grouped-template B30 evaluation, construct its explicit zero-based query/template
maps from observed coordinates and full sequences under the accepted B30 guide,
using a fresh command/output path. No implicit predictor or model substitution
occurs. A confidence score does not establish binding or experimental success.

Inspect counts, identities, flags, structures, errors and exact settings before
calling the campaign complete. After a failure, retain partial output and stop
writers before an explicit bounded continuation. Watch, restoration and tool
preparation never replay a scientific command. Changed scientific intent needs
a new output directory. Respect human holds and the original cap/deadline.

Native diffusion continuation restarts its original random seed while generating
only missing indices. In the qualified 500-index continuation, new indices
470–499 repeated the unrounded coordinates of prior indices0–29. All prior
completed bytes were preserved. This establishes the finite 500-row execution
profile, not500 independent backbones or equivalence to an uninterrupted run.
Keep that provenance and audit; use a fresh campaign when independence is required.

```sh
ariax forge sync "$SESSION" --wait --timeout 900 --json
ariax forge files "$SESSION" --path /workspace/pxdesign --checkpoint "$CHECKPOINT" --json
ariax forge close "$SESSION" --json
ariax forge status "$SESSION" --json
```


The completion matrix and outcome packet are under `science/evidence/pxdesign/`.
The pinned 5o45 example contains 129 source residues: crop116+binder80=196 and
full129+binder80=209. A separately labeled synthetic247+binder80=327 software
fixture preserves the original capacity endpoint and is not biological PD-L1.
Query-only A3Ms test supplied-MSA plumbing and provide no evolutionary evidence.


For the complete large capacity profile, retain the entire native tree in a
gzip tar and split it into ordered Files parts of at most4GiB, with a JSON
manifest listing the order and byte sizes. Keep the raw tree until full save
and restoration pass. The completion harness uses the bounded source helper
`science/src/pxdesign/archive_delivery.py` on the authorized remote host.
The tested r3 image's bundled archive helper predates the60GB bound; use the
current source helper for this large export.
Keep the closed raw tree outside the checkpoint workspace while saving the
complete part export; the remote host harness retains it separately. A single
17.98GB checkpoint exceeded its CLI wait, so use incremental stages that each
fit the existing900-second transfer limit. Save the first two4GiB parts, then
add the remaining parts with a new checkpoint. The first stage is partial; only
the final complete index represents the full scientific export. Retain failed
operations and use new IDs for explicit retries. No scientific command is replayed.
Files stores and exports every part plus the original selected inputs. After
fresh logical restoration into empty scratch/history, concatenate the parts,
unpack into `/workspace/pxdesign`, compare every native file and rerun native
output checks. The saved Files listing contains the archive parts; native
folders become available after explicit unpacking. This retains every array,
rejected row and failed attempt while keeping the ordinary Files transfer path.
The small raw-tree profile passed 2,071 files / 2,765,104,061 bytes; broader
individual-file checkpoint throughput is not inferred from that observation.
