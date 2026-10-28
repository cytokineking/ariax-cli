# ESMC capacity and continuation

Use `esmc-300m`, `esmc-600m` or `esmc-6b` with embeddings, logits,
hidden-states or masked-logits. BF16 is the default; `--precision fp32` is an
explicit alternative. Each item has one protein sequence. The supported
hardware profile uses native SDPA on one NVIDIA L40. The image requires driver
>=580.95.05. Capacity on other GPU types remains unverified.

The supported profile is 1..1024 residues per item and 1..8 sequential items.
One command owns the GPU until terminal. Batch inference remains sequential,
so item count increases time and saved output
space rather than parallel inference capacity. The adapter leaves larger
requests available, but capacity beyond this profile remains unverified.

| Model | Required usable CPUs | Catalog RAM minimum | Free payload disk, GiB | GPU |
| --- | ---: | ---: | ---: | --- |
| 300M | 8 | Unset | 250 | One L40, at least 44 GiB usable VRAM |
| 600M | 8 | Unset | 250 | One L40, at least 44 GiB usable VRAM |
| 6B | 8 | Unset | 250 | One L40, at least 44 GiB usable VRAM |

The GPU, CPU and disk floors cover this profile, cold named-asset
preparation and complete array retention. The catalog imposes no fixed RAM
floor. A 32 GiB container memory limit with no swap has sufficed for this
bounded profile; leave host memory for preparation,
Docker, Files and transfer buffers. Reserve additional disk for longer projects
and repeated checkpoints. All N+1 hidden layers are exported as float32,
including BF16 inference: eight 1024-residue 6B items contain 6.328 GiB of raw
hidden-state values before metadata and compression. Compressed sizes vary.

FASTA and single-chain JSON accept the standard amino acids and X/B/Z/U/O.
Masks are one based, repeatable and apply to every item. Use positions that fit
the shortest sequence. All supplied positions are masked in one forward pass;
duplicate positions normalize to one mask. Logits retain all 64 native channels
and the saved vocabulary. Representation arrays exclude BOS/EOS; saved token
IDs include them. See [array definitions](../biohub-esm.md#read-and-check-outputs).

Upload the bounded example after the chosen tool is ready:

```sh
ariax forge inputs add "$SESSION" --file "$EXAMPLES/length-batch.fasta" --path biohub-esm/length-batch.fasta --json
ariax forge inputs list "$SESSION" --json
ariax forge run "$SESSION" --tool esmc-600m --gpus 0 --timeout-seconds 3600 --json -- biohub-esm esmc --model esmc-600m --mode embeddings --precision bf16 --input /inputs/biohub-esm/length-batch.fasta --output /workspace/biohub-esm/length-embeddings
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 3600 --json
```

Use `length-batch.json` and `--precision fp32` for the JSON/FP32 case. Select
the same model in `--tool` and `--model`. Use a fresh output directory per
scientific request. Full hidden-state serialization can take several minutes.

## Explicit continuation

Upload `interruption.json`, start a 6B hidden-state batch, and retain its returned
command ID. Cancellation is optional and explicit:

```sh
ariax forge inputs add "$SESSION" --file "$EXAMPLES/interruption.json" --path biohub-esm/interruption.json --json
ariax forge run "$SESSION" --tool esmc-6b --gpus 0 --timeout-seconds 3600 --json -- biohub-esm esmc --model esmc-6b --mode hidden-states --precision bf16 --input /inputs/biohub-esm/interruption.json --output /workspace/biohub-esm/interrupted-6b
ariax forge cancel "$SESSION" "$COMMAND_ID" --json
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 3600 --json
ariax forge sync "$SESSION" --wait --timeout 1800 --json
```

After the command is terminal and any same-project restore is complete, read
`batch.json`. Completed items stay complete. An explicit new command with the
same input/settings and `--resume` runs only unfinished items:

```sh
ariax forge run "$SESSION" --tool esmc-6b --gpus 0 --timeout-seconds 3600 --json -- biohub-esm esmc --model esmc-6b --mode hidden-states --precision bf16 --input /inputs/biohub-esm/interruption.json --output /workspace/biohub-esm/interrupted-6b --resume
ariax forge watch "$SESSION" "$RESUME_COMMAND_ID" --timeout 3600 --json
ariax forge run "$SESSION" --tool esmc-6b --timeout-seconds 1800 --json -- biohub-esm-check /workspace/biohub-esm/interrupted-6b
ariax forge watch "$SESSION" "$CHECK_COMMAND_ID" --timeout 1800 --json
ariax forge sync "$SESSION" --wait --timeout 1800 --json
ariax forge files "$SESSION" --path /workspace/biohub-esm/interrupted-6b --checkpoint "$CHECKPOINT" --json
ariax forge download "$SESSION" "$EXPORTED_NPZ_PATH" --checkpoint "$CHECKPOINT" --dest ./sequence.npz --json
```

Use the NPZ path from the successful item's manifest, including its generated
attempt directory. Files restoration starts no inference and recreates named
assets normally. Prior unfinished attempts remain in `previous_attempts` and
their directories. Missing completed exports require a new run directory.
Follow [saved results](../../outputs.md) and honor any project human hold.
