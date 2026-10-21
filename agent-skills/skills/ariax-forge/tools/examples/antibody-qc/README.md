# Antibody QC example and recovery

Run `prepare.py --out DIRECTORY` from this installed example directory. It writes
`batch.json`, `vhh.json`, `invalid.json`, `empty.json` and `provenance.json`. The
paired seed is a trastuzumab-like variable sequence used as a controlled input.
Its deliberately introduced CDR3 NGT sequon changes to QGT in the second record.
Both chains retain their lengths. The VHH input is RCSB 1ZVH, camelid polymer entity 2 (author chain A), with
its trailing RGRHHHHHH expression tag removed. The TNP BSD notice is included here. No coordinates or binding measurement accompany
these sequences.

Register `batch.json` and use the command in the primary guide. After downloading
saved `result.json`, run `python3 "$EXAMPLES/check.py" ./antibody-inputs/batch.json
./result.json` in an appropriate analysis environment. The checker validates
original sequences, residue indices, distinct IMGT positions, regions, native
peptide counts and disappearance of the deliberate NGT alert. The adapter checks
native TNP and AbNumber CDR sequence agreement during execution.

Save `batch.json`, `provenance.json` and the complete output directory through
Files. Record the source session and checkpoint IDs. Fresh recovery must restore
both the registered input and all saved reports; compare paths and bytes and run
the checker. A new command over the restored input is an explicit choice. For a
numbering-only diagnostic, use `--methods number-liabilities`. OASis requires the
complete selected reference at `/models/oasis-v1/OASis_9mers_v1.db`.
