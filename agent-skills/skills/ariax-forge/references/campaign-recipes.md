# Forge campaign recipes and Adaptyv handoff

Use these recipes to generate protein or antibody candidates, evaluate an exact
candidate against the full target, and save a review for a later experiment.
Choose inputs, counts and review criteria for the user's scientific objective
and authorized compute allowance. The small examples illustrate commands and
file formats; bundled fixtures are not customer results or experimental hit rates.

Consult [saved outputs](../outputs.md), [campaign planning](../../../core/campaigns.md)
and [interpretation](../../../core/interpretation.md) as needed. Read the selected
tool's guide and live mode/resource information before running it. Native Forge
executables and hosted managed protocols have separate contracts.

## Choose the scientific route

Record the target construct, biological assembly/state, epitope, binder format,
source chain/residue register, missing positions, glycan/cofactor context and
assay objective. Keep an author-to-model residue map for a crop. Inspect poses
against the full target context before export: a crop can expose a surface
absent from the intact protein. Agree on generated volume, desired accepted
count, attempt cap, GPU/time allowance and review point before compute.

| Route | When to use it | Meaningful constraints |
| --- | --- | --- |
| [BoltzGen](../tools/boltzgen.md) | Protein design followed by native inverse folding and complex/binder refolds | Match the protocol/checkpoints, preserve native filters and use saved design masks for chain roles. |
| [FreeBindCraft](../tools/freebindcraft.md) | Target-conditioned binder optimization with OpenMM or PyRosetta | Use complete settings/filters; PyRosetta requires its separately authorized mount and terms. |
| [RFantibody](../tools/rfantibody.md) | Paired VH/VL or VHH CDR design, sequence design and RF2 prediction | Use a supported construct/count profile, native HLT annotations and explicit numbering maps. |
| [Genie3](../tools/genie3.md) | Scaffold generation with motif or target conditioning, followed by CA-only MPNN and prediction | Preserve fixed residues, sampled scaffold maps and the selected mode's native success criteria. |
| [Native PXDesign](../tools/pxdesign.md) | A joined design/prediction pipeline with preview or extended settings | Inspect the exact preset, checkpoint, MSA/template requirements and native export conditions. |
| [Native ESMFold2 pipeline](../tools/esmfold2-pipeline.md) | Experimental design/critic with integrated Protenix validation | Internal-development scope is bounded to at most 318 polymer residues/eight design steps; custom scFv validation needs a supported structural framework. |

The live selected-tool record supplies actual keys, model choices, mode limits
and resource floors. A guide or compact entry alone does not establish that a
mode is available. Unknown floors remain unknown.
AF3 is outside Ariax support. RFantibody requires its specialized RFdiffusion_Ab,
not standalone original RFdiffusion. Tool/model license and attribution notices
in the linked native guides apply to every route.

## Setup and command lifecycle

Discover by task, then inspect each selected tool and its guide:

```sh
ariax forge catalog --task binder-design --compact --json
ariax forge catalog --tool boltzgen --model BoltzGen-0.2.0 --mode protein-anything --json
ariax skills forge --tool boltzgen --json
ariax skills forge --reference boltzgen --read --json
ariax forge catalog --tool protenix-models --model protenix_base_default_v1.0.0 --mode protein-complex --json
ariax forge catalog --tool interface-scores --json
ariax pricing --json
```

For antibody work use task `antibodies` and tool `rfantibody`; read that tool's
scoped guide. Read other selected guides in the same way. Set `FORGE_SKILL` to
the installed directory containing `SKILL.md`, the parent of scoped discovery's
`data.skill`. Its `data.examples` gives the selected tool's example paths.
Campaign helper paths can be derived without loading the entire skill index:

```sh
BG="$FORGE_SKILL/tools/boltzgen"
CAMPAIGNS="$FORGE_SKILL/tools/examples/campaigns"
```

CLI orchestration and small source uploads can run on the workstation. Every
Python/helper/native command below runs remotely through `forge run`. Keep
environments, dependencies, images, weights and bulk scientific outputs remote.
Keep API/registry/R2 credentials outside workloads, argv, logs and saved source;
use the existing grant/transfer path and named shared assets.

