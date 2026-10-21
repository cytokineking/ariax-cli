# Antibody QC methods and support limits

BioPhi `bc59cd17b690a634553ac50a60840b9a89bd21b0` (1.0.11) supplies the native
OASis query and antibody percentile arrays. AbNumber 0.3.2 with ANARCI 2020.04.23
supplies IMGT numbering and IMGT CDR boundaries. Inputs must cover exactly one
variable domain per chain. VHH status comes from the explicit input declaration;
numbering classifies its domain as H. The numbering HMM data ships with ANARCI.

| Method | Meaning and selected controls |
| --- | --- |
| number-liabilities | Original residues, IMGT positions/insertion codes and FR/CDR labels; explicit motifs over the whole variable domain. |
| oasis | Full OASis v1 overlapping 9mer prevalence. Loose 1%, relaxed 10%, medium 50%, strict 90%, using >= thresholds. |
| tnp-sequence | TNP `29dcac72f1380e8538e8870f45a699d3c6156162` native CDR sequences and unchanged L/L3 thresholds, only for declared VHH. |

The OASis numerator uses human subject hits with at least 10000 complete heavy or
light chains, excluding Corcoran_2016. The native denominator counts subjects
meeting the complete-chain cutoff. This preserves BioPhi's selected code,
including the difference between numerator and denominator study filters.
Identity pools all overlapping 9mers, with no peptide crossing a chain boundary.
The supplied database is [OASis v1](https://zenodo.org/records/5164685), published
August 2021, 6.5 GB compressed and approximately 22 GB extracted. The complete
reference is required. Its CC BY 4.0 attribution is retained with the asset.
The full archived file contains 231 subject rows; native eligible denominators are
225 heavy and 154 light. BioPhi's CLI description says more than 500 subjects;
that population disagreement remains unresolved. Outputs retain the archived
counts. Native antibody percentile arrays are exposed as BioPhi reference ranks;
their calibration against this archived cohort has not been revalidated.
Identity and native percentile values use a 0..1 scale; a native percentile of
0.9 denotes the 90th percentile of the corresponding BioPhi reference.
VHH identity describes resemblance to human heavy repertoires; the antibody
reference arrays provide no VHH-specific percentile calibration.

Sequence alerts include N[^P][ST] glycosylation sequons, N[GST] deamidation,
D[GSTDH] isomerization, M/W oxidation susceptibility, DP fragmentation and
additional cysteine outside IMGT 23/104. Each match retains its full residue span.
Exposure, modification rates and disulfide partners are unmeasured. These labels
use the entire variable domain and explicitly differ in scope from TNP's
North-CDR/vernier selections. Generic polyreactivity motifs are excluded.

TNP's L flags are red below 20 or above 39, amber at 20..24 or 37..39, otherwise
green. L3 flags are red below 5 or above 23, amber at 5..8 or 21..23, otherwise
green. Its reference contains 36 clinical-stage nanobody sequences. The original
source's region module is compared with the independently obtained AbNumber CDR
sequences in each native call. The full TNP predictor, compactness, PSH, PPC and
PNC remain unavailable. Public [salt-bridge key](https://github.com/oxpig/TNP/pull/3)
and [loop indentation](https://github.com/oxpig/TNP/pull/4) reports match the
selected structural source; [failed-score handling](https://github.com/oxpig/TNP/pull/5)
requires correction before structural support. Full TAP is also deferred pending
canonical executable terms and dated threshold reconciliation.

BioPhi and AbNumber code use MIT terms. ANARCI and selected TNP code use
BSD-3-Clause, while HMMER uses BSD-3-Clause. OASis uses CC BY 4.0 with creator credit.
Neural humanization or QC checkpoints are unselected. AbNatiV's learned nativeness
and AntiFold's structural sequence likelihood are research comparisons; their
models are absent from this image. AbNatiV has noncommercial restrictions.

Scientific provenance: [BioPhi paper](https://doi.org/10.1080/19420862.2021.2020203),
[ANARCI paper](https://doi.org/10.1093/bioinformatics/btv552),
[TNP creator preprint](https://doi.org/10.1101/2025.08.11.669635),
[BioPhi source](https://github.com/Merck/BioPhi/tree/bc59cd17b690a634553ac50a60840b9a89bd21b0),
[TNP source](https://github.com/oxpig/TNP/tree/29dcac72f1380e8538e8870f45a699d3c6156162).
The selected scores carry no clinical immunogenicity or measured binding claim.

Coordinator terms clarification, October 15: the [current IMGT policy](https://www.imgt.org/about/termsofuse.php) states CC BY 4.0 for underlying germline source data. Separate terms for the packaged ANARCI derived HMM snapshot remain unverified. ANARCI code retains its BSD-3-Clause notice.
