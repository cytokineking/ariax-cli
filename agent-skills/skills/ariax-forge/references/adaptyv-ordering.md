# Adaptyv Bio experimental handoff and ordering

Use this reference after completing computational candidate generation and
review in Forge (see [campaign recipes](campaign-recipes.md)) when preparing an
authorized wet-lab order with Adaptyv Bio. Forge compute authority does **not**
authorize sequence disclosure or an experimental purchase.

## Pre-order QC & review table

QC inspiration: Adaptyv's
[protein-qc](https://github.com/adaptyvbio/protein-design-skills/blob/59dd63374314baa2fb1f9864f190775bd7466647/skills/protein-qc/SKILL.md)
and [ipSAE](https://github.com/adaptyvbio/protein-design-skills/blob/59dd63374314baa2fb1f9864f190775bd7466647/skills/ipsae/SKILL.md)
guides. Use actual native outputs, units, and unchanged filters; external guides
do not supply universal thresholds or automatic scale-up authority.

- Separate folding/pose confidence, interface evidence, and expression
  liabilities (cysteines, glycosylation/deamidation motifs, exposed hydrophobic
  or charged patches, tags/linker interference, assembly context). Record
  uncertainty: sequence motifs alone do not establish exposure or expression,
  and unavailable stability/Rosetta metrics cannot be filled with constants.
- Prepare a remote review table containing: candidate ID, full sequence(s),
  construct format, target/register, generation/evaluation model, seed/sample,
  original pass/rejection flags, unavailable metrics, selection rationale, and
  current structure/settings links (noting that linked paths can change).
- Keep failed rows. If no row passes, report no computationally accepted
  shortlist; a zero-pass result does not establish an undesignable target.

## Construct & target requirements

- Submit full FASTA for a selected minibinder or VHH (including VHH framework).
- Paired variable Fv chains are not complete Fab/scFv/IgG constructs: keep H/L
  paired; a Fab needs complete heavy/light chains and an scFv needs explicit
  linker/orientation and renewed evaluation. Adaptyv supports minibinders, VHH,
  scFv, and paired Fabs and excludes intact bivalent IgGs. Confirm current
  [supported protein formats](https://docs.adaptyvbio.com/docs/experiment-setup/supported-protein-formats).
- Match assay and computational target sequence/domain, oligomeric state,
  glycosylation, and tags (an Fc tag can alter apparent affinity via avidity).
  Confirm sourcing, reagent cost, tag compatibility, and feasibility per
  [target guidance](https://docs.adaptyvbio.com/docs/experiment-setup/target-proteins).

## Portal submission & lab-data join

- With explicit disclosure/submission authority, use the
  [Foundry Portal](https://foundry.adaptyvbio.com) to draft the assay/target,
  upload named FASTA or mapped name/sequence CSV, designate controls, inspect
  parsed sequences, and pick replicates.
- Binding orders require **24 distinct sequences per target** (replicates do not
  fill that minimum). Arrange smaller pilots rather than expanding generation
  solely to pad an order. Inspect the final quote, target costs, deliverables,
  and timeline, and obtain explicit purchase authority before confirming (see
  [creating experiments](https://docs.adaptyvbio.com/docs/experiment-setup/creating-experiments)).
- After results return, join lab sequence/replicate IDs to submitted FASTA and
  native candidate keys. Retain assay method, concentrations, controls,
  expression, fit quality, kinetics, and unexpressed/nonbinding/censored/failed
  rows beside computational scores (see
  [binding data package](https://docs.adaptyvbio.com/docs/experiment-setup/binding-data-package)
  and [lab feedback](../tools/lab-feedback.md)).