The joined BoltzGen/Protenix example requests one H100-class GPU, 100 GiB RAM,
eight CPUs and 250 GiB disk. Protenix requires 48 GiB VRAM and has no fixed
catalog RAM floor; the 100-GiB request is an example allocation, not a measured minimum.
Assess all selected tools and the actual input size before creation; this request
does not establish a smaller BoltzGen hardware minimum. Set `GPU` from current
pricing/availability and `GPU_HOURS` from the approved total limit:

```sh
ariax forge create --name "Protein binder pilot" --gpu "$GPU" --gpu-count 1 --min-ram-gib 100 --min-cpu-count 8 --min-disk-gib 250 --tools boltzgen,protenix-models,interface-scores --priority boltzgen --max-gpu-hours "$GPU_HOURS" --json
ariax forge status "$SESSION" --json
ariax forge tools wait "$SESSION" base --timeout 600 --json
ariax forge tools wait "$SESSION" boltzgen --timeout 1800 --json
```

Set `SESSION` from the actual create response. Creating or resuming allocates
paid resources; preparation and idle time consume the allowance. Command
completion does not close the session. Keep the same CLI root directory,
account and API origin for recovery. Set `CPU_SET` to eight CPU indices assigned
to the workload, for example `0-7`; thread variables alone do not constrain
JAX startup on a wide guest.

Require host `available`, requested tool `ready` and every staged input `ready`.
`inputs add` returns an asynchronous import ID. Set `INPUT` to each returned ID
and inspect it before dependent work:

```sh
ariax forge inputs list "$SESSION" --json
ariax forge inputs status "$SESSION" "$INPUT" --json
```

After **each** `forge run`, set `COMMAND` to its returned durable command ID and
observe it before submitting the next dependent step:

```sh
ariax forge watch "$SESSION" "$COMMAND" --timeout 1800 --json
ariax forge command "$SESSION" "$COMMAND" --json
ariax forge logs "$SESSION" "$COMMAND" --tail 1000 --json
```

Read state, exit code, native logs and expected files together. Watch timeout
or Ctrl-C leaves remote work running. After an uncertain reply, inspect the
original ID; if redelivery is needed, use `--command-id` with that ID and identical
fields. Reconcile saved create, selection, input and sync requests in the
same way. A fresh ID means new work. Never automatically rerun inference. Use a
fresh output directory for an authorized new attempt; keep failed/interrupted
attempts and unreached stages.

## Protein binder: generation and review

Use BoltzGen for designed sequences with native complex and binder-only refolds.
Prepare a YAML for the selected protocol and stage every structure companion at
the path named in that YAML. This example designs B while retaining target A:

```yaml
entities:
  - protein:
      id: B
      sequence: 40
  - file:
      path: target.cif
      include:
        - chain:
            id: A
```

Here `40` is an illustrative designed length. Set target chain, designed region
and length for the approved case; preserve its sequence and residue map.
`DESIGN_YAML` and `TARGET_CIF` are the actual small local source/input files:

```sh
ariax forge inputs add "$SESSION" --file "$DESIGN_YAML" --path boltzgen/design.yaml --json
ariax forge inputs add "$SESSION" --file "$TARGET_CIF" --path boltzgen/target.cif --json
```

After both imports are ready, run once in a fresh output directory. This small
example requests two designs and a selected-set budget of one. It explicitly
reduces the native five-sample refold setting to one; choose the scientifically
intended settings rather than treating this size as a default:

```sh
ariax forge run "$SESSION" --tool boltzgen --gpus 0 --timeout-seconds 1800 --json -- taskset -c "$CPU_SET" forge-boltzgen --seed 7 run /inputs/boltzgen/design.yaml --output /workspace/boltzgen/pilot1 --protocol protein-anything --num_designs 2 --budget 1 --devices 1 --num_workers 0 --cache /scratch/cache --moldir /models/boltzgen/mols --design_checkpoints /models/boltzgen/boltzgen1_diverse.ckpt --inverse_fold_checkpoint /models/boltzgen/boltzgen1_ifold.ckpt --folding_checkpoint /models/boltzgen/boltz2_conf_final.ckpt --config folding diffusion_samples=1 --config design_folding diffusion_samples=1 --config analysis num_processes=2 --config filtering top_budget=2
```

Inspect `final_ranked_designs/all_designs_metrics.csv`, native pass flags,
resolved stage settings, masks, sequences, refold CIFs and raw NPZ arrays. Join
by native candidate ID and same-ID files; rank is a separate field. Use design
masks and author/label-chain maps for target/binder roles. Alphabetical chain
order, rank and array size do not establish that mapping. Inverse-folded
sidechains can be zero placeholders; evaluate actual refolds.

