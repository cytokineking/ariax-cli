# ProteinMPNN acceleration

Use `mpnn-acceleration` to compare stock and optimized full-backbone sequence design. Select `--mode off` or `--mode exact` explicitly. Small runs can take longer in exact mode because of startup and compilation overhead. Read [the model and mode limits](mpnn-acceleration/modes.md) before choosing an optimized path. Sequence likelihood describes model support; experimental activity remains unmeasured.

Use the original soluble-trained checkpoints through --variant soluble and /models/solublempnn. Vanilla weights live under /models/proteinmpnn/vanilla. Supply complete N/CA/C/O coordinates, explicit chains and fixed positions. [The existing MPNN guide](mpnn.md) explains original residue numbering and prepared constraints.

Set `EXAMPLES` from `data.examples["mpnn-acceleration"]` in `ariax skills forge --tool mpnn-acceleration --json`; SESSION is the authorized session UUID. Readiness and each returned command must finish before its dependent command. The installed reference aliases are mpnn-acceleration, mpnn-acceleration-modes and mpnn-acceleration-fixtures under both forge and ariax-forge.

```sh
ariax forge tools add "$SESSION" --tools mpnn-acceleration --json
ariax forge tools wait "$SESSION" mpnn-acceleration --timeout 1800 --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/protein.pdb" --path mpnn-acceleration/protein.pdb --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/prepare.py" --path mpnn-acceleration/prepare.py --json
ariax forge run "$SESSION" --tool mpnn-acceleration --gpus 0 --timeout-seconds 1800 --json -- python /inputs/mpnn-acceleration/prepare.py --pdb /inputs/mpnn-acceleration/protein.pdb --out /workspace/mpnn-acceleration/batch
ariax forge run "$SESSION" --tool mpnn-acceleration --gpus 0 --timeout-seconds 1800 --json -- mpnn-acceleration --mode off --variant vanilla --jsonl_path /workspace/mpnn-acceleration/batch/parsed.jsonl --fixed_positions_jsonl /workspace/mpnn-acceleration/batch/fixed.jsonl --model_name v_48_020 --seed 37 --num_seq_per_target 2 --batch_size 1 --sampling_temp 0.3 --save_score 1 --save_probs 1 --out_folder /workspace/mpnn-acceleration/off
ariax forge run "$SESSION" --tool mpnn-acceleration --gpus 0 --timeout-seconds 1800 --json -- mpnn-acceleration --mode exact --variant vanilla --jsonl_path /workspace/mpnn-acceleration/batch/parsed.jsonl --fixed_positions_jsonl /workspace/mpnn-acceleration/batch/fixed.jsonl --model_name v_48_020 --seed 37 --num_seq_per_target 2 --batch_size 1 --sampling_temp 0.3 --save_score 1 --save_probs 1 --out_folder /workspace/mpnn-acceleration/exact
```

Inspect seqs/crop64.fa and seqs/crop93.fa, including two generated samples after the native sequence, and the matching scores/probs NPZ arrays. Fixed positions must retain their input identities. score averages negative natural-log probability over designed positions; global_score covers all positions. Lower values indicate greater model support. Probability columns follow ACDEFGHIKLMNPQRSTVWYX. Preserve arrays and masks when comparing models. A rejected GPU probe returns exit 3 and produces an explicit failed command; empty parsed inputs fail before design.

Save registered inputs and the complete `/workspace/mpnn-acceleration` directory through `forge sync`. Use [saved results](../outputs.md) and [project controls](../SKILL.md#project-controls-and-resume) for current project exports, closure and continuation.

Measurements appear in the mode reference. Other hardware, lengths and batch envelopes remain unmeasured. Terms and scientific sources: [ProteinMPNN paper](https://www.science.org/doi/10.1126/science.add2187), [stock MIT source](https://github.com/dauparas/ProteinMPNN/tree/8907e6671bfbfc92303b5f79c4b5e6ce47cdef57), [Anthropic kit](https://github.com/anthropics/uplifting-biomolecular-modeling/tree/f4f62fa6592ae4938d49b1757bea0cfeff9f468e/proteinmpnn). Kit original code uses Apache-2.0; the derived worker uses MIT. Existing weights retain their source notices; no separate weight license was found. No database is required.
