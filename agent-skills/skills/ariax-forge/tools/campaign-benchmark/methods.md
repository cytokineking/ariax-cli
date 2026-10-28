# Benchmark fields and limits

`plan.json` fixes exact cohort IDs, state, target context, chain sequences,
database and cutoffs. Its required legacy `accepted_b70_heads` object contains
the original `runtime`, `backend` and `cli` source revisions as 40-character
lowercase hexadecimal strings. The supplied values are populated; retain them
with the saved provenance. `prepare` requires exactly two minibinders and one
antibody with distinct explicit identities. Every referenced file stays under
the saved benchmark root. Relative paths preserve the original native files;
use a new preparation or report output directory.

| Table | Meaning and denominator |
| --- | --- |
| candidates | Three selected diagnostic proposals: two minibinders and one antibody. Original native decisions and generation identities survive. |
| throughput-cost | Each recorded wall interval retains its timing basis, submitted candidates and chain-query counts. Native-operation timing and complete executable timing are distinct. Optional preparation/VM intervals use their own rows. Original generation timing/cost is unavailable where the retained records cannot isolate the interval. |
| qc / qc-fractions | Original GLU fraction, exact canonical sequence and new complete finite backbone check. Joint QC is their path-specific conjunction. Selected, measured, passed and missing counts are explicit. Fraction-of-selected stays null while required outcomes are missing. An observed failed check can reject joint QC while another check remains missing. |
| sequence-diversity | Unit-cost global Levenshtein distance divided by max(chain lengths); substitutions, insertions and deletions each cost one. Compare binder versus binder within the minibinder cohort. The sole antibody has zero heavy-heavy or light-light candidate pairs. |
| database-hits / database-search | All retained UniRef90 accessions, fident fraction, one-based inclusive coordinates, E-values, bit scores, both coverages and aligned strings. Four chain queries map to three candidates. An unsuccessful search leaves hit counts unavailable. |
| family-agreement | Retained same-task comparisons between distinct suitable families, including per-role RMSD and the original review threshold. BoltzGen/Boltz2 share one family; RF3 checkpoints and accelerated variants share their underlying family. Four ImmuneBuilder members form one ensemble. |
| native-scores | Every selected native field, units, score direction, rank context in the source selection, command ID and original source file. pLDDT 0..1, summary 0..100, PAE angstrom and ensemble displacement angstrom squared keep their separate meanings. |
| assays | Exact sequence/target/assay context has no established matching export. Endpoints and experimental hit rate stay null. The diagnostic selection follows generation/rejection; no held-out experimental evaluation split exists. Training overlap is unknown. |
| exclusions | Other candidates in the original shortlist remain outside the three-candidate denominator. Original failed paths and rejected outcomes remain inspectable. |

`results.py` joins `new/search/run.json` and `new/qc/run.json`. By default,
their elapsed times measure the native search or QC operation inside the helper;
they exclude some process startup/import and output-writing time. Exact command
observations can supply Docker StartedAt-to-FinishedAt execution intervals;
report rows preserve the shorter native-operation interval separately. This
complete executable interval covers imports and output writing. GPU samples
and container memory usage retain their sample counts; an absent sample stays
null.

Optional `--inclusive-hourly-usd RATE --quote-source metadata/quote.json`
computes a full-VM allocation estimate over the available recorded interval.
The quote file must contain the matching `inclusive_hourly_usd`. Preserve the
sanitized quote/hardware record in Files. Shared preparation and idle time
belong to their own rows. Optional `--measurements metadata/intervals.json`
supplies a list of recorded preparation or VM intervals with `command_id`,
`operation`, `basis`, `submitted_candidates`, `elapsed_seconds`, `cost_usd`,
`cost_kind` and `cost_source`. The report accepts measurement bases
`retained_observation`, `new_complete_call`, `cold_preparation` and
`recovery_consumer`. Resource/timing additions to an existing call must match
its `command_id` and `operation`, with their saved `resource_source`; they
cannot replace the call's outcome or denominator.

Use `observed_VM_interval` for an actual accounted VM interval. Per-call
allocation uses `allocation_prorated_estimate`. Intervals can overlap; do not
sum overlapping VM and per-call costs into campaign spend. Cost fields use
USD. Original per-design cost stays unavailable when its actual denominator
is unknown.

Search command/settings and the native log retain GPU prefilter behavior.
`max-seqs` limits candidates passed by the prefilter and affects detection.
Short or low-complexity designed chains can lack retained hits. The complete
UniRef90 2026_03 snapshot has 121494192 representatives; the selected native
index residue count is 45545048538. The prepared GPU asset includes accession
lookup, sequence, header and index members. Taxonomy/full k-mer indexing are
absent. Use the named asset directly; saved-report generation reads its
retained metadata and hits without mounting or rebuilding the database.

Canonical sequence and backbone checks describe the declared software/structure
criteria. Pairwise RMSD is a prediction comparison. The report leaves function,
binding efficacy, biological novelty and clinical immunogenicity unmeasured.
Related acceleration variants do not supply an independent prediction family.
Use each tool's current catalog scope for other workloads. AF3 is outside this
example.

[MMseqs2 parser](https://github.com/soedinglab/MMseqs2/blob/8cc5ce367b5638c4306c2d7cfc652dd099a4643f/src/commons/Parameters.cpp)
defines the cutoffs and seq-id-mode. Its [writer](https://github.com/soedinglab/MMseqs2/blob/8cc5ce367b5638c4306c2d7cfc652dd099a4643f/src/util/convertalignments.cpp)
emits the raw scales. [Issue 586](https://github.com/soedinglab/MMseqs2/issues/586)
records a historical greedy-best-hits coverage bug and maintainer fix; the selected
argv omits that flag. MMseqs2 uses MIT code. Gemmi 0.7.3 uses MPL-2.0.
Attribute UniProt Consortium under [CC BY 4.0](https://www.uniprot.org/terms).
Any future permitted ProteinBase reuse must preserve the notice:
"This work used Proteinbase by Adaptyv Bio under ODC-BY license".
Its [public export](https://proteinbase.com/download) requires no laboratory
account. A private candidate submission or experiment order needs its own authority.
