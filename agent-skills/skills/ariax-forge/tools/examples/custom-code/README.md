# Custom-code fixture

The matching [reference](../../../references/custom-code.md) stages these
regular inputs, creates a Git checkout containing a symlink in scratch,
edits its output label, and saves an ordinary source archive. The restored
checkout explicitly recreates a venv and installs `fixture-stats==0.1` from
saved source using an offline local wheel. Outputs go to workspace.

`prepare.py` uses Git from base. `bootstrap.py` requires Python with venv and
pip. `run.py` reads two DNA FASTA records and imports the installed dependency;
`check.py` validates the actual length/GC-fraction output and local label.
This example does not install model assets.