Check target/binder sequences and residue correspondence, completed stage
counts, finite coordinates, confidence dimensions/units and same-sample
structure/array identity. Record planned, attempted and completed backbones,
sequences, complex refolds, binder-only refolds, ranked rows and passing rows
separately. Native `budget=1` is a selected-set size, not dollars or a guaranteed
pass. Keep native filtering thresholds and unavailable metrics. Use the selected
guide for the native CIF coordinate/confidence sample convention.

For the bundled two-design ubiquitin example only, `$BG/check.py` checks the
fixed 76-residue target/40-residue binder and that exact output layout. It is
not a general checker for a new target or count. To reproduce that example,
stage `ubiquitin.yaml`, `1ubq.cif` and `check.py` together under `/inputs/boltzgen`,
and run the native command above with that YAML. Then save its checker report:

```sh
ariax forge run "$SESSION" --tool boltzgen --gpus 0 --timeout-seconds 180 --json -- sh -lc 'python3 /inputs/boltzgen/check.py /workspace/boltzgen/pilot1 > /workspace/boltzgen/pilot1/native-check.json'
```

With a matching checker report, the selector cross-checks candidate IDs,
sequences and decisions against the native CSV. It writes all rows to
`review.json` without selecting a candidate unless explicitly asked:

```sh
ariax forge inputs add "$SESSION" --file "$CAMPAIGNS/boltzgen-select.py" --path campaigns/boltzgen-select.py --json
ariax forge run "$SESSION" --tool base --timeout-seconds 60 --json -- python3 /inputs/campaigns/boltzgen-select.py /workspace/boltzgen/pilot1 --check /workspace/boltzgen/pilot1/native-check.json --out /workspace/campaigns/protein-review
ariax forge run "$SESSION" --tool base --timeout-seconds 60 --json -- python3 /inputs/campaigns/boltzgen-select.py /workspace/boltzgen/pilot1 --check /workspace/boltzgen/pilot1/native-check.json --out /workspace/campaigns/protein-export --candidate "$CANDIDATE"
```

Wait for the helper import and observe each command. Choose `CANDIDATE` from
actual checked passing IDs in the review. The helper refuses failed decisions;
deliberate diagnostic inspection requires `--review-rejected` and retains
`rejected-review/` labeling. An accepted selection retains same-ID complex
CIF/NPZ, binder/target FASTAs, binder-only refold, settings/masks, checker report
and selection record. For other input layouts use checks/exports appropriate
to the actual mode; these fixture helpers do not establish coverage for them.
Ranking or a nonempty export alone does not make a candidate pass.

## Full-target evaluation and directional scoring

Use independent Protenix prediction to inspect a selected sequence's fold and
placement. Preserve generation-stage results; a new confidence score does not
reverse a native rejection. For a cropped design, supply the authorized full
target sequence/assembly and residue map and record the changed construct.

Prepare native Protenix JSON with the exact checked target/binder sequences.
For a protein pair, assign target A and binder B with `proteinChain` entries
containing explicit `id`, `count` and `sequence`. Save a chain-role sidecar
linking evaluation chains to the original candidate, generation map and decision.
Keep extraction from generated outputs and input preparation on the VM. The
upload commands below apply to caller-supplied small JSON files; for an input
prepared remotely, use its actual `/workspace` path in the prediction/check
commands instead of uploading or downloading generated results.
`EVALUATION_JSON` and `CHAIN_ROLES_JSON` name the caller-supplied files:

```sh
ariax forge inputs add "$SESSION" --file "$EVALUATION_JSON" --path protenix/evaluation.json --json
ariax forge inputs add "$SESSION" --file "$CHAIN_ROLES_JSON" --path protenix/chain-roles.json --json
ariax forge tools wait "$SESSION" protenix-models --timeout 1800 --json
ariax forge tools wait "$SESSION" interface-scores --timeout 1800 --json
ariax forge run "$SESSION" --tool protenix-models --gpus 0 --timeout-seconds 1800 --json -- forge-protenix --model_name protenix_base_default_v1.0.0 --input_json_path /inputs/protenix/evaluation.json --dump_dir /workspace/campaigns/evaluation/prediction --use_msa false --sample_diffusion.N_sample 1 --sample_diffusion.N_step 20 --model.N_cycle 3 --seeds 101 --need_atom_confidence true
```

