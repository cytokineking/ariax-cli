# Choosing a hosted engine

Preserve the user's chosen engine when it supports the requested experiment.
If several engines fit, use the scientific workflow and input requirements to
choose; there is no universal best engine or comparable cross-engine score.

| Scientific need | Hosted choice and tradeoff |
| --- | --- |
| AF2-guided miniprotein hallucination with an accepted-design target | BindCraft; explicit filter/preset selection and PyRosetta or FreeBindCraft scoring |
| Diffusion miniproteins with AF2-IG and Protenix evaluation | PXDesign Extended; full target sequence and stricter coordinate/register requirements |
| ESMFold2 inversion with independent Protenix v2 validation | ESMFold2-pipeline; author-indexed partial structure conditioning, fixed production steps |
| VHH design | BoltzGen scaffold-based workflow or ESMFold2 framework/CDR design; use the requested design mechanism/framework policy |
| scFv design | ESMFold2-pipeline; paired framework and heavy/light CDR design |
| Linear alpha-helical peptide | BindCraft peptide presets; BoltzGen also supports linear peptide design |
| Cyclic peptide, stapled helicon, or miniprotein against one ligand | BoltzGen; each is a distinct hosted modality with its own inputs |

Ordinary miniprotein design fits all four. Resolve only choices that matter to
the experiment: design mechanism, modality, scoring/filter policy, target
context, campaign size, and compute authorization. Do not infer a large screen
or Turbo merely from “find a good binder.”

Use [campaign planning](campaigns.md) to suggest pilot/full-campaign sizes and
review points when unspecified. Recommend Turbo for long campaigns within the
agreed compute scope. Read the chosen engine's GPU guidance: target and binder
size affect VRAM needs, and the lowest hourly GPU price need not give the lowest
total run cost.

Hosted workflows are narrower than their source repositories. Arbitrary YAML,
custom frameworks, preview-only modes, rerank-only execution, and unadvertised
expert flags require separate support; do not work around the public contract
with internal routes. Use live schemas for supported fields and examples.
