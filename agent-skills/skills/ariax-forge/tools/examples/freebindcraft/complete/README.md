# FreeBindCraft finite native examples

Use these configurations as starting points for miniprotein or linear-peptide
design. Read the [FreeBindCraft guide](../../../freebindcraft.md) for staging,
native commands, relaxation routes and result interpretation. Discover their
installed directory with `ariax skills forge --tool freebindcraft --json`:
`data.examples.freebindcraft` is the parent directory; these files are under
`complete/`.

The examples retain native family filters, set an accepted goal of one and
cap attempts at two trajectories. They retain unrelaxed structures, binder
monomers and MPNN FASTA when those stages run. Rejection can prevent later
stages and leave no accepted design. These settings do not guarantee a useful
binder or define a scientific search budget for other targets.

Stage the bundled [PD-L1 structure](../PDL1.pdb) as
`/inputs/freebindcraft/PDL1.pdb`. Its selected target chain A has 115 residues
numbered 18–132, with hotspot A56. Each family has matching `advanced-*.json`
and `filters-*.json` files:

| Family | Binder | Soluble MPNN v_48_020 proposals / accepted cap per trajectory | Validation recycles |
| --- | --- | --- | --- |
| Miniprotein | B80 | 20 / 2 | 3 |
| Linear peptide | B20 | 10 / 2 | 3 |

Choose the matching `settings-<family>-openmm.json` or
`settings-<family>-pyrosetta.json`. Each writes a distinct directory under
`/workspace/complete/`. Select OpenMM explicitly with `--no-pyrosetta`;
PyRosetta requires the separately authorized complete named asset and its
license terms. Preserve source and dependency notices as described in the
main guide. Run workloads on the authorized remote GPU host. Keep native
rejections, missing metrics and failures in the saved result, and choose
filters before the run.

## Check saved outputs

The bundled [check.py](check.py) is specific to these PD-L1 examples. It
requires `/inputs/freebindcraft/PDL1.pdb` and the native export layout. Stage
the checker as `/inputs/freebindcraft/complete/check.py`, then set `RUN_DIR`
to the selected settings file's remote `design_path`:

```sh
ariax forge run "$SESSION" --tool freebindcraft --json -- python3 /inputs/freebindcraft/complete/check.py "$RUN_DIR"
ariax forge watch "$SESSION" "$CHECK_COMMAND_ID" --timeout 180 --json
```

Set `CHECK_COMMAND_ID` to the returned command ID and inspect its terminal
state. The checker needs the tool's Gemmi, NumPy, ColabDesign and recorded MPNN
weights. It checks native identities, structure/array correspondence and
available MPNN results without running a new design or AF2 prediction.
It requires a complete `NativeArrays` export, but not an MPNN archive or an
accepted design. A pass therefore does not imply that all stages ran or a
candidate passed its scientific filters; interpret those outcomes using the
main guide.

Use `--diagnostic` only for a separate `freebindcraft-refold` output directory.
That mode checks its `diagnostic.json`, model reference arrays and
complex/binder sequence correspondence, including the recorded unchanged
rejection decision. Diagnostic refolding does not promote the original
candidate to an accepted design. For different targets, settings or export
layouts, use result checks appropriate to those inputs. Follow the shared
[project file and recovery workflow](../../../../outputs.md) to save or recover
results without automatically replaying design.
