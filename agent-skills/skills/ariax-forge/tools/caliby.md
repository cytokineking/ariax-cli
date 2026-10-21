# Caliby sequence design and scoring

Use tool `caliby` for protein sequence design on a fixed backbone or aligned ensemble. Choose `caliby` or `soluble_caliby` for the full ensemble pipeline; the latter excludes annotated transmembrane proteins during training. The distilled choices `caliby_distill` and `soluble_caliby_distill` support rapid single-backbone screening. The creator discourages distilled models for subtle multistate tasks. These models were trained on monomers; multichain input support has a bounded execution check.

Read [modes and interpretation](caliby/modes.md) for defaults, constraints, terms and limitations. The named asset `caliby-weights` mounts at `/models/caliby-weights`. Each native operation uses one GPU. Qualification used one L40 with 48GiB VRAM and 56GiB host RAM on proteins of 46 or 92 residues. Minimum RAM/VRAM requirements remain unmeasured; the demonstrated ensemble contains three conformers. Check the catalog qualification record before choosing a larger workload.

Discover installed example paths:

```sh
ariax skills forge --json
ariax skills forge --reference caliby --read --json
ariax skills ariax-forge --reference caliby-modes --read --json
```

The response gives `data.examples.caliby`. Prepare its public 1CRN fixture with `python3 "$EXAMPLES/prepare.py" "$EXAMPLES/1crn.pdb" ./caliby-inputs`. Register the files under `caliby/monomer/1crn.pdb`, `caliby/multichain/pair.pdb` and `caliby/constraints.csv` with `ariax forge inputs add SESSION --file FILE --path PATH`; wait for each input to be ready. The synthetic pair is two copies separated by 25Å and tests chain handling. The 25Å translation defines this artificial arrangement.

Select the tool with `ariax forge tools add SESSION --tools caliby` and wait for `ariax forge status SESSION` to show it ready. Run these exact native commands through `ariax forge run SESSION --tool caliby --gpus 0 -- NATIVE_ARGV`, then `ariax forge watch SESSION COMMAND_ID`:

```sh
ariax forge run "$SESSION" --tool caliby --gpus 0 -- caliby clean input_cfg.pdb_dir=/inputs/caliby/monomer out_dir=/workspace/caliby/clean-monomer num_workers=1
ariax forge run "$SESSION" --tool caliby --gpus 0 -- caliby design ckpt_name_or_path=caliby out_dir=/workspace/caliby/caliby/monomer/design num_workers=1 sampling_cfg_overrides.batch_size=1 input_cfg.pdb_dir=/workspace/caliby/clean-monomer pos_constraint_csv=/inputs/caliby/constraints.csv sampling_cfg_overrides.num_seqs_per_pdb=2
ariax forge run "$SESSION" --tool caliby --gpus 0 -- caliby-check design /workspace/caliby/caliby/monomer/design/seq_des_outputs.csv --input /workspace/caliby/clean-monomer/1crn.cif --rows 2
```

Installed `commands.json` contains the exact cleaning, Protpardelle1c generation, design and scoring argv for the complete bounded matrix. Execute entries sequentially, waiting for completion after each. Check each `check` argv when present. [Example instructions](examples/caliby/README.md) explain ensemble preflight and Files recovery.

Design saves `seq_des_outputs.csv`, generated CIFs and `config.yaml`. Use `seq` for each designed sequence; `input_seq` records the primary sequence after any explicit sequence overrides. Chains are separated by `:`. Scores are in `U`, a total Potts energy with lower values favored within the same model/backbone/settings. Values have no calibrated physical unit. Scoring writes `score_outputs.csv` and optional local conditionals. Inspect terminal errors and logs if a command fails; do not treat missing rows as candidates.

Save the registered inputs, constraints, cleaned structures, complete ensemble directory, CSVs, generated CIFs, configs and command records with `ariax forge sync SESSION --wait`. Record the returned checkpoint and use the normal restore/resume path in another session. Run the checker against restored files before continuing. Run further designs explicitly after restoration.

Qualification uses two sequences and two generated decoys per backbone, batch1 and the default 500 sweeps/rewind150. Creator guidance recommends at least 32 generated samples for substantive ensemble design. Experimental specificity, pH response, agonism and binding efficacy require experimental evidence. The [creator source](https://github.com/ProteinDesignLab/caliby) and [Caliby paper](https://doi.org/10.1101/2025.09.30.679633) describe the method.
