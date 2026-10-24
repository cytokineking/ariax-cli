# Forge campaign recipes and Adaptyv handoff

The finite joined campaign completed native execution, managed installation and
full Files/R2 restoration on October 10. Protein P1/P2/P3, motif M1/M2, antibody
A1 and ligand L1/L2 retain their native outcomes. The original rejected motif
and ligand outcomes remain rejected. M2 preserves twelve fixed positions in its
75-residue sequence; L1 retains all 38 OQO heavy atoms and matched RF3 inputs.

The installed commands below cover those bounded joins. Later source/model
changes, new cohorts and additional modes need their own evidence. Genuine
human/agent workflow acceptance has its separate scope. Each command uses the
session's stated compute allowance.

Read [the scope map](catalog.md), [saved outputs](../outputs.md),
[shared campaign planning](../../../core/campaigns.md) and
[interpretation](../../../core/interpretation.md). All 25 retained SCI packages
remain required; these two recipes cover selected cases. Standalone original
RFdiffusion SCI-16 is retired. RFantibody's specialized RFdiffusion_Ab is required.
Chai-1 remains unavailable. The selected Protenix v2 native cases and private delivery are documented in its current guide. AF3 is outside Ariax support.

## Choose the case and review point

Record the exact target construct, biological assembly/state, epitope, intended
binder format, source chain/residue register, missing positions, glycan/cofactor
context and assay objective. Keep an author-to-model residue map for a crop.
Inspect shortlisted poses against the full target context before export. A crop
can expose a surface absent from the intact protein. Agree on generated volume,
accepted target, attempt cap, GPU/time allowance and review point before compute.
Use the user's existing scope. The two-candidate fixtures below are execution
pilots, with no experimental hit-rate expectation. Do not silently expand them
to the larger pilot sizes in the shared planning reference.

| Route | Use and accepted settings | Gate before this recipe can run |
| --- | --- | --- |
| [BoltzGen](../tools/boltzgen.md) | Full-target protein design, native BoltzIF and complex/binder refolds in the documented cases | Ready tool and matching named assets; preserve native filters and chain maps. |
| [FreeBindCraft](../tools/freebindcraft.md) | PD-L1 A115/B80 native defaults with explicit OpenMM or PyRosetta | Select the documented authorized PyRosetta mount when using that route. |
| [RFantibody](../tools/rfantibody.md) | Paired VH/VL and VHH profiles, native CDR sequence design and RF2 prediction | Keep the eight declared profile identities and native rejection. |
| [Genie3](../tools/genie3.md) | Explicit CA-only MPNN/Boltz handoff, target evaluation, search and refinement | Select the documented finite profile and unchanged motif filters. |
| [Native PXDesign](../tools/pxdesign.md) | Preview/extended and finite continuation profiles | Follow the current checkpoint and native export terms; use the documented profile. |
| [Native ESMFold2 pipeline](../tools/esmfold2-pipeline.md) | Experimental design/critic with matching Protenix validation | At most 318 residues/eight design steps in accepted internal-development scope; retain custom-scFv restriction. |

The live catalog supplies actual keys, source/model metadata and resource
floors. A guide or candidate entry does not admit a tool. Unknown floors remain
unknown. Do not substitute a hosted managed skill for a native Forge executable.
Standalone `ariax skills boltzgen`, `pxdesign` and `esmfold2-pipeline` retain
their hosted managed protocols and existing scope.

## Common setup and command discipline

CLI orchestration and small source uploads can run on the workstation. Every
Python/helper/native command in these recipes runs inside the remote workload
through `forge run`. No local environment, tests, scientific dependencies,
images, weights or bulk outputs are needed. Keep API/registry/R2 credentials
outside scientific workloads, argv, logs and retained source. Ariax manages
ordinary private tags and named assets; use its existing grant/transfer path.

Read the installed paths and actual deployment before creating anything:

```sh
ariax skills forge --json
ariax skills forge --reference catalog --read --json
ariax skills forge --reference outputs --read --json
ariax forge catalog --details --json
```

