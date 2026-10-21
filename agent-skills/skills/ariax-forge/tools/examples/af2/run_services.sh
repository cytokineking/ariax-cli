#!/bin/sh
# One explicitly selected native service case/stage from one approved host/IP.
set -eu
root="$1"; run_id="$2"; host="$3"; name="$4"; stage="$5"
execution="${6:-native}"
case "$execution" in
    native) ;;
    audit-override)
        if [ "$host" != https://api.colabfold.com:443 ]; then
            echo 'Public override audit requires the same public service at explicit HTTPS port 443' >&2; exit 2
        fi ;;
    *) echo 'Choose native or audit-override execution' >&2; exit 2 ;;
esac
run_batch() {
    limit="$1"; phase="$2"; audit="$3"; shift 3
    if [ "$execution" = audit-override ]; then
        timeout --signal=TERM --kill-after=30s "$limit" python3 /inputs/af2/af2_endpoint_override.py "$audit" "$phase" -- "$@"
    else
        timeout --signal=TERM --kill-after=30s "$limit" colabfold_batch "$@"
    fi
}
case "$name" in
    monomer|unpaired|paired|unpaired_paired|paired_greedy_3chain|paired_complete_3chain|template_monomer|template_heteromer) ;;
    *) echo 'Choose a case from completion-matrix.json' >&2; exit 2 ;;
esac
case "$stage" in search|predict) ;; *) echo 'Choose search or predict' >&2; exit 2 ;; esac
python3 - "$host" <<'PY'
import sys
from urllib.parse import urlsplit
u = urlsplit(sys.argv[1])
if u.scheme != 'https' or not u.hostname or u.username or u.password or u.query or u.fragment or u.path.endswith('/'):
    raise SystemExit('Use a clean HTTPS base URL without a trailing slash; native config records it')
PY
input=/inputs/af2/insulin.fasta; job=insulin; mode=alphafold2_multimer_v3
pair="$name"; strategy=greedy; manifest=/inputs/af2/alphafold2_multimer_v3.json
templates=false
case "$name" in
    monomer|template_monomer)
        input=/inputs/af2/search.fasta; job=ubiquitin; mode=alphafold2_ptm
        pair=unpaired; manifest=/inputs/af2/alphafold2_ptm.json ;;
    unpaired_paired) strategy=complete ;;
    paired_greedy_3chain|paired_complete_3chain)
        input=/inputs/af2/three-chain.fasta; job=three_chain; pair=paired
        manifest=/inputs/af2/three-chain.json
        if [ "$name" = paired_complete_3chain ]; then strategy=complete; fi ;;
    template_heteromer) pair=unpaired_paired ;;
esac
# Retain the previously accepted monomer's recorded pair-mode label.
if [ "$name" = monomer ]; then pair=unpaired_paired; fi
case "$name" in template_*) templates=true ;; esac
if [ "$stage" = search ]; then
    mkdir "$root"
    mkdir "$root/$name" "$root/$name/msa"
    python3 - "$manifest" "$root/$name/manifest.json" "$job" "$host" "$pair" "$strategy" "$templates" <<'PY'
import json,sys
from pathlib import Path
source,out,job,host,pair,strategy,templates=sys.argv[1:]
x=json.loads(Path(source).read_text()); x['models']=[1]
x['settings'].update(num_models=1,model_order=[1],host_url=host,pair_mode=pair,pairing_strategy=strategy,use_templates=templates=='true')
x['cases'][0]['job']=job
x['cases'][0]['source']={'server_url':host,'database_version':'unknown unless exposed by the selected operator or returned metadata'}
if templates=='true':
    x['settings'].update(max_template_date='2026-10-09',max_template_hits=4)
    x['cases'][0]['require_templates']=list(x['cases'][0]['chains'])
Path(out).write_text(json.dumps(x,indent=2)+'\n')
PY
    set --
    if [ "$templates" = true ]; then set -- --templates --max-template-date 2026-10-09 --max-template-hits 4; fi
    run_batch 15m search "$root/$name/msa/requests.jsonl" "$input" "$root/$name/msa" \
        --msa-only --model-type "$mode" --host-url "$host" --msa-mode mmseqs2_uniref_env \
        --pair-mode "$pair" --pair-strategy "$strategy" "$@" > "$root/$name/msa/console.log" 2>&1
    test -s "$root/$name/msa/$job.a3m"
    python3 /inputs/af2/af2_features.py /inputs/af2 --msa "$root/$name/msa/$job.a3m" \
        --mode "$mode" --manifest "$root/$name/manifest.json" > "$root/$name/msa-dimensions.json"
    if [ "$templates" = true ]; then
        test -s "$root/$name/msa/$job.pickle"
        python3 - "$root/$name/msa/${job}_template_domain_names.json" "$root/$name/manifest.json" <<'PY'
import json,sys
from pathlib import Path
domains=json.loads(Path(sys.argv[1]).read_text())
case=json.loads(Path(sys.argv[2]).read_text())['cases'][0]
for chain in case['require_templates']:
    hits=domains.get(chain)
    if not isinstance(hits,list) or not any(isinstance(hit,str) and hit.strip() for hit in hits):
        raise SystemExit(f'No native service template selected for chain {chain}; preserve this failure')
PY
    fi
    if [ "$execution" = audit-override ]; then
        python3 - "$root/$name/msa/requests.jsonl" "$name" <<'PY'
import json,sys
from pathlib import Path
name=sys.argv[2]
rows=[json.loads(line) for line in Path(sys.argv[1]).read_text().splitlines()]
seen={(x['method'],x['route']) for x in rows if x['event']=='request'}
required={('GET','/result/download/{id}')}
if name in ('monomer','unpaired','unpaired_paired','template_monomer','template_heteromer'):
    required.add(('POST','/ticket/msa'))
if name in ('paired','unpaired_paired','paired_greedy_3chain','paired_complete_3chain','template_heteromer'):
    required.add(('POST','/ticket/pair'))
if name.startswith('template_'):
    required.add(('GET','/template/{ids}'))
if not required.issubset(seen):
    raise SystemExit(f'Native selected service did not exercise required routes: {sorted(required-seen)}')
PY
    fi
    exit 0
fi
test -s "$root/$name/msa/$job.a3m"
test -s "$root/$name/manifest.json"
mkdir "$root/$name/prediction"
set --
if [ "$templates" = true ]; then
    # This is the trusted native cache produced by this search, never a user pickle.
    # ColabFold loads JOB.pickle before its search path. A3M alone loses templates.
    cp "$root/$name/msa/$job.pickle" "$root/$name/prediction/$job.pickle"
    set -- --templates --max-template-date 2026-10-09 --max-template-hits 4
fi
run_batch 30m predict "$root/$name/prediction/requests.jsonl" "$root/$name/msa/$job.a3m" "$root/$name/prediction" \
    --model-type "$mode" --host-url "$host" --msa-mode mmseqs2_uniref_env \
    --pair-mode "$pair" --pair-strategy "$strategy" --num-models 1 --model-order 1 \
    --num-seeds 1 --random-seed 7 --num-recycle 1 --num-ensemble 1 --max-msa 32:64 \
    --num-relax 0 --stop-at-score 100 --disable-unified-memory --save-all "$@" \
    > "$root/$name/prediction/console.log" 2>&1
python3 /inputs/af2/af2_outputs.py "$root/$name/prediction" "$root/$name/manifest.json" > "$root/$name/check.json"
python3 /inputs/af2/af2_handoff.py "$root/$name/prediction" "$root/$name/manifest.json" \
    --job "$job" --model 1 --seed 7 --run-id "$run_id" --output "$root/$name/handoff.json"
