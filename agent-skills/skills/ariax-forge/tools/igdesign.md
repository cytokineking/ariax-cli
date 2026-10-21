# IgDesign and IgMPNN antibody CDR redesign

Use tool `igdesign` for structure-conditioned redesign of a paired antibody with one antigen chain. Select `--model igdesign` for the ESM2 adapter or `--model igmpnn` for its structural inverse folder. Both use the ACVR2B-holdout checkpoints. Each proposed sequence needs downstream assessment; model cross entropy does not measure binding affinity. Native qualification covers the bounded paired-antibody cases below; read the catalog for each delivery and restoration gate.

The named asset `igdesign-weights` mounts at `/models/igdesign-weights`. Use one CUDA GPU. Qualification used the observed 1N8Z trastuzumab VH B, VL A and HER2 C backbone: 117/107 antibody residues and 581 antigen residues, 805 total. The exact crop retained 40 antigen residues, giving 264 total. One L40 with 49,140 MiB VRAM, 56 GiB host RAM and 28 CPUs ran these cases. Sampled peaks reached 14,709 MiB GPU memory and about 33.8 GiB container RAM. Native IgDesign commands took 36.5–39.5 seconds and IgMPNN 6.3–9.4 seconds in this environment. Minimum hardware requirements and larger envelopes remain unmeasured. [Modes and mapping](igdesign/modes.md) explains the selected paths, patch, terms and native output columns.

Discover the installed inputs:

```sh
ariax skills forge --json
ariax skills forge --reference igdesign --read --json
ariax skills ariax-forge --reference igdesign-modes --read --json
```

Read `data.examples.igdesign` from the discovery response and set `EXAMPLES` to that local directory. Run `python3 "$EXAMPLES/prepare.py" "$EXAMPLES" ./igdesign-inputs` on the execution host. It generates SEQRES headers and configs for this complete observed fixture. Register each file under `igdesign/FILE` with `ariax forge inputs add "$SESSION" --file ./igdesign-inputs/FILE --path igdesign/FILE`; wait for every input to be ready. Local example paths differ from the container's `/inputs` paths.

```sh
ariax forge tools add "$SESSION" --tools igdesign
ariax forge tools wait "$SESSION" igdesign
ariax forge run "$SESSION" --tool igdesign --gpus 0 -- igdesign --model igdesign --config /inputs/igdesign/igdesign-hcdr3.json
ariax forge watch "$SESSION" "$COMMAND_ID"
ariax forge run "$SESSION" --tool igdesign --gpus 0 -- igdesign-check /workspace/igdesign/igdesign-hcdr3.csv --rows 1
```

Use each actual command ID returned by `forge run`. The example's `commands.json` lists every bounded model/CDR and crop command with its checker. Execute a command and wait for its terminal state before its check. Failed or empty results retain their reported state and diagnostics. Start an explicit new command to retry.

Inspect the native `.csv` CDR columns and their cross-entropy fields. The `.identity.json` file links each row to its model, original parsed chains, selected indices and reconstructed full Fv. `.fasta` contains those reconstructed VH/VL sequences. Only the requested CDR positions are replaced; all other positions copy the parsed input. Preserve the input structure/config, CSV, identity, FASTA and checker result with `ariax forge sync "$SESSION" --wait`, then record the checkpoint. Use normal Files export/restore and check recovered outputs before continuing.

The [creator README](https://github.com/AbSciBio/igdesign/blob/70431eef0afaf0496d7d84e22dfdc1980ec9e70e/README.md) and [paper](https://doi.org/10.1101/2023.12.08.570889) describe the method. Heavy-only, nanobody, antigen-sequence-only generation and automatic spatial crop remain unqualified.
