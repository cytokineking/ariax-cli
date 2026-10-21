# Models, inputs and interpretation

Selected Caliby source: `41d31560c3c73d7980d94f40f3c852b90bfab5c0` (metadata version0.1). Protpardelle1c: `7962da091a335251fa8e5ddef5d2c937fbd9d9ae`, cc95 epoch3490. Caliby and its creator-hosted weight card declare Apache2; Protpardelle code is MIT. AtomWorks-Caliby uses BSD3-Clause. Image notices retain dependency terms.

| Operation | Native command | Models | Input and output |
| --- | --- | --- | --- |
| Single design | caliby design | all four | PDB/CIF directory; seq_des_outputs.csv and CIFs |
| Ensemble design | caliby design-ensemble | all four | conformer directory; seq_des_outputs.csv and CIFs |
| Single score | caliby score | all four | sequence encoded in PDB/CIF; score_outputs.csv |
| Ensemble score | caliby score-ensemble | all four | primary sequence scored against aggregate; score_outputs.csv |
| Ensemble generation | caliby ensembles | Protpardelle1c cc95 epoch3490 | cleaned PDB/CIF directory; copied primary and partial-diffusion decoys |

`ckpt_name_or_path` selects `caliby`, `soluble_caliby`, `caliby_distill` or `soluble_caliby_distill`. Each resolves an existing `.ckpt` under MODEL_PARAMS_DIR/caliby. Literal paths ending `.ckpt` are accepted by the native loader. This contribution does not qualify arbitrary user checkpoints. Additional upstream v1/L models, packers, training and optional AF2 refolding remain outside this package's qualified scope.

Clean inputs first using `caliby clean`. The cleaner keeps supported protein residues and resolved atoms, fixes blank chain IDs and relabels distinct chain/transformation pairs. Inspect its resulting mapping before applying constraints. Native positions use label chain and label_seq_id, with one-letter chain and integer range syntax in the constraint parser. Preserve a mapping to any author numbering used upstream. The example retains A1-46; its pair has A1-46 and B1-46.

Constraint CSV requires pdb_key equal to structure stem or ensemble subdirectory. `fixed_pos_seq=A1-5,B` preserves five A residues and the entire B chain; all remaining positions are designable. `fixed_pos_scn` must be a subset of fixed sequence positions and requires a full `caliby` or `soluble_caliby` checkpoint. The selected distilled-model loader rejects fixed standard-protein sidechains; use fixed_pos_seq for immutable sequences with a distilled model. `fixed_pos_override_seq=A26:L` changes then fixes a residue. `pos_restrict_aatype=A6:AG` restricts design at A6. `symmetry_pos=A10,B10|A11,B11` ties specified positions. Native missing-position warnings require inspection. Qualification checks fixed sequence, whole-chain conditioning, a restricted position, explicit sequence override, tied positions and global omission. Full models receive a fixed-sidechain case; distilled models receive an expected unsupported-sidechain rejection. With an explicit sequence override, input_seq includes that applied override before sampling.

Ensemble root contains one subdirectory per structure. Each holds `<key>.cif` or `<key>.pdb` as primary, followed by naturally sorted conformers. Primary is included by default and max_num_conformers=32 counts it. Run `caliby-check ensemble /workspace/ENSEMBLE/KEY` first. Every conformer must preserve ordered label chain/residue/insertion identities. Match the cleaned input and every conformer after parsing. The native guard also compares residue_index/asym_id. Keep ensemble_ignore_res_idx_mismatch=false.

[Maintainer discussion1](https://github.com/ProteinDesignLab/caliby/issues/1#issuecomment-3473893579) records ignored-residue mismatches, the cleaner fix and expected glycine-only decoys. Reporter confirmed the fix. Decoy sequences are ignored in design; primary sequence supplies fixed residues. Changing labels without establishing correspondence invalidates parameter aggregation.

[Maintainer discussion6](https://github.com/ProteinDesignLab/caliby/issues/6#issuecomment-4159749878) resolves confusion between input_seq and seq. Repeated input_seq values are expected. Designed sequences can repeat through stochastic sampling. Diversity is a property to measure in seq.

Default design requests16 sequences and batch4. Inference uses500 Potts sweeps and anneals to T0.01; override with `++sampling_cfg_overrides.potts_sampling_cfg.potts_temperature=0.1` when appropriate. Creator discusses0.1–0.2 as case-dependent alternatives. Generation defaults32 samples/batch8 with rewind150, while installed acceptance reduces to2/batch1.

CSV sequence strings list chains in alphabetical label-chain order, separated by a colon. The selected scorer reads sequences encoded in structures. The README's score_inputs_csv remark has no corresponding CLI parser in this revision. Score designed CIFs by placing them in an input directory. U is a sum of field and pair terms; lower is favored, with no physical unit or experimental calibration. Compare matching model, residue count, ensemble and settings. Optional local_conditionals arrays are `(N,C)`, C=len(caliby.data.const.POTTS_TOKENS), in that reduced alphabet's order. Interpret them as conditional energies.

The [selected README](https://github.com/ProteinDesignLab/caliby/blob/41d31560c3c73d7980d94f40f3c852b90bfab5c0/README.md) recommends full ensemble design for laboratory candidates; distilled models are less sensitive to small conformational changes. Multichain execution does not establish interface-training equivalence. Experimental function requires separate evidence.
