# Boltz-2 residual optimization

Choose `boltz2` for the accepted predictor. Select `boltz2-acceleration` to evaluate the explicit residual shortcut with the same Boltz2.2.1 checkpoints. `boltz-resid predict` removes redundant dropout-mask multiplication during inference and preserves random draws. Ordinary `boltz predict` in either image provides the accepted baseline. The [mode reference](boltz2-acceleration/modes.md) records bounded timing, numerical equality and a held CCD artifact-byte gate. Whole-process measurements established no robust general speed benefit; keep the accepted predictor selected.

Read [Boltz inputs](../references/boltz2-inputs.md), [native output meanings](../references/boltz2-results.md) and [affinity interpretation](../references/boltz2-affinity.md). The [example README](examples/boltz2-acceleration/README.md) describes all three finite inputs. The complete named `boltz2` asset contains confidence/affinity checkpoints and chemical components and mounts read-only at `/models/boltz2`. One GPU is required; general RAM/VRAM/disk minima remain unknown. Measure substantive workloads before allocating larger jobs.

## Installed example

Run `ariax skills forge --json`; set `EXAMPLES` from `data.examples.root`. Both `forge` and `ariax-forge` resolve reference `boltz2-acceleration`. SESSION is an authorized live session with this tool in its catalog. Require available host and ready tool.

```sh
ariax forge tools add "$SESSION" --tools boltz2-acceleration --priority boltz2-acceleration --json
ariax forge tools wait "$SESSION" boltz2-acceleration --timeout 1800 --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/boltz2-acceleration/complex.yaml" --path boltz2-acceleration/complex.yaml --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/boltz2-acceleration/check_modes.py" --path boltz2-acceleration/check_modes.py --json
ariax forge inputs list "$SESSION" --json
```

Require both registered paths ready. Use a fresh output root for each prediction. These reduced settings establish bounded operation with synthetic eight-residue chains A/B and single-sequence inference; they provide no binder validation.

```sh
ariax forge run "$SESSION" --tool boltz2-acceleration --gpus 0 --timeout-seconds 1800 --json -- env CUDA_VISIBLE_DEVICES=0 boltz-resid predict /inputs/boltz2-acceleration/complex.yaml --model boltz2 --cache /models/boltz2 --checkpoint /models/boltz2/boltz2_conf.ckpt --out_dir /workspace/boltz2-acceleration-demo --accelerator gpu --devices 1 --recycling_steps 3 --sampling_steps 200 --diffusion_samples 1 --max_parallel_samples 1 --seed 7 --num_workers 0 --preprocessing-threads 1 --output_format mmcif --write_full_pae
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 1800 --json
ariax forge logs "$SESSION" "$COMMAND_ID" --tail 1000 --json
ariax forge run "$SESSION" --tool boltz2-acceleration --gpus 0 --timeout-seconds 120 --json -- python3 /inputs/boltz2-acceleration/check_modes.py /workspace/boltz2-acceleration-demo/boltz_results_complex --input /inputs/boltz2-acceleration/complex.yaml --mols-dir /models/boltz2/mols
```

The qualified one-GPU environment sets `CUDA_VISIBLE_DEVICES=0` before the process starts. Forge selects the host GPU with `--gpus`; CUDA sees that assigned GPU as logical device0. The accepted baseline and optimized build use this same setting.

Record each returned command ID and inspect its terminal status. A local wait timeout requires inspection of the same command. Native preprocessing can skip a failed input while exiting zero; require the checker to pass. It validates emitted chains, residues, atoms, finite coordinates, confidence fields and token-aware PAE/pLDDT shapes. Preserve `B72_RESID` counters with command logs to establish that the shortcut ran.

## Results and continuation

The result directory contains predictions/complex/complex_model_0.cif, confidence_complex_model_0.json and full PAE/pLDDT arrays. CIF uses native chain/residue numbering; PAE is in angstroms and confidence/pLDDT lie on0–1. Inspect molecular placement and geometry. Confidence describes the model's estimate; measured binding and specificity require experiments. Affinity examples produce separate native affinity JSON whose two outputs serve different tasks, as described in the affinity reference.

Save registered inputs, YAML/settings, command IDs, complete native results and checker reports through `ariax forge sync "$SESSION" --wait --timeout 1800 --json`. Record its completed checkpoint UUID. Use `ariax forge files` and `download` for explicit export, then close the session and confirm closure. Resume the same project with its current control revision, restore-session and checkpoint, as documented in the [outputs guide](../outputs.md). A fresh session prepares the image and named asset; restore recovers inputs/workspace. Run the saved checker explicitly after readiness. Scientific prediction is an explicit new command.

Changed inputs require a fresh output directory because native2.2.1 can reuse processed inputs. Unsupported optimization flags and model choices fail visibly. No fast/big/multi-GPU optimization is shipped. The accepted MSA and molecular parsing boundaries continue; public service use follows its policy and serialized campaign path. MSE was emitted as MET in accepted qualification, so that modification remains chemically unqualified. Caller-selected service URLs require a usable authorized service.

The [research reference](boltz2-acceleration/modes.md) links selected source, terms and observed limits. Cite [Boltz-2](https://doi.org/10.1101/2025.06.14.659707) and the [reference optimization source](https://github.com/anthropics/uplifting-biomolecular-modeling). Code and weights retain their recorded notices. This experimental optimization has no claim to improve scientific accuracy.
