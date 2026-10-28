# Bounded campaign benchmark

Use this example to compare two retained public minibinders and one paired
antibody proposal. It consumes saved campaign outputs and adds exact sequence
and backbone QC plus four chain queries against UniRef90 2026_03. The helper is
limited to this three-candidate diagnostic design; it is not a general benchmark
runner or an experimental evaluation.

```sh
ariax skills forge --tool campaign-benchmark --json
ariax skills forge --reference campaign-benchmark --read --json
ariax skills ariax-forge --reference campaign-benchmark-methods --read --json
ariax forge catalog --task validation-search --compact --json
ariax forge catalog --tool design-qc --json
ariax forge catalog --tool mmseqs2-uniref90 --json
```

Set `EXAMPLES` to scoped discovery's `data.examples['campaign-benchmark']`.
Its [README](examples/campaign-benchmark/README.md) describes the files and saved
input layout. Both platform aliases expose the same guide. Read each selected
tool's catalog scope and resources; for tools with models or modes, use
`--tool TOOL --model MODEL --mode MODE --json` with the exact IDs from discovery.
Follow the [Forge lifecycle](../SKILL.md) for preparation, billing, command
recovery and closure. All helper and scientific execution runs remotely.

Register the five small source inputs and wait for every import ID to be ready:

```sh
for name in benchmark.py qc.py search.py results.py plan.json; do
  ariax forge inputs add "$SESSION" --file "$EXAMPLES/$name" --path "campaign-benchmark/$name" --json
done
```

The plan selects `B43/ubiquitin_1` and `B43/ubiquitin_0`, preserving their
original GLU rejections, and `B66/igdesign-1/all-six-CDRs`. It fixes their state,
chain sequences, QC structure family and search settings. Keep the populated
`accepted_b70_heads` source-revision fields: the current helper requires that
legacy field with `runtime`, `backend` and `cli` revisions. Place the original
`campaign-delivery/` and `campaign-shortlists/` directories beneath
`/workspace/benchmark/`, retaining
every file referenced by their manifest and shortlist. They can come from the
current workspace or an optional [checkpoint restore](../outputs.md).
Candidates outside the selected three remain in the exclusions table.

Prepare `base`, `design-qc` and `mmseqs2-uniref90`. The search helper requires
MMseqs2 18-8cc5c and the complete named database at
`/models/mmseqs2-uniref90-2026-03`. Its supplied profile selects two L40 GPUs;
observed devices exposed 46,068–49,140 MiB each. The profile calls for 110 GiB
usable RAM, eight CPUs, 256 GiB tool disk and 512 GiB usable staging space.
Use the current catalog for asset preparation and search resource requirements.
Physical 32-GiB and single-80-GB GPU profiles are not established by this example.
The report consumer needs Python 3; `qc.py` uses Gemmi 0.7.3 in `design-qc`.

After the registered inputs and selected tools are ready:

```sh
ariax forge run "$SESSION" --tool base --timeout-seconds 120 --json -- python3 /inputs/campaign-benchmark/benchmark.py prepare /workspace/benchmark --plan /inputs/campaign-benchmark/plan.json --campaign campaign-delivery --shortlists campaign-shortlists/shortlists.json --out /workspace/benchmark/prepared
```

Preparation rereads the original manifest, scores and run records. It writes
`selection.json`, `qc-input.json` and `queries.fasta`. The four FASTA accessions
map to two separate binder chains and separate antibody heavy/light chains.
Set `QC_COMMAND` and `SEARCH_COMMAND` to fresh UUIDs before submission; each
helper saves the same UUID in its provenance:

```sh
ariax forge run "$SESSION" --tool design-qc --command-id "$QC_COMMAND" --timeout-seconds 120 --json -- python3 /inputs/campaign-benchmark/qc.py /workspace/benchmark --input prepared/qc-input.json --out /workspace/benchmark/new/qc --command-id "$QC_COMMAND"
ariax forge run "$SESSION" --tool mmseqs2-uniref90 --gpus 0,1 --command-id "$SEARCH_COMMAND" --timeout-seconds 900 --json -- python3 /inputs/campaign-benchmark/search.py /workspace/benchmark --selection prepared/selection.json --fasta prepared/queries.fasta --out /workspace/benchmark/new/search --scratch /scratch/benchmark-search --command-id "$SEARCH_COMMAND"
```

Observe each command with `forge watch`, `forge command` and `forge logs`
before its dependent consumer. A timeout leaves remote work running; query the
original UUID after an uncertain reply. Preserve a failed search's log and run
record. Failed searches have unavailable hit counts. Each new attempt needs
fresh output and search scratch directories.

```sh
ariax forge run "$SESSION" --tool base --timeout-seconds 120 --json -- python3 /inputs/campaign-benchmark/results.py /workspace/benchmark --search-run new/search/run.json --qc-run new/qc/run.json --qc-result new/qc/result.json --out /workspace/benchmark/results.json
ariax forge run "$SESSION" --tool base --timeout-seconds 120 --json -- python3 /inputs/campaign-benchmark/benchmark.py report /workspace/benchmark --selection prepared/selection.json --results results.json --out /workspace/benchmark/report
```

The report writes JSON/TSV tables for timing and cost, declared QC fractions,
sequence distances, every retained search hit, per-query search outcomes, native
scores and distinct-family pose comparisons, plus `report.json` and `report.md`.
Candidate decisions and exclusions stay visible.
[Methods](campaign-benchmark/methods.md) defines the denominators and optional
measurement records. Missing cost stays null; per-call allocations are estimates
unless an actual VM accounting interval is supplied.

GLU fraction uses the original 0.20 threshold. Backbone QC checks exact sequence
and finite N/CA/C/O coverage across every selected residue. The antibody joint
QC fraction describes technical completeness. Antigen binding and experimental
developability remain unmeasured. Inspect failed criteria before using any row.

Search fixes identity 0.30, both-side coverage 0.80, E-value 0.001, max-seqs 300
and seq-id-mode 0. Accessions, alignments and database release metadata remain
available. A successful empty query means no retained hit under these settings.
Biological novelty and training overlap remain unmeasured. Pose agreement keeps
the saved 2-Angstrom review rule and per-role RMSDs; it supplies no experimental
hit rate.

Save the plan, original candidate files, structures, native scores, command
records, search logs/TSVs, QC diagnostics, measurement sources and reports using
the [saved-output workflow](../outputs.md). `report.json` lists its complete
saved input closure by relative path and byte size. To regenerate a report later,
make those files available under one benchmark root and run only the report
command with a fresh `--out` directory. That command performs no generation,
prediction, QC execution or database search and requires only Python 3 and
the saved files.

Creator and practical guidance: [MMseqs2 selected source](https://github.com/soedinglab/MMseqs2/tree/8cc5ce367b5638c4306c2d7cfc652dd099a4643f),
[alignment writer](https://github.com/soedinglab/MMseqs2/blob/8cc5ce367b5638c4306c2d7cfc652dd099a4643f/src/util/convertalignments.cpp),
[coverage-boundary discussion](https://github.com/soedinglab/MMseqs2/issues/586),
[Gemmi](https://github.com/project-gemmi/gemmi/tree/v0.7.3),
[UniProt terms](https://www.uniprot.org/terms). The selected search omits
greedy-best-hits; the linked release-13 issue includes maintainer fix replies.
Predictor sources and confidence limitations follow the
[campaign guide](../references/campaign-recipes.md).