Require both inputs ready. This selects public v1, three cycles/20 steps, one
sample and no MSA/template. Larger/default-setting workloads need their own
capacity assessment; same-seed reruns can differ. Set `PREDICTION_COMMAND` to
the actual prediction command ID. After completion, check all requested
items/seeds/samples and export the same-sample confidence handoff:

```sh
ariax forge run "$SESSION" --tool protenix-models --gpus 0 --timeout-seconds 120 --json -- python /opt/forge-protenix-check.py /inputs/protenix/evaluation.json /workspace/campaigns/evaluation/prediction
ariax forge run "$SESSION" --tool protenix-models --gpus 0 --timeout-seconds 120 --json -- python /opt/forge-protenix-handoff.py /inputs/protenix/evaluation.json /workspace/campaigns/evaluation/prediction --run-id "$PREDICTION_COMMAND"
```

Inspect both results. Set `HANDOFF` to the actual exported
`*_handoff_sample_0.json` workload path linked to the same model, seed, sample,
CIF and unrounded confidence. Token splitting can make it unavailable; keep
the reason and stop the complete scoring claim. Never fabricate a
one-token-per-residue map or repair dimensions.

```sh
ariax forge run "$SESSION" --tool interface-scores --timeout-seconds 120 --json -- interface-scores "$HANDOFF" --output /workspace/campaigns/evaluation/interface.json --pae-cutoff 10
```

Inspect the result remotely or through a current project link. Preserve
A→B (target row/binder column) and B→A values: PAE is directional. ipSAE takes
a row-specific maximum at PAE strictly below 10 Å. pDockQ is symmetric with
CB/glycine-CA contacts ≤8 Å; pDockQ2 uses directional PAE and can exceed one.
LIS uses PAE ≤12 Å. Unordered aggregates use max-of-directions for
ipSAE/pDockQ/pDockQ2 and mean-of-directions for LIS. A requested `ipSAE_min`
is a separately labeled minimum of two available directions. Missing
PAE/pLDDT/contact atoms produce null with a reason; defined zero stays zero.
Monomers have `no_protein_interface`. Preserve native pair versus complex ipTM.
See [the scorer](../tools/interface-scores.md) and [metric definitions](ipsae-metrics.md).

Protenix raw atom pLDDT is 0–1, summary pLDDT/PDB B-factors use 0–100 and raw
PAE is Å. Native BoltzGen pLDDT is fractional; binder-only interaction and
protein-only ligand scores retain inapplicable zero/sentinel meanings. Do not
fill missing arrays with B-factors or substitute small-molecule affinity for
protein-binder affinity. Confidence, pose agreement and rank do not demonstrate
binding or specificity.

## FreeBindCraft alternative

Use FreeBindCraft for its native target-conditioned optimization. Read its guide,
select OpenMM or authorized PyRosetta, and prepare complete target/settings,
advanced and filter files. The [example settings](../tools/examples/freebindcraft/b45/settings-openmm.json)
show the format; set target, chains, hotspots, binder length, counts and a fresh
`design_path` for the approved case. The example checker is specific to its
bundled inputs; check actual outputs against your declared construct and settings.

```sh
ariax forge tools add "$SESSION" --tools freebindcraft --json
ariax forge tools wait "$SESSION" freebindcraft --timeout 1800 --json
ariax forge inputs add "$SESSION" --file "$TARGET_PDB" --path freebindcraft/target.pdb --json
ariax forge inputs add "$SESSION" --file "$SETTINGS_JSON" --path freebindcraft/settings.json --json
ariax forge inputs add "$SESSION" --file "$ADVANCED_JSON" --path freebindcraft/advanced.json --json
ariax forge inputs add "$SESSION" --file "$FILTERS_JSON" --path freebindcraft/filters.json --json
ariax forge run "$SESSION" --tool freebindcraft --gpus 0 --timeout-seconds 3600 --json -- freebindcraft --settings /inputs/freebindcraft/settings.json --advanced /inputs/freebindcraft/advanced.json --filters /inputs/freebindcraft/filters.json --no-pyrosetta --no-plots --no-animations --verbose
```

