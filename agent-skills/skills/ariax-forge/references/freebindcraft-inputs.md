# FreeBindCraft target preparation

Use this reference to prepare a target and finite search for the
[native FreeBindCraft workflow](../tools/freebindcraft.md). It describes
FreeBindCraft `d12747d` with the Forge CUDA-relaxation and attempt-count
changes. Presets alone do not establish prediction quality or guarantee an
accepted design.

Use a protein PDB with the target chains and biological context needed to
constrain the epitope. Preserve original sequences, author chain/residue
numbers, insertion codes, missing coordinates, and any deliberate crop or
renumber map. A chain omitted from `chains` does not constrain the model.
Hotspots require observed coordinates. Resolve alternate conformers and
nonstandard residues deliberately; insertion-coded hotspots need a reviewed
mapping before this conservative workflow can proceed.

Prepare complete target, advanced and filter JSON files. The native loader
reads dictionaries directly, so parsing JSON does not establish validity.
For a selected chain A with observed author residue 56, the target shape is:

```json
{
  "design_path": "/workspace/my-design/results",
  "binder_name": "target-binder",
  "starting_pdb": "/inputs/my-design/target.pdb",
  "chains": "A",
  "target_hotspot_residues": "A56",
  "lengths": [65, 100],
  "number_of_final_designs": 1
}
```

Use two ordered integer lengths. The native loop samples the inclusive range.
The native interactive families use miniproteins of at least 31 residues and
linear peptides of 8–30; these are preset conventions rather than limits of
noninteractive JSON parsing. Preserve the user's intended binder format.
Neither preset supplies cyclic or chemically modified peptide design.

Hotspots are optional (`""`). Prefer selected-chain author identifiers such as
`A56,A60-62,B20`; they pass through to ColabDesign. Native single-chain settings
can use an unqualified `56`, but the helper requires explicit chains to avoid
ambiguity on new inputs. A hotspot guides optimization and does not promise a
contact in the result.

Start with the complete presets inside the current image:

| Family | Advanced file under `/opt/freebindcraft/` | Filter file under `/opt/freebindcraft/` |
| --- | --- | --- |
| Miniprotein | `settings_advanced/default_4stage_multimer.json` | `settings_filters/default_filters.json` |
| Linear peptide | `settings_advanced/peptide_3stage_multimer.json` | `settings_filters/peptide_filters.json` |

Copy the chosen files into a writable task directory before editing. Set
`af_params_dir` to `/models/alphafold2`, retain the image's soluble MPNN
resources, and save the complete effective configuration. The current image
uses OpenMM with `--no-pyrosetta`; follow the native command in the main guide.
Alternative optimizers, trajectory-only mode, beta presets and extras need
separate workflow checks. An empty filter object disables final criteria;
choose explicit acceptance criteria for the intended experiment.

`number_of_final_designs` counts accepted designs. `num_seqs` requests MPNN
proposals, and `max_mpnn_sequences` limits accepted sequences per trajectory.
A positive `max_trajectories` bounds unique trajectory PDB names across
`Trajectory`, `Trajectory/Relaxed`, `Trajectory/LowConfidence` and
`Trajectory/Clashing` in the patched image, including rejected trajectories.
The native default `false` leaves that bound open. It is not a duration or
spend limit. Preserve an explicit attempt budget and session duration within
the user's scope. The native loop draws its own random seeds.

Run the packaged [preflight helper](../scripts/freebindcraft-preflight.py)
against staged target/settings on the remote VM. Upload the helper from its
installed path, require all inputs ready, and invoke it through base:

```sh
ariax forge run "$SESSION" --tool base -- python3 /inputs/freebindcraft/preflight.py --settings /inputs/freebindcraft/target.json --pdb /inputs/freebindcraft/target.pdb --family miniprotein
```

Discover the helper's installed path as
`data.references["freebindcraft-preflight"]` from
`ariax skills forge --tool freebindcraft --json`. It checks finite standard
PDB coordinates, unique single-character chains and residue/atom registers,
CA presence, hotspot existence, the accepted-design count and family lengths.
It rejects alternate conformers, insertion codes, nonstandard residues in
selected chains and multiple models. It reads `--pdb` independently of
`starting_pdb`; confirm both identify the same staged construct. It does not
check atomic completeness, advanced/filter settings or the attempt cap, and
does not run ColabDesign. See [scientific checks](science-checks.md) for a
runnable synthetic example and limits, and the [Forge lifecycle](../SKILL.md)
for input readiness and command monitoring.

Sources: [target/loop](https://github.com/cytokineking/FreeBindCraft/blob/d12747dbc907435622559b81891ad73e0a45c2e4/bindcraft.py),
[presets](https://github.com/cytokineking/FreeBindCraft/tree/d12747dbc907435622559b81891ad73e0a45c2e4/settings_advanced).
