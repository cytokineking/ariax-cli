# Forge tool guide index

Use this index to compare tools and open the relevant guide. Find available
choices with `ariax forge catalog --task TASK --compact --json`, then inspect
the selected tool/model/mode as described in [capability discovery](../capabilities.md).
The live catalog supplies current workload limits, resources and terms.

## Design

| Tool or family | Use for | Guide |
| --- | --- | --- |
| `bindcraft2` | AF2-guided design across protein, peptide and antibody formats, including multi-state objectives | [BindCraft2](../bindcraft2.md) |
| `freebindcraft` | AF2-guided binder design with alternative relaxation/scoring routes | [FreeBindCraft](../freebindcraft.md) |
| `boltzgen` | Diffusion binder, peptide and scaffold-conditioned antibody design | [BoltzGen](../boltzgen.md) |
| `rfd3`, `rfd3na` | Conditioned generation with Foundry's protein or nucleic-acid models | [Foundry](../foundry.md) |
| `rfd4` | Joint sequence and all-atom design | [RFd4](../rfd4.md) |
| `rfantibody` | Antibody backbone generation, sequencing and prediction | [RFantibody](../rfantibody.md) |
| `genie3` | Conditioned design with target evaluation, filtering or search/refinement | [Genie3](../genie3.md) |
| `proteina-complexa` | Protein design with protein, ligand or motif conditioning | [Proteina-Complexa](../proteina-complexa.md) |
| `pxdesign` | Native diffusion design with preview, extended or custom settings | [PXDesign](../pxdesign.md) |
| `esmfold2-pipeline` | Experimental ESMFold2 inversion with Protenix v2 validation | [Pipeline](../esmfold2-pipeline.md) |
| `igdesign` | Structure-conditioned CDR redesign of a paired antibody with antigen | [IgDesign/IgMPNN](../igdesign.md) |

## Prediction

| Tool or family | Use for | Guide |
| --- | --- | --- |
| `boltz2` | Molecular structure/complex prediction and declared affinity-input modes | [Boltz-2](../boltz2.md), [modes](../boltz2/modes.md) |
| `af2` | Protein monomer or multimer prediction with ColabFold | [AF2](../af2.md) |
| `rf3` | Foundry molecular prediction | [Foundry](../foundry.md) |
| `protenix-models`, `protenix-v2` | Molecular prediction with model-specific MSA, template or constraint features | [Protenix](../protenix-models.md) |
| `biohub-esmfold2`, `biohub-esmfold2-fast` | Standalone sequence-to-protein structure prediction | [Biohub ESM](../biohub-esm.md) |
| `opendde` | Preview molecular prediction | [OpenDDE](../opendde.md) |
| `openbind-0`, `openfold3-preview2` | OpenFold3-family prediction with MSA/template inputs | [OpenFold3/OpenBind](../openfold3.md) |
| Mol-1 | Prepared-JSON molecular prediction | [Mol-1](../mol1.md) |
| `chai1` | Molecular prediction with local MSA, templates or restraints | [Chai-1](../chai1.md) |
| `immunebuilder` | Antibody, VHH or TCR variable-domain structure prediction | [ImmuneBuilder](../immunebuilder.md) |

## Sequence optimization

| Tool or family | Use for | Guide |
| --- | --- | --- |
| `proteinmpnn`, `solublempnn`, `ligandmpnn`, `abmpnn` | Backbone-, ligand- or antibody-conditioned sequence design/scoring | [MPNN](../mpnn.md) |
| `fampnn` | Sequence design/scoring with fixed masks and checkpoint choices | [FAMPNN](../fampnn.md) |
| `caliby` | Fixed-backbone or aligned-ensemble sequence design/scoring | [Caliby](../caliby.md) |
| `esmc-300m`, `esmc-600m`, `esmc-6b` | Sequence embeddings and model likelihood | [Biohub ESM](../biohub-esm.md) |
| `absolute-stability-esm3`, `absolute-stability-saprot` | Learned absolute stability, mutation scans or complex estimates | [Absolute stability](../absolute-stability.md) |
| `spurs` | Mutation stability changes relative to a supplied wild type | [SPURS](../spurs.md) |
| `jms-esm2`, `jms-mpnn`, `jms-esmfold`, `jms-aggregate` | Explicit components of a joint sequence score | [JMS components](../jms-components.md), [semantics](../jms-components/semantics.md) |
| `jms-legacy` | Original JMS TrMRF, TrROS or joint operations | [Original JMS](../jms-legacy.md) |
| `mpnn-acceleration` | Explicit comparison of full-backbone optimization modes | [MPNN acceleration](../mpnn-acceleration.md) |

## Validation and search

| Tool or family | Use for | Guide |
| --- | --- | --- |
| `ipsae`, `interface-scores` | Predicted-complex interface confidence | [ipSAE](../ipsae.md), [interface scores](../interface-scores.md) |
| `tmol` | Protein energy, interface interaction scoring or Cartesian minimization | [Tmol](../tmol.md) |
| `structure-tools`, `foldseek` | Structure preparation, geometry, alignment, clustering or structural database search | [Structure tools](../structure-tools.md) |
| `mmseqs2`, `mmseqs2-gpu`, `mmseqs2-uniref90` | Protein sequence search, clustering, redundancy filtering or alignments | [MMseqs2](../mmseqs2.md) |
| `design-qc` | DSSP, DockQ or reports from existing interface scores | [Design QC](../design-qc.md) |
| `antibody-qc` | Antibody numbering, sequence alerts and repertoire resemblance | [Antibody QC](../antibody-qc.md) |
| `boltz2-acceleration` | Explicit evaluation of a residual optimization | [Boltz-2 acceleration](../boltz2-acceleration.md) |

## Campaigns and workspace

| Tool or family | Use for | Guide |
| --- | --- | --- |
| `base` | Shell/Python and project-local source/bootstrap work | [Base](../base.md), [custom code](../../references/custom-code.md) |
| `opendde-harness` | Iterative antibody design with explicit review points | [Harness](../opendde-harness.md) |
| `protein-hunter` | A native composed binder-design campaign | [Protein-Hunter](../protein-hunter.md) |
| Campaign recipes | Join generator, sequence, predictor, scoring and search outputs | [Recipes](../../references/campaign-recipes.md), [consensus](../campaign-recipes.md) |
| `lab-feedback` | Save experimental observations or prepare an offline laboratory review draft | [Lab feedback](../lab-feedback.md) |
| Campaign benchmark | Compare retained candidates with declared QC/search settings | [Benchmark](../campaign-benchmark.md) |
