# Native MMseqs2 modes and interpretation

| Native operation | Task and execution |
| --- | --- |
| createdb | Convert protein FASTA to a basename with sequence/header/index/dbtype/lookup/source files. Keep the entire group together. |
| search / easy-search | CPU protein search; `search` retains an alignment result database, while easy-search exports a table. Use `-a` or `--alignment-mode 3` for measured identity. |
| makepaddedseqdb; search --gpu 1 | CUDA protein search against the padded target. GPU generation must be Turing or later; Ampere or later is the creator's full-speed recommendation. |
| easy-cluster | Cascaded CPU clustering. The example uses greedy representatives with cluster-reassign to check final assignment criteria. |
| easy-linclust | CPU clustering for large supplied libraries. Output membership and representative FASTA preserve candidate accessions. |
| convertalis | Export alignments and selected columns from a result database. |
| result2msa --msa-format-mode 5; unpackdb | Query-centered A3M, with lowercase inserted residues and regular exported files. |
| result2msa --filter-msa 1 --max-seq-id 0.9 | Filter redundant MSA members; inspect the retained count and sequences. |

`--min-seq-id` is a fraction. Default `--seq-id-mode 0` divides identical aligned residues by alignment length. `--cov-mode 0` requires both query and target coverage; mode 1 checks target coverage, mode 2 checks query coverage. An aligned span can contain mismatches. Identity and coverage answer separate questions.

`fident`, `qcov` and `tcov` use fractions; `pident` uses percent. Sequence coordinates are one-based and inclusive in exported TSVs. Smaller E-values indicate stronger statistical evidence, and larger bit scores indicate stronger alignment evidence under the selected scoring model. E-values depend on the searched database. `qaln` and `taln` retain aligned strings and gaps. A3M insertion letters are lowercase and do not consume a query coordinate. Empty TSV output is a valid no-retained-hit outcome after successful execution; a failed process or missing output has a separate meaning.

CPU search uses a k-mer prefilter with sensitivity `-s` (selected source default 5.7). CUDA search uses an ungapped prefilter and searches at its maximum native sensitivity. Candidate truncation through `--max-seqs` can affect either result. A padded database supports CPU ungapped search with `--prefilter-mode 1`. A full CPU k-mer index needs a separate resource assessment. The managed asset omits that index. The native `createindex --index-subset 2` path is available upstream for GPU/ungapped indexes; persistent gpuserver setup is outside this guide's supported workflow.

This guide covers protein sequence search, CPU clustering, alignment and A3M export, plus the full selected UniRef90 snapshot. Nucleotide, translated, profile/iterative, taxonomy, MPI, CA3M/HH-suite manufacture, gpuserver and experimental aligners are outside its supported scope. CUDA clustering has no supported parser path in the selected release.

[MMseqs2 18 source and MIT terms](https://github.com/soedinglab/MMseqs2/tree/8cc5ce367b5638c4306c2d7cfc652dd099a4643f) and the [GPU homology-search paper](https://doi.org/10.1038/s41592-025-02819-8) describe the method. [UniProt Consortium UniRef documentation](https://www.uniprot.org/help/uniref) describes representative clustering. The managed database is UniRef90 2026_03, released September 2, 2026, under [CC BY 4.0](https://www.uniprot.org/terms); retain that attribution with derived results.

CPU/GPU hit sets can differ; compare retained accessions and thresholds rather than assuming equivalence ([upstream report](https://github.com/soedinglab/MMseqs2/issues/999)). The example exports A3M mode 5; CA3M/index compatibility is outside this workflow ([upstream report](https://github.com/soedinglab/MMseqs2/issues/1036)). Inspect identity alongside clustering coverage ([upstream report](https://github.com/soedinglab/MMseqs2/issues/1104)).
