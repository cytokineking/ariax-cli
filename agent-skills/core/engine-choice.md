# Choose an execution model and engine

Start with the scientific goal, inputs, modality and required stages. Preserve
the user's chosen engine when the selected execution path supports the intended
experiment. If several engines fit, compare their workflows and input needs;
there is no universal best engine or comparable cross-engine score.

Use a **managed project** when its live protocol schema supports the experiment.
Ariax provisions compute, runs the defined stages, reports engine-specific
progress and results, persists artifacts, and cleans up. Use **Forge** for a
native command or a composed workflow: the agent plans commands,
inputs, workspace checks, saves and session closure, while Ariax enforces
access, isolation, billing and the resource lifecycle. A shared engine name does
not make their settings or supported modes interchangeable.

| Scientific need | Managed choice and tradeoff |
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

Consider the [Forge guide](../skills/ariax-forge/SKILL.md) for native settings,
additional tools or a custom sequence of stages. Use
[capability discovery](../skills/ariax-forge/tools/capabilities.md) to select
the exact live tool/model/mode and read its guide. Upstream options may exceed
the supported managed or native contract.

Use [campaign planning](campaigns.md) for pilot sizing, scaling and compute
tradeoffs. Check `ariax pricing --json`, memory requirements and supported
parallel execution against the user's budget, deadline and saved preferences.
When runtime is unknown, plan a bounded pilot and review point.
