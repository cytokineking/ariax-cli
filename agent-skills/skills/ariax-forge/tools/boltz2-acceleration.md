# Boltz-2 residual shortcut

Use [ordinary `boltz2`](boltz2.md) as the recommended predictor. Choose `boltz2-acceleration` only to evaluate an experimental residual shortcut with the same Boltz 2.2.1 checkpoints. `boltz-resid predict` removes redundant dropout-mask multiplication during inference while preserving random draws. Ordinary `boltz predict` in either image runs the baseline. No robust general speed benefit or improvement in scientific accuracy has been demonstrated.

Read [Boltz inputs](../references/boltz2-inputs.md), [native output meanings](../references/boltz2-results.md) and [affinity interpretation](../references/boltz2-affinity.md). The [mode reference](boltz2-acceleration/modes.md) describes supported scope, unresolved limits and affinity examples. The complete named `boltz2` asset contains confidence and affinity checkpoints plus chemical components, mounted read-only at `/models/boltz2`. One GPU is required; general RAM, VRAM and disk minima remain unknown. Measure the intended workload before allocating larger jobs.

## Installed example

Run `ariax skills forge --tool boltz2-acceleration --json`; set `EXAMPLES` from `data.examples.boltz2-acceleration`. Both `forge` and `ariax-forge` resolve reference `boltz2-acceleration`. `SESSION` is an authorized live session with this tool in its catalog. Require an available host and ready tool.

```sh
ariax forge tools add "$SESSION" --tools boltz2-acceleration --priority boltz2-acceleration --json
ariax forge tools wait "$SESSION" boltz2-acceleration --timeout 1800 --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/complex.yaml" --path boltz2-acceleration/complex.yaml --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/check_modes.py" --path boltz2-acceleration/check_modes.py --json
ariax forge inputs list "$SESSION" --json
```

Require both registered paths ready. Use a fresh output root for each prediction, especially after changing inputs: native 2.2.1 can reuse processed inputs. This example uses synthetic eight-residue chains A/B and explicit single-sequence inference (`msa: empty`). It demonstrates execution and provides no binder validation.

```sh
ariax forge run "$SESSION" --tool boltz2-acceleration --gpus 0 --timeout-seconds 1800 --json -- env CUDA_VISIBLE_DEVICES=0 boltz-resid predict /inputs/boltz2-acceleration/complex.yaml --model boltz2 --cache /models/boltz2 --checkpoint /models/boltz2/boltz2_conf.ckpt --out_dir /workspace/boltz2-acceleration-demo --accelerator gpu --devices 1 --recycling_steps 3 --sampling_steps 200 --diffusion_samples 1 --max_parallel_samples 1 --seed 7 --num_workers 0 --preprocessing-threads 1 --output_format mmcif --write_full_pae
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 1800 --json
ariax forge logs "$SESSION" "$COMMAND_ID" --tail 1000 --json
ariax forge run "$SESSION" --tool boltz2-acceleration --gpus 0 --timeout-seconds 120 --json -- python3 /inputs/boltz2-acceleration/check_modes.py /workspace/boltz2-acceleration-demo/boltz_results_complex --input /inputs/boltz2-acceleration/complex.yaml --mols-dir /models/boltz2/mols
```

Set `CUDA_VISIBLE_DEVICES=0` before starting either the baseline or residual command in this one-GPU setup. Forge selects the host GPU with `--gpus`; CUDA sees that assigned GPU as logical device 0. This explicit setting is required for the tested L40 configuration.

Record each returned command ID and inspect its terminal status. A local wait timeout does not cancel the command; inspect that same command before resubmitting. Native preprocessing can skip a failed input while exiting zero, so require the checker to pass against the actual input and results. It validates emitted chains, residues, atoms, finite coordinates, confidence fields and token-aware PAE/pLDDT shapes. Preserve `B72_RESID` counters with command logs to confirm that the shortcut ran.

## Results and continuation

The example result root is `/workspace/boltz2-acceleration-demo/boltz_results_complex`. Under `predictions/complex/`, `complex_model_0.cif` contains coordinates, `confidence_complex_model_0.json` contains confidence scores, and the PAE/pLDDT NPZ files contain token-level arrays. CIF uses native chain/residue numbering; PAE is in angstroms and confidence/pLDDT lie on 0–1. Ligand tokens differ from polymer residues; use the native output reference when mapping arrays. Inspect molecular placement, geometry and intended chemistry. Confidence does not establish measured binding or specificity.

Save registered inputs, YAML/settings, command IDs, complete native results and checker reports through `ariax forge sync "$SESSION" --wait --timeout 1800 --json`. Inspect saved results with `ariax forge files` and use `link` or `download` for explicit access, keeping bulk scientific outputs in remote storage under the workstation storage policy. Close the session and confirm closure to release compute.

Resume the same project with its current control revision, as documented in the [outputs guide](../outputs.md). Resume allocates compute under normal billing. The new session prepares the image and named asset; restore recovers inputs/workspace and never replays commands. Run the saved checker explicitly after readiness; a new prediction requires an explicit command.

Unsupported optimization flags and model choices fail visibly. No `fast`, `big` or multi-GPU optimization is shipped. MSA and molecular parsing retain the native limits: MSE has been emitted as MET and remains chemically unqualified; caller-selected MSA services remain unverified and require a usable authorized service. Public MSA use must follow the service policy and authorized sequence disclosure.

Cite [Boltz-2](https://doi.org/10.1101/2025.06.14.659707) and the [reference optimization source](https://github.com/anthropics/uplifting-biomolecular-modeling). See [sources and license notices](boltz2-acceleration/modes.md#sources-and-license-notices).
