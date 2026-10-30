# MMseqs2 protein search, clustering and alignments

Use `mmseqs2` for CPU searches against supplied protein FASTA, clustering and redundancy filtering. `mmseqs2-gpu` runs CUDA protein search with a padded target database. Choose `mmseqs2-uniref90` for the managed **UniRef90 2026_03, September 2, 2026** snapshot. This guide selects MMseqs2 **18-8cc5c**. Read the catalog's resource profile for the demonstrated workload before selecting hardware.

Input FASTA uses unique accessions in the first header token and amino-acid sequences. Preserve the relation between those accessions and candidate IDs. Multi-chain designs need an explicit choice of chain sequence or concatenation; a concatenated sequence search does not establish an interface result. The [modes and interpretation reference](mmseqs2/modes.md) explains native thresholds, formats, source terms and unsupported operations.

## Discover and register the example

```sh
ariax skills forge --tool mmseqs2 --json
ariax skills forge --reference mmseqs2 --read --json
ariax skills ariax-forge --reference mmseqs2-modes --read --json
ariax skills forge --reference mmseqs2-fixtures --read --json
```

Read `data.examples.mmseqs2` from the scoped discovery response and set `EXAMPLES` to that installed directory. It contains `query.fasta`, `target.fasta`, `unmatched.fasta`, `run.sh`, `search-managed.sh` and `check.py`. The registered copies below become `/inputs/mmseqs2/` inside commands. Inspect `ariax forge catalog --tool mmseqs2 --json` for the CPU tool's current resources; use the corresponding tool ID when selecting CUDA or the managed database.

```sh
ariax forge tools add "$SESSION" --tools mmseqs2 --priority mmseqs2 --json
ariax forge tools wait "$SESSION" mmseqs2 --timeout 1800 --json
for name in query.fasta target.fasta unmatched.fasta run.sh search-managed.sh check.py; do
  ariax forge inputs add "$SESSION" --file "$EXAMPLES/$name" --path "mmseqs2/$name" --json
done
ariax forge inputs list "$SESSION" --json
```

Require every registered input ready. Observe an importing input with `ariax forge inputs status "$SESSION" "$INPUT_ID" --json`.

## Run the bounded CPU example

```sh
ariax forge run "$SESSION" --tool mmseqs2 --timeout-seconds 600 --json -- sh /inputs/mmseqs2/run.sh /workspace/mmseqs2-cpu /scratch/mmseqs2-cpu cpu
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 900 --json
```

Save the returned command ID. The example uses human beta-globin P68871, a duplicate, a three-substitution control, an N-terminal fragment and human ubiquitin. It tests identity 0.90 versus 0.99 and coverage 0.80 for both sequences versus target alone. The two CPU cluster operations should export a three-member beta-globin group and two singleton groups. `check.py` inspects accession membership, coordinates, aligned strings, A3M width and redundancy filtering. Its deliberate unrelated query should produce an empty TSV. This small control supplies no performance claim for a large candidate library.

The native commands are visible in `run.sh`. `hits.tsv` contains `query,target,fident,pident,alnlen,qstart,qend,qlen,tstart,tend,tlen,evalue,bits,qcov,tcov,qaln,taln`. Require `checks.json` with `passed: true` and inspect `/workspace/mmseqs2-cpu/a3m/`. Representative FASTA and membership tables have `_rep_seq.fasta` and `_cluster.tsv` suffixes. Filtered A3M files are in `filtered-a3m/`.

## Run the CUDA example

```sh
ariax forge tools add "$SESSION" --tools mmseqs2-gpu --priority mmseqs2-gpu --json
ariax forge tools wait "$SESSION" mmseqs2-gpu --timeout 1800 --json
ariax forge run "$SESSION" --tool mmseqs2-gpu --gpus 0 --timeout-seconds 600 --json -- sh /inputs/mmseqs2/run.sh /workspace/mmseqs2-gpu /scratch/mmseqs2-gpu gpu
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 900 --json
```

GPU mode calls `makepaddedseqdb` before searching and runs the same output checks. Clustering remains a CPU operation. CPU and CUDA prefilters can return different hit sets; record the selected mode and candidate limit. GPU preparation can reorder internal IDs, so compare accessions. Read the catalog's measured GPU envelope before selecting devices.

## Search the full managed snapshot

```sh
ariax forge tools add "$SESSION" --tools mmseqs2-uniref90 --priority mmseqs2-uniref90 --json
ariax forge tools wait "$SESSION" mmseqs2-uniref90 --timeout 1800 --json
ariax forge run "$SESSION" --tool mmseqs2-uniref90 --gpus 0,1 --timeout-seconds 900 --json -- sh /inputs/mmseqs2/search-managed.sh /workspace/novelty /scratch/novelty
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 1200 --json
```

The snapshot contains every UniRef90 representative from that release. Header descriptions are removed; complete accessions remain. Its prepared directory and metadata mount read-only. Reserve the catalog's disk requirement for cold download/extraction and keep the query/output files through Files. The beta-globin control should return a strong beta-globin match. Inspect accessions and thresholds in every result.

Write a missing-match statement as: “No hit was retained against UniRef90 2026_03 using MMseqs2 18-8cc5c CUDA search, minimum identity 0.30, both-side coverage 0.80, E-value ≤0.001 and max-seqs 300.” Candidate limits, low complexity and search sensitivity affect detection. Sequence absence under these settings establishes a computational observation. Biological novelty, measured binding and lack of training overlap need separate evidence.

## Save and continue

Set `PROJECT` to the session's returned `project_id`.

```sh
ariax forge sync "$SESSION" --wait --timeout 1800 --json
ariax forge files "$PROJECT" --path /workspace --json
```

Require a successful flush. Retain original candidate accessions, query FASTA, exact argv and database metadata alongside TSVs, A3M files and cluster representatives. Follow the [Files guide](../outputs.md) for saved results, restoration and session closure.
