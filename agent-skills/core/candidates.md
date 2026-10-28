# Candidate tables and shortlist export

Use `ariax candidates PROJECT` to retrieve design metrics, sequences, selection
outcomes and published structure paths without starting compute. Read the
engine's output guide and [metric interpretation](interpretation.md) when
choosing a shortlist.

```sh
ariax candidates PROJECT --view final --json
ariax candidates PROJECT --view all --all --output candidates.json --json
ariax candidates PROJECT --view diagnostics --all --output diagnostics.json --json
```

## Choose a view

`final` returns final candidates. `all` includes earlier available stages for
BindCraft2; for BindCraft it aliases `final` and returns retained accepted
designs. Complete BindCraft attempted-sequence statistics are unavailable.

`diagnostics` returns BindCraft trajectories, BindCraft2 trajectory/refold
records, or ESMFold2 ranking diagnostics. PXDesign and BoltzGen do not support
this view.

BindCraft2 defaults to compact scientific rows with ordered `binder_sequences`,
`selected`, `native_outcome`, `ranking.eligible`, `ranking.reasons`, rejection
details and per-target `target_scores`. Selection, native outcome and ranking
eligibility are distinct. Add `--details` for the complete per-attempt record,
additional metrics and provenance. Other engines retain their native fields.
Use JSON for complete sequences and structure paths; human tables show a summary.

`--eligible` keeps only explicit true eligibility and reports excluded false or
unknown rows. PXDesign and BoltzGen do not supply a universal eligibility flag;
inspect their native pass flags and selection instead of applying this filter.

A structure path appears only when the public file exists. Missing paths do
not establish that a model was never produced. Use `ariax results PROJECT`
to find other artifacts. Missing/nonfinite metrics stay null;
`producer_scaled_pae` is not in angstroms.

## Export and paginate

`--limit` sets page size (1–50; default 25). Use `--all` to retrieve every page,
or pass `meta.next_cursor` to `--cursor`. Only a non-null cursor promises another
page; publication state is separate:

| `meta.state` | Meaning |
| --- | --- |
| `available` | Completed project with candidate rows |
| `completed_empty` | Completed project with a valid, empty candidate table |
| `missing` | Completed project without its expected candidate table |
| `incomplete` | Project is not completed; rows may still be useful |

`--output` writes the JSON envelope only after the requested pages succeed.
Use `--overwrite` to replace an existing file. `--details` changes included
fields; it does not fetch more pages.

These are current project outputs and can change during continuation or
reranking. If retrieval returns `cursor_stale` (HTTP 409, CLI exit 7), restart
without the cursor. For an oversized table (HTTP 413), download the CSV with
`ariax results` and analyze it locally. An invalid source schema (HTTP 422)
requires correction; it is not an empty result.
