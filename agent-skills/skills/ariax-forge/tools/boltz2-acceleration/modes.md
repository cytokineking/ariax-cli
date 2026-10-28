# Boltz-2 acceleration modes and limits

Use `boltz2` for routine prediction. `boltz2-acceleration` offers only the explicit residual shortcut through `boltz-resid predict`; ordinary `boltz predict` stays native in either image. Bounded comparisons showed no robust general speed benefit. Measure the intended workload before choosing the shortcut, and do not infer improved scientific accuracy.

## Scope and selection

| Mode or input | Behavior and limits |
| --- | --- |
| Baseline | `boltz predict` uses native Boltz 2.2.1 and the complete read-only `/models/boltz2` asset. It remains the recommended predictor. |
| Residual shortcut | `boltz-resid predict` uses the same checkpoints and native arguments, preserving random draws while removing redundant inference dropout-mask multiplication. Training is unsupported and fails explicitly. |
| Other optimization modes | Other reference-kit `exact` levers, `fast`, `big` and multi-GPU optimization are not shipped. Unsupported optimization flags and model selections fail visibly. There is no implicit optimization through autoload or `BOLTZ2_OPT`. |
| Native molecular inputs | Protein, complexes, DNA/RNA, SMILES/CCD ligands, modified/cyclic polymers, bonds, templates, constraints and batches retain the [native input rules](../../references/boltz2-inputs.md). Supplied A3M/paired CSV and server MSA use the native transport and parsing. This does not establish shortcut speed or equality across those modes. |
| Affinity | The separate native affinity checkpoint uses a crop of the top-ranked structure. Use one specified small molecule against a protein target; protein/DNA/RNA binders, multi-copy ligands and multi-residue CCD lists are outside the [affinity recipe](../../references/boltz2-affinity.md). |

Shortcut comparisons covered a synthetic protein pair and protein/L-tyrosine affinity with SMILES or CCD TYR. They do not establish general output equality, scientific accuracy, biological function or library-ranking performance. CCD artifact byte-exactness remains unresolved: chemical-component row ordering differed even where the tested atom identities, coordinates, JSON and arrays agreed. Do not promise byte-identical CCD artifacts.

MSE has been emitted as MET and remains chemically unqualified. Verify intended modifications, ligand stereochemistry, charge and atom identity in the actual outputs. The shortcut leaves guidance unchanged and makes no new guidance-accuracy claim. Caller-selected MSA services remain unverified; public or custom service use requires authorized sequence disclosure and compliance with that service's policy.

Use one GPU and set `CUDA_VISIBLE_DEVICES=0` before either baseline or residual execution in the tested L40 setup. Forge's `--gpus` selects the host GPU; CUDA uses logical device 0. General RAM, VRAM and disk minima, workload maxima and performance on other hardware remain unknown.

## Inputs, commands and result checks

Follow the [main guide](../boltz2-acceleration.md) to prepare the tool, stage inputs and run `boltz-resid predict`. All three shipped YAML examples use `msa: empty`, so they make no MSA service request:

| Example under `examples/boltz2-acceleration/` | Purpose |
| --- | --- |
| `complex.yaml` | Synthetic eight-residue chains A/B; execution example only. |
| `affinity_smiles.yaml` | Full protein with L-tyrosine specified as SMILES and a native affinity request. |
| `affinity_ccd.yaml` | Same protein with CCD TYR and a native affinity request; preserve its separate chemical representation. |

For affinity, stage the selected YAML, replace the main command's input path, and choose a fresh output root. Keep `--model boltz2 --checkpoint /models/boltz2/boltz2_conf.ckpt` and add `--affinity_checkpoint /models/boltz2/boltz2_aff.ckpt --sampling_steps_affinity 200 --diffusion_samples_affinity 5`. The main command requests one structure sample; these additional flags request five affinity diffusion samples. Use the input stem in `boltz_results_<stem>` and pass that root plus the originating YAML to `check_modes.py --mols-dir /models/boltz2/mols`.

Require terminal command success, every requested input and rank, and the native identity/chemistry checker to pass. Preprocessing may skip failed inputs even when the process exits zero. Check chains, residues, atoms, finite coordinates, confidence fields and token-aware PAE/pLDDT dimensions. Run the checker on actual results; passing a bundled fixture does not validate a customer's input or result. Preserve the complete native output and checker report with the settings and command IDs.

Coordinates use native CIF numbering; confidence and pLDDT are 0–1, and PAE is in angstroms per token pair. Ligands use different tokenization from polymer residues. Affinity JSON is separate from structural confidence: `affinity_probability_binary` estimates binder/decoy probability, while `affinity_pred_value` predicts log10(IC50 in micromolar), with lower values indicating stronger predicted affinity. Retain both ensemble heads and the matching top-ranked structure. Neither field is a measured affinity or proof of binding. See the [native output](../../references/boltz2-results.md) and [affinity](../../references/boltz2-affinity.md) references before interpreting or handing off results.

## Sources and license notices

The adapter uses the residual transformation from the unmaintained [reference collection at commit `f4f62fa6592ae4938d49b1757bea0cfeff9f468e`](https://github.com/anthropics/uplifting-biomolecular-modeling/tree/f4f62fa6592ae4938d49b1757bea0cfeff9f468e), specifically its [residual implementation](https://github.com/anthropics/uplifting-biomolecular-modeling/blob/f4f62fa6592ae4938d49b1757bea0cfeff9f468e/boltz2/opt/forward/trunk_levers/boltz_trunk_levers.py). The collection's [mode inventory](https://github.com/anthropics/uplifting-biomolecular-modeling/blob/f4f62fa6592ae4938d49b1757bea0cfeff9f468e/boltz2/opt/boltz2_opt/modes.py) describes additional optimizations that this tool does not ship. Native behavior follows the [Boltz 2.2.1 CLI](https://github.com/jwohlwend/boltz/blob/v2.2.1/src/boltz/main.py), [prediction guide](https://github.com/jwohlwend/boltz/blob/v2.2.1/docs/prediction.md) and [output writer](https://github.com/jwohlwend/boltz/blob/v2.2.1/src/boltz/data/write/writer.py).

The [reference-kit license](https://github.com/anthropics/uplifting-biomolecular-modeling/blob/f4f62fa6592ae4938d49b1757bea0cfeff9f468e/boltz2/LICENSE) is Apache-2.0 with component notices. The [Boltz README](https://github.com/jwohlwend/boltz/blob/v2.2.1/README.md) releases code and weights under MIT; vendored components retain their notices. Chemical archive terms are inherited from the prepared assets; no new chemical release is claimed. Cite the [Boltz-2 paper](https://doi.org/10.1101/2025.06.14.659707) and the reference optimization source.
