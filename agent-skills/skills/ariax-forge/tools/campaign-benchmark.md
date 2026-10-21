# Bounded campaign benchmark

Use this example to compare two retained public minibinders and one paired
antibody proposal. It consumes accepted campaign outputs and adds exact sequence
and backbone QC plus four chain queries against UniRef90 2026_03. This finite
scope passed native execution, installed delivery and complete fresh-host recovery.
All 24 report files matched byte for byte through four installed distribution
routes on both hosts, with Files restoration and complete archive readback.
The current catalog exposes each primitive's accepted scope.

```sh
ariax skills forge --json
ariax skills forge --reference campaign-benchmark --read --json
ariax skills ariax-forge --reference campaign-benchmark-methods --read --json
```

Choose EXAMPLES from the actual discovery response's
`data.examples['campaign-benchmark']`. Its [README](examples/campaign-benchmark/README.md)
describes the retained-file layout. Both aliases expose the same guide. Installed
local paths become remote input paths only after registration and import readiness.
Register benchmark.py, qc.py, search.py, results.py and the accepted plan.json
under campaign-benchmark/. Preserve returned input IDs and wait for ready.

The finite plan contains B43 ubiquitin_1 and ubiquitin_0, including their original
GLU rejections, and B66 igdesign-1/all-six-CDRs. Freeze accepted recipe source heads
before preparation. Restore the complete accepted campaign files, then stage its
original campaign-delivery and campaign-shortlists beneath
/workspace/benchmark/b70/. Keep all seven original candidate rows in those files.
The selected benchmark denominator is three candidates.

Select base, design-qc and mmseqs2-uniref90 through ordinary tool preparation.
The complete named database mounts at /models/mmseqs2-uniref90-2026-03. The
completed finite benchmark used two L40 GPUs: the primary reported 46,068 MiB per
device and the fresh host reported 49,140 MiB per device. Plan 110 GiB usable RAM,
eight CPUs, 256 GiB tool disk and at least 512 GiB usable staging disk for cold
installation, complete archives and independent recovery copies. Both tested
hosts had 60 CPUs and 122,469,507,072 bytes RAM. Physical 32-GiB and single-80-GB
GPU profiles remain unqualified. Existing global search resource requirements
retain their documented scope. The base consumer needs Python 3; qc.py uses
gemmi 0.7.3 in the existing design-qc image.

After every registered input and selected tool is ready:

```sh
ariax forge run "$SESSION" --tool base --timeout-seconds 120 --json -- python3 /inputs/campaign-benchmark/benchmark.py prepare /workspace/benchmark --plan /inputs/campaign-benchmark/plan.json --campaign b70/campaign-delivery --shortlists b70/campaign-shortlists/shortlists.json --out /workspace/benchmark/prepared
```

Observe the returned command ID with forge watch, command and logs. Preparation
rereads the native manifest, scores and run records. The four FASTA accessions
map to two separate binder chains and separate antibody heavy/light chains.
Record fresh UUIDs as QC_COMMAND and SEARCH_COMMAND before their submissions.
Each UUID is also passed into its helper's saved provenance:

```sh
ariax forge run "$SESSION" --tool design-qc --command-id "$QC_COMMAND" --timeout-seconds 120 --json -- python3 /inputs/campaign-benchmark/qc.py /workspace/benchmark --input prepared/qc-input.json --out /workspace/benchmark/new/qc --command-id "$QC_COMMAND"
ariax forge run "$SESSION" --tool mmseqs2-uniref90 --gpus 0,1 --command-id "$SEARCH_COMMAND" --timeout-seconds 900 --json -- python3 /inputs/campaign-benchmark/search.py /workspace/benchmark --selection prepared/selection.json --fasta prepared/queries.fasta --out /workspace/benchmark/new/search --scratch /scratch/benchmark-search --command-id "$SEARCH_COMMAND"
```

Wait for each actual command outcome before its dependent consumer. An uncertain
reply requires querying the original UUID. Preserve a failed search's saved log
and run record. Failed searches have unavailable hit counts.

```sh
ariax forge run "$SESSION" --tool base --timeout-seconds 120 --json -- python3 /inputs/campaign-benchmark/results.py /workspace/benchmark --search-run new/search/run.json --qc-run new/qc/run.json --qc-result new/qc/result.json --out /workspace/benchmark/results.json
ariax forge run "$SESSION" --tool base --timeout-seconds 120 --json -- python3 /inputs/campaign-benchmark/benchmark.py report /workspace/benchmark --selection prepared/selection.json --results results.json --out /workspace/benchmark/report
```

The report writes JSON/TSV tables for throughput and cost, declared QC fractions,
sequence distances, every retained search hit, per-query search outcomes, raw
native scores and distinct-family pose comparisons. Candidate decisions and
exclusions stay visible. [Methods](campaign-benchmark/methods.md) defines each
denominator and optional saved cost records. Missing cost stays null. Estimated
per-call allocations retain their estimate label.

GLU fraction uses the original 0.20 threshold. Backbone QC checks exact sequence
and finite N/CA/C/O coverage across every selected residue. The antibody joint
QC fraction describes technical completeness. Antigen binding and experimental
developability remain unmeasured. Inspect failed criteria before using any row.

Search freezes identity 0.30, both-side coverage 0.80, E-value 0.001, max-seqs 300
and seq-id-mode 0. Accessions, alignments and database release metadata survive.
A successful empty query reports no retained hit under these settings. Biological
novelty and training overlap remain unmeasured. Pose agreement keeps B70's native
2-angstrom review rule and per-role RMSDs; it supplies no experimental hit rate.

Stop writers and use forge sync --wait. Save the checkpoint ID and export its
complete inputs/workspace. Keep original candidate files, all native score and
structure files, accepted plan, command/settings/version/hardware records, search
TSV/logs, QC diagnostics, measurement sources, exclusions and every report file.
On a fresh managed worker, cold-install all selected tools and the complete asset,
restore the actual checkpoint into empty history/scratch, then run the installed
report command with a new output directory. Compare all report paths and bytes.
The saved consumer runs no prediction, generation or search during report recovery.

Creator and practical guidance: [MMseqs2 selected source](https://github.com/soedinglab/MMseqs2/tree/8cc5ce367b5638c4306c2d7cfc652dd099a4643f),
[alignment writer](https://github.com/soedinglab/MMseqs2/blob/8cc5ce367b5638c4306c2d7cfc652dd099a4643f/src/util/convertalignments.cpp),
[coverage-boundary discussion](https://github.com/soedinglab/MMseqs2/issues/586),
[Gemmi](https://github.com/project-gemmi/gemmi/tree/v0.7.3),
[UniProt terms](https://www.uniprot.org/terms). The selected search omits
greedy-best-hits; the linked release-13 issue includes maintainer fix replies.
Predictor sources and confidence limitations follow the accepted
[campaign guide](../references/campaign-recipes.md).
