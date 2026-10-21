# MMseqs2 bounded protein controls

Read the installed `mmseqs2` guide for registration and exact Forge commands. This directory is the value returned as `data.examples.mmseqs2` for the contribution. Upload its six executable/input files into `mmseqs2/` under registered inputs.

`query.fasta` is human beta-globin P68871, 147 residues including initiator methionine. `target.fasta` adds an exact duplicate, a deliberate three-substitution control, a short N-terminal fragment and human ubiquitin P0CG47 residues 1–76. `unmatched.fasta` is a deliberate artificial unrelated sequence. Protein controls derive from UniProt Consortium sequence records under CC BY 4.0; constructed variants carry no biological claim.

Run `sh /inputs/mmseqs2/run.sh /workspace/mmseqs2-cpu /scratch/mmseqs2-cpu cpu` with tool `mmseqs2`. Its GPU counterpart uses mode `gpu`, tool `mmseqs2-gpu` and fresh output/scratch directories. The scripts expose every native command and invokes `check.py`. Expected observations include three broad hits, two strict hits, fragment admission under target-only coverage, valid A3M export and fewer MSA members after filtering. CPU clustering produces one three-member group and two singleton groups. Inspect `checks.json` and the native files. These controls use a tiny five-entry target; the managed UniRef90 search is a separate command in the primary guide.
