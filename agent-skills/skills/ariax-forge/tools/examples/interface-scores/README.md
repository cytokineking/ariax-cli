# Synthetic mapping fixtures

These are constructed format/indexing inputs, not native predictions or
biological interaction evidence. The selected chains are Z and X, each AG.
Z residues are 1/2; X residues are 7/8. PAE tokens are deliberately ordered
X8, Z1, X7, Z2. Atom serials are noncontiguous. CA and CB confidence values
differ, while structure B-factors are 99 and must not be substituted.

Every engine-format directory has an explicit handoff. The native-shaped
Protenix atom/token/asym map and RF3 string chain iids protect indexing
boundaries. Boltz rank is 2, with original asym IDs Z=4 and X=1.

The independent score checks cover directional PAE blocks and contact-atom
pLDDT 61,83,72,54. Z->X PAE block is [[2,3],[5,6]], X->Z is [[4,7],[8,9]].
All four representative contact pairs are <=8 A. Thus LIS is 2/3 versus
5/12, and the aggregate mean is 13/24. No-contact, absent-confidence,
missing-CB, excluded-token and malformed-map cases are exercised by tests
using copies of these files. Actual predictor cases belong in remote evidence.
