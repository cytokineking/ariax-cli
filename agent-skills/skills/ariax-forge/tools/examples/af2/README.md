# AF2 inputs

These are supplied fixtures and expected-identity manifests. No file here
is an AF2 prediction. Native results are retained separately in the runtime contribution
`science/evidence/af2/native-20261006.md`.

`monomer.a3m` contains the 76-residue ubiquitin sequence from
[RCSB 1UBQ](https://www.rcsb.org/structure/1UBQ) and one identical alignment
row. This deliberately shallow alignment tests supplied-input handling.
`templates/1ubq.pdb` is the unmodified [RCSB coordinate download](https://files.rcsb.org/download/1UBQ.pdb),
retrieved October 4, 2026, for selected-template execution. The matching
`templates/1ubq.cif` is the unmodified RCSB mmCIF download for per-entry CSV
templates; native ColabFold names that scratch copy `1dmy.cif`. Its experimental
coordinates are input data. They are never counted as AF2 output evidence.

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

## Acceptance preparation continuation

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


`public-unpaired-20261005.a3m` is the unchanged returned public insulin MSA
from the original native failure. The fresh October 6 public unpaired search
returned identical bytes. `af2_features.py` verifies the original empty-paired
MSA exception against the accepted original package, then checks native query
identity and feature construction for absent channels, supplied both-channel,
homomer and monomer cases against the repaired package. Its paired-only
diagnostic selects existing rows from the disclosed supplied fixture; it
does not generate or label service content as paired. These feature checks
perform no prediction.

The checker now requires native token sidecars and compares model/seed,
residue order and PDB/JSON pLDDT for all matrix samples. `af2_handoff.py`
selects a model and seed, preserving its native rank separately. Stage it
beside `af2_outputs.py`. The original config, returned A3M, template-domain
names, raw pickle and token sidecar remain alongside each handoff.
Native config records MSA caps before the single-query adjustment; retain
`log.txt` for the actual reduced caps. Single-sequence batch config records
1:1 even though the command requests the maximum 32:64.


`completion-small.proposed.json` selects the inactive small S05-S08/E01
completion and the shared B33 handoff. Use `af2_completion_selection.py` with
an explicit `--manifest` to read one row without dispatch. The old
`completion-matrix.json` and `af2_profiles.py` retain optional historical capacity
diagnostics outside mandatory completion. `three-chain.fasta`/`three-chain.json`
support the remaining pairing cases. Read the completion guide
before service queries, template-cache reuse or full project restoration.
