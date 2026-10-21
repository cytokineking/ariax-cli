# Genie3 native design


The native model represents designed scaffold positions as CA tokens and conditioned residues with CA and selected sidechain atom tokens. Generated PDBs are inspectable generation outputs. Final full structures require sequence design and prediction. Use B27 ProteinMPNN's CA-only v_48_020 checkpoint and the accepted Boltz2 package for the compatible handoff below.

## Inputs and commands

Upload the files in [genie3/](genie3/unconditional.yaml) under `/inputs/genie3/`. Each supplied config has an explicit seed, model paths, a fresh output directory, one sample and the native 100-step DDIM settings. The target fixture conditions on BHRF1 geometry, preserves its sequence and selects its upstream extended interface residues. Its binder length is reduced to exactly 80. The bounded qualification uses one sample per mode.

```sh
genie3-generate --config /inputs/genie3/unconditional.yaml
genie3-generate --config /inputs/genie3/motif.yaml
genie3-generate --config /inputs/genie3/target.yaml
```

Select `genie3` and GPU 0 through the normal Forge command interface. `genie3-generate` calls native generation and retains raw input masks, native tensors, source residue maps and PDBs. It requires an explicit seed and absent output directory. It does not replay a completed or failed run. Native `genie3 generate` is also installed; preserve its own settings and outputs when using it directly.

For a motif problem, `paths.dataset` contains `problems/<name>.json`. `motif_filepaths` point to upstream annotated PDBs; REMARK 999 INPUT defines motif segments. `segment_config_str` combines sampled scaffold length ranges with motif selections such as `A1`. Minimum/maximum total lengths retain native meaning. Known motif sequence is fixed in MPNN; native UNK positions have no sequence constraint and remain designable. Target problems use `target_pdb_filepath`, binder length bounds and `target_interface_residues`; `cond_strategy` selects the named interface list. Preserve supplied chain/residue identities and the native sampled `scaffold_info.tsv`.

If generation has already written its structures and tensors but helper metadata failed, `genie3-generate --config CONFIG --finalize-existing` writes metadata from those retained files. The supplied parsed config must match retained `request.yaml`; a missing original or any mismatch fails before metadata changes. This explicit operation does not generate another sample. Keep the original failure record. The guarded-image verification records six passing cases and full remote restoration.

For each generated PDB, choose the explicit native mode and a fresh handoff directory:

```sh
genie3-handoff prepare --pdb /workspace/b51/unconditional/pdbs/50_0.pdb --mode unconditional --out /workspace/b51/handoff-unconditional
mpnn-prepare --pdb /workspace/b51/handoff-unconditional/ca.pdb --plan /workspace/b51/handoff-unconditional/plan.json --ca-only --out /workspace/b51/prepared-unconditional
proteinmpnn --prepared /workspace/b51/prepared-unconditional --ca_only --model_name v_48_020 --seed 51 --sampling_temp 0.1 --num_seq_per_target 1 --batch_size 1 --save_probs 1 --save_score 1 --out_folder /workspace/b51/mpnn-unconditional
mpnn-check --prepared /workspace/b51/prepared-unconditional --output /workspace/b51/mpnn-unconditional --family protein --mode design --report /workspace/b51/mpnn-unconditional-check.json
genie3-handoff sequence --handoff /workspace/b51/handoff-unconditional --prepared /workspace/b51/prepared-unconditional --fasta /workspace/b51/mpnn-unconditional/seqs/backbone.fa --out /workspace/b51/predict-input-unconditional
boltz predict /workspace/b51/predict-input-unconditional/design.yaml --model boltz2 --cache /models/boltz2 --checkpoint /models/boltz2/boltz2_conf.ckpt --out_dir /workspace/b51/predict-unconditional --accelerator gpu --devices 1 --recycling_steps 3 --sampling_steps 200 --diffusion_samples 1 --max_parallel_samples 1 --seed 51 --num_workers 0 --preprocessing-threads 1 --output_format mmcif --write_full_pae
```

Run MPNN commands in `proteinmpnn`, generation/handoff commands in `genie3`, and prediction in `boltz2`. The helper keeps native CA geometry unchanged, replaces free UNK with explicit temporary ALA placeholders for B27's parser, and records those placeholders in its map. It rejects changes to fixed motif or target residues and restores every fixed target chain in the predictor input. The supplied Boltz input declares an empty MSA; it does not contact a public MSA server.

## Output interpretation and limits

Retain generation arrays, PDBs, sampled motif configurations, original problem files, maps, MPNN sequences/probabilities/scores, Boltz confidence and PAE/pLDDT arrays, and final CIFs. A successful process can produce a rejected scientific candidate. The upstream unconditional filter requires self-consistency CA RMSD <2 Å. Motif success additionally requires motif backbone RMSD <1 Å, with all-atom criteria <2 Å or strict <1 Å. Binder filtering uses complex RMSD <2.5 Å, binder pTM >0.8, minimum interface PAE <1.5 Å, and its native hotspot coverage criterion. Keep missing metrics unavailable; the Boltz handoff does not replace ColabFold-specific binder metrics.

The native completion profiles add ESMFold/ColabFold evaluation, beam search and iterative refinement with their finite settings, retained defaults and explicit continuation. Private publication and fresh installation passed on October 9, 2026. The installed U1 commands completed five designs and 40 ESMFold predictions, followed by all 14 restored-profile checks and complete Files/R2 restoration. The earlier qualification below retains its original scope and unavailable binder metrics. Training, predecessor checkpoints, joint sequence/sidechain generation and multi-GPU execution remain excluded.

The qualification report records an accepted unconditional candidate, a rejected motif candidate and a target-conditioned candidate whose binding success remains unaccepted. It also records measured resources and durable private exports. Broad hardware minima remain unknown. B55g completed private delivery, installed discovery, six guard/handoff cases and one new native unconditional loader/output check. Coordinator catalog admission, broader qualification and production remain separate. Fixtures retain the upstream [Apache-2.0 notice](genie3/LICENSE).