Set `FORGE_SKILL` to the absolute installed directory containing this skill's
`SKILL.md` (the parent of discovery's `data.skill`). `BG` is `$FORGE_SKILL/tools/boltzgen`, `RF` is
`$FORGE_SKILL/tools/rfantibody`, `CAMPAIGNS` is
`$FORGE_SKILL/tools/examples/campaigns`, and `EXAMPLES` is
`$FORGE_SKILL/tools/examples`. Discovery supplies those existing native example
paths; `data.examples.campaigns` locates the campaign helpers. The links work in
the installed tree. Installed discovery and selected native commands passed in the completed campaign. Set each UUID variable from the actual JSON response, never from a sample
UUID in prose. Keep the same CLI root directory, account and API origin.

```sh
BG="$FORGE_SKILL/tools/boltzgen"
RF="$FORGE_SKILL/tools/rfantibody"
CAMPAIGNS="$FORGE_SKILL/tools/examples/campaigns"
EXAMPLES="$FORGE_SKILL/tools/examples"
```

For the joined protein/Protenix recipe, use an authorized one-GPU H100-class VM
meeting Protenix's 48-GiB VRAM, eight-CPU and 250-GiB disk floors.
Protenix has no fixed catalog RAM floor.
Its recorded prediction host was H100 PCIe. Generation-only B43 ran on L40;
its wider floors remain unknown. The joined case passed its finite qualification; these fields describe the retained admission profile.
`GPU_HOURS` is the user's approved total allowance, including preparation/idle.
Confirm the deployed GPU spelling and availability before the create:

```sh
ariax forge create --name "Protein binder pilot" --gpu "$GPU" --gpu-count 1 --min-ram-gib 100 --min-cpu-count 8 --min-disk-gib 250 --tools boltzgen,protenix-models,interface-scores --priority boltzgen --max-gpu-hours "$GPU_HOURS" --json
ariax forge status "$SESSION" --json
ariax forge tools wait "$SESSION" base --timeout 600 --json
ariax forge tools wait "$SESSION" boltzgen --timeout 1800 --json
```

Require host `available`, requested tool `ready` and every staged input `ready`.
`inputs add` returns an asynchronous import ID. Use `inputs status` on each ID;
do not start dependent work while an input is still importing. The example
`taskset -c 0-7` is the recorded eight-CPU prefix. Use the workload's assigned
CPU indices if they differ; thread environment variables alone do not constrain
JAX startup on a wide guest. Do not change scientific settings while doing so.

Every `forge run` prints/saves a durable command ID. After **each** command,
set `COMMAND` to its returned ID and observe it before the next dependent step:

```sh
ariax forge watch "$SESSION" "$COMMAND" --timeout 1800 --json
ariax forge command "$SESSION" "$COMMAND" --json
ariax forge logs "$SESSION" "$COMMAND" --tail 1000 --json
```

Read state, exit code, native logs and expected produced items together. Watch
timeout/Ctrl-C leaves remote work running. After an uncertain reply, inspect the
original ID; resend only its original request with `--command-id` and identical
fields if needed. The same rule applies to saved create, selection, input and
checkpoint IDs. A fresh ID means new work. Do not automatically rerun inference.
Keep failed/interrupted attempts and unreached stages. Stop writers before sync.

## Protein-binder pilot: generation through native selection

Stage the native B43 files and the small new selector, with matching paths:

```sh
for FILE in ubiquitin.yaml 1ubq.cif check.py; do
  ariax forge inputs add "$SESSION" --file "$BG/$FILE" --path "boltzgen/$FILE" --json
done
ariax forge inputs add "$SESSION" --file "$CAMPAIGNS/boltzgen-select.py" --path campaigns/boltzgen-select.py --json
ariax forge inputs list "$SESSION" --json
ariax forge inputs status "$SESSION" "$INPUT" --json
```

Repeat `inputs status` for each returned input ID until ready. The YAML chooses
input target A76 and design B40. Run once in a fresh output directory:

```sh
ariax forge run "$SESSION" --tool boltzgen --gpus 0 --timeout-seconds 1800 --json -- taskset -c 0-7 forge-boltzgen --seed 7 run /inputs/boltzgen/ubiquitin.yaml --output /workspace/boltzgen/pilot1 --protocol protein-anything --num_designs 2 --budget 1 --devices 1 --num_workers 0 --cache /scratch/cache --moldir /models/boltzgen/mols --design_checkpoints /models/boltzgen/boltzgen1_diverse.ckpt --inverse_fold_checkpoint /models/boltzgen/boltzgen1_ifold.ckpt --folding_checkpoint /models/boltzgen/boltz2_conf_final.ckpt --config folding diffusion_samples=1 --config design_folding diffusion_samples=1 --config analysis num_processes=2 --config filtering top_budget=2
```

Observe its command, then run the existing native checker, saving its complete
JSON as a regular workspace file through an explicit workload shell:

```sh
ariax forge run "$SESSION" --tool boltzgen --gpus 0 --timeout-seconds 180 --json -- sh -lc 'python3 /inputs/boltzgen/check.py /workspace/boltzgen/pilot1 > /workspace/boltzgen/pilot1/native-check.json'
ariax forge run "$SESSION" --tool base --timeout-seconds 60 --json -- python3 /inputs/campaigns/boltzgen-select.py /workspace/boltzgen/pilot1 --check /workspace/boltzgen/pilot1/native-check.json --out /workspace/campaigns/protein-review
```

Observe each command before continuing. `review.json` keeps every native CSV
row, exact decisions, checked sequences/design masks and unavailable columns.
The existing checker ties `id` to the inverse-folded CIF/NPZ, actual complex and
binder-only refolds, raw confidence arrays, native rank and export bytes.
Native ID `ubiquitin_1` differs from rank 1; retain both. In this fixture,
the design mask maps input B to emitted A, and input target A to emitted B.
Never use alphabetical chain order, file rank or array size to infer that map.
Inverse-folded sidechains are zero placeholders; evaluate actual refolds.

Keep planned 2 backbones, attempted/completed counts for every native stage,
2 sequences, 2 complex refolds, 2 binder-only refolds, 2 ranked rows and the
actual accepted count separately. Native `budget=1` is a selected-set size,
not dollars or a guarantee of one passing candidate. Design retains three
recycles/500 steps; each refold retains three recycles/200 steps, with one
sample instead of the default five. Native filtering keeps alpha 0.001,
random_state 0, original RMSD threshold 2.5 Å and composition caps.

The retained B43 outcome is:

| ID | Rank | GLU fraction / cap | Decision |
| --- | ---: | --- | --- |
| `ubiquitin_1` | 1 | 0.375 / 0.2 | rejected, `pass_GLU_fraction_filter=false` |
| `ubiquitin_0` | 2 | 0.35 / 0.2 | rejected, `pass_GLU_fraction_filter=false` |

Both ranked/diversity exports remain rejected; accepted count is zero. Preserve
all flags and original metrics even if a new run differs. For deliberate
inspection of the actual retained rank-one rejected candidate:

```sh
ariax forge run "$SESSION" --tool base --timeout-seconds 60 --json -- python3 /inputs/campaigns/boltzgen-select.py /workspace/boltzgen/pilot1 --check /workspace/boltzgen/pilot1/native-check.json --out /workspace/campaigns/protein-export --candidate ubiquitin_1 --review-rejected
```

This exports the actual complex CIF, same-ID NPZ and binder FASTA under
`rejected-review/ubiquitin_1`. It creates no accepted shortlist. For a later
actual passing ID, choose that ID explicitly and omit `--review-rejected`;
the helper refuses a failed native decision. Never relabel a rank-one rejection
as an experimental candidate or relax native thresholds to obtain a pass.

### Explicit full-target evaluation and directional scoring

This is a later B56 native join, conditional on B30 Protenix and corrected B35q
delivery/readiness. It is useful for a diagnostic rejected candidate as well as
a real passing one; independent confidence does not reverse its native filter
decision. Preserve the generation-stage result beside the evaluation.
Here the full target is already A76 1UBQ. For a cropped real campaign, supply
the larger authorized target sequence/assembly and original residue map instead,
and record the changed evaluation construct. Do not silently substitute a crop.

Prepare the exact checked `ubiquitin_1` binder plus target as one native
Protenix input on the remote host. This code only writes small metadata:

```sh
ariax forge run "$SESSION" --tool base --timeout-seconds 60 --json -- python3 -c 'import json; from pathlib import Path; r=json.loads(Path("/workspace/campaigns/protein-review/review.json").read_text()); s=next(x for x in r["samples"] if x["id"]=="ubiquitin_1"); m=s["input_to_emitted_chain_mapping"]; target=s["sequence_stage"][m["input_target_A"]]; binder=s["sequence_stage"][m["input_design_B"]]; p=Path("/workspace/campaigns/evaluate-ubiquitin_1"); p.mkdir(); (p/"input.json").write_text(json.dumps([{"name":"ubiquitin_1_full_target","sequences":[{"proteinChain":{"id":["A"],"count":1,"sequence":target}},{"proteinChain":{"id":["B"],"count":1,"sequence":binder}}]}],indent=2)); (p/"chain-roles.json").write_text(json.dumps({"native_candidate_id":s["id"],"generation_chain_map":m,"evaluation_target":"A","evaluation_binder":"B","generation_filter_decision":next(x for x in r["checked_decisions"] if x["id"]==s["id"]),"msa":"none","template":"none"},indent=2))'
ariax forge tools wait "$SESSION" protenix-models --timeout 1800 --json
ariax forge tools wait "$SESSION" interface-scores --timeout 1800 --json
ariax forge run "$SESSION" --tool protenix-models --gpus 0 --timeout-seconds 1800 --json -- forge-protenix --model_name protenix_base_default_v1.0.0 --input_json_path /workspace/campaigns/evaluate-ubiquitin_1/input.json --dump_dir /workspace/campaigns/evaluate-ubiquitin_1/prediction --use_msa false --sample_diffusion.N_sample 1 --sample_diffusion.N_step 20 --model.N_cycle 3 --seeds 101 --need_atom_confidence true
```

Observe each command. Set `PREDICTION_COMMAND` to the prediction's actual ID.
This selects the public v1 model, reduced 3-cycle/20-step profile and no MSA or
template. The larger default profile and this generated candidate are not
already qualified by B29/B30's primitive matrix. Same-seed native reruns can
differ. Keep the actual sample and original failures.

```sh
ariax forge run "$SESSION" --tool protenix-models --gpus 0 --timeout-seconds 120 --json -- python /opt/forge-protenix-check.py /workspace/campaigns/evaluate-ubiquitin_1/input.json /workspace/campaigns/evaluate-ubiquitin_1/prediction
ariax forge run "$SESSION" --tool protenix-models --gpus 0 --timeout-seconds 120 --json -- python /opt/forge-protenix-handoff.py /workspace/campaigns/evaluate-ubiquitin_1/input.json /workspace/campaigns/evaluate-ubiquitin_1/prediction --run-id "$PREDICTION_COMMAND"
```

Observe both and inspect the exported handoff path and status in their logs.
`HANDOFF` below is that **actual** `*_handoff_sample_0.json` absolute workload
path, linked to the same model/seed/sample CIF and unrounded raw confidence.
If token splitting makes it unavailable, retain its reason and stop the complete
scoring claim. Never fabricate a one-token-per-residue map or repair dimensions.

```sh
ariax forge run "$SESSION" --tool interface-scores --timeout-seconds 120 --json -- interface-scores "$HANDOFF" --output /workspace/campaigns/evaluate-ubiquitin_1/interface.json --pae-cutoff 10
```

Observe the scorer and inspect the result on the remote host or through a
checkpoint-pinned file link. Preserve ordered A→B (target row/binder column)
and B→A (binder row/target column). PAE is directional. ipSAE takes a
row-specific maximum at PAE strictly below 10 Å; pDockQ is symmetric with
CB/glycine-CA contacts ≤8 Å; pDockQ2 uses directional PAE and may exceed one;
LIS uses PAE ≤12 Å and keeps both directions. Unordered aggregates label
max-of-directions for ipSAE/pDockQ/pDockQ2 and mean-of-directions for LIS.
An explicitly requested `ipSAE_min` is a separately labelled minimum of the
two available directional values, never the native max aggregate. Missing
PAE/pLDDT/contact atoms produce null with a reason; a defined zero stays zero.
Monomers have `no_protein_interface`. Preserve native pair versus complex ipTM.
Read [the scorer](../tools/interface-scores.md) and
[v3 metric definitions](ipsae-metrics.md) for the complete units/availability.

Protenix raw atom pLDDT is 0–1, its summary pLDDT/PDB B-factors use 0–100,
and raw token-pair PAE is Å. Native BoltzGen pLDDT is fractional; binder-only
interaction and protein-only ligand scores keep their native inapplicable
zero/sentinel meanings. Do not replace missing arrays with B-factors or
substitute Boltz small-molecule affinity for protein-binder affinity.
Confidence, pose agreement and rank do not demonstrate binding or specificity.

### FreeBindCraft alternative with unchanged failures

For a separately authorized FreeBindCraft pilot, follow its native guide's
input readiness and corrected B45 delivery gate. Use the existing PD-L1 and
complete B45 settings, rather than B09's empty optional filters:

```sh
ariax forge tools add "$SESSION" --tools freebindcraft --json
ariax forge tools wait "$SESSION" freebindcraft --timeout 1800 --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/freebindcraft/PDL1.pdb" --path freebindcraft/PDL1.pdb --json
for FILE in advanced.json filters.json settings-openmm.json check.py; do
  ariax forge inputs add "$SESSION" --file "$EXAMPLES/freebindcraft/b45/$FILE" --path "freebindcraft/b45/$FILE" --json
done
ariax forge inputs list "$SESSION" --json
ariax forge run "$SESSION" --tool freebindcraft --gpus 0 --timeout-seconds 3600 --json -- freebindcraft --settings /inputs/freebindcraft/b45/settings-openmm.json --advanced /inputs/freebindcraft/b45/advanced.json --filters /inputs/freebindcraft/b45/filters.json --no-pyrosetta --no-plots --no-animations --verbose
ariax forge run "$SESSION" --tool freebindcraft --gpus 0 --timeout-seconds 120 --json -- python3 /inputs/freebindcraft/b45/check.py /workspace/b45/openmm
```

Require each input ready and observe each dependent command as above. Use a
fresh `design_path` and staged settings for a later run. The retained OpenMM
and separately authorized PyRosetta routes each exhausted two trajectories,
relaxed one trajectory and rejected the first MPNN complex refold on native
i_pTM/i_pAE criteria, producing **zero accepted designs**. Later models,
redesigned-complex relaxation, binder-alone and Accepted/Ranked were unreached.
Join CSV `Design` to the FASTA/stem before `_modelN`, exact selected model and
native arrays/map. Rejected CSV fields can be failure indicators. OpenMM
Rosetta-energy/H-bond placeholders and fallback shape-complementarity values
remain uncomputed. Native ColabDesign CSV PAE is normalized, while raw PAE is Å.
PyRosetta energy units are not experimental binding free energy. Do not rerank
placeholders as measured interface scores. Link the rejection table and native
array/settings files if no actual accepted structure exists.

## Antibody/nanobody interpretation and explicit export


Require `rfantibody` ready on a one-GPU host with at least 44 GiB reported
VRAM, 48 GiB RAM, eight CPUs and 100 GiB disk. The original host was L40.
Use a new session or add the tool to an already authorized compatible session:

```sh
ariax forge tools add "$SESSION" --tools rfantibody --priority rfantibody --json
ariax forge tools wait "$SESSION" rfantibody --timeout 1800 --json
ariax forge status "$SESSION" --json
for FILE in rsv_site3.pdb hu-4D5-8_Fv.pdb h-NbBCII10.pdb; do
  ariax forge inputs add "$SESSION" --file "$RF/$FILE" --path "rf-antibody/$FILE" --json
done
ariax forge inputs add "$SESSION" --file "$CAMPAIGNS/rfantibody-select.py" --path campaigns/rfantibody-select.py --json
ariax forge inputs list "$SESSION" --json
```

Observe every input ID until ready. The unmodified source has RSV target T251,
VH H116/VL L107 and VHH H127, with explicit upstream HLT CDR REMARK labels.
Those labels are not a newly assigned IMGT/Chothia/Kabat scheme. For new inputs,
retain a validated numbering sidecar and explicit region correspondence before
mapping into HLT. Preserve framework/target amino acids, insertion codes,
CDR constraints and hotspots. Variable-length CDR correspondence is unqualified.
This native stage uses RFdiffusion_Ab.pt, published native
ProteinMPNN_v48_noise_0.2.pt and RF2_ab.pt under `/models/rfantibody`.
Optional AbMPNN does not replace its sequence checkpoint.

Only for an authorized fresh generation, run each stage once and observe it:

```sh
ariax forge run "$SESSION" --tool rfantibody --gpus 0 --timeout-seconds 1800 --json -- taskset -c 0-7 rfantibody generate --target /inputs/rf-antibody/rsv_site3.pdb --framework /inputs/rf-antibody/hu-4D5-8_Fv.pdb --out /workspace/antibody/generate --design-loops H1:7,H2:6,H3:7,L1:11,L2:7,L3:9 --hotspots T305,T456 --steps 50 --num-designs 1 --deterministic
ariax forge run "$SESSION" --tool rfantibody --gpus 0 --timeout-seconds 600 --json -- taskset -c 0-7 rfantibody sequence --input /workspace/antibody/generate/pdbs --out /workspace/antibody/sequence --loops H1,H2,H3,L1,L2,L3 --num-sequences 2 --temperature 0.1 --deterministic
ariax forge run "$SESSION" --tool rfantibody --gpus 0 --timeout-seconds 1800 --json -- taskset -c 0-7 rfantibody predict --input /workspace/antibody/sequence/pdbs --out /workspace/antibody/predict --recycles 10 --seed 0 --hotspot-show-proportion 0.1
ariax forge run "$SESSION" --tool rfantibody --gpus 0 --timeout-seconds 1800 --json -- taskset -c 0-7 rfantibody generate --target /inputs/rf-antibody/rsv_site3.pdb --framework /inputs/rf-antibody/h-NbBCII10.pdb --out /workspace/nanobody/generate --design-loops H1:10,H2:6,H3:16 --hotspots T305,T456 --steps 50 --num-designs 1 --deterministic
ariax forge run "$SESSION" --tool rfantibody --gpus 0 --timeout-seconds 600 --json -- taskset -c 0-7 rfantibody sequence --input /workspace/nanobody/generate/pdbs --out /workspace/nanobody/sequence --loops H1,H2,H3 --num-sequences 2 --temperature 0.1 --deterministic
ariax forge run "$SESSION" --tool rfantibody --gpus 0 --timeout-seconds 1800 --json -- taskset -c 0-7 rfantibody predict --input /workspace/nanobody/sequence/pdbs --out /workspace/nanobody/predict --recycles 10 --seed 0 --hotspot-show-proportion 0.1
```

Generation uses deterministic design-index seeds; sequence uses upstream seed
42; RF2 uses explicit seed 0. Ten recycles give eleven model passes. Do not
merge their identities into one campaign seed. Each stage retains its native
`stage.json`, TRB/settings, sampled sequences/SCORE records and raw arrays.
The two modalities both use `design_0_dldesign_0` and `_1`; include modality
in the candidate key to prevent joining antibody 0 to nanobody 0.

For fresh outputs, run the existing check for each sequence **after** prediction.
For restored B50, inspect the retained reports first; recheck only when the
exercise requires it, writing fresh report paths if the originals are retained.
Run these checks one at a time, observing each returned ID before the next.
They reserve the same GPU and must not be submitted as concurrent work:

```sh
ariax forge run "$SESSION" --tool rfantibody --gpus 0 --timeout-seconds 60 --json -- rfantibody-check --framework /inputs/rf-antibody/hu-4D5-8_Fv.pdb --target /inputs/rf-antibody/rsv_site3.pdb --generated /workspace/antibody/generate/pdbs/design_0.pdb --sequenced /workspace/antibody/sequence/pdbs/design_0_dldesign_0.pdb --predicted /workspace/antibody/predict/pdbs/design_0_dldesign_0_best.pdb --loops H1,H2,H3,L1,L2,L3 --out /workspace/antibody/check-0.json
ariax forge run "$SESSION" --tool rfantibody --gpus 0 --timeout-seconds 60 --json -- rfantibody-check --framework /inputs/rf-antibody/hu-4D5-8_Fv.pdb --target /inputs/rf-antibody/rsv_site3.pdb --generated /workspace/antibody/generate/pdbs/design_0.pdb --sequenced /workspace/antibody/sequence/pdbs/design_0_dldesign_1.pdb --predicted /workspace/antibody/predict/pdbs/design_0_dldesign_1_best.pdb --loops H1,H2,H3,L1,L2,L3 --out /workspace/antibody/check-1.json
ariax forge run "$SESSION" --tool rfantibody --gpus 0 --timeout-seconds 60 --json -- rfantibody-check --framework /inputs/rf-antibody/h-NbBCII10.pdb --target /inputs/rf-antibody/rsv_site3.pdb --generated /workspace/nanobody/generate/pdbs/design_0.pdb --sequenced /workspace/nanobody/sequence/pdbs/design_0_dldesign_0.pdb --predicted /workspace/nanobody/predict/pdbs/design_0_dldesign_0_best.pdb --loops H1,H2,H3 --out /workspace/nanobody/check-0.json
ariax forge run "$SESSION" --tool rfantibody --gpus 0 --timeout-seconds 60 --json -- rfantibody-check --framework /inputs/rf-antibody/h-NbBCII10.pdb --target /inputs/rf-antibody/rsv_site3.pdb --generated /workspace/nanobody/generate/pdbs/design_0.pdb --sequenced /workspace/nanobody/sequence/pdbs/design_0_dldesign_1.pdb --predicted /workspace/nanobody/predict/pdbs/design_0_dldesign_1_best.pdb --loops H1,H2,H3 --out /workspace/nanobody/check-1.json
ariax forge run "$SESSION" --tool base --timeout-seconds 60 --json -- python3 /inputs/campaigns/rfantibody-select.py /workspace --out /workspace/campaigns/antibody-review
```

The helper expects the documented fixed-length B50 layout. If restored under
a different parent, pass that actual `/workspace/...` parent. Keep native files
unchanged and copy reports into the documented layout only on the VM when needed.
The checker verifies same-sequence prediction, fixed sequence-stage backbone,
generation geometry, raw array/PDB rounded means and H/L/T residue correspondence.
Its screen retains pred_lddt >0.9, interaction PAE <10 Å and target-aligned
antibody RMSD <2 Å, with generation's 0.05-Å diagnostic. It can exit zero while
its `filter.accepted` is false. Never infer acceptance from process exit.

| B50 retained candidate | pred_lddt (0–1) | Interaction PAE (Å) | Target-aligned antibody RMSD (Å) | Decision |
| --- | ---: | ---: | ---: | --- |
| `antibody/design_0_dldesign_0` | 0.907221 | 17.293472 | 22.715429 | rejected |
| `antibody/design_0_dldesign_1` | 0.919675 | 16.802931 | 29.284170 | rejected |
| `nanobody/design_0_dldesign_0` | 0.910643 | 15.582981 | 14.183523 | rejected |
| `nanobody/design_0_dldesign_1` | 0.908505 | 16.442680 | 17.140078 | rejected |

All four remain rejected, including the high-fold-confidence rows. Retain the
original reasons: generation framework/target geometry exceeded 0.05 Å,
interchain PAE and target placement failed. Native `interaction_pae` averages
**all** interchain pairs, including VH/VL; it is not a binder-to-target-only
metric. Confidence arrays use target-first T/H/L (VHH T/H), while native PDBs
use H/L/T (VHH H/T). Use each report's `confidence_residue_map` and
`array_index_zero_based`, source residue and native output residue; never
slice arrays by PDB order. VHH light-chain CDR RMSDs are native NaNs recorded
as unavailable. Preserve raw arrays and those reasons; do not turn them into
zero or add a fictional L chain. New RF2→B35 interface scoring is unqualified;
do not feed RF2 arrays to an AF2 adapter.

For an explicit diagnostic export of actual rejected VH/VL and VHH candidates:

```sh
ariax forge run "$SESSION" --tool base --timeout-seconds 60 --json -- python3 /inputs/campaigns/rfantibody-select.py /workspace --out /workspace/campaigns/antibody-export --candidate antibody/design_0_dldesign_0 --candidate nanobody/design_0_dldesign_0 --review-rejected
```

Exports retain actual prediction PDB/NPZ, generated/sequenced structures,
stage records, rejection/mapping report and complete H/L/T FASTAs. The target
T FASTA preserves the checked construct alongside the separate binder chains. Paired Fv H
and L stay separate. VHH exports full H, including framework and CDRs. No linker,
constant region or assay format is invented. An explicitly chosen future
screen-passing row can use the same helper without `--review-rejected`; its
screen remains a computational result requiring separate scientific review.

## B56a1 retained protein/motif subset

The completed B56a1 retained-output subset operates only on actual B43/B55g protein outputs and
B51 motif outputs recovered from B55g's private retained package. It submits
no generation, sequence design, inference or optimization. Keep B43 and B55g
as separate cohorts: both use native IDs `ubiquitin_1` and `ubiquitin_0`, but
their sequences differ. Both cohorts retain zero accepted candidates and the
original GLU rejection. Native rank 1 does not authorize accepted export.


`boltzgen-select.py` now retains the full target FASTA, native settings,
generation/sequence masks, binder-only refold and complete native check beside
the selected complex CIF/NPZ and binder FASTA. Choose the actual ID explicitly
and use `--review-rejected` for diagnostic inspection. The ordinary path refuses
a rejected row before creating the export directory.

For the retained motif, stage `genie3-motif-select.py` from the campaigns
examples and use output-only native generation, prediction and ScaffoldReducer
checks. Keep original reports and failure records. The explicit helper command is:

```sh
python /inputs/campaigns/genie3-motif-select.py /workspace/b51 --candidate 04_5WN9_0 --generation-check /workspace/campaigns/motif-initial-generation-check.json --prediction-check /workspace/campaigns/motif-initial-prediction-check.json --motif-check /workspace/b51/motif-native-metrics.json --motif-inputs /inputs/genie3/motif --out /workspace/campaigns/motif-export --review-rejected
```

It verifies the actual CA-only v_48_020 sample against the native motif and
MPNN fixed-position maps. Twelve known residues at A:31–A:42 remain fixed in
the 75-residue sequence. The sampled `24,A1,31` motif geometry still fails the
unchanged scaffold/backbone/all-atom criteria. Two missing source atoms remain
masked. Keep the predictor's unavailable fields separate from the computed
native motif failures. The export retains the full scaffold FASTA, native
generation/MPNN/Boltz arrays, settings, maps, original inputs and reports.

Save the explicitly named final review snapshot through genuine Files inputs
and a complete checkpoint. Restore every selected input/workspace file into a
fresh logical data root with empty scratch and command history, then run only
saved-output checks. The retained subset used one physical host. The completed joined campaign also
preserves public-v1 Protenix evaluation, the Genie3 sequence/prediction join and
the Proteina/RF3 ligand path. Real human interaction and separate physical
allocations belong to their independently accepted workflow scope.

## Save, share, human hold and explicit resume

After all workspace writers are terminal, save the actual outputs and review:

```sh
ariax forge sync "$SESSION" --wait --timeout 900 --json
ariax forge checkpoint "$SESSION" "$CHECKPOINT" --json
ariax forge files "$SESSION" --path /workspace/campaigns --checkpoint "$CHECKPOINT" --json
ariax forge link "$SESSION" /workspace/campaigns/protein-review/review.json --checkpoint "$CHECKPOINT" --json
ariax forge link "$SESSION" /workspace/campaigns/protein-export/rejected-review/ubiquitin_1/ubiquitin_1.cif --checkpoint "$CHECKPOINT" --json
```

Set `CHECKPOINT` to the actual returned ID and require `synced`. For the
antibody case, share its `antibody-review/review.json` and actual exported
`predict/pdbs/design_0_dldesign_0_best.pdb` under the chosen modality path.
Link rejection tables/partial-stage records when no accepted structure exists.
Each `forge link` returns an authorized project-page URL pinned to session,
checkpoint and encoded path. Copy that URL into the user's result handoff.
The page previews uncompressed PDB/CIF/mmCIF ≤10,000,000 bytes. Decompress
a separate preview copy on the VM if needed and save it beside the original.
Keep structures/arrays/bulk files remote. Use `forge download ... --dest ...`
only on an authorized remote host when a file is needed for remote restore or
analysis; downloaded files publish atomically after the complete byte count.

Set `PROJECT` from the session's actual `project_id`. Human pause on the
authenticated project page establishes `human_resume_required`. On observing
it, stop this project's work, give the user that page link and explain that
**Allow agent to resume** is required. API-key CLI requests cannot clear it.
Await their web approval and direction. Approval leaves compute unallocated.
An agent-requested `ariax pause "$PROJECT" --json` is a distinct control and
does not demonstrate the human approval exercise. Never continue held work by
creating a replacement project. Abort/delete remains terminal.

```sh
ariax forge project "$PROJECT" --json
ariax forge status "$SESSION" --json
ariax forge activity "$PROJECT" --limit 50 --json
```

Inspect cleanup and the last completed checkpoint. A final-save failure can
still release compute and leave the earlier completed checkpoint available;
new unsaved files remain unavailable. Read command `output_available`,
`output_complete`, `output_truncated` and `output_error` together. A captured
empty tail is available; complete terminal output may still omit its prefix.
Activity preserves commands/control events, not private agent conversations.
After confirmed source resource release and web approval, read the new
`control.revision` into `REVISION`. Choose the exact checkpoint and new hardware,
tools and allowance explicitly. `RESUMED` is the returned new session ID:

```sh
ariax forge resume "$PROJECT" --restore-session "$SESSION" --checkpoint "$CHECKPOINT" --control-revision "$REVISION" --gpu "$GPU" --gpu-count 1 --min-ram-gib 100 --min-cpu-count 8 --min-disk-gib 250 --tools boltzgen,protenix-models,interface-scores --priority boltzgen --max-gpu-hours "$RESUME_GPU_HOURS" --json
ariax forge status "$RESUMED" --json
ariax forge tools wait "$RESUMED" base --timeout 600 --json
ariax forge tools wait "$RESUMED" boltzgen --timeout 1800 --json
ariax forge run "$RESUMED" --tool base --timeout-seconds 60 --json -- python3 -c 'import json; from pathlib import Path; p=Path("/workspace/campaigns/protein-review/review.json"); r=json.loads(p.read_text()); print(json.dumps({"saved_review":str(p),"accepted_count":r["accepted_count"],"selected_ids":r["selected_ids"]}))'
```

Observe that explicit restored-file inspection. For RFantibody, choose
`--tools rfantibody`, its hardware floors and the antibody review path instead.
Saved inputs/workspace return; scratch environments and model mounts require
normal preparation. [Custom code](custom-code.md) uses saved source/bootstrap
and explicit remote scratch recreation before its next command. Resume never
replays generation, predictions, scoring or selection. A stale control revision
or definitive hold rejection requires fresh inspection and a deliberate new
resume request; an uncertain acceptance reuses the original session ID/fields.

At completion, close each owned session and inspect status until `closed`:

```sh
ariax forge close "$RESUMED" --json
ariax forge status "$RESUMED" --json
ariax forge project "$PROJECT" --json
```


## Route other native proposals without expanding claims

Read the integrated [Genie3 guide](../tools/genie3.md) and its
guard qualification. Stage the
chosen config, problem JSON and motif/target PDB companions at their documented
paths, then run `genie3-generate --config /inputs/genie3/motif.yaml` in ready
`genie3`. Use its exact `genie3-handoff prepare --mode motif`, CA-only
`proteinmpnn` v_48_020 and `genie3-handoff sequence` commands before the documented
Boltz-2 prediction. These helpers preserve fixed motif/target identity; retain
sampled `scaffold_info.tsv`, masks and source residue maps. Its qualified
`--finalize-existing` needs matching retained `request.yaml`; it only finishes
metadata. The accepted unconditional result does not convert the rejected motif
or target-conditioned Boltz handoff into native target-binding success.

[PXDesign](../tools/pxdesign.md) uses `forge-pxdesign check-input`, `parse-target`
then the documented two-sample `pipeline --preset preview` proposal. Preview
uses native ColabDesign MPNN/AF2, not a replacement external prediction. Preserve
`(task_name, run_idx, name, seq_idx)`, exact completed `results`/`results_vN`
manifest, all/filtered/by-run tables, chain/register maps and actual chosen
structure. Failed rows can pad `min_total_return`; bucket/rank/return count
cannot replace `pass_af2`/`pass_ptx`. Extended needs its separate mini-template
asset and supplied full-query MSAs, and can select a different PTX model based
on target RMSD. Do not transfer preview qualification to extended.

[The ESMFold2 pipeline](../tools/esmfold2-pipeline.md) uses native `check`, `plan`,
one shard, saved status, explicit remaining-shard continuation and matching
native `validate`, `aggregate`, `select`/`export`. The proposal's convenience
case commands are documented there. Two seeds mean two total candidates,
not two per framework. Keep campaign.sqlite and native status counts, candidate
→ validation ID → actual model/seed/sample, `validation_chain_role_map`, complete
critic/validation tables and final combined ranking. The pinned contract
requires Protenix v2; independent v1/AF3 predictions cannot fill native validation
rows. Missing confidence stays unavailable. Rank can use absent ipSAE only with
its native basis/warnings, while missing required RMSD or failed validation
excludes the row. A nonempty export does not establish a complete campaign.

Motif/ligand-conditioned B56 work also routes to
[Foundry](../tools/foundry.md) and
[Proteina-Complexa](../tools/proteina-complexa.md). Preserve actual ligand atom,
bond/SMILES and native token maps when evaluating a complex. AF2 protein-only
prediction cannot evaluate a ligand it dropped. AME's retained zero bond matrix
leaves complete ligand topology unqualified. Standard-protein B35 scoring can
explicitly exclude chemical tokens; ligand-interface scores remain outside its
calibration. B52 OpenDDE-Harness and B53 Protein-Hunter keep their adapters,
credential boundaries and native acceptance gates; this recipe introduces no
adapter CLI or independent compute owner.

## Adaptyv guidance: computation to a reviewed experiment

Historical Adaptyv inspiration was recovered with `git show` from CLI archive
`8d0b15cf5b13d2bc2ea7c95bef8e9626fbc332be`, path
`evaluation/forge-skills/ariax-forge-ipsae/source-cache/adaptyv/skills/protein-qc/SKILL.md`,
and its sibling `skills/ipsae/SKILL.md`. The adjacent `sources.json` identifies
actual upstream revision `59dd63374314baa2fb1f9864f190775bd7466647` in
[Adaptyv protein-qc](https://github.com/adaptyvbio/protein-design-skills/blob/59dd63374314baa2fb1f9864f190775bd7466647/skills/protein-qc/SKILL.md)
and [ipSAE](https://github.com/adaptyvbio/protein-design-skills/blob/59dd63374314baa2fb1f9864f190775bd7466647/skills/ipsae/SKILL.md).
These are source inspiration. This recipe uses Forge's actual native outputs,
units and unchanged filters. It does not import historical composite weights,
universal pass rates, thresholds from another predictor or suggested automatic
scale-up. No historical code or bulk result was copied into these examples.

Separate folding/pose confidence, interface evidence and expression liabilities.
Inspect cysteines, potential glycosylation/deamidation motifs, exposed hydrophobic
or charged patches, tags/linker interference and assembly context against the
chosen construct. Record observations and uncertainty. A sequence motif alone
does not establish solvent exposure or expression; unavailable stability or
Rosetta metrics cannot be filled with constants. Preserve differences between
native filtering and any separately agreed experimental selection rationale.

Prepare a small review table on the remote host with candidate ID, full amino
acid sequence(s), construct format, target construct/register, generation and
evaluation model/seed/sample, original pass/rejection flags, unavailable metrics,
selection rationale and checkpoint-pinned structure/settings links. Include
all failed rows in the saved review, even when a later approved experimental
panel uses a subset. The two B43, both B45 routes and all four B50 candidates
provide **no computationally accepted shortlist**. Sending one as a deliberate
negative/diagnostic experiment would need that explicit rationale and authority.

For a real selected minibinder or VHH, upload the actual full amino acid FASTA
export; VHH includes its framework. A paired B50 output is a variable Fv, not
already a Fab/scFv/IgG assay construct. Keep H/L paired in the review. An approved
Fab requires complete heavy/light construct design; an scFv needs an explicit
linker/orientation and new evaluation. Adaptyv currently supports minibinders,
VHH, scFv and paired Fabs, and excludes intact bivalent IgGs. Confirm construct
and tag requirements before submission. [Supported formats](https://docs.adaptyvbio.com/docs/experiment-setup/supported-protein-formats).

Match the assay target's sequence/domain, oligomeric state, glycosylation and
tags to the computational target. Adaptyv's target documentation describes
catalog, sourced and user-supplied routes, separate reagent cost, tag constraints
and feasibility checks for difficult targets. An Fc-tagged target can change
apparent affinity through avidity; record that context. [Target guidance](https://docs.adaptyvbio.com/docs/experiment-setup/target-proteins).

When the user authorizes disclosure/submission, use the
[Foundry Portal](https://foundry.adaptyvbio.com) to prepare a draft, select the
actual assay/target, upload named FASTA or mapped name/sequence CSV, designate
controls and review the parsed sequences. Choose replicates and requirements.
The documented binding minimum is 24 distinct sequences per target; replicates
do not fill it. Smaller pilots need arrangement with Adaptyv. A two-candidate
software pilot does not justify generating additional designs to fill an order.
Move to review within the user's authorized scope, inspect the concrete final
quote, target costs, assay/format, deliverables and timeline, then obtain purchase
authority if it was not already provided. Confirmation commits the quote.
[Experiment creation](https://docs.adaptyvbio.com/docs/experiment-setup/creating-experiments).
This recipe installs no SDK, calls no lab API and auto-confirms no purchase.

After an authorized experiment, join experimental sequence/replicate IDs back
to the exact submitted FASTA and native candidate key. Keep assay method,
concentrations, controls, expression, fit quality and measured kinetics beside
computational scores. Preserve unexpressed, nonbinding, censored and fit-failed
rows with their lab status. Raw/fit sensorgrams and replicate metadata belong
in the remote retained package; current data packages can be revised, and
filenames sanitize sequence names. Record experiment/result identity, version
and original-to-lab name mapping. [Binding data package](https://docs.adaptyvbio.com/docs/experiment-setup/binding-data-package).
New biological conclusions require those data; a computational zero-pass result
does not demonstrate that the target cannot be designed.

The Adaptyv public pages above were read October 7 Pacific / October 8 UTC, 2026.
Recheck the primary pages for a real future order. Preserve the user's disclosure,
experimental budget and ownership scope independently of Forge compute authority.
