# Forge tool guide index

Discover tools dynamically with `ariax discover --execution forge --json` or
`ariax forge catalog --task TASK --json` (compact summary by default; pass
`--all` for experimental/legacy tools). Fetch one tool's full requirements and
bundled guide in one call with `ariax forge catalog --tool TOOL --with-guide --json`.
See [capability discovery](../capabilities.md) for modes, resources, and terms.

## Recommended defaults

Default starting points for common Forge tasks (`tier: recommended`):

| Task | Tool or family | Use for | Guide |
| --- | --- | --- | --- |
| Design | `bindcraft2` | AF2-guided design across protein, peptide, cyclic peptide, VHH, scFv, Fab, ARP, and multi-target objectives | [BindCraft2](../bindcraft2.md) |
| Design | `boltzgen` | All-atom diffusion binder, cyclic peptide, small-molecule, and scaffold-conditioned VHH design | [BoltzGen](../boltzgen.md) |
| Design | `rfd4` | RFdiffusion4 all-atom joint sequence and structure design (binders, motifs, ligands) | [RFd4](../rfd4.md) |
| Antibodies | `rfd4-antibody` | Native RFd4 antibody checkpoint for VHH joint sequence and structure generation | [RFd4 antibody](../rfd4-antibody.md) |
| Antibodies | `immunebuilder` | Fast antibody (ABodyBuilder2), VHH (NanoBodyBuilder2), and TCR variable-domain prediction | [ImmuneBuilder](../immunebuilder.md) |
| Antibodies | `antibody-qc` | Antibody IMGT numbering, CDR liability alerts, and BioPhi OASis humanness QC | [Antibody QC](../antibody-qc.md) |
| Prediction | `boltz2` | All-atom biomolecular complex prediction and small-molecule affinity modes | [Boltz-2](../boltz2.md), [modes](../boltz2/modes.md) |
| Prediction | `protenix-models` | Multi-checkpoint AF3-class all-atom complex prediction with MSA, template, or constraint features | [Protenix](../protenix-models.md) |
| Prediction | `af2` | Protein monomer or multimer prediction with ColabFold for orthogonal refolding | [AF2](../af2.md) |
| Prediction | `biohub-esmfold2` | Fast standalone single-sequence and MSA-assisted protein structure prediction | [Biohub ESM](../biohub-esm.md) |
| Sequence | `proteinmpnn`, `solublempnn`, `ligandmpnn`, `abmpnn` | Backbone-, solubility-, ligand-, or antibody-conditioned inverse folding | [MPNN](../mpnn.md) |
| Sequence | `esmc-600m` | Balanced ESM-C 600M protein language model embeddings and masked log-likelihood scoring | [Biohub ESM](../biohub-esm.md) |
| Scoring | `interface-scores` | Unified CPU multi-predictor interface confidence (ipSAE, pDockQ, pDockQ2, LIS) for AF2, Boltz-2, Protenix, RF3, OpenDDE, and OpenFold3 | [Interface scores](../interface-scores.md) |
| Scoring | `tmol` | GPU-accelerated all-atom protein energy scoring, interface interaction energy, and minimization | [Tmol](../tmol.md) |
| Scoring | `design-qc` | CPU DSSP secondary structure, DockQ pose comparison, and interface score tables | [Design QC](../design-qc.md) |
| Search | `structure-tools`, `foldseek` | Structure preparation, geometry, alignment, clustering, and 3D structural search | [Structure tools](../structure-tools.md) |
| Search | `mmseqs2` | CPU sequence search, clustering, redundancy filtering, and alignment | [MMseqs2](../mmseqs2.md) |
| Workspace | `base` | Shell/Python utilities and project-local source/bootstrap work | [Base](../base.md), [custom code](../../references/custom-code.md) |

## Specialized tools

Use when a specific modality, assay, or analysis stage calls for them (`tier: specialized`):