Require all inputs ready; settings must reference the staged target path.
This command selects OpenMM. Follow the guide's license/mount requirements
and command for PyRosetta. Join CSV `Design` to the FASTA/stem before `_modelN`,
exact selected model and native arrays/map. Keep attempted/completed, failed
and unreached stages distinct. Rejected CSV fields can be failure indicators.
OpenMM Rosetta-energy/H-bond placeholders and fallback shape-complementarity
values remain uncomputed. ColabDesign CSV PAE is normalized while raw PAE is Å;
PyRosetta energies are not experimental binding free energies. Share rejection
tables and native array/settings files when no accepted structure exists.

## Antibody or nanobody: design, prediction and export

Use RFantibody for CDR design in paired VH/VL or VHH frameworks. Its documented
profile needs at least 44 GiB reported VRAM, 48 GiB RAM, eight CPUs and 250 GiB
disk. Assess the selected construct/count profile in its guide before running.
Stage target/framework in native HLT format: H/L for paired VH/VL, H for VHH,
and target T. Preserve CDR annotations, amino acids, hotspots and source numbering.
Retain numbering sidecars and explicit correspondence when mapping another scheme
or insertion codes into native integer labels. A length-changing CDR retains
its region map without invented individual source-residue correspondence.

```sh
ariax forge tools add "$SESSION" --tools rfantibody --priority rfantibody --json
ariax forge tools wait "$SESSION" rfantibody --timeout 1800 --json
ariax forge inputs add "$SESSION" --file "$RF_TARGET_PDB" --path rfantibody/target.pdb --json
ariax forge inputs add "$SESSION" --file "$FRAMEWORK_PDB" --path rfantibody/framework.pdb --json
ariax forge inputs add "$SESSION" --file "$CAMPAIGNS/rfantibody-select.py" --path campaigns/rfantibody-select.py --json
```

Require all imports ready. Set `RF_ROOT` to a fresh workload path such as
`/workspace/rfantibody/paired` or `/workspace/rfantibody/vhh`. Set `DESIGN_LOOPS`
to approved lengths and `LOOPS` to corresponding native names. Fixed-length
paired design can select all six H/L CDRs; VHH uses H1/H2/H3. Set `HOTSPOTS`
to original target labels, or omit that option for native optional-hotspot
behavior. This example requests one backbone/two sequences:

```sh
ariax forge run "$SESSION" --tool rfantibody --gpus 0 --timeout-seconds 1800 --json -- taskset -c "$CPU_SET" rfantibody generate --target /inputs/rfantibody/target.pdb --framework /inputs/rfantibody/framework.pdb --out "$RF_ROOT/generate" --design-loops "$DESIGN_LOOPS" --hotspots "$HOTSPOTS" --steps 50 --num-designs 1 --deterministic
ariax forge run "$SESSION" --tool rfantibody --gpus 0 --timeout-seconds 600 --json -- taskset -c "$CPU_SET" rfantibody sequence --input "$RF_ROOT/generate/pdbs" --out "$RF_ROOT/sequence" --loops "$LOOPS" --num-sequences 2 --temperature 0.1 --deterministic
ariax forge run "$SESSION" --tool rfantibody --gpus 0 --timeout-seconds 1800 --json -- taskset -c "$CPU_SET" rfantibody predict --input "$RF_ROOT/sequence/pdbs" --out "$RF_ROOT/predict" --recycles 10 --seed 0 --hotspot-show-proportion 0.1
```

Observe every stage. This uses RFdiffusion_Ab.pt, native
ProteinMPNN_v48_noise_0.2.pt and RF2_ab.pt under `/models/rfantibody`; optional
AbMPNN does not replace the sequence checkpoint. Diffusion uses design-index
seeds, deterministic sequence design uses seed 42 and RF2 uses seed 0. Ten
recycles give eleven model passes. Keep each stage's identity, `stage.json`,
TRB/settings, sampled sequences/SCORE records and raw arrays.

Set `DESIGN_ID` and `SEQUENCE_ID` to actual native stems. Check **every** sequence
after prediction, saving `checks/SEQUENCE_ID.json` for the selector. Submit
checks sequentially; they reserve the same GPU. For saved outputs inspect
existing reports first and use fresh paths for deliberate rechecks:

