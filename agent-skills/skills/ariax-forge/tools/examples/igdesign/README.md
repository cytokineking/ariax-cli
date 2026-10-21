# Bounded paired-antibody example

This fixture reuses the accepted MPNN 1N8Z observed backbone: trastuzumab VL A1-107 and VH B1-117, with observed HER2 C residues. Waters, sidechains and incomplete backbone records were removed in that fixture. Its coordinates remain unchanged. The original source is [RCSB 1N8Z](https://www.rcsb.org/structure/1N8Z).

Run prepare.py with this directory and a new destination on the execution host. It adds fixed-column SEQRES for the observed sequences and writes JSON configs accepted as YAML. Each file uses explicit zero-based native Fv indices. The six loop windows follow the creator's 1N8Z config; the comparison selects author B31/B32 and A30/A31 only. The exact crop retains antigen indices 80 through 119 inclusive. This is a parser/crop/constraint fixture with declared observed coordinates, without modeled missing residues.

Discover this directory through `ariax skills forge --json`, field `data.examples.igdesign`. Register the generated files at `igdesign/FILE`. Run commands.json entries sequentially using `ariax forge run SESSION --tool igdesign --gpus 0 -- ARGV`, wait, then run their checks. Each model produces one sequence per individual CDR and two for the paired, crop and comparison paths. Keep every failed or empty outcome explicit.

For accepted AbMPNN comparison, use the unchanged abmpnn tool, mpnn-prepare, paired.pdb and abmpnn.plan.json. Select two samples at temperature 0.5/seed7 and retain its native FASTA/probability scores. AbMPNN and IgDesign-family losses retain their method definitions.

Checkpoint registered input files and every selected output with `ariax forge sync SESSION --wait`. Export the Files checkpoint through the normal CLI, restore into a new session, and run igdesign-check against the restored CSVs. Restoration checks saved science; further sequence generation requires an explicit command.
