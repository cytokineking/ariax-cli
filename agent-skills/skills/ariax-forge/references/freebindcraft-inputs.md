# FreeBindCraft target preparation

Read this before changing the bounded [native example](../tools/freebindcraft.md).
These scientific rules were adapted from the archived Forge collection at
`d8c0b040f553bf9e51a532cb4db693529f50cc70` and checked against FreeBindCraft
`d12747d` plus the current CUDA/attempt-count patch. The miniprotein example
has live execution evidence. The linear-peptide preset is source-reviewed.

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
`A56,A60-62,B20`; they pass through to ColabDesign. An unqualified `56` appears
in the single-chain live fixture, but the helper requires explicit chains to
avoid ambiguity on new inputs. A hotspot guides optimization and does not
promise a contact in the result.

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
separate workflow checks. An empty filter object is the execution fixture's
reduced setting, not a general acceptance policy.

`number_of_final_designs` counts accepted designs. `num_seqs` requests MPNN
proposals, and `max_mpnn_sequences` limits accepted sequences per trajectory.
A positive `max_trajectories` bounds unique trajectory PDB names across
`Trajectory`, `Trajectory/Relaxed`, `Trajectory/LowConfidence` and
`Trajectory/Clashing` in the patched image, including rejected trajectories.
The native default `false` leaves that bound open. It is not a duration or
spend limit. Preserve an explicit attempt budget and session duration within
the user's scope. The native loop draws its own random seeds.

Run the packaged [preflight helper](../scripts/freebindcraft-preflight.py)
against the local target and settings, using its installed absolute path:

```sh
python3 /INSTALLED/freebindcraft-preflight.py --settings target.json --pdb target.pdb --family miniprotein
```

Discover that path as `data.references.freebindcraft-preflight` from
`ariax skills forge --json`. It checks ordinary PDB coordinates, chain/register
identity, hotspot existence, counts and family lengths. It does not check
atomic completeness or run ColabDesign. See [offline checks](science-checks.md)
for a runnable synthetic example and limits.

Sources: [target/loop](https://github.com/cytokineking/FreeBindCraft/blob/d12747dbc907435622559b81891ad73e0a45c2e4/bindcraft.py),
[presets](https://github.com/cytokineking/FreeBindCraft/tree/d12747dbc907435622559b81891ad73e0a45c2e4/settings_advanced).