```sh
ariax forge run "$SESSION" --tool rfantibody --gpus 0 --timeout-seconds 60 --json -- rfantibody-check --framework /inputs/rfantibody/framework.pdb --target /inputs/rfantibody/target.pdb --generated "$RF_ROOT/generate/pdbs/$DESIGN_ID.pdb" --sequenced "$RF_ROOT/sequence/pdbs/$SEQUENCE_ID.pdb" --predicted "$RF_ROOT/predict/pdbs/${SEQUENCE_ID}_best.pdb" --loops "$LOOPS" --out "$RF_ROOT/checks/$SEQUENCE_ID.json"
ariax forge run "$SESSION" --tool base --timeout-seconds 60 --json -- python3 /inputs/campaigns/rfantibody-select.py /workspace/rfantibody --out /workspace/campaigns/antibody-review
ariax forge run "$SESSION" --tool base --timeout-seconds 60 --json -- python3 /inputs/campaigns/rfantibody-select.py /workspace/rfantibody --out /workspace/campaigns/antibody-export --candidate "$CANDIDATE"
```

Choose `CANDIDATE` from the review including its profile directory, so identical
paired/VHH stems cannot collide. The selector needs the documented native
PDB/stage/check layout; it is not a Quiver or arbitrary RF2 JSON adapter.
Export a passing row directly; diagnostic export of a failure requires
`--review-rejected`.

The checker verifies sequence identity, sequence-stage backbone, generation
geometry, array/PDB rounded means and H/L/T residue correspondence. The screen
requires pred_lddt >0.9, interaction PAE <10 Å, target-aligned antibody RMSD <2 Å
and generation geometry within 0.05 Å. Exit zero can accompany
`filter.accepted=false`. `interaction_pae` averages all interchain pairs,
including VH/VL. Arrays use T/H/L (VHH T/H); PDBs use H/L/T (VHH H/T).
Use `confidence_residue_map`, zero-based array indices and source/native residue
maps. VHH light-chain CDR RMSDs remain unavailable, not zero. RF2 interface
scoring needs a supported adapter; do not feed its arrays to an AF2 adapter.

Exports retain prediction PDB/NPZ, generated/sequenced structures, stage records,
screening/mapping reports and full H/L/T FASTAs. Keep paired H/L separate,
VHH framework plus CDRs intact and target T alongside the binder. No linker,
constant region or assay construct follows automatically from an Fv. A passing
computational screen still requires scientific and experimental review.

## Motif scaffolds and other joined routes

For motif scaffolding stage the selected [Genie3](../tools/genie3.md) config,
problem JSON and annotated motif PDB companions at their referenced paths.
Use the guide's complete commands through `forge run` in this order:

1. In `genie3`, run `genie3-generate --config CONFIG`, then
   `genie3-handoff prepare --pdb PDB --mode motif --out HANDOFF_DIR`.
2. In `proteinmpnn`, run `mpnn-prepare` with the handoff's `ca.pdb` and `plan.json`
   and `--ca-only`. Run `proteinmpnn` with `--ca_only --model_name v_48_020`,
   explicit seed/count/settings, then `mpnn-check`.
3. In `genie3`, run `genie3-handoff sequence` with that handoff, prepared directory
   and actual sampled FASTA. Predict its output in `boltz2` using the guide's
   settings. Observe every dependent command before continuing.

Retain `scaffold_info.tsv`, fixed-position masks, source maps, generation arrays,
MPNN sequences/probabilities/scores and final prediction arrays/structures.
Verify known motif residues/sequence are fixed while native UNK positions stay
designable; preserve masked missing source atoms. Native motif success requires
scaffold CA RMSD <2 Å and motif backbone RMSD <1 Å, with all-atom RMSD <2 Å or
strict <1 Å. Missing predictor-specific binder metrics remain unavailable.
Target conditioning alone does not establish binding. `--finalize-existing`
only completes metadata from matching retained `request.yaml` and generated
files. The bundled `genie3-motif-select.py` is restricted to its retained fixture,
not new motif designs. Preserve the [Apache-2.0 notice](../tools/genie3/LICENSE).

[PXDesign](../tools/pxdesign.md) uses `forge-pxdesign check-input`, `parse-target`
then `pipeline` with the chosen preset. Preview uses native ColabDesign MPNN/AF2.
Preserve `(task_name, run_idx, name, seq_idx)`, the completed `results`/`results_vN`
manifest, all/filtered/by-run tables, chain/register maps and chosen structure.
Failed rows can pad `min_total_return`; bucket/rank/return count cannot replace
`pass_af2`/`pass_ptx`. Extended needs its mini-template asset and full-query MSAs
and can select a different PTX model based on target RMSD. Assess it independently.

