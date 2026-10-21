# Antibody quality and humanness

Choose `antibody-qc` for paired VH/VL or explicitly declared VHH variable-domain
sequences. It returns IMGT residue identities, sequence alerts and BioPhi OASis
repertoire resemblance. The selected TNP sequence module adds nanobody CDR-length
flags. Check the current catalog qualification states for the observed native,
installation and restoration gates before execution.

The full `oasis-v1` asset mounts at `/models/oasis-v1`. Plan at least 120 GiB usable
disk for cold preparation and restoration. The demonstrated batch contains two
paired 120+107-residue inputs and one 125-residue VHH, using one CPU and 2 GiB RAM
under read-only isolation. Cold installation used the complete 23,114,940,416-byte
SQLite reference. Larger batches remain unmeasured. [Methods and terms](antibody-qc/methods.md) explain the
native reference, threshold definitions and excluded structural operations.

Locate the installed example:

```sh
ariax skills forge --json
ariax skills forge --reference antibody-qc --read --json
ariax skills ariax-forge --reference antibody-qc-methods --read --json
```

Use `data.examples.antibody-qc` from the discovery response as `EXAMPLES`. Prepare
inputs with `python3 "$EXAMPLES/prepare.py" --out ./antibody-inputs`. Register
`batch.json` with `ariax forge inputs add "$SESSION" --file
./antibody-inputs/batch.json --path antibody-qc/batch.json`, then wait for readiness.
Select `antibody-qc` with `ariax forge tools add "$SESSION" --tools antibody-qc`
and `ariax forge tools wait "$SESSION" antibody-qc`. Run the exact native example:

```sh
ariax forge run "$SESSION" --tool antibody-qc -- antibody-qc --input /inputs/antibody-qc/batch.json --methods number-liabilities oasis tnp-sequence --out /workspace/antibody-qc/batch
ariax forge watch "$SESSION" "$COMMAND_ID"
```

Choose a fresh `--out` directory on each explicit command. JSON input is a list of
`{id,kind,heavy,light}` records. `kind:"paired"` requires both chains, while
`kind:"vhh"` uses heavy alone. Sequences contain 70..180 uppercase canonical amino
acids and exactly one variable domain. IMGT insertion codes stay in `position`;
`input_index` is the one-based original sequence index. An empty or rejected batch
writes its status and returns exit code 2. A partial result retains every rejected
row and also returns 2. Inspect `reason` before using accepted rows.

The outputs are `result.json`, `residues.tsv` and `liabilities.tsv`. OASis identity
is a fraction from 0 to 1; higher means more 9mers meet the selected human-subject
prevalence threshold. Each peptide retains counts, positions and regions. Paired
identity pools VH/VL peptide counts. Native percentile values also use a 0..1
scale, so 0.9 denotes the 90th reference percentile. Percentiles use BioPhi's antibody reference;
VHH percentiles are null with `no_vhh_calibration`. Motifs and CDR-length flags
suggest follow-up checks. Clinical immunogenicity and experimental developability
remain unmeasured.

Save registered inputs, provenance and the whole output directory with
`ariax forge sync "$SESSION" --wait`. Record the checkpoint ID. Restore through
the normal create/resume flow and inspect the saved results before choosing a
new scientific command. [Example and recovery checks](examples/antibody-qc/README.md)
include the controlled NGT-to-QGT motif change. Humanization is outside this tool.
