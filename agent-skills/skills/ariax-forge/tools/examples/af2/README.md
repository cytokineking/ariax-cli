# AF2 inputs

These are input fixtures and expected-identity manifests for the
[AF2 guide](../../af2.md). No file here is an AF2 prediction.

`monomer.a3m` contains the 76-residue ubiquitin sequence from
[RCSB 1UBQ](https://www.rcsb.org/structure/1UBQ) and one identical alignment
row. This deliberately shallow alignment tests supplied-input handling.
`templates/1ubq.pdb` is the unmodified [RCSB coordinate download](https://files.rcsb.org/download/1UBQ.pdb),
retrieved October 4, 2026, for selected-template execution. The matching
`templates/1ubq.cif` is the unmodified RCSB mmCIF download for per-entry CSV
templates; native ColabFold names that scratch copy `1dmy.cif`. Its experimental
coordinates are input data.

`paired.a3m` has unique chain lengths 16,16 and cardinalities 1,1. It contains
one synthetic paired row and separate padded unpaired rows. The requested
output sequences are A `AGSTAGSTAGSTAGST` and B `GSTAGSTAGSTAGSTA`.
`homomer.a3m` uses one unique 16-residue sequence with cardinality 2.
Its output is A/B `AGSTAGSTAGSTAGST`. These complexes have no validated
biological identity or binding expectation.

`batch.fasta` contains two separate monomer records. The second differs by
one residue. `search.fasta` contains one ubiquitin query for a bounded later
public/custom-server case. `supplied.csv` binds an explicit query to its A3M;
`templates.csv` also selects one template file. Paths target the Forge input
mount. Keep output IDs unique after native filename sanitization.

The three mode manifests request every model (1..5), seed 7, raw outputs,
one recycle and one ensemble. Additional batch/homomer/template manifests
request model 1 only. `run_modes.sh` checks all fifteen parameter choices
through the later native execution path. The checkers inspect outputs from
the named result directory; synthetic local test data live only in tests.

Supplied A3M inference uses `mmseqs2_uniref_env` as the unchanged default
mode label but does not search when templates are off. Do not pass
`--msa-mode single_sequence` with these A3Ms: in 1.6.3 that flag intentionally
removes supplied homologs and pairing before inference.

## Insulin and feature-handling examples

The five multimer-v3 checkpoint runs now use `insulin.a3m`: 4INS pig-insulin
chain A `GIVEQCCTSICSLYQLENYCN` (21) and chain B
`FVNQHLCGSHLVEALYLVCGERGFFYTPKA` (30), each cardinality one, in that order.
[RCSB 4INS](https://www.rcsb.org/structure/4INS) describes the A1B1 assembly.
The supplied paired row is an identical query copy, with separately padded
unpaired copies. It is not a searched evolutionary pairing. `insulin.fasta`
contains the same colon-separated chains for the optional service cases.
The unmodified [4INS mmCIF](https://files.rcsb.org/download/4INS.cif), retrieved
October 4, 2026, is selected template input only. Zinc, disulfide restraints
and experimentally fixed assembly geometry are not modeled by this sequence
fixture. A successful native run alone makes no insulin-quality claim.


`public-unpaired-20261005.a3m` is a captured public insulin MSA response.
`af2_features.py` checks query identity and feature construction for absent
channels, supplied paired/unpaired channels, homomers and monomers. Its
paired-only diagnostic selects rows from the supplied fixture rather than
claiming service-generated pairing. These feature checks perform no prediction.

The checker requires native token sidecars and compares model/seed,
residue order and PDB/JSON pLDDT for all matrix samples. `af2_handoff.py`
selects a model and seed, preserving its native rank separately. Stage it
beside `af2_outputs.py`. The original config, returned A3M, template-domain
names, raw pickle and token sidecar remain alongside each handoff.
Native config records MSA caps before the single-query adjustment; retain
`log.txt` for the actual reduced caps. Single-sequence batch config records
1:1 even though the command requests the maximum 32:64.


`af2_completion_selection.py --manifest MANIFEST` reads a profile row without
dispatching it. `completion-small.proposed.json` and `completion-matrix.json`
describe optional diagnostic profiles, not supported capacity or default runs.
`af2_profiles.py` prepares profile commands; `three-chain.fasta` and
`three-chain.json` supply additional pairing inputs. Check the
[MSA and template guide](../../af2/msa.md) before service queries or cache reuse.