[The ESMFold2 pipeline](../tools/esmfold2-pipeline.md) uses `check`, `plan`, an
explicit shard, saved status, deliberate remaining-shard continuation and
matching `validate`, `aggregate`, `select`/`export`. Two seeds mean two total
candidates, not two per framework. Keep `campaign.sqlite`, status counts,
candidate → validation ID → model/seed/sample, `validation_chain_role_map`,
complete critic/validation tables and final ranking. Integrated validation
requires Protenix v2; independent v1/AF3 predictions cannot fill native rows.
Missing confidence stays unavailable. Rank can use absent ipSAE only with native
basis/warnings; missing required RMSD or failed validation excludes the row.
A nonempty export does not establish completeness.

For ligand-conditioned work consult [Foundry](../tools/foundry.md) and
[Proteina-Complexa](../tools/proteina-complexa.md). Preserve ligand atoms,
bond/SMILES and native token maps. A protein-only predictor cannot evaluate a
ligand it dropped. A zero bond matrix does not establish complete topology.
Standard-protein interface scoring can explicitly exclude chemical tokens;
ligand-interface scores remain outside its calibration. [OpenDDE-Harness](../tools/opendde-harness.md)
and [Protein-Hunter](../tools/protein-hunter.md) retain their adapters, credential
boundaries and native acceptance gates.

## Save, share, human hold and resume

Keep source inputs, settings, stage records, failures, sequences, structures,
raw confidence, maps and review tables in saved inputs or `/workspace`.
Stop all workspace writers before saving:

```sh
ariax forge sync "$SESSION" --wait --timeout 900 --json
```

Require the flush state `saved`, then inspect/link saved
files. `STRUCTURE_PATH` is the actual selected workload path:

Set `PROJECT` to the session's returned `project_id`.

```sh
ariax forge files "$PROJECT" --path /workspace/campaigns --json
ariax forge link "$PROJECT" /workspace/campaigns/protein-review/review.json --json
ariax forge link "$PROJECT" "$STRUCTURE_PATH" --json
```

For antibody work use its actual review/export paths. Share rejection tables
and partial-stage records if there is no accepted structure. Each link returns
an authorized project-page URL for the current path; include it in
the handoff, noting that later updates can change the linked bytes. The page previews uncompressed PDB/CIF/mmCIF ≤10,000,000 bytes.
Make any decompressed preview copy on the VM and save it beside the original.
Keep structures/arrays/bulk files remote. Use `forge download ... --dest ...`
only on an authorized remote host for restore/analysis; downloaded files publish
atomically after the complete byte count.

Set `PROJECT` from the session's actual `project_id`. Human pause on the
project page establishes `human_resume_required`. Stop this project's work,
provide its page link and explain that **Allow agent to resume** is required.
API-key CLI requests cannot clear it. Wait for web approval and direction;
approval itself leaves compute unallocated. Agent-requested
`ariax pause "$PROJECT" --json` is a distinct control. Do not bypass a hold
with a replacement project. Abort/delete is terminal.

```sh
ariax forge project "$PROJECT" --json
ariax forge status "$SESSION" --json
ariax forge activity "$PROJECT" --limit 50 --json
```

Inspect cleanup and the current synchronization state. A final-save failure can
release compute while leaving unsaved changes unavailable. Read `output_available`, `output_complete`, `output_truncated`
and `output_error` together. A captured empty tail is available; complete
terminal output can still omit its prefix. Activity saves command/control
events, not private agent conversations.

After source resource release and any required web approval, read
`control.revision` into `REVISION`. Choose hardware, tools and renewed
allowance explicitly. The joined protein example is:

```sh
ariax forge resume "$PROJECT" --control-revision "$REVISION" --gpu "$GPU" --gpu-count 1 --min-ram-gib 100 --min-cpu-count 8 --min-disk-gib 250 --tools boltzgen,protenix-models,interface-scores --priority boltzgen --max-gpu-hours "$RESUME_GPU_HOURS" --json
ariax forge status "$RESUMED" --json
ariax forge tools wait "$RESUMED" base --timeout 600 --json
ariax forge tools wait "$RESUMED" boltzgen --timeout 1800 --json
ariax forge run "$RESUMED" --tool base --timeout-seconds 60 --json -- python3 -c 'import json; from pathlib import Path; p=Path("/workspace/campaigns/protein-review/review.json"); r=json.loads(p.read_text()); print(json.dumps({"saved_review":str(p),"accepted_count":r["accepted_count"],"selected_ids":r["selected_ids"]}))'
```

