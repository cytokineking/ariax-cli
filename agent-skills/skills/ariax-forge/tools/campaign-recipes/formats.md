# Campaign saved-output manifest

`campaign.json` contains `candidates`, with one or two rows for each of the five
required paths: `minibinder`, `antibody`, `states`, `ligand-motif` and
`nucleic-acid`. The consumer does not support a partial set of paths or more than
two candidates per path. Each row has an explicit `id`, original
`native_decision`, original `generation` record and `states`. The states path
requires exactly `positive` and `negative` entries. Other paths use descriptive
state keys.

Each state retains an `identity`, `chains` and `observations`. `chains` maps
molecular roles to `{kind,sequence}`, where `kind` is `protein`, `rna` or `dna`.
Each observation supplies `model_family`, a same-task `task` label, `structure`
path, native `chains` map, `run_record` path and `scores`. Supply the original
`native_rank` and `native_rank_context` when available; missing ranks remain
null and missing context is labeled unavailable. The native chain map must
name every declared polymer role. A run record
contains `command_id`, `sources`, `model`, `settings` including the actual seed,
and `hardware`; preserve these from the original Forge command rather than
inventing missing measurements.

Supported `model_family` values are `boltzgen`, `boltz2`, `boltz2-accelerated`,
`rf3`, `rf3_preprint_124`, `rf3_preprint_921`, `protenix`, `abodybuilder2`,
`igdesign`, `igmpnn`, `proteina-complexa` and `genie3`. The retained run record's
model must belong to the declared family. Related variants share a family;
only distinct families with the same `task` are compared.

A score names `file`, `units`, `direction` and a list of JSON `keys` leading to
the native value. For CSV, use `format: "csv"`, one identity key/value in
`match` and an exact `column`; the match must identify exactly one row. CSV
values remain native strings. Keep unavailable scores null in the original
source and preserve their explanation in saved records. A defined zero stays
zero. Do not fill an unavailable measurement from another predictor. Native
ranking remains per method and state.

References must name files relative to the campaign root. The consumer rejects
missing files, ambiguous candidate/CSV identity, incomplete run records,
differing molecular sequences, unsupported modalities and missing campaign
paths. It reads the saved structures and scores without a generation or
prediction call. It writes `shortlists.json`, `shortlists.tsv` and five per-path
JSON shortlists to a fresh `--out` directory. Saved inputs can be read in the
current workspace or after an optional [same-project resume](../../outputs.md).

Pose RMSD fits corresponding molecular roles and sequence positions using
C-alpha atoms for proteins and phosphate P atoms for nucleic acids. It uses
atoms present in both structures and reports unmatched counts; fewer than
three fitting atoms leaves RMSD unavailable. Retain native residue maps and
make any receptor trimming explicit. Set `alignment_role: "target"` to fit a
protein-binder complex on its target; per-role RMSDs then use that same fit.
An optional positive `pose_review_threshold_angstrom` labels the comparison
without calibrating experimental quality. Discordant poses remain in the
shortlist.

Chemical roles declare `heavy_element_counts`, and every observation maps them
through `chemical_chains`. The consumer checks those elemental counts and
preserves native heavy-atom names, identities and coordinates. It reports
centroid displacement after the declared polymer fit; it does not infer bonds
or atomwise correspondence, orientation or chemical equivalence.

For positive/negative comparisons, inspect the same field separately within
the same model family, checkpoint, source and scientific settings. Numeric
positive-minus-negative differences require matching native units. Keep score
direction visible. No inter-family average, global rank or calibrated
specificity transformation is supported. `review_selection: true` records an
inspection choice; `accepted_for_experiment: false` preserves the need for
scientific review and experiment. Computational agreement does not establish
function, binding or specificity.
