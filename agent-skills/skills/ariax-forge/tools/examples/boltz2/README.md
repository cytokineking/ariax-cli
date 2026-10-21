# Boltz-2 native qualification cases

These match the B33 runtime fixtures. See the [agent mode guide](../../boltz2/modes.md)
for identities, staging and commands, and the [main guide](../../boltz2.md) for
accepted B12 evidence. Twelve bounded B33 cases qualified. The original MSE
case became MET and remains chemically unqualified; the separate SEP case
retained neutral CCD chemistry. Public pairing and observable selected-URL checks remain unrun; a separate
service deployment is not required. RCSB 1UBQ PDB/CIF files are input
templates. A3M/CSV homolog rows are constructed parser examples. No new model
outputs are included. `check_modes.py` runs in the Boltz tool environment, using
its native tokenizer, Gemmi, NumPy, PyYAML and RDKit.

Template line padding was removed; all 660 atom identities and coordinates
were preserved in each format.


The October10 service phase also stages audit_server_url.py and check_server_url.py.
Both native clients submit public fixtures serially from the shared B31 VM/IP.
HTTP URL propagation, explicit native rejection and restored audits remain unrun.
The shared schedule must fit its existing original clocks before adoption.
