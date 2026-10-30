# Five campaign recipes and computational consensus

Use these recipes to review a small minibinder cohort, optimize antibody CDRs,
compare declared positive/negative states, inspect ligand or motif designs, or
refold a designed nucleic acid. The saved-output consumer requires all five
paths, with one or two explicit identities per path. It joins existing outputs
without running a predictor. A native rejection stays rejected in the shortlist.

Read the live catalog and the underlying [campaign recipes](../references/campaign-recipes.md).
[Formats](campaign-recipes/formats.md) defines the saved-output manifest and score meanings.
The [installed examples](examples/campaigns/README.md) contain the consumer and five plans.

```sh
ariax skills forge --reference campaign-consensus --read --json
ariax skills ariax-forge --reference campaign-consensus-formats --read --json
ariax skills forge --tool campaign-recipes --json
ariax forge catalog --task TASK --compact --json
ariax forge catalog --tool TOOL --model MODEL --mode MODE --json
```

Use the [capability guide](capabilities.md) to select `TASK`, `TOOL`, `MODEL`
and `MODE`; omit model/mode filters where they do not apply. Set `EXAMPLES` to
scoped discovery's `data.examples['campaign-recipes']`. Upload
`$EXAMPLES/consensus.py` with the command below, then observe its import ID
until ready:

```sh
ariax forge inputs add "$SESSION" --file "$EXAMPLES/consensus.py" --path campaigns/review/consensus.py --json
```

Supply `campaign.json`, original native outputs and per-command records beneath
one campaign root. They can come from
the existing workspace or an optional [same-project resume](../outputs.md).
All helper/scientific execution runs remotely. Follow the
[Forge lifecycle](../SKILL.md) for preparation, billing, durable command IDs,
recovery and closure within the existing authorized allowance.

| Path and decision | Native operations and resources | Saved review |
| --- | --- | --- |
| Minibinder | BoltzGen generation/complex refold plus independent Protenix full-target validation. Preserve the design-mask chain map and explicit cohort. Use each tool's catalog envelope. | Native flags, native ranks, chain permutations and separate confidence fields. Existing ubiquitin examples have zero passing candidates. |
| Antibody optimization | IgDesign paired H/L and one antigen, explicit CDR indices/order; validate the reconstructed H/L with full-ensemble ABodyBuilder2 and RF3. IgDesign uses its 56-GiB RAM envelope. | Original parsed Fv, changed CDRs and untouched framework positions. RF3 and ImmuneBuilder compare antibody fold only; ImmuneBuilder supplies no antigen-interface confidence. |
| Positive/negative state | Same binder, two separately named target inputs, Boltz2 and RF3 for each. The bounded example uses full 1UBQ and its sequence-reversed computational decoy. | Keep both target sequences, structures and scores. The decoy is a stress test; no validated nonbinding or specificity label follows. |
| Ligand/motif | Compare exact Proteina/Complexa ligand conditioning and RF3 validation with a Boltz2 structure refold from a distinct prediction family. Genie3/CA-only MPNN/Boltz2 motif results keep their native filters. | Preserve OQO atom names, elements, SMILES and chemistry checks. Motif failures and missing atoms remain explicit. |
| Nucleic acid | RFD3NA atomic-decoder generation, then RF3 and Boltz2 of the exact generated RNA or DNA. Preserve chain type and generated sequence. | Same-molecule refold comparison; requested and extra base pairs remain separate from pose confidence. |

Run the consumer in the selected RF3 workload, which supplies Gemmi and NumPy,
using a fresh output directory:

```sh
ariax forge run "$SESSION" --tool rf3 --gpus 0 --timeout-seconds 120 --json -- python3 /inputs/campaigns/review/consensus.py /workspace/campaign-delivery --manifest campaign.json --out /workspace/campaign-shortlists
```

This writes `shortlists.json`, `shortlists.tsv` and five per-path JSON files.
Review their decisions, native scores and pose comparisons as described below.
No new prediction is needed to regenerate these tables from saved outputs.

If new predictor observations are needed within the authorized experiment,
the following commands show the bundled input and model settings. The
installed `molecular/` examples carry exact candidate sequences and chemistry;
they do not supply native outputs or a complete manifest.
Register every file there under `campaigns/molecular/` and register `stage-inputs.py`
under `campaigns/stage-inputs.py`. Observe all input IDs until ready. Stage the inputs
through the base workload before native validation:

```sh
ariax forge run "$SESSION" --tool base --timeout-seconds 60 --json -- python3 /inputs/campaigns/stage-inputs.py /inputs/campaigns/molecular --out /workspace/campaign-delivery
```

The supplied refold profile uses one GPU, one sample, seed 7 and at most 256
tokens. Its minimum VRAM/RAM are unknown; use each tool's catalog hardware
envelope. RF3's broader reference profile uses an H100 with 79 GiB reported
VRAM and 96 GiB RAM. A successful small example does not establish a smaller
minimum. Plan disk for tool/model preparation and retained inputs/outputs using
the catalog. Model mounts are read-only: `/models/foundry-rf3`,
`/models/boltz2`, `/models/immunebuilder-weights`. Existing observations retain
their original settings when joined with a new one.

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
fields. Add observations to the manifest only with their exact molecular
identity, native output paths and original run records.

Inspect `native_decision`, `consensus`, each observation's `native_rank`,
its native ranking context and score units. Unavailable ordinal ranks stay
null; sample IDs remain explicit in structure paths. `review_selection=true` identifies
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
have separate meanings. Cross-family averaging is unavailable. Preserve explicit
`not_applicable` labels on native zeros for unavailable interchain, ligand or
protein-only interfaces. RF3 `chain_ptm` is the native chain mean pLDDT field,
whose name differs from its meaning; the native checker preserves that interpretation.

Stop workspace writers, then save inputs, settings, native outputs, numbering
maps, the manifest and shortlists with `ariax forge sync "$SESSION" --wait --json`.
Export through current project Files. Use [saved results](../outputs.md) to
resume and inspect saved candidates before continuing. Restoration does not
replay generation, optimization or prediction.

Use the current tool-specific catalog scopes for routes beyond this recipe's
consumer. AF3 is excluded. Computational consensus does not establish
experimental function or specificity. Native access and terms follow the
linked tool guides.

Selected creator sources: [Foundry](https://github.com/RosettaCommons/foundry/tree/94c78ab125c6ef2cc7d1226de86d1bd578bf8bee),
[Boltz prediction interface](https://github.com/jwohlwend/boltz/blob/v2.2.1/docs/prediction.md),
[IgDesign](https://github.com/AbSciBio/igdesign/tree/70431eef0afaf0496d7d84e22dfdc1980ec9e70e),
[ImmuneBuilder](https://github.com/oxpig/ImmuneBuilder/tree/0df4e2ad82a1aa60f37ea9dae335d1198159ef78).
[Boltz #277](https://github.com/jwohlwend/boltz/issues/277) describes explicit empty MSA;
accuracy without MSA remains unestablished by that discussion.
[ImmuneBuilder #14](https://github.com/brennanaba/ImmuneBuilder/issues/14) explains
ensemble error. Its [missing-residue report](https://github.com/brennanaba/ImmuneBuilder/issues/23)
motivates complete variable domains and exact trimming records.
