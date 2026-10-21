# Five campaign recipes and computational consensus

Use these recipes to review a small minibinder cohort, optimize antibody CDRs,
compare declared positive/negative states, inspect ligand or motif designs, or
refold a designed nucleic acid. Each path selects one or two explicit identities
for review. A native rejection stays rejected in the saved shortlist.

Read the live catalog and the underlying [campaign recipes](../references/campaign-recipes.md).
[Formats](campaign-recipes/formats.md) defines the saved-output manifest and score meanings.
The [installed examples](examples/campaigns/README.md) contain the consumer and five plans.

```sh
ariax skills forge --reference campaign-consensus --read --json
ariax skills ariax-forge --reference campaign-consensus-formats --read --json
ariax skills forge --json
ariax forge catalog --details --json
```

Discovery's `data.examples.campaigns` is the absolute installed example directory.
Choose it from the actual response. Upload `consensus.py` to `campaigns/review/consensus.py`
with `forge inputs add`, then observe its import ID until ready. The restored
campaign root below contains `campaign.json`, exact registered molecular inputs,
original native outputs and per-command run records. All helper/scientific execution
runs in the selected remote workload. Keep the session's existing approved compute
allowance and durable IDs.

| Path and decision | Native operations and resources | Saved review |
| --- | --- | --- |
| Minibinder | BoltzGen generation/complex refold plus independent Protenix full-target validation. Preserve the design-mask chain map and explicit cohort. Use each tool's catalog envelope. | Native flags, native ranks, chain permutations and separate confidence fields. Existing ubiquitin examples have zero passing candidates. |
| Antibody optimization | IgDesign paired H/L and one antigen, explicit CDR indices/order; validate the reconstructed H/L with full-ensemble ABodyBuilder2 and RF3. IgDesign uses its 56-GiB RAM envelope. | Original parsed Fv, changed CDRs and untouched framework positions. RF3 and ImmuneBuilder compare antibody fold only; ImmuneBuilder supplies no antigen-interface confidence. |
| Positive/negative state | Same binder, two separately named target inputs, Boltz2 and RF3 for each. The bounded example uses full 1UBQ and its sequence-reversed computational decoy. | Keep both target sequences, structures and scores. The decoy is a stress test; no validated nonbinding or specificity label follows. |
| Ligand/motif | Reuse exact Proteina/Complexa ligand conditioning and RF3 validation; a new Boltz2 structure refold supplies a distinct prediction family. Genie3/CA-only MPNN/Boltz2 motif results keep their native filters. | Preserve OQO atom names, elements, SMILES and chemistry checks. Motif failures and missing atoms remain explicit. |
| Nucleic acid | RFD3NA atomic-decoder generation, then RF3 and Boltz2 of the exact generated RNA or DNA. Preserve chain type and generated sequence. | Same-molecule refold comparison; requested and extra base pairs remain separate from pose confidence. |

The installed `molecular/` examples carry the exact input identities used below.
Register every file there under `campaigns/molecular/` and register `stage-inputs.py`
under `campaigns/stage-inputs.py`. Observe all input IDs until ready. Stage the inputs
through the base workload before native validation:

```sh
ariax forge run "$SESSION" --tool base --timeout-seconds 60 --json -- python3 /inputs/campaigns/stage-inputs.py /inputs/campaigns/molecular --out /workspace/campaign-delivery
```

The staged JSON/YAML files describe molecular inputs only. The complete shortlist
consumer additionally needs the original native outputs and manifest saved through
Files. The ten new calls comprise one minibinder RF3 validation, paired-state RF3
and Boltz2 predictions, antibody RF3/ImmuneBuilder validation, RNA RF3/Boltz2
validation and one ligand Boltz2 prediction. Existing Protenix and ligand RF3
results retain their original settings.

The bounded new refold profile uses one GPU, one sample, seed 7 and at most 256
tokens. Its minimum VRAM/RAM remain unknown until qualification; use the catalog
hardware envelope of each offered tool. RF3's broader accepted profile uses an
H100 with 79 GiB reported VRAM and 96 GiB RAM. Never infer a smaller minimum from
a successful small example. Cold preparation also needs disk for complete image,
model archives, extracted models and full recovery copies. Model mounts remain
read-only: `/models/foundry-rf3`, `/models/boltz2`, `/models/immunebuilder-weights`.

Native validation uses ordinary argv in fresh directories. For one explicitly
prepared RF3 input:

```sh
ariax forge run "$SESSION" --tool rf3 --gpus 0 --timeout-seconds 1800 --json -- rf3 fold inputs=/workspace/campaign-delivery/inputs/antibody-rf3.json out_dir=/workspace/campaign-delivery/new/antibody-rf3 ckpt_path=/models/foundry-rf3/rf3_foundry_01_24_latest_remapped.ckpt seed=7 n_recycles=10 diffusion_batch_size=1 num_steps=50 skip_existing=False
```

For a prepared Boltz2 protein, ligand or NA YAML, preserve `msa: empty` on protein
chains when the declared case has no MSA. No MSA service is contacted by this example.

