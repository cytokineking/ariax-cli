# Boltz-2 example inputs

See the [mode guide](../../boltz2/modes.md) for input identities and commands,
and the [main guide](../../boltz2.md) for normal use. RCSB 1UBQ PDB/CIF files
are input templates; A3M/CSV homolog rows are constructed parser examples.
No model outputs are bundled. Template formatting preserves atom identities
and coordinates.

The MSE fixture emitted MET and is not supported as MSE chemistry. The separate
SEP case retained neutral CCD chemistry. Public paired-MSA handling and routing
to a selected service URL remain unverified; follow the service policy in the
mode guide before transmitting sequences.

`check_modes.py` runs in the Boltz tool environment using its native tokenizer,
Gemmi, NumPy, PyYAML and RDKit. `audit_server_url.py` and
`check_server_url.py` are optional service diagnostics; their presence does not
establish a working service route.
