# Choose an execution model and engine

Start with the scientific goal, inputs, modality and required stages. Preserve
the user's chosen engine when the selected execution path supports the intended
experiment. If several engines fit, compare their workflows and input needs;
there is no universal best engine or comparable cross-engine score.

Use a **managed project** when its live protocol schema supports the experiment.
Ariax provisions compute, runs the defined stages, reports engine-specific
progress and results, persists artifacts, and cleans up. Use **Forge** for a
qualified native command or a composed workflow: the agent plans commands,
inputs, workspace checks, saves and session closure, while Ariax enforces
access, isolation, billing and the resource lifecycle. A shared engine name does
not make their settings, versions or qualification interchangeable.

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

For a requested native joint sequence and all-atom design workflow, also see
the [Forge RFd4 guide](../skills/ariax-forge/tools/rfd4.md). It is not a
hosted protocol. Its selected-profile checks are bounded; use the live catalog
to assess availability, qualified modes and resources before selecting it.

Consider the [Forge platform guide](../skills/ariax-forge/SKILL.md) when the
goal calls for native settings, a tool outside the managed workflows, or a
custom sequence of stages. Discover the exact live tool, model and mode and
read its qualification before choosing it; a managed limitation does not prove
that a corresponding native mode is available or qualified. The Forge guides
for [BindCraft2](../skills/ariax-forge/tools/bindcraft2.md),
[BoltzGen](../skills/ariax-forge/tools/boltzgen.md),
[PXDesign](../skills/ariax-forge/tools/pxdesign.md), and
[ESMFold2-pipeline](../skills/ariax-forge/tools/esmfold2-pipeline.md) describe
their own bounded native scope.

Use [campaign planning](campaigns.md) for pilot sizing, evidence-based scaling,
cost forecasts, and review points. Compare one compatible GPU with supported
parallel execution using representative throughput, useful yield, current
allocation-hour prices, the deadline and authorized budget. Campaign length
alone does not decide the comparison. Without comparable evidence, report the
rate and runtime uncertainty and propose a bounded review point. Read the
chosen engine's GPU guidance and check `ariax pricing --json`; target and binder
size affect VRAM needs. Preserve existing GPU preferences and explicit requests.

Each managed workflow can be narrower than its source repository. Do not work
around its public contract with internal routes; use its live schema for
supported fields. Check Forge separately for the exact native mode and its
qualification instead of assuming upstream options are available.

For an explicit Mol-1 prediction request, read the [candidate Forge guide](../skills/ariax-forge/tools/mol1.md).
Mol-1 is not a managed protocol. Two bounded protein-monomer/CCD-ligand native
cases passed; installation and restoration remain pending. The guide does not
establish live availability. Prepared inputs and separate asset/service terms
apply.