```sh
ariax forge run "$SESSION" --tool boltz2 --gpus 0 --timeout-seconds 1800 --json -- boltz predict /workspace/campaign-delivery/inputs/positive.yaml --model boltz2 --cache /models/boltz2 --checkpoint /models/boltz2/boltz2_conf.ckpt --out_dir /workspace/campaign-delivery/new/positive-boltz2 --accelerator gpu --devices 1 --recycling_steps 3 --sampling_steps 200 --diffusion_samples 1 --max_parallel_samples 1 --seed 7 --num_workers 0 --preprocessing-threads 1 --output_format mmcif --write_full_pae
```

The antibody JSON is a list of `{id,sequences:{H,L},source_chains:{H,L}}`.
Use complete supplied variable domains and retain the adapter's trimming map.

```sh
ariax forge run "$SESSION" --tool immunebuilder --gpus 0 --timeout-seconds 1800 --json -- immunebuilder --family abodybuilder2 --input /workspace/campaign-delivery/inputs/antibody-immunebuilder.json --out /workspace/campaign-delivery/new/antibody-immunebuilder --numbering imgt
```

Observe each returned command ID with `forge watch`, `forge command` and `forge logs`
before the next dependent command. A timeout leaves remote work running. Query the
original durable ID after an uncertain reply. A new native attempt requires an
explicit decision and a fresh output directory. Keep failed commands and unavailable
fields. The saved-output consumer executes no model inference:

```sh
ariax forge run "$SESSION" --tool rf3 --gpus 0 --timeout-seconds 120 --json -- python3 /inputs/campaigns/review/consensus.py /workspace/campaign-delivery --manifest campaign.json --out /workspace/campaign-shortlists
```

This writes `shortlists.json`, a tabular `shortlists.tsv`, and one JSON per path. Inspect `native_decision`,
`consensus`, per-family ranks, their native ranking context and score units. Unavailable ordinal ranks stay null; sample IDs remain explicit in structure paths. `review_selection=true` identifies
a deliberate inspection choice. `accepted_for_experiment=false` preserves the
need for scientific review and experiment. `insufficient_same_task_families` is an
incomplete consensus result. Pose comparisons use corresponding C-alpha or
phosphate atoms, with every native residue and chain map retained. An optional
2-Angstrom review threshold labels this bounded comparison and supplies no
calibrated quality estimate. Complex comparisons fit the declared target chain and retain per-role binder RMSD. Ligand comparisons preserve every heavy atom and report its centroid displacement after the binder fit; atomwise ligand orientation and bond-graph agreement remain unmeasured. A discordant pose stays in the table. Positive-minus-negative differences retain the same model, source, scientific settings and native units, with no specificity calibration.

BoltzGen/Boltz2 and their accelerated variants count as one related family.
All RF3 checkpoints count as one. ImmuneBuilder's four members form one ensemble.
Rank and score scales stay native. Protenix raw pLDDT is 0–1 while its summary uses
0–100; PAE is Angstrom. ImmuneBuilder mean squared disagreement is Angstrom squared,
and its PDB error B-factor is Angstrom. Sequence likelihood and structural confidence
have separate meanings. Cross-family averaging is unavailable. Native zeros for unavailable interchain, ligand or protein-only interfaces retain an explicit not_applicable label. RF3 chain_ptm is the native chain mean pLDDT field, whose name differs from its meaning; the native checker preserves that interpretation.

Stop writers, `forge sync --wait`, and retain the actual checkpoint ID. Save inputs,
source/settings/seed/hardware records, failed attempts, structures, raw confidence,
numbering maps, manifest and shortlists. Export through checkpoint-pinned Files.
Restore the complete chosen checkpoint into a fresh session with empty history and
scratch. Prepare the same named tools/assets, inspect installed examples, then run
the consumer above with a fresh output directory. Compare every saved shortlist
byte. Restore never silently replays generation, optimization or prediction.

Unsupported molecular modalities fail explicitly. Held Foldseek/Chai branches keep
their service-clearance gates. SPURS remains gated on coordinator acceptance. AF3
is excluded. Computational consensus supplies no experimental function or
specificity claim. Native access and terms follow the linked tool guides. Scientific
provenance remains available in each retained run record.

Selected creator sources: [Foundry](https://github.com/RosettaCommons/foundry/tree/94c78ab125c6ef2cc7d1226de86d1bd578bf8bee),
[Boltz prediction interface](https://github.com/jwohlwend/boltz/blob/v2.2.1/docs/prediction.md),
[IgDesign](https://github.com/AbSciBio/igdesign/tree/70431eef0afaf0496d7d84e22dfdc1980ec9e70e),
[ImmuneBuilder](https://github.com/oxpig/ImmuneBuilder/tree/0df4e2ad82a1aa60f37ea9dae335d1198159ef78).
[Boltz #277](https://github.com/jwohlwend/boltz/issues/277) describes explicit empty MSA;
accuracy without MSA remains unestablished by that discussion.
[ImmuneBuilder #14](https://github.com/brennanaba/ImmuneBuilder/issues/14) explains
ensemble error. Its [missing-residue report](https://github.com/brennanaba/ImmuneBuilder/issues/23)
motivates complete variable domains and exact trimming records.
