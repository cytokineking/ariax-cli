# Boltz-2 residual-shortcut examples

`complex.yaml` contains synthetic proteins A `AGSTAGST` and B `GSTAGSTA`.
`affinity_smiles.yaml` and `affinity_ccd.yaml` describe the same 397-token
affinity input, with L-tyrosine as SMILES or CCD TYR. All proteins use
`msa: empty`; these examples need no MSA service.

Use the [main guide](../../boltz2-acceleration.md) for prediction and checking.
For an affinity example, change the input filename, use a new output directory
and its stem in `boltz_results_<stem>`, and retain all native affinity fields.

`check_modes.py` checks native identities and chemistry. `compare.py` compares
saved paths, CIF/JSON bytes and uncompressed NPY members inside NPZ files.
It reports reordered CIF chemical-component rows as a difference even when
coordinates agree; CCD artifact exactness remains unresolved.

For timing diagnostics, `measure.py` takes `off` or `resid` before native
predict arguments. Whole-process elapsed time and memory need host measurement.
The [mode guide](../../boltz2-acceleration/modes.md) describes scope and resource
limits. These inputs do not establish general speed or accuracy benefits.
