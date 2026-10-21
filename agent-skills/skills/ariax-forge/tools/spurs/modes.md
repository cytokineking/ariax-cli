# SPURS models, meaning and limits

| Selection | Output | Meaning |
| --- | --- | --- |
| `spurs score --model single` | result.json; single-ddg.npy | One native ddG per selected substitution; kcal/mol |
| `spurs scan` | single-ddg.csv; single-ddg.npy | L × 20 native ddG matrix in ACDEFGHIKLMNPQRSTVWY order, including WT zero |
| `spurs score --model higher-order` | result.json | Distinct `spurs_multi` checkpoint; joint prediction with learned correction |
| `spurs functional-sites --method paper` | functional-sites.csv; functional-residuals.npy; esm1v-delta-log-likelihood.npy | Dimensionless mean residual plus normalized display score, ranked within this protein |

| `spurs functional-sites --method native-notebook` | Same explicit output layout | Creator notebook comparison; annotation interpretation unqualified |

The named `spurs` asset mounts at `/models/spurs`. It contains the separate single/higher-order configurations and checkpoints, native ESM2 650M base checkpoint and ESM1v 650M model 1. `/inputs` and `/models` are read-only. Outputs use a new directory beneath `/workspace`; caches use `/scratch`.

The higher-order model was trained using single and double variants. The creator recommends variants with many mutations mainly as priors or ranking tools. No pH or temperature parameter enters the predictor. These outputs represent training-condition stability changes and carry no direct melting-temperature or experimental efficacy claim. Mutation effects depend on the supplied WT reference structure and sequence.

Functional-site scoring uses WT-context ESM1v log-probability differences and the single SPURS checkpoint. The default `--method paper` percentile-normalizes negative ddG over all L × 20 variants at the 0.1 and 99.9 percentiles, then fits a sigmoid with double precision. It uses the creator's squared-weight objective and midpoint/upper-scale bounds, with a positive scale and a required successful fit. `functional-fit.json` retains optimizer status and parameters. `residual_mean` is the mean over twenty amino acids at each site; `function_score` scales per-site residuals to [-1,1] for display. Higher scores prioritize follow-up. Biological accuracy remains unmeasured for this bounded case.

The explicit `--method native-notebook` comparison preserves the source function's negative fixed-bound targets and float32 fit. That normalization differs from the paper; the observed fixture retained its starting fit parameters. Its annotation interpretation remains unqualified. Record the chosen method with every result. These corrections leave the neural checkpoints unchanged.

For a structure covering part of a sequence, provide `--sequence /inputs/full.fasta --sequence-start N`, where N is its first 1-based full-sequence position. The segment must match exactly. ESM BOS offsets follow the native function. Constant/non-finite residuals or an unsuccessful corrected fit fail explicitly.

Selected source is the creator's Python 3.11 compatibility beta at `70cbb99af5cdf1f6da392389aaf93fd245610efb`. SPURS checkpoint revision is `0cc7a565af8f31eb122819f95a9d16e27b3d1596`. `spurs2` appears in the hub without a documented inference selection; training, low-N fitness regression, pathogenicity classification and benchmark datasets are outside the shipped matrix.

Creator [README](https://github.com/luo-group/SPURS), [paper](https://www.nature.com/articles/s41467-025-67609-4), [functional implementation](https://github.com/luo-group/SPURS/blob/70cbb99af5cdf1f6da392389aaf93fd245610efb/spurs/functional_site_annotation.py), [higher-order correction report](https://github.com/luo-group/SPURS/issues/4), [many-mutation guidance](https://github.com/luo-group/SPURS/issues/7), [environment update](https://github.com/luo-group/SPURS/issues/16) inform these choices.

SPURS code has MIT terms; its [model card](https://huggingface.co/cyclization9/SPURS) declares MIT. [ESM](https://github.com/facebookresearch/esm) code/model guidance declares MIT. No reference database is shipped. Preserve creator attribution when using the example and distributing derived scientific results.

The recipe also installs lmdb 1.6.2 and removes one unused Atom3D import from the beta PDB utility. The complete native ESM1v file is about 7.83 GB; the shared asset is about 15.81 GB before tar overhead.
