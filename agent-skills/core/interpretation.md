# Interpreting protein-design results

Read this with the chosen engine's `outputs.md` before evaluating a pilot or
selecting candidates. Computational acceptance supports prioritization for
experiments; it does not establish binding, affinity, stability, or activity.

## Answer separate scientific questions

1. Does the binder have a plausible, confidently predicted fold?
2. Is the predicted binder–target interface confident?
3. Does the evaluated complex preserve the designed pose and requested epitope?
4. Is that pose compatible with the biological context and intended mechanism?

A well-folded binder at the wrong site can pass confidence filters while missing
the user's objective. For blocking designs, examine overlap or steric interference
with the intended partner using an appropriate reference complex when available.
For requested selectivity, consider a relevant counter-target evaluation where
supported; a low-confidence counter-target prediction alone does not establish
experimental selectivity.

## Keep structure stages and identities straight

Distinguish generated backbones/complexes, sequence-designed intermediates,
refolded complexes, and binder-only predictions. Inspect both the generation
pose and the later evaluated pose. Some intermediate structures contain
placeholder sidechains; use the engine's output reference to choose coordinates.

Map target and binder chains by sequence/identity and verified residue numbering,
not by assuming chain labels survive the pipeline. Align target coordinates
before measuring binder-pose RMSD. Self-aligning the binder measures fold
similarity, not whether it retained its position on the target. Respect symmetry
when matching equivalent protomers and check occupancy against relevant partners.

Tie each reported metric to its corresponding candidate, stage, model, and seed
where available. Do not combine the best confidence from one prediction with
the best pose agreement from another as if one structure achieved both. Distinguish
source-table scores from later rerun structures; report missing provenance.

## Metric glossary

| Metric | What it supports | Interpretation limits |
| --- | --- | --- |
| **pLDDT** | Confidence in local predicted structure; higher is better. | Check whether the producer uses 0–1 or 0–100 and which residues are averaged. It is a useful fold-confidence screen, not a direct thermodynamic stability, expression, affinity, or melting-temperature measurement. Low values can also reflect flexibility/disorder. |
| **pTM** | Confidence in global structure/relative domain arrangement. | A large, well-predicted target can dominate a whole-complex value; it is not a binder-interface score. |
| **ipTM** | Confidence in relative subunit placement; higher is better. | Record the chain scope. Whole-complex values can include native target–target interfaces. High ipTM does not establish the requested epitope or affinity. |
| **ipSAE** | PAE-derived interface confidence with filtering and normalization; higher is generally better. | Record the implementation, directional aggregation, chain pairing, and cutoffs when available. Pairwise maxima, directional minima, and combined multimer-target calculations are different quantities. Not a binding-energy or affinity scale. |
| **Interchain PAE / iPAE** | Predicted uncertainty in relative positioning across chains; lower generally means greater confidence. | Raw PAE is in angstroms; producer-scaled PAE is not. Check the interface/residue scope and never apply angstrom thresholds to scaled fields. |
| **Target-aligned binder RMSD / self-consistency DockQ** | Agreement of designed and subsequently predicted binding poses; lower RMSD or higher DockQ means closer agreement. | Identify the alignment, atom selection, chain mapping, and reference. Agreement with a designed structure is computational self-consistency, not agreement with an experimental binder complex. |
| **Native pass flags / composite rank scores** | Whether a producer's stated criteria passed, or relative ordering within its workflow. | Selected/ranked does not necessarily mean passed. Composite scores and pool-dependent scores are not comparable across engines or unrelated scoring batches. |

For VHH/scFv, inspect CDR confidence and CDR-mediated target contacts separately
from the conserved framework; a high framework average can hide uncertain
designed loops. Include plausible sequence/structure liabilities in shortlist
review, such as exposed hydrophobic patches, long homopolymer runs, clashes,
and disulfide compatibility. Judge these in the requested modality: antibody
framework similarity and expected cysteines are not miniprotein novelty failures.

## Compare candidates fairly

Use the engine's documented filters and score meanings as the starting point.
There is no universal ipTM, ipSAE, pLDDT, or pose threshold for all engines and
targets. Keep raw values, units, model, construct, MSA/template conditions, and
seed count/aggregation visible when available. Best-of-many sampling has a
different opportunity to score well than a single prediction. Batch z-scores
depend on the comparison pool and cannot be compared across waves or targets.

Prefer distinct sequence/backbone or binding-mode candidates to a shortlist
filled with near-duplicates. Agreement across different models can strengthen
computational evidence, but does not make their predictions experimentally
independent. Use known complexes or positive/negative controls when evaluating
an uncertain scoring workflow or suspicious systematic behavior; a compulsory
multi-model control panel is not required for every Ariax campaign. Additional
scoring must use supported workflows within the authorized scope.

Investigate unexpected constant metrics, missing outputs, or implausible counts
using retained logs and artifacts. A zero or all-fail result can be real, and
documented placeholders are not measurements. Diagnose input/configuration
problems and scientific failure without presuming that poor refolding is a
software bug. Missing or nonfinite values remain unknown, not zero or passed.
Preserve useful partial outputs before deciding whether to retry.

## Metric references

- [AlphaFold pLDDT: local confidence](https://www.ebi.ac.uk/training/online/courses/alphafold/inputs-and-outputs/evaluating-alphafolds-predicted-structures-using-confidence-scores/plddt-understanding-local-confidence/)
- [AlphaFold multimer confidence scores](https://www.ebi.ac.uk/training/online/courses/alphafold/inputs-and-outputs/evaluating-alphafolds-predicted-structures-using-confidence-scores/confidence-scores-in-alphafold-multimer/)
- [PAE: confidence in relative positioning](https://www.ebi.ac.uk/training/online/courses/alphafold/inputs-and-outputs/evaluating-alphafolds-predicted-structures-using-confidence-scores/pae-a-measure-of-global-confidence-in-alphafold-predictions/)
- [Dunbrack Lab ipSAE implementation](https://github.com/DunbrackLab/IPSAE)

These explain the metrics; the hosted engine's output reference defines the
specific fields and stages actually available through Ariax.
