#!/bin/sh
set -eu
out=$1
tmp=$2
mode=${3:-cpu}
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "$out" "$tmp"
fields=query,target,fident,pident,alnlen,qstart,qend,qlen,tstart,tend,tlen,evalue,bits,qcov,tcov,qaln,taln
mmseqs createdb "$here/query.fasta" "$out/query" --dbtype 1
mmseqs createdb "$here/target.fasta" "$out/target" --dbtype 1
target="$out/target"
gpu=0
if [ "$mode" = gpu ]; then
  mmseqs makepaddedseqdb "$out/target" "$out/padded" --threads 4
  target="$out/padded"
  gpu=1
fi
mmseqs search "$out/query" "$target" "$out/search" "$tmp/search" -a --alignment-mode 3 --min-seq-id 0.9 -c 0.8 --cov-mode 0 -e 0.001 --max-seqs 100 --threads 4 --gpu "$gpu"
mmseqs convertalis "$out/query" "$target" "$out/search" "$out/hits.tsv" --format-output "$fields" --threads 4
mmseqs easy-search "$here/query.fasta" "$target" "$out/strict.tsv" "$tmp/strict" -a --min-seq-id 0.99 -c 0.8 --cov-mode 0 -e 0.001 --max-seqs 100 --threads 4 --gpu "$gpu" --format-output "$fields"
mmseqs easy-search "$here/query.fasta" "$target" "$out/target-coverage.tsv" "$tmp/coverage" -a --min-seq-id 0.9 -c 0.8 --cov-mode 1 -e 0.001 --max-seqs 100 --threads 4 --gpu "$gpu" --format-output "$fields"
mmseqs easy-search "$here/unmatched.fasta" "$target" "$out/empty.tsv" "$tmp/empty" -a --min-seq-id 0.99 -c 0.8 --cov-mode 0 -e 0.001 --max-seqs 100 --threads 4 --gpu "$gpu" --format-output "$fields"
mmseqs result2msa "$out/query" "$target" "$out/search" "$out/msa" --msa-format-mode 5 --filter-msa 0 --threads 4
mmseqs unpackdb "$out/msa" "$out/a3m" --unpack-name-mode 1 --unpack-suffix .a3m
mmseqs result2msa "$out/query" "$target" "$out/search" "$out/filtered-msa" --msa-format-mode 5 --filter-msa 1 --max-seq-id 0.9 --threads 4
mmseqs unpackdb "$out/filtered-msa" "$out/filtered-a3m" --unpack-name-mode 1 --unpack-suffix .a3m
if [ "$mode" = cpu ]; then
  mmseqs easy-cluster "$here/target.fasta" "$out/cluster" "$tmp/cluster" --min-seq-id 0.9 -c 0.8 --cov-mode 0 --cluster-mode 2 --cluster-reassign 1 --threads 4
  mmseqs easy-linclust "$here/target.fasta" "$out/linclust" "$tmp/linclust" --min-seq-id 0.9 -c 0.8 --cov-mode 0 --cluster-mode 2 --threads 4
fi
python3 "$here/check.py" "$out" --mode "$mode"
