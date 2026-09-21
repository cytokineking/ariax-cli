# Choosing a hosted engine

Preserve the user's chosen engine when it supports the requested experiment.
If several engines fit, use the scientific workflow and input requirements to
choose; there is no universal best engine or comparable cross-engine score.

| Scientific need | Hosted choice and tradeoff |
| --- | --- |
| AF2-guided miniprotein hallucination with an accepted-design target | BindCraft; explicit filter/preset selection and PyRosetta or FreeBindCraft scoring |
| Native AF2-guided design across miniprotein, protein, peptide, VHH, scFv, Fab, ARP, oligomer, or multidomain formats | BindCraft2; accepted-design target, optional multi-state/detarget objectives, and modality-specific scaffolds |
| Diffusion miniproteins with AF2-IG and Protenix evaluation | PXDesign Extended; full target sequence and stricter coordinate/register requirements |
| ESMFold2 inversion with independent Protenix v2 validation | ESMFold2-pipeline; author-indexed partial structure conditioning, fixed production steps |
| VHH design | BindCraft2, BoltzGen scaffold-based workflow, or ESMFold2 framework/CDR design; use the requested mechanism and framework policy |
| scFv design | BindCraft2 two-chain variable-domain design or ESMFold2 paired framework/CDR design; neither choice implies a designed linker |
| Linear alpha-helical peptide | BindCraft peptide presets; BoltzGen also supports linear peptide design |
| Ordinary cyclic peptide | BindCraft2 or BoltzGen; compare design mechanism and inputs |
| Stapled Helicon or miniprotein against one ligand | BoltzGen; each is a distinct hosted modality with its own inputs |

Ordinary miniprotein design fits all five. Resolve only choices that matter to
the experiment: design mechanism, modality, scoring/filter policy, target
context, campaign size, and compute authorization. Do not infer a large screen
or Turbo merely from “find a good binder.”

Use [campaign planning](campaigns.md) to suggest pilot/full-campaign sizes and
review points when unspecified. Recommend Turbo for long campaigns within the
agreed compute scope. Read the chosen engine's GPU guidance: target and binder
size affect VRAM needs. Check `ariax pricing --json` and select a range of
compatible GPUs within the user's hourly price preferences to maximize
availability. Do not estimate campaign duration or total cost.

Hosted workflows are narrower than their source repositories. Arbitrary YAML,
custom frameworks, preview-only modes, rerank-only execution, and unadvertised
expert flags require separate support; do not work around the public contract
with internal routes. Use live schemas for supported fields and examples.
