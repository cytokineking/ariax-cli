# Choose an execution model and engine

Start with `ariax discover --query "<goal>" --json` (public, no auth required).
Preserve an explicit user choice when the selected path supports the experiment.
Cross-engine scores are not interchangeable; compare workflows, inputs, and live
schemas rather than looking for a single universal score.

## 1. Managed vs. Forge boundary

| Task type | Execution model | Why |
| --- | --- | --- |
| Standard de novo binder design (miniprotein, linear/cyclic peptide, VHH, scFv, Fab, ARP, helicon, small-molecule binder) | **Managed first** | Turnkey provisioning, checkpointing, ranked outputs, artifact storage, and automatic teardown. |
| Structure prediction, docking/affinity, inverse folding (MPNN/FAMPNN/Caliby), stability/ΔΔG, QC/ipSAE scoring, Foldseek/MMseqs2 search | **Forge only** | Dedicated native tools (`boltz2`, `protenix-models`, `af2`, `proteinmpnn`, `interface-scores`, `foldseek`, `mol1`, etc.). |
| Custom multi-stage pipelines, custom scripts/checkpoints, native RFdiffusion4 (`rfd4`/`rfd4-antibody`), RFantibody, Genie3, or custom filters | **Forge** | Full control over stage order, `/workspace` files, custom Python, and multi-GPU worker placement. |

## 2. Managed protocol decision matrix

| Protocol | Default / best fit | Modalities | Key constraints & notes |
| --- | --- | --- | --- |
| **`bindcraft2`** | **Default** for most protein, peptide, multi-target, and scaffold binder campaigns | `miniprotein`, `protein`, `peptide`, `cyclic-peptide`, `vhh`, `scfv`, `fab`, `arp`, `homo_oligomer`, `multidomain` | PDB/mmCIF primary target (up to 8 targets including FASTA secondary/detarget); author numbering; hotspots/coldspots; multi-state/detargeting; AF2 + MPNN. |
| **`boltzgen`** | **Default** for VHH/nanobody CDRs, small-molecule targets, and stapled helicons | `vhh`, `miniprotein-small-molecule`, `helicon`, `cyclic-peptide`, `peptide`, `miniprotein` | Canonical 1-based / mmCIF `label_seq_id` rules; SMILES or CCD ligand; requires `--input` for structure-backed runs; all-atom diffusion + refolding. |
| **`pxdesign`** | Diffusion miniproteins with dual AF2-IG + Protenix validation | `miniprotein` only | Extended pipeline only; rejects gapped PDBs (use canonical mmCIF); excludes Blackwell & `RTX6000PRO`. |
| **`esmfold2-pipeline`** | ESMFold2 inversion + mandatory Protenix v2 validation; bundled VHH/scFv frameworks | `miniprotein`, `vhh`, `scfv` | Fixed 150 steps; requires ≥80 GB VRAM (`H100`/`A100_80GB`/`RTX6000PRO`); scFv targets <400 aa recommended. |
| **`bindcraft-v1.5`** | Classic AF2 hallucination (use when explicitly requested; prefer `bindcraft2` for new campaigns) | `miniprotein`, `peptide` (linear) | PDB input only; single target; explicit `use_pyrosetta: false` (FreeBindCraft) or licensed PyRosetta. |

Resolve only choices that affect the experiment: modality, target register/context,
filter/scoring policy, campaign size, and compute authorization. Do not infer a
large screen or Turbo from "find a good binder."

## 3. Forge capability routing

Use live public discovery to narrow Forge tools and read a guide in one call:

```sh
ariax discover --query "<goal>" --execution forge --json
ariax forge catalog --task binder-design --json
ariax forge catalog --tool TOOL --with-guide --json
```

Key native routes beyond managed protocols:
- **VHH / antibody generation:** [RFd4 antibody checkpoint](../skills/ariax-forge/tools/rfd4-antibody.md) for native VHH sequence + structure generation; [RFantibody](../skills/ariax-forge/tools/rfantibody.md) for paired VH/VL or VHH CDR loops; [IgDesign](../skills/ariax-forge/tools/igdesign.md) for CDR redesign; [Antibody QC](../skills/ariax-forge/tools/antibody-qc.md) and [ImmuneBuilder](../skills/ariax-forge/tools/immunebuilder.md).
- **All-atom design & scaffolding:** [RFd4](../skills/ariax-forge/tools/rfd4.md), [Foundry (RFD3/RF3)](../skills/ariax-forge/tools/foundry.md), [Genie3](../skills/ariax-forge/tools/genie3.md), [Proteina-Complexa](../skills/ariax-forge/tools/proteina-complexa.md).
- **Prediction, sequence design & scoring:** see the [Forge tool index](../skills/ariax-forge/tools/capabilities/matrix.md) and [Forge guide](../skills/ariax-forge/SKILL.md).

Check `ariax pricing --json` and [campaign planning](campaigns.md) for pilot sizing
and compute tradeoffs before starting paid runs.
