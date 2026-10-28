# Native RFantibody antibody and nanobody workflow

Use RFantibody to generate antibody or nanobody backbones, design their CDR
sequences and predict the resulting target complexes. The [native source](https://github.com/RosettaCommons/RFantibody/tree/3e5a5bb1cb98befde9fc049ae3ff58cabb491f67)
is revision `3e5a5bb1cb98befde9fc049ae3ff58cabb491f67`, using its locked Python
3.10 and PyTorch 2.3.1/CUDA 11.8 environment.

| Stage | Checkpoint under /models/rfantibody | Native defaults |
| --- | --- | --- |
| generate | RFdiffusion_Ab.pt | Specialized diffusion; 50 steps, final step 1, 10 sequential designs, all present CDRs at source lengths; stochastic |
| sequence | ProteinMPNN_v48_noise_0.2.pt | Native base ProteinMPNN; 1 sequence per structure, temperature 0.1, omit CX, native augmentation, all present CDRs; stochastic |
| predict | RF2_ab.pt | Antibody RF2; 10 recycles plus initial pass, cautious true, hotspot visibility 0.1, unset seed |

AbMPNN is a separate optional preset in the [ProteinMPNN guide](mpnn.md).
TCR, Rosetta scoring and experimental binding validation are outside this
three-checkpoint package. A native rejected candidate remains a valid outcome.

Use H/L framework chains for paired VH/VL, H for VHH, and target T in native
HLT interchange PDBs. Preserve `REMARK PDBinfo-LABEL` CDR annotations and
numbering sidecars. Native HLT requires integer residue labels; explicitly
renumber insertion codes with a retained source map before use. Generation
accepts arbitrary target chains, retaining their source chain/residue map when
native output combines them into T. Hotspots identify original target residues.

The supported resource envelope requires one GPU
with >=44 GiB reported memory, 48 GiB host RAM, eight usable CPUs and 250 GiB
free payload space. Sampled usage does not establish a smaller hardware floor.
Profiles cover target 251–502, VH 112–120, VL 104–110, VHH 123–131 residues,
total <=740; 1–10 backbones, 1–4 sequences/backbone and at most 40 RF2 inputs.
Support for other constructs remains unestablished.

`RFANTIBODY_EXAMPLES` is the installed example directory reported as
`data.examples.rfantibody` by discovery. `SESSION` is the authorized UUID.
Require every returned input ID ready with `forge inputs status SESSION INPUT_ID`
before submitting work. Tool readiness does not establish input readiness.

```sh
ariax forge tools add "$SESSION" --tools rfantibody --priority rfantibody --json
ariax forge tools wait "$SESSION" rfantibody --timeout 1800 --json
ariax forge inputs add "$SESSION" --file "$RFANTIBODY_EXAMPLES/rsv_site3.pdb" --path rfantibody/rsv_site3.pdb --json
ariax forge inputs add "$SESSION" --file "$RFANTIBODY_EXAMPLES/hu-4D5-8_Fv.pdb" --path rfantibody/hu-4D5-8_Fv.pdb --json
ariax forge inputs add "$SESSION" --file "$RFANTIBODY_EXAMPLES/h-NbBCII10.pdb" --path rfantibody/h-NbBCII10.pdb --json
ariax forge inputs add "$SESSION" --file "$RFANTIBODY_EXAMPLES/launch.py" --path rfantibody-code/launch.py --json
ariax forge inputs add "$SESSION" --file "$RFANTIBODY_EXAMPLES/check_outputs.py" --path rfantibody-code/check_outputs.py --json
ariax forge inputs add "$SESSION" --file "$RFANTIBODY_EXAMPLES/to_rf2_json.py" --path rfantibody-code/to_rf2_json.py --json
ariax forge inputs add "$SESSION" --file "$RFANTIBODY_EXAMPLES/../examples/campaigns/rfantibody-select.py" --path rfantibody-code/select.py --json
ariax forge inputs list "$SESSION" --json
ariax forge run "$SESSION" --tool base --json -- sh -c 'mkdir -p /workspace/rfantibody-code && cp /inputs/rfantibody-code/*.py /workspace/rfantibody-code/'
```

Wait for each command ID to finish and inspect its logs before the next
dependent action. This example requests one reproducible paired backbone and
two sequences. Omitted counts instead use the native defaults above. Every
explicit retry needs a new output directory.

```sh
ariax forge run "$SESSION" --tool rfantibody --gpus 0 --timeout-seconds 1800 --json -- taskset -c 0-7 env PYTHONPATH=/opt/forge-rfantibody python /workspace/rfantibody-code/launch.py generate --target /inputs/rfantibody/rsv_site3.pdb --framework /inputs/rfantibody/hu-4D5-8_Fv.pdb --out /workspace/paired/generate --design-loops H1:7,H2:6,H3:7,L1:11,L2:7,L3:9 --hotspots T305,T456 --num-designs 1 --deterministic
ariax forge run "$SESSION" --tool rfantibody --gpus 0 --timeout-seconds 600 --json -- taskset -c 0-7 env PYTHONPATH=/opt/forge-rfantibody python /workspace/rfantibody-code/launch.py sequence --input /workspace/paired/generate/pdbs --out /workspace/paired/sequence --loops H1,H2,H3,L1,L2,L3 --num-sequences 2 --temperature 0.1 --deterministic
ariax forge run "$SESSION" --tool rfantibody --gpus 0 --timeout-seconds 1800 --json -- taskset -c 0-7 env PYTHONPATH=/opt/forge-rfantibody python /workspace/rfantibody-code/launch.py predict --input /workspace/paired/sequence/pdbs --out /workspace/paired/predict --seed 0
ariax forge run "$SESSION" --tool rfantibody --gpus 0 --timeout-seconds 60 --json -- env PYTHONPATH=/opt/forge-rfantibody python /workspace/rfantibody-code/check_outputs.py --framework /inputs/rfantibody/hu-4D5-8_Fv.pdb --target /inputs/rfantibody/rsv_site3.pdb --generated /workspace/paired/generate/pdbs/design_0.pdb --sequenced /workspace/paired/sequence/pdbs/design_0_dldesign_0.pdb --predicted /workspace/paired/predict/pdbs/design_0_dldesign_0_best.pdb --loops H1,H2,H3,L1,L2,L3 --out /workspace/paired/check-0.json
```

Repeat the check for every sequence. For VHH, use `h-NbBCII10.pdb`, lengths
`H1:10,H2:6,H3:16`, and sequence/check loops `H1,H2,H3`. Deterministic diffusion
uses the design-index seed, ProteinMPNN uses seed 42, and RF2 uses the supplied
seed. Omitted flags preserve native stochastic behavior. Omit `--hotspots` for
native optional-hotspot behavior. H3-only design selects `H3:7` paired or
`H3:16` VHH and `--loops H3` in sequence/check stages; other CDRs remain fixed.

Variable ranges are `H1:6-8,H2:5-7,H3:5-9,L1:10-12,L2:6-8,L3:8-10` paired
and `H1:9-11,H2:5-7,H3:14-18` VHH. A length-changing CDR retains the source
region's residue list with null individual source residue/position fields.
Native output positions remain explicit; no residue-level alignment is invented.

Generation and sequence accept `--output-quiver`, saving `designs.qv` in place
of candidate PDBs. Sequence accepts `--input-quiver`; RF2 accepts one of
`--input`, `--input-pdb`, `--input-quiver`, or `--input-json`. RF2 output stays
PDB plus complete `.native.npz` arrays. Preserve Quiver tags as candidate IDs.
Native PDB stems, Quiver tags and JSON entry IDs must be 1–128 safe filename
characters: start with a letter or digit, followed by letters, digits, `_`, `.`
or `-`.
Run `to_rf2_json.py --input HLT.pdb --out /workspace/input.json` inside this image
to construct the pinned native sequence/target JSON and its source map. JSON
contains sequence-only H/L and empty native CDR masks. Its native RF2 export
contains pLDDT, PAE and interchain PAE and omits the ten geometry/CDR RMSDs.
Record those omissions and the diagnostic's provenance alongside the
structure-based screening report.

Every stage saves `stage.json` with exact native argv, checkpoint, settings and
revision. PDB generation retains its source map, TRB/settings and trajectories.
Quiver generation retains complete tagged structures and trajectory text; its
native writer does not emit TRB/unrounded confidence arrays.
Sequence stdout retains native sampled sequences/scores. RF2 retains SCORE
records and arrays before PDB means are rounded. The export patch changes no
score formula. Geometry above 0.05 Å remains a rejection; score/array comparisons
retain tolerance 0.0051. `pred_lddt` uses the native 0–1 scale. `interaction_pae`
includes all interchain pairs, including VH/VL. Arrays use T/H/L order (T/H for
VHH), while PDBs use H/L/T. Use the zero-based `confidence_residue_map`. Absent
VHH light-chain CDR RMSDs remain unavailable with raw NaNs preserved.

Preserve rejected candidates and their original decisions alongside arrays,
settings and source maps. Screening acceptance does not establish experimental binding.

The installed selector discovers checked fixed-length and variable-length
profiles beneath its root. It preserves the native candidate ID, confidence
map, generation files and original decision, and exports complete H/L/T FASTAs.
For the example above, review a rejected candidate explicitly:

```sh
ariax forge run "$SESSION" --tool base --json -- python3 /workspace/rfantibody-code/select.py /workspace/paired --out /workspace/selection-1 --candidate design_0_dldesign_0 --review-rejected
```

Keep the export outside the checked profile root when running the selector
again, so earlier copied reports do not become duplicate candidates. A report
under `checks/` uses its native sequence ID as filename; the single-backbone
example also supports `check-0.json`, `check-1.json`, and so on.

Save the complete workspace and inputs, including source helpers, rejected
outputs, arrays, settings and source maps:

```sh
ariax forge sync "$SESSION" --wait --json
ariax forge files "$SESSION" --json
ariax forge link "$SESSION" /workspace/paired/predict/pdbs/design_0_dldesign_0_best.pdb --checkpoint "$CHECKPOINT" --json
```

Use the returned checkpoint ID for saved-result links. Restoration starts with
empty scratch and command history. Sync the restored session explicitly before
closing it so it has its own complete checkpoint. Keep existing links pinned
to their original checkpoint. Submit the next scientific command explicitly.
See [saved results](../outputs.md) and [project controls](../SKILL.md#project-controls-and-resume).
The [example inputs](rfantibody/README.md) retain their source attribution and
[MIT license](rfantibody/LICENSE.RFantibody).
