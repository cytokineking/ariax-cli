# Exchange formats and scientific limits

A ProteinBase CSV has `id`, `sequence` and JSON-encoded `evaluations`, with original
extra columns preserved. Each evaluation retains its `type`, `metric`, `target`,
`valueType`, `unit`, `value`, `method` and `measuredAt`. Experimental replicates stay
separate, including equal values. Computational source exports can already have
latest-result deduplication; Forge cannot recover records the exporter omitted.
The public dataset's `v2026-10-12` tag identifies its published snapshot. The
`proteinbase_latest.csv` URL is mutable and requires its own retrieval version.

A shortlist has `request_id`, `name`, `target` (`catalog_id`, `context`,
`construct_verified`), `assay` (`experiment_type`, `method`, `n_replicates`, optional
`antigen_concentrations` and `concentration_unit`) and `candidates`. Each candidate
has `id`, ordered `chains` of `{id,sequence}`, `sequence_metadata`, and `provenance`.
The installed prepare.py writes a complete example. Include native design IDs,
model/settings/seed, original rejection flags, selection rationale and exact
structure/settings checkpoint paths in real shortlist provenance.

`SingleChain` includes full minibinder or VHH constructs. Complete Fab has two
ordered chains and `sequence_metadata.type="FAB"`. Paired variable Fv alone needs
construct design before Fab use. An explicit scFv requires VH, VL, linker and
chain_order metadata plus a full single-chain sequence; review orientation and
linker before export. The helper joins ordered chains with the API's colon syntax.
It accepts the 20 natural amino acids. Native SDK enum `IgG` supplies no assurance
of laboratory format support. Full IgG is outside this package's supported scope.

Offline request drafts cover affinity, screening, expression, fluorescence and
thermostability. Experimental feasibility is assessed by the lab. epitope_binning
and enzyme_activity are visible native enums with protocol-specific work pending.
This package validates affinity concentrations as nM, positive replicate counts,
chain counts, names and sequence alphabets. The SDK models contain fields whose
server rules are stronger than Pydantic alone; target construct and ordered format
review remains a human task. The helper never supplies a default scFv linker.

Saved Adaptyv import syntax:

```sh
lab-feedback import-adaptyv --result /inputs/lab/result.json --identity-map /inputs/lab/identity-map.json --context /inputs/lab/assay-context.json --source "authorized saved experiment" --version "$RESULT_VERSION" --request-id "$RESULT_IMPORT" --ledger /workspace/lab-feedback/exchange.json
```

`result.json` follows the selected SDK's `ResultInfo`: result/experiment IDs,
created_at, title, result_type, metadata and summary array. Only affinity summaries
are handled. The exact saved candidate name and submitted amino-acid sequence must
match one identity-map row. Assay context has an explicit `method`; retain target
construct, concentration series, controls and instrument/fit data there. Kinetic
replicates retain index, binding_strength, kon/koff fit methods and unavailable
values. KD carries its explicit `kd_units`; kon and koff units follow the selected
API model descriptions (M^-1 s^-1 and s^-1). Keep sensorgrams and revised packages
in separate original files. Quantitative comparisons require matching assay and
construct context. Missing units remain missing. Other result types stay in their
original files; this importer does not support them.

Current authenticated quotes, private results and raw sensorgrams require account
access. [Quote metadata](https://docs.adaptyvbio.com/api-reference/experiments/get-experiment-quote)
reports currency, minor units, expiry and status. Actual laboratory disclosure or
purchase requires the human's actual recipient/quote authorization. Credentials
and temporary download URLs stay outside retained exchange files.

[ProteinBase schema/terms](https://proteinbase.com/download),
[API request model](https://github.com/adaptyvbio/adaptyv-sdk/blob/cdf207819ed5a58e0c127453626d2bce125c8064/src/adaptyv/types/generated.py),
[data-package interpretation](https://docs.adaptyvbio.com/docs/experiment-setup/binding-data-package),
[supported formats](https://docs.adaptyvbio.com/docs/experiment-setup/supported-protein-formats).
