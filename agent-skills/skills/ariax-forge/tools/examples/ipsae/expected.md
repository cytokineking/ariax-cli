This is a synthetic parser/score fixture, with four glycine CA representatives.
It is not a complete protein structure or a predicted biological interaction.

Structure order is A1, A2, B1, B2. Each chain has two residues. All four
interchain representative pairs are within 8 Å. pLDDT is 90 on a 0–100 scale.
PAE is 2 Å in the A-to-B block and 4 Å in the B-to-A block. Both blocks pass
the strict PAE < 10 Å cutoff. For these short chains, native length normalization uses L=27 and
`d0=max(1, 1.24*(27-15)^(1/3)-1.8)=1.0388913215 Å`, giving:

| Chn1 | Chn2 | Type | ipSAE | nres1/nres2 | dist1/dist2 |
|---|---|---|---|---|---|
| A | B | asym | 1/(1+(2/d0)²) = 0.212489 | 2/2 | 2/2 |
| B | A | asym | 1/(1+(4/d0)²) = 0.063193 | 2/2 | 2/2 |
| A | B | max | 0.212489 | 2/2 | 2/2 |

Native output is `toy_10_10.txt`, `toy_10_10_byres.txt`, and `toy_10_10.pml`,
beside the copied PDB. The by-residue file has four data rows. Imported
`ipTM_af` is the deliberately supplied 0.5, not a value computed by Forge.
`check.py` checks these files and the directional values with print-rounding
tolerance. Do not treat these toy values as a success threshold for real work.