Set `RESUMED` from the actual resume response; inspect the saved-file command
before new work. For RFantibody choose its tool, floors and review path.
Inputs/workspace return; scratch environments and model mounts need normal
preparation. [Custom code](custom-code.md) needs saved source/bootstrap and
explicit remote scratch recreation. Resume never replays scientific commands.
A stale revision or definitive hold rejection needs fresh inspection and a
new deliberate request; uncertain acceptance reuses the original ID and fields.

At completion close each owned session, including resumed sessions. Verify
`closed` and resource release separately from save success:

```sh
ariax forge close "$RESUMED" --json
ariax forge status "$RESUMED" --json
ariax forge project "$PROJECT" --json
```

## Adaptyv handoff: computation to a reviewed experiment

QC inspiration: Adaptyv's [protein-qc](https://github.com/adaptyvbio/protein-design-skills/blob/59dd63374314baa2fb1f9864f190775bd7466647/skills/protein-qc/SKILL.md)
and [ipSAE](https://github.com/adaptyvbio/protein-design-skills/blob/59dd63374314baa2fb1f9864f190775bd7466647/skills/ipsae/SKILL.md)
guides. Use actual native outputs, units and unchanged filters; those sources
do not supply universal thresholds, composite weights or automatic scale-up
authority for another predictor.

Separate folding/pose confidence, interface evidence and expression liabilities.
Inspect cysteines, potential glycosylation/deamidation motifs, exposed hydrophobic
or charged patches, tags/linker interference and assembly context. Record
uncertainty: sequence motifs alone do not establish exposure or expression,
and unavailable stability/Rosetta metrics cannot be filled with constants.
Keep native filtering distinct from any agreed experimental selection rationale.

Prepare a review table remotely with candidate ID, full sequence(s), construct
format, target/register, generation/evaluation model, seed/sample, original
pass/rejection flags, unavailable metrics, selection rationale and current
structure/settings links, recording that linked paths can change. Keep failed rows. If no row passes, report no
computationally accepted shortlist; a deliberate negative/diagnostic experiment
needs its own rationale and authority. A zero-pass result does not establish
that the target cannot be designed.

Submit full FASTA for a selected minibinder or VHH, including VHH framework.
Paired variable Fv chains are not complete Fab/scFv/IgG constructs. Keep H/L
paired; a Fab needs complete heavy/light constructs and an scFv needs explicit
linker/orientation and renewed evaluation. Adaptyv supports minibinders, VHH,
scFv and paired Fabs and excludes intact bivalent IgGs. Confirm current
[format and tag requirements](https://docs.adaptyvbio.com/docs/experiment-setup/supported-protein-formats)
before submission.

Match assay and computational target sequence/domain, oligomeric state,
glycosylation and tags. Confirm sourcing, separate target reagent cost, tag
compatibility and any feasibility check. An Fc tag can change apparent affinity
through avidity. See [target guidance](https://docs.adaptyvbio.com/docs/experiment-setup/target-proteins).

With disclosure/submission authority, use the [Foundry Portal](https://foundry.adaptyvbio.com)
to draft the actual assay/target, upload named FASTA or mapped name/sequence CSV,
designate controls and inspect parsed sequences. Choose replicates/requirements.
Binding orders require 24 distinct sequences per target; replicates do not fill
that minimum. Arrange smaller pilots rather than expanding generation to fill
an order. Move to review within scope, inspect the final quote, target costs,
assay/format, deliverables and timeline, and obtain purchase authority if missing.
Confirmation commits the quote. Recheck [experiment creation requirements](https://docs.adaptyvbio.com/docs/experiment-setup/creating-experiments)
for the actual order. Forge compute authority does not authorize disclosure or
an experimental purchase.

After an authorized experiment join lab sequence/replicate IDs to submitted
FASTA and native candidate keys. Retain assay method, concentrations, controls,
expression, fit quality and measured kinetics beside computational scores.
Preserve unexpressed, nonbinding, censored and fit-failed rows with lab status.
Keep raw/fit sensorgrams and replicate metadata remote. Record experiment/result
identity, data version and original-to-lab name maps; packages can be revised and
filenames sanitize sequence names. See the [binding data package](https://docs.adaptyvbio.com/docs/experiment-setup/binding-data-package).
Biological conclusions require these experimental data.
