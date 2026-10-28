# Forge tools and supported scientific scope

Read with `ariax skills forge --reference catalog --read --json`.

Use `ariax forge catalog --compact --json` to find relevant tool keys, then
`ariax forge catalog --tool TOOL --json` for full model choices, mode qualifications
and resource requirements available to your account. Select the tools you need
and wait for preparation to finish before submitting a command. A null resource
minimum means it is unknown. The linked guides describe the qualified scientific
settings and the limits of each result.

Catalog RAM minima are unset except for `esmfold2-pipeline`, which requires
80 GiB. Explicit user-requested RAM minima still apply. RAM allocations and
measurements in qualification notes describe the recorded runs.

The [RFd4 guide](../tools/rfd4.md) describes bounded native cases and their
scientific limits. Consult the live catalog for availability, mode-level native,
installation and restoration evidence, and resources. A packaged guide does not
establish that a tool is available to an account.

| Package | Guide and native interface | Scientific scope |
| --- | --- | --- |
| Foundry | [Foundry](../tools/foundry.md); `rf3 fold --help`, `rfd3 design --help`, `rfd3na design --help` | RF3 covers all three checkpoint choices. Generation has native evidence for the documented profiles; check live availability before selecting a generation tool. |
| MPNN | [MPNN](../tools/mpnn.md); `proteinmpnn --help`, `solublempnn --help`, `ligandmpnn --help`, `abmpnn --help` | Four distinct native tools have qualified installation and saved-output recovery. Older JMS/ColabDesign variants have separate availability and semantics. RFantibody uses its own checkpoint. |
| Mol-1 (draft) | [Mol-1](../tools/mol1.md); `python -m mol.runner.inference` with prepared JSON | `mol-1-base` candidate protein-monomer and ligand-ccd modes; native/installation/restoration untested. No public catalog availability established. No public MSA search; broader upstream modalities remain outside candidate qualification. |
| Tmol | [Tmol](../tools/tmol.md); uploaded `run.py` with `score`, `interface-score` and `minimize` | Protein energy scoring and Cartesian minimization without model downloads. Preserve prepared coordinates and atom identities; read live mode evidence before use. Interaction scores are not experimental affinities. |
| Protenix | [Protenix](../tools/protenix-models.md); `protenix pred --help`, `forge-protenix --help` | Eight public choices cover the documented molecular, template, constraint and batch cases. V2 has bounded internal-development coverage for nine integrated samples and three standalone samples, with installation and saved-output recovery. Its guide defines the supported settings and separate delivery scope. Preserve soft-prior misses and unavailable split-token metrics. |
| AlphaFold2 | [AF2](../tools/af2.md); `colabfold_batch --help` | All fifteen monomer, pTM and multimer-v3 checkpoints have bounded native coverage, including supplied/public MSA and template/pairing paths. Use the guide's eight-CPU startup prefix and model-specific limits. |
| Standalone ESMFold2 | [Biohub ESM](../tools/biohub-esm.md); `biohub-esm fold --help` | Full and Fast models cover the documented 1–1,040-residue envelope, explicit continuation and complete saved-output recovery. The native Fast MSA refusal is expected. Design optimization uses the separate pipeline below. |
| ESMC | [Biohub ESM](../tools/biohub-esm.md); `biohub-esm esmc --help` | 300M/600M/6B support the declared 1–1,024-residue, one-to-eight-item sequential profiles and BF16/FP32 modes. Read the model-specific memory observations and driver requirements. |
| Boltz-2 | [Boltz-2](../tools/boltz2.md), [modes](../tools/boltz2/modes.md); `boltz predict --help` | Qualified small molecular, supplied/public MSA, template, batch and both affinity-input paths. Native affinity keeps five samples and 200 diffusion steps. MSE identity refusal and optional unselected profiles retain their meanings. |
| BoltzGen | [Native BoltzGen](../tools/boltzgen.md); `forge-boltzgen --seed 7 run --help` | The small 25-design campaign and 22 earlier profiles cover both design checkpoints, five-sample refolds and completed-stage continuation. Native rejections and stochastic limits remain. [Hosted BoltzGen](../../ariax-boltzgen/SKILL.md) has its own workflow. |
| BindCraft2 | [BindCraft2](../tools/bindcraft2.md); `bindcraft design --help` | v1.0.4 covers the documented design, both ProteinMPNN variants, complex/binder validation and campaign helper paths. Saved-output inspection preserves native filter rejection and historical failed comparisons. Resource allowances apply to the guide's small inputs. |
| FreeBindCraft | [FreeBindCraft](../tools/freebindcraft.md); `freebindcraft --help` | Both relaxation routes and the documented campaign matrix have native and complete saved-output checks. Diagnostic refolds retain the source candidate's rejection status. The universal VRAM minimum is unknown. |
| PXDesign | [Native PXDesign](../tools/pxdesign.md), [hosted protocol](../../ariax-pxdesign/SKILL.md) | Qualified preview, extended and custom modes with explicit continuation. Retain native exclusions and duplicate-coordinate findings. The H100 qualification profile used 100 GiB RAM; the GPU, CPU and disk profile remains 48 GiB GPU memory, eight CPUs and 600 GiB disk. Catalog admission has no fixed RAM floor. |
| ESMFold2 design pipeline | [Native pipeline](../tools/esmfold2-pipeline.md), [hosted protocol](../../ariax-esmfold2-pipeline/SKILL.md) | Four experimental aliases cover small miniprotein, experimental-target, VHH and scFv paths, native critic and integrated v2 validation. The admission profile is one GPU with 79 GiB usable VRAM, 80 GiB RAM and eight CPUs, through 318 polymer residues. Recorded qualification used a 96-GiB container memory limit. The eight-step design qualification leaves default-length campaigns unqualified. |
| Chai-1 | [Chai-1](../tools/chai1.md), [fixtures](../tools/examples/chai1/README.md); `chai-lab fold --help` | Native protein, complex, ligand, nucleic-acid, modified-residue and glycan prediction covers the documented local MSA, template, contact and pocket conditioning paths. Invalid restraints fail through the supplied wrapper. Installation and saved-output recovery cover the bounded 256-token examples; larger systems need their own capacity assessment. |
| OpenDDE | [OpenDDE](../tools/opendde.md); `forge-opendde --help` | Both checkpoints have native lifecycle and complete saved-output coverage within Preview scope. The full profile through 805 tokens was qualified with 79 GiB reported GPU memory, 56 GiB RAM and eight CPUs; catalog admission has no fixed RAM floor. |
| OpenFold3/OpenBind | [OpenFold3](../tools/openfold3.md); `openfold3-native --help` | OpenBind-0 and Preview2 support the documented MSA/template paths and complete recovery. Preserve stochastic default differences; Preview1 is excluded. Use `openbind-0` and `openfold3-preview2`. |
| RFantibody | [RFantibody](../tools/rfantibody.md); `rfantibody generate --help`, `rfantibody sequence --help`, `rfantibody predict --help` | Eight declared VH/VL and VHH profiles cover native defaults, interchange and retained trajectories. The specialized RFdiffusion_Ab model belongs to this package. Rejected candidates stay rejected after recovery. |
| Genie3 | [Native Genie3](../tools/genie3.md) | Fourteen native profiles cover target evaluation, filters, search/refinement and explicit continuation. The qualified L40 profile uses 44 GiB GPU memory, 48 GiB RAM, eight CPUs and 250 GiB disk. |
| Interface confidence | [Interface scores](../tools/interface-scores.md), [ipSAE](../tools/ipsae.md); `interface-scores --help` | Documented AF2, Boltz, RF3, Protenix, OpenDDE, OpenBind-0 and Preview2 consumers preserve original files and report unavailable mappings. |
| Structure tools / Foldseek | [Structure tools](../tools/structure-tools.md); `structure-tools --help`, `foldseek -h` | Preparation, alignment, geometry, clustering and downstream 3Di consumption have native coverage. Full PDB250101 and AlphaFold Swiss-Prot v6/2025_03 database searches include expected-hit and strict no-hit checks, installed commands and fresh saved-output recovery. Search settings and database snapshot determine coverage. |
| JMS components | [JMS components](../tools/jms-components.md), [semantics](../tools/jms-components/semantics.md); `jms-components --help` | ESM2, two-checkpoint ColabDesign MPNN, full/serialized/half-mask ESMFold and hybrid1/hybrid3 have distinct native quantities. Check live availability. |
| Original JMS joint score | [Original JMS](../tools/jms-legacy.md) | The approved public 6MRR-A 12-case/41-stage comparison covers TrMRF, TrROS and joint operations. The unavailable historical r9_900 reproduction remains unverified. |
| FAMPNN | [FAMPNN](../tools/fampnn.md); `fampnn --help` | Qualified checkpoint, mode, structure and batch matrix with fixed masks, concatenated mutation indexing and saved-output recovery. The guide distinguishes the all-model 76-residue matrix from recommended 247/494-residue pairs. |
| Agent campaigns | [Campaign recipes](campaign-recipes.md), [Harness](../tools/opendde-harness.md), [Protein-Hunter](../tools/protein-hunter.md) | Harness covers the documented one/two-cycle deterministic mode with GPT-6.1 and explicit hold/continue. Nondeterministic mode remains unqualified. Protein-Hunter has a bounded native campaign and recovery scope; broader sizes and combinations remain outside its bounded native scope; selected private delivery and complete recovery passed. |
| Proteina-Complexa | [Proteina-Complexa](../tools/proteina-complexa.md); `complexa --help`, `rf3 fold --help` | Protein, ligand and complete AME conditioning cover the documented search, predictor and refinement matrix. Preserve complete DHZ/ZN chemistry and the older BCA fixture's four missing atoms. Native quality rejection remains a valid result. |
| Absolute stability | [Absolute stability](../tools/absolute-stability.md); `absolute-stability --help` | Four ensembles cover DG/complex512 and scan128/batch1–4. DG_AB retains its full-complex meaning; synthetic boundary structures establish execution/resource behavior. |

Base is always included. Its [guide](../tools/base.md) covers shell/Python
readiness and reconstructing scratch environments from saved source.

Use the common [checkpoint, link and restore](../outputs.md) and
[human hold/resume](../SKILL.md#project-controls-and-resume) flows. After an
interruption, inspect preserved output and continue only unfinished work through
the tool's supported command. Reuse the original durable command ID and fields
after a lost acknowledgment. Approval clears a hold; a subsequent explicit
command resumes scientific work.

Scientific rejection is a valid completed outcome. Computational confidence,
ranking and recovered coordinates provide evidence about the model's output.
Experimental binding or affinity requires its own measurements.

[Capability discovery](../tools/capabilities.md) routes scientific tasks and reports scoped per-model/per-mode evidence, component terms and explicit unknown fields.
