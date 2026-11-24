#!/bin/sh
set -eu
out=$1
tmp=$2
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
db=/models/mmseqs2-uniref90-2026-03
mkdir -p "$out" "$tmp"
cp "$db/snapshot.json" "$out/snapshot.json"
/usr/bin/time -v -o "$out/resources.txt" mmseqs easy-search "$here/query.fasta" "$db/uniref90" "$out/hits.tsv" "$tmp/search" --gpu 1 -a --min-seq-id 0.3 -c 0.8 --cov-mode 0 -e 0.001 --max-seqs 300 --threads 8 --format-output query,target,fident,pident,alnlen,qstart,qend,qlen,tstart,tend,tlen,evalue,bits,qcov,tcov,qaln,taln
printf '%s\n' '{"engine":"MMseqs2 18-8cc5c","mode":"CUDA protein search","database":"UniRef90 2026_03","snapshot_date":"2026-09-02","min_seq_id":0.3,"coverage":0.8,"cov_mode":0,"evalue":0.001,"max_seqs":300,"alignment_backtrace":true}' > "$out/search-settings.json"