| Task | Tool or family | Use for | Guide |
| --- | --- | --- | --- |
| Design | `freebindcraft` | AF2-guided binder design with OpenMM or licensed PyRosetta scoring | [FreeBindCraft](../freebindcraft.md) |
| Design | `rfd3`, `rfd3na`, `rf3` | Foundry protein/nucleic-acid conditioned generation and prediction | [Foundry](../foundry.md) |
| Design | `genie3` | Motif- or target-conditioned scaffold generation with CA-only MPNN | [Genie3](../genie3.md) |
| Design | `proteina-complexa` | Protein design with protein, ligand, or motif conditioning | [Proteina-Complexa](../proteina-complexa.md) |
| Design | `pxdesign` | Native PXDesign diffusion pipeline (preview, extended, or custom presets) | [PXDesign](../pxdesign.md) |
| Antibodies | `rfantibody` | Paired VH/VL or VHH CDR backbone generation, ProteinMPNN sequencing, and RF2 prediction | [RFantibody](../rfantibody.md) |
| Antibodies | `igdesign` | Structure-conditioned CDR redesign of a paired antibody with antigen | [IgDesign/IgMPNN](../igdesign.md) |
| Prediction | `mol1` | Prepared-JSON all-atom biomolecular structure prediction (Mol-1) | [Mol-1](../mol1.md) |
| Prediction | `chai1` | Molecular complex prediction with local MSA, templates, or restraints | [Chai-1](../chai1.md) |
| Prediction | `openbind-0`, `openfold3-preview2` | OpenFold3-family prediction with MSA/template inputs | [OpenFold3/OpenBind](../openfold3.md) |
| Prediction | `biohub-esmfold2-fast` | Faster single-sequence ESMFold2-Fast high-throughput screening | [Biohub ESM](../biohub-esm.md) |
| Sequence | `fampnn` | Full-atom sequence and sidechain design/scoring with fixed masks | [FAMPNN](../fampnn.md) |
| Sequence | `caliby` | Fixed-backbone or aligned-ensemble sequence design/scoring | [Caliby](../caliby.md) |
| Sequence | `esmc-300m`, `esmc-6b` | Lightweight (300M) and large (6B) ESM-C embeddings and likelihood scoring | [Biohub ESM](../biohub-esm.md) |
| Sequence | `absolute-stability-esm3`, `absolute-stability-saprot` | Learned absolute stability, mutation scans, and complex estimates | [Absolute stability](../absolute-stability.md) |
| Sequence | `spurs` | Mutation stability changes (ΔΔG) relative to wild type | [SPURS](../spurs.md) |
| Search | `mmseqs2-gpu`, `mmseqs2-uniref90` | GPU-accelerated MMseqs2 and pre-installed UniRef90 homology search | [MMseqs2](../mmseqs2.md) |
| Campaigns | `protein-hunter`, `opendde-harness` | Native composed binder or iterative antibody campaign harnesses | [Protein-Hunter](../protein-hunter.md), [Harness](../opendde-harness.md) |
| Campaigns | Campaign recipes, benchmark & lab feedback | Multi-stage pipelines, consensus benchmarks, and experimental data joins | [Recipes](../../references/campaign-recipes.md), [consensus](../campaign-recipes.md), [Benchmark](../campaign-benchmark.md), [Lab feedback](../lab-feedback.md) |

## Experimental & legacy tools

Hidden from default `ariax forge catalog` output; pass `--all` or `--tier experimental|legacy` to inspect:

| Status | Tool or family | Notes | Guide |
| --- | --- | --- | --- |
| Experimental | `protenix-v2` | Experimental Protenix v2 predictor (experimental scope; use `protenix-models` for stable runs) | [Protenix](../protenix-models.md) |
| Experimental | `esmfold2-pipeline` | Native ESMFold2 inversion + Protenix v2 (bounded workload; prefer managed protocol for full runs) | [Pipeline](../esmfold2-pipeline.md) |
| Experimental | `opendde` | Preview molecular prediction | [OpenDDE](../opendde.md) |
| Experimental | `mpnn-acceleration`, `boltz2-acceleration` | Explicit optimization-mode benchmarks | [MPNN accel](../mpnn-acceleration.md), [Boltz-2 accel](../boltz2-acceleration.md) |
| Legacy | `ipsae` | Standalone AF2-focused ipSAE v3 CPU scorer (superseded by `interface-scores`) | [ipSAE](../ipsae.md) |
| Legacy | `jms-esm2`, `jms-mpnn`, `jms-esmfold`, `jms-aggregate`, `jms-legacy` | Component and legacy Joint Modeling Score pipelines | [JMS components](../jms-components.md), [semantics](../jms-components/semantics.md), [Original JMS](../jms-legacy.md) |
