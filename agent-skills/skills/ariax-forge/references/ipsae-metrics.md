# Score semantics and output identity

The v3 native output stem is the structure path without `.pdb`/`.cif`, followed by `_<PAE>_<DIST>`, where thresholds are truncated to integers and values below 10 receive a leading zero. It writes `.txt` (chain pairs), `_byres.txt` (alignment residue scores), and `.pml` (PyMOL aliases/comments). There are no `_chains.csv`, `_residues.csv`, or native `ipSAE_min` outputs. Preserve actual floating thresholds in run notes because filenames can collide. Repeated runs overwrite these files; score copied matched inputs in a fresh directory.

For each unordered chain pair, `.txt` has two `asym` rows and one `max` row. `Chn1` is the alignment/reference row chain and `Chn2` the scored column chain. By-residue `i` is a one-based global representative index; `AlignResNum` is the structure's parsed residue number. Keep both identities and chains; identical residue numbers in different chains are different residues.

## Calculations in the vendored v3 source

The by-residue table also reports `AlignRespLDDT` on 0–100,
`ipTM_pae` as the unfiltered row kernel score, and each row's normalization
lengths and d0 values. A residue produces a row for every other chain; a
multi-chain table can therefore contain more rows than residues. With all
scores zero, the chain-level maximizing residue can be an uninformative first
array position. Treat zero-score identity cautiously.

The PAE kernel is `1 / (1 + (PAE/d0)^2)`. For protein pairs, `d0=max(1,1.24*(max(L,27)-15)^(1/3)-1.8)`; for a pair containing native-recognized nucleic acid the minimum is 2 Å, an explicitly arbitrary native choice. This does not establish nucleic-acid calibration.

| Column | Native meaning |
| --- | --- |
| `ipSAE` | For each alignment residue, average kernel over partner residues with **PAE < user cutoff**, using L equal to that row's count of qualifying partner residues (`n0res`). Directional score is the maximum such row score. No qualifying entries gives zero. |
| `ipSAE_d0chn` | Same PAE-filtered average, but L is total residues in both chains (`n0chn`). |
| `ipSAE_d0dom` | L is the sum of unique residues participating in qualifying PAE pairs (`n0dom`) for that direction. |
| `ipTM_d0chn` | Recomputed kernel score without PAE filtering; total pair length determines d0. It is not the predictor's own ipTM calculation. |
| `ipTM_af` | Imported predictor confidence. AF2's complex ipTM is repeated for every pair (-1 when absent); AF3/Boltz use their summary pair data (zero fallback when missing). |
| `pDockQ` | Fixed distance ≤8 Å at CB/glycine CA representatives; x=mean interface pLDDT(0–100)×log10(number of residue contact pairs). Score `0.724/(1+exp(-0.052*(x-152.611)))+0.018`, or zero with no contacts. |
| `pDockQ2` | Same fixed contacts, directional mean kernel with d0=10 Å times mean interface pLDDT. Score `1.31/(1+exp(-0.075*(x-84.733)))+0.005`, or zero with no contacts. Preserve native values; do not force them into a probability calibration. |
| `LIS` | Directional mean `(12-PAE)/12` over partner PAE ≤12 Å; zero if none. No distance filter. |

The user distance cutoff affects the `dist1`/`dist2` residue counts (PAE < cutoff **and** distance < cutoff), not ipSAE values. `nres1`/`nres2` count unique PAE-qualified residues, not contact-pair counts. pDockQ/pDockQ2 have their own fixed 8 Å contact cutoff, and LIS has its own fixed 12 Å cutoff. Native distances use CB/glycine CA (C3 representatives for nucleic acids), not CA–CA generally.

The `max` row independently takes the maximum direction for each ipSAE/ipTM recomputation and pDockQ2. Its LIS is the **mean** of directions despite the row name; pDockQ is symmetric. Boltz imported ipTM uses the maximum of directions in that row. AF2 retains
its one imported complex value. AF3 retains the second printed direction,
which native code assumes is symmetric; preserve both directional inputs if
they differ. The `nres1`/`nres2` and `dist1`/`dist2` fields use the maximum count
for each named chain across directions. `n0res`/`d0res` accompany the direction
that won `ipSAE`; `n0dom`/`d0dom` accompany the direction that won
`ipSAE_d0dom`. They need not describe one common winning direction. A requested `ipSAE_min` must be a separately labeled minimum of the two `asym` ipSAE values, retaining the original values and derivation. Do not equate it with the native `max` row or invent benchmark cutoffs.

Inspect plausible coordinates/interface geometry separately. Scores describe predicted confidence and contact features; they do not demonstrate binding, affinity, expression, specificity or experimental success. Compare with consistent predictor/model, input constructs, mapping and cutoff choices, and disclose changes in length/d0 or sampling. Do not tune thresholds, trim disordered regions or replace samples simply to increase reported scores.

Attribution: native calculations are Roland Dunbrack's ipSAE v3, retaining its MIT notice and paper references in the runtime vendored source. The native header cites [ipSAE](https://www.biorxiv.org/content/10.1101/2025.02.10.637595v1), [pDockQ](https://www.nature.com/articles/s41467-022-28865-w), [pDockQ2](https://academic.oup.com/bioinformatics/article/39/7/btad424/7219714), and [LIS](https://www.biorxiv.org/content/10.1101/2024.02.19.580970v1). Formulas above describe the inspected implementation, not a review of those papers' calibration datasets.

Scientific reference adapted from Forge archive `d8c0b040f553bf9e51a532cb4db693529f50cc70` and checked against the current vendored source.
