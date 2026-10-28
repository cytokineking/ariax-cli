# Two-crop ProteinMPNN comparison

protein.pdb and protein.plan.json reuse the 3HTN fixture. prepare.py selects the first 64 and first 93 observed chain-A residues with their original coordinates, preserving complete backbone atoms. The crops use dense residue numbers and retain an explicit map to author numbers, including gaps. Only dense positions 11 through 20 may change. These crops test execution and agreement. They supply no claim about foldability or activity. Run prepare.py inside the selected image so it uses the matching native parser.

Find this installed directory in `data.examples["mpnn-acceleration"]` from `ariax skills forge --tool mpnn-acceleration --json`. The primary guide contains the actual commands. Retain the raw PDB, plan, both crops, parsed JSONL, fixed-position map and output sequences/scores/probabilities through Files.
