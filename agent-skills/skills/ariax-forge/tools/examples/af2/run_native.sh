#!/bin/sh
# Later assigned GPU only. ROOT and SCRATCH must be new paths.
# sh /inputs/af2/run_native.sh /workspace/af2-UNIQUE ORIGINAL_SESSION_ID /scratch/af2-UNIQUE
set -eu
root="$1"
run_id="$2"
scratch="$3"
mkdir "$root"
mkdir "$scratch"
python3 /inputs/af2/af2_inputs.py /inputs/af2 > "$root/parser.json"
sh /inputs/af2/run_modes.sh "$root/core"
# Select model/seed explicitly. Confidence rank is retained separately.
python3 /inputs/af2/af2_handoff.py "$root/core/alphafold2_ptm" /inputs/af2/alphafold2_ptm.json \
    --job monomer --model 1 --seed 7 --run-id "$run_id" --output "$root/handoffs/monomer.json"
python3 /inputs/af2/af2_handoff.py "$root/core/alphafold2_multimer_v3" /inputs/af2/alphafold2_multimer_v3.json \
    --job insulin --model 1 --seed 7 --run-id "$run_id" --output "$root/handoffs/insulin.json"

run_case() {
    name="$1"; input="$2"; mode="$3"; models="$4"; order="$5"; shift 5
    mkdir "$root/$name"
    timeout --signal=TERM --kill-after=30s 30m colabfold_batch "$input" "$root/$name" \
        --model-type "$mode" --num-models "$models" --model-order "$order" \
        --num-seeds 1 --random-seed 7 --num-recycle 1 --num-ensemble 1 \
        --max-msa 32:64 --num-relax 0 --pair-mode unpaired_paired --pair-strategy greedy \
        --stop-at-score 100 --disable-unified-memory --save-all "$@" \
        > "$root/$name/console.log" 2>&1
    python3 /inputs/af2/af2_outputs.py "$root/$name" "/inputs/af2/$name.json" > "$root/$name/check.json"
}
run_case batch /inputs/af2/batch.fasta alphafold2_ptm 1 1 --msa-mode single_sequence
run_case supplied /inputs/af2/supplied.csv alphafold2_ptm 1 1
run_case homomer /inputs/af2/homomer.a3m alphafold2_multimer_v3 1 1
mkdir "$scratch/ubiquitin" "$scratch/insulin" "$scratch/csv"
cp /inputs/af2/templates/1ubq.pdb "$scratch/ubiquitin/"
cp /inputs/af2/templates/4ins.cif "$scratch/insulin/"
for mode in alphafold2 alphafold2_ptm alphafold2_multimer_v3; do
    input=/inputs/af2/monomer.a3m; templates="$scratch/ubiquitin"; models=2; order=1,2
    if [ "$mode" = alphafold2_multimer_v3 ]; then
        input=/inputs/af2/insulin.a3m; templates="$scratch/insulin"; models=1; order=1
    fi
    run_case "template-$mode" "$input" "$mode" "$models" "$order" \
        --templates --custom-template-path "$templates" --max-template-date 2026-10-04 --max-template-hits 1
done
run_case template-csv /inputs/af2/templates.csv alphafold2_ptm 1 1 \
    --templates --custom-template-cache-path "$scratch/csv" --max-template-date 2026-10-04 --max-template-hits 1
