# RFantibody native fixtures

These unmodified HLT PDBs come from `scripts/examples/example_inputs/` in
RosettaCommons/RFantibody revision `3e5a5bb1cb98befde9fc049ae3ff58cabb491f67`.
The source repository MIT license is retained in `LICENSE.RFantibody` and the image package.

- `hu-4D5-8_Fv.pdb`: paired VH H, 116 residues; VL L, 107 residues.
- `h-NbBCII10.pdb`: one VHH H, 127 residues. H is a VHH for this case.
- `rsv_site3.pdb`: RSV site 3 target T, 251 residues, including T305/T456 hotspots.

The supplied REMARK PDBinfo-LABEL records explicitly define each CDR.
The provided labels are HLT numbering. No new Chothia, IMGT, Kabat or North
numbering is inferred. Native generation/prediction can renumber the output;
the checker exports the original residue labels and corresponding native
positions. The raw source PDBs retain the original labels and coordinates.
For another scientific input, first obtain a validated conventional numbering
assignment, retain it in a sidecar, and explicitly map the CDRs into native HLT.
Do not infer CDR boundaries from sequential PDB residue numbers.

The original B50 baseline designs one backbone of each type with original CDR lengths:
paired H1:7,H2:6,H3:7,L1:11,L2:7,L3:9; VHH H1:10,H2:6,H3:16.
It samples two native ProteinMPNN sequences per backbone at temperature 0.1
and predicts each using the published antibody RF2 checkpoint, ten recycles,
seed 0 and hotspot visibility 0.1. All CDRs are explicitly selected; the
framework and target sequences must survive generation and sequence design.
Generation is native structural conditioning; it does not guarantee exact framework/target coordinates.

The scientific checker applies unchanged B27 sequence constraints, checks
generation geometry as a strict 0.05 A diagnostic and sequence-stage fixed backbone geometry at 0.05 A and checks RF2 confidence array shapes and
rounded PDB mean agreement. Fixed-length fixtures retain residue correspondence.
The completion checker also supports the variable CDR ranges in
`completion-matrix-20261009.md`, using explicit region correspondence and
preserving the native design TRB and CDR annotations. Individual source residue
labels are unavailable inside changed-length CDRs; the checker does not invent
a residue alignment.

The complete finite qualification covers paired VH/VL and VHH, all annotated
CDRs or H3 alone, variable CDR lengths, 251- and 502-residue targets, ten-design
native defaults, and one to four ProteinMPNN samples per backbone. The matrix
states the exact supported lengths, settings and resource floor. Direct RF2
PDB, Quiver and JSON diagnostics preserve their own identities and the original
campaign decision. Consult the installed RFantibody guide for commands and
native fields unavailable in each format.

Screening examples retain candidates passing or failing pred_lddt > 0.9,
interaction_pae < 10 A and target_aligned_antibody_rmsd < 2 A. These are
inspection thresholds, not evidence of experimental binding. Native interaction_pae
averages all interchain pairs, including H/L pairs for antibodies.

RF2 emits native NaN RMSDs for absent light-chain CDRs in a VHH. The checker
records these as unavailable, preserves the raw NaNs, and still requires finite
folding confidence, PAE, target alignment and present-domain metrics.

Native RF2 confidence arrays retain target-first T/H/L order (T/H for VHH),
while the output PDB uses H/L/T order. The report supplies a zero-based
`confidence_residue_map` from every array index to its chain, original source
residue label and native PDB residue. Do not read the raw arrays in PDB order.
