#!/bin/sh
# Remote native negative case; .invalid is deliberately unusable, not a service.
set -eu
root="$1"
mkdir "$root" "$root/msa"
set +e
timeout --signal=TERM --kill-after=5s 60s python3 /inputs/af2/af2_endpoint_override.py \
    "$root/requests.jsonl" search -- /inputs/af2/search.fasta "$root/msa" \
    --msa-only --model-type alphafold2_ptm --host-url https://forge-af2-unusable.invalid \
    --msa-mode mmseqs2_uniref_env --pair-mode unpaired \
    > "$root/msa/console.log" 2>&1
status=$?
set -e
python3 - "$root" "$status" <<'PY'
import json,sys
from pathlib import Path
root=Path(sys.argv[1]); status=int(sys.argv[2])
audit=[json.loads(line) for line in (root/'requests.jsonl').read_text().splitlines()]
requests=[x for x in audit if x['event']=='request']
failures=[x for x in audit if x['event']=='transport_error']
if not status or not requests or not failures or any(x['event']=='unexpected_endpoint' for x in audit):
    raise SystemExit('Unusable explicit endpoint case needs actual native transport failure and zero fallback attempts')
if any(x['origin']!='https://forge-af2-unusable.invalid' for x in requests):
    raise SystemExit('Unusable endpoint case used another service')
if any((root/'msa').glob('*.a3m')) or any((root/'msa').glob('*.done.txt')):
    raise SystemExit('Unusable endpoint unexpectedly produced a completed query')
config=json.loads((root/'msa/config.json').read_text())
if config['host_url']!='https://forge-af2-unusable.invalid':
    raise SystemExit('Native config does not retain the selected unusable URL')
(root/'check.json').write_text(json.dumps({'case':'E01','state':'expected endpoint failure observed',
    'exit_code':status,'native_request_attempts':len(requests),'transport_errors':len(failures),
    'fallback_attempts':0,'sequence_output_created':False,'scientific_prediction':False},indent=2)+'\n')
PY
