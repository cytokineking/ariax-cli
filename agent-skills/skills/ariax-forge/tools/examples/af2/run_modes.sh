#!/bin/sh
# Run inside the AF2 container on the later assigned remote GPU slot.
# Invoke: sh /inputs/af2/run_modes.sh /workspace/af2-native-UNIQUE
set -eu
root="$1"
# Refuse an old root, including one restored from a checkpoint.
mkdir "$root"
for mode in alphafold2 alphafold2_ptm alphafold2_multimer_v3; do
    input=/inputs/af2/monomer.a3m
    if [ "$mode" = alphafold2_multimer_v3 ]; then input=/inputs/af2/insulin.a3m; fi
    mkdir "$root/$mode"
    timeout --signal=TERM --kill-after=30s 30m colabfold_batch "$input" "$root/$mode" --model-type "$mode" \
        --num-models 5 --model-order 1,2,3,4,5 --num-seeds 1 --random-seed 7 \
        --num-recycle 1 --num-ensemble 1 --max-msa 32:64 --num-relax 0 \
        --pair-mode unpaired_paired --pair-strategy greedy --stop-at-score 100 \
        --disable-unified-memory --save-all
    python3 /inputs/af2/af2_outputs.py "$root/$mode" "/inputs/af2/$mode.json" > "$root/$mode/check.json"
done
