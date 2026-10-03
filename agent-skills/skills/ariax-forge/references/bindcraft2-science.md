# BindCraft2 native scientific configuration

This guide checks native 1.0.1 at `e6d30f6ea2e5bbc2f62ae7fa722f183da6c6c29f`.
The [Forge example](../tools/bindcraft2.md) qualifies a bounded single-target
miniprotein run. Other formats and multi-state settings below are source-reviewed;
they need representative native GPU runs before workflow qualification.

The [managed BindCraft2 skill](../../ariax-bindcraft2/SKILL.md) explains useful
scientific choices, but its `protocol_config`, upload bundle limits, project
status and candidate APIs belong to managed jobs. Forge executes a native
settings file with `bindcraft design /inputs/run/settings.json`. Do not send
managed job JSON to that executable or infer native defaults from hosted ones.

## Prepare targets and choose a format

Record the target construct, biological assembly, sequence and residue mapping.
Keep glycans, membranes, unresolved residues and omitted domains in the review
of epitope accessibility even when they are absent from modeled coordinates.
Native `targets` entries use `name`, `target_path`, `chains`, `hotspots`,
`coldspots`, `weight` and `objective`. Prefer absolute staged `/inputs` paths.
Relative target/scaffold paths in JSON resolve from its directory. A minimal
explicit target shape is:

```json
{
  "modality": "binder",
  "project_folder": "/workspace/my-bc2-run",
  "targets": [{
    "name": "target",
    "target_path": "/inputs/my-bc2-run/target.pdb",
    "chains": "A",
    "hotspots": "A56"
  }],
  "binder_lengths": [65, 100],
  "number_of_final_designs": 1,
  "max_trajectories": 10,
  "resume": false
}
```

These counts and lengths illustrate fields. Choose them for the user's task.
Inspect actual author chain/residue identifiers, including missing coordinates
and insertion codes, before using selectors such as `A54,A56,B12-16`.
Unprefixed numbers refer to the first selected chain. A selected structure
chain may have a multi-character ID. Keep an explicit map when preparation
concatenates or renumbers target chains. The conservative FreeBindCraft helper
is not a BC2 parser or a general mmCIF validator.

Native sequence targets accept FASTA with a selected record and can be cropped
into states such as `target_epitope_1`; they cannot supply structure-numbered
hotspots/coldspots. Review effective crops and validation flanks. A negative
weight or explicit `objective: "detarget"` creates a detarget state. Retain
its sign and a meaningful final avoidance criterion; a negative-selection
score alone cannot establish specificity.

Use `bindcraft design --list-modalities`, `--list-properties`, `--list-core`
and `--list-settings` through a ready native tool when choosing settings.
The inspected modality files include `binder`, `large_binder`, `peptide`,
`cyclic_peptide`, `VHH`, `scFv`, `Fab`, `ARP`, `homo_oligomer` and `multidomain`.
`induced_fit` and `fold_switch` modify the objective. Preserve intended
chemistry and chain count. scFv models two variable-domain chains and supplies
no linker. Oligomer `binder_lengths` is per copy; `copies` and `oligomer_tie`
control its assembly. A cyclic offset models head-to-tail intent, which still
requires inspection of closure geometry.

For a custom scaffold supply `binder_scaffold` and exact `mutate_positions`.
`A52-57(5-7)` permits a variable-length edit; `A33*` marks a framework position,
and `A33+` a binding position without making it freely designable. Preserve
fixed sequence and check edits against that scaffold. Scaffold length follows
the edits rather than `binder_lengths`. Read model/scaffold terms before
redistributing assets.

## Effective settings and budgets

Native defaults come from `/opt/bindcraft2/settings/core/default.json`, then
selected core/modality/property/target presets, campaign JSON and command-line
overrides. Nested dictionaries merge by key and lists replace earlier lists.
A named property set to false does not erase an explicit loss/filter elsewhere.
Save resolved `campaign_metadata.json` and inspect per-trajectory `autotuned`
values when comparing candidates. No per-command asset inspection is needed;
Forge prepares the shared model mount before tool readiness.

`number_of_final_designs` is the accepted goal; `max_trajectories` limits attempts.
`sequence_candidates` controls MPNN proposals, `kept_sequences` retained
proposals, and `enough_passing_sequences` can stop validation after enough pass.
Refold rows can therefore outnumber trajectory rows. Stage confidence gates
screen/refine/anneal/harden/mutate/final precede final candidate filters. The
cleared filters and short stage budgets of the live fixture qualify execution.
Select real acceptance criteria before a scientific campaign.

The native desperation threshold defaults to 750 trajectories. Explicit zero
can start its first recovery rung immediately when enabled. Omission, zero
and disabled values have different meanings. Do not silently lower this
threshold to make a short pilot exercise desperation. Autotuning, pose seeding
and held-out model choices affect comparability; retain their actual settings.
`aa_bias` values are relative amino-acid propensities: zero excludes at mutable
positions, one is neutral, positive values below/above one discourage/favor.
Use finite nonnegative values for standard uppercase residues and preserve
preset inheritance. Fixed scaffold residues and target residues retain their
separate roles.

Use a fresh `project_folder` and `resume: false` for changed scientific intent.
After interruption inspect the existing command and native state before an
explicit continuation. The state files track claimed attempts and redesigns;
do not delete them or accepted structures as a casual cleanup operation.

## Interpret the native tables

Use a CSV parser. `design` names files; `_candidate<n>` indexes MPNN draws,
while `_seq<n>` identifies retained sequences. `Binder_Sequence` separates
binder chains with `/`. A blank `terminated` means gradient optimization
completed; `outcome` and `failed_filters` report later candidate evaluation.
An empty final-filter list before scoring means unevaluated criteria.

Multi-target metric cells contain semicolon-separated values aligned with
`targets` and signed `target_weights`; retain empty positions. Positive targets
and detargets answer different questions. Native ranking descends by `i_pDAE`
with missing scores last; retain the actual per-target values as well.
Confidence metrics average available validation-model readings, while geometry
uses the first model's coordinates. Early rejected refolds may have an
incomplete ensemble. Optional monomers and relaxed structures represent
additional stages; identify which coordinates support each claim.

| Metric | Scale and meaning |
| --- | --- |
| `pLDDT`, `Unbound_Binder_pLDDT`, `i_pTM`, `pTM` | 0–1 confidence summaries |
| Structure B factors | pLDDT on 0–100 for BC2 predictions |
| `i_pAE` | Mean interface PAE divided by 31 Å; lower is better |
| `pae`, `PAE_mean` | Pairwise error and row mean in Å |
| `i_pDAE` | Distance-masked interface TM confidence on 0–1, default contact cutoff 8 Å |
| RMSD / interface area | Å / Å² for the specified aligned atoms and state |

Compare structure sequence, target/binder roles and residue register to the
reported candidate before exporting. Review the [shared interpretation guide](../../../core/interpretation.md)
for interface context and comparisons. A ranked binder remains an experimental
candidate.

Sources: native [settings reference](https://github.com/PacesaLab/BindCraft2/blob/e6d30f6ea2e5bbc2f62ae7fa722f183da6c6c29f/docs/source/reference.md),
[output semantics](https://github.com/PacesaLab/BindCraft2/blob/e6d30f6ea2e5bbc2f62ae7fa722f183da6c6c29f/docs/source/outputs.md),
and [native CLI](https://github.com/PacesaLab/BindCraft2/blob/e6d30f6ea2e5bbc2f62ae7fa722f183da6c6c29f/bindcraft/cli.py).
There is no archived Forge BindCraft2 skill; this reference was checked against
current native source and the existing managed scientific guidance.
