# Antibody QC sequence controls

Use `ariax skills forge --tool antibody-qc --json` to find this directory in
`data.examples["antibody-qc"]`. Run `python3 prepare.py --out DIRECTORY` on the
authorized remote host. It writes `batch.json`, `vhh.json`, `invalid.json`,
`mixed.json`, `empty.json` and `provenance.json`. The
paired seed is a trastuzumab-like variable sequence used as a controlled input.
Its deliberately introduced CDR3 NGT sequon changes to QGT in the second record.
Both chains retain their lengths. The VHH input is RCSB 1ZVH, camelid polymer entity 2 (author chain A), with
its trailing RGRHHHHHH expression tag removed. The TNP BSD notice is included here. No coordinates or binding measurement accompany
these sequences.

Register `batch.json` and use the command in the [primary guide](../../antibody-qc.md).
Copy `check.py` to the remote analysis host and run `python3 check.py BATCH_JSON RESULT_JSON`
against the input and saved result there. The checker validates
original sequences, residue indices, distinct IMGT positions, regions, native
peptide counts and disappearance of the deliberate NGT alert. The adapter checks
native TNP and AbNumber CDR sequence agreement during execution.

Save `batch.json`, `provenance.json` and the complete output directory through
the [Files guide](../../../outputs.md). For a
numbering-only diagnostic, use `--methods number-liabilities`. OASis requires the
complete selected reference at `/models/oasis-v1/OASis_9mers_v1.db`.
