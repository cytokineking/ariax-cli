# Forge structure preparation, alignment and search


The qualified fixture environment uses Biopython 1.85, NumPy 1.26.4, PDBFixer v1.11,
OpenMM 8.2.0, FreeSASA Python 2.2.1, US-align/TM-align source
`1fa25a958fe3095900eba2ef9b48562bdc462251`, and Foldseek 10-941cd33. The tools
accept direct argv. CPU commands omit GPU selection. The Foldseek binary requires
Linux amd64 AVX2. Read [settings and interpretation](structure-tools/definitions.md)
and the [example input inventory](examples/structure-tools/README.md).

## Prepare inputs and tool readiness

For a session authorized for this work, with these keys in its live catalog:

```sh
ariax forge tools add "$SESSION" --tools structure-tools,foldseek --json
ariax forge tools wait "$SESSION" structure-tools --timeout 1800 --json
ariax forge tools wait "$SESSION" foldseek --timeout 1800 --json
ariax forge status "$SESSION" --json
```

Require session `available` and each needed tool `ready`. `SESSION` is its real
UUID. `EXAMPLES` is the absolute `data.examples.root` returned by the installed
Forge skill listing.

The [bounded fixtures](examples/structure-tools/README.md) contain deposited
1UBQ, its protein-only chain, a known rigid transform, a missing NZ atom case and
synthetic insertion/alternate-location contacts. Upload only the needed fixtures:

```sh
for FILE in 1ubq.pdb 1ubq-protein.pdb 1ubq-transformed.pdb 1ubq-missing-nz.pdb identity.pdb; do
  ariax forge inputs add "$SESSION" --file "$EXAMPLES/structure-tools/$FILE" --path "structure-tools/$FILE" --json
done
ariax forge inputs list "$SESSION" --json
```

Require each input `ready` before scientific work. Confirm the real construct,
chain IDs, model, alternate-location policy and molecule types for other inputs.
CIF selections use author chain IDs. Multi-model inputs require an explicit
one-based `--model`. Alternate atoms require `--altloc occupancy` or one label;
default behavior rejects them. Occupancy ties select the alphabetical label.
Alternative residue identities require explicit preprocessing.

## Conversion, sequence and analysis

Use a fresh output directory for every command. Adapter outputs include
`settings.json` and `result.json`; failed runs keep partial output without a
success result. Standard-protein FASTA has a corresponding chain/residue map.
Atom conversion preserves author IDs and insertion codes. It omits header,
connectivity and other CIF categories, so keep the raw file. Use CIF when PDB
cannot represent a chain ID or residue number.

```sh
ariax forge run "$SESSION" --tool structure-tools --timeout-seconds 120 --json -- structure-tools convert /inputs/structure-tools/1ubq-protein.pdb --format cif --out-dir /workspace/structures/convert1
ariax forge run "$SESSION" --tool structure-tools --timeout-seconds 120 --json -- structure-tools align /inputs/structure-tools/1ubq-transformed.pdb --reference /inputs/structure-tools/1ubq-protein.pdb --engine kabsch --out-dir /workspace/structures/rmsd1
ariax forge run "$SESSION" --tool structure-tools --timeout-seconds 120 --json -- structure-tools align /inputs/structure-tools/1ubq-transformed.pdb --reference /inputs/structure-tools/1ubq-protein.pdb --engine usalign --out-dir /workspace/structures/usalign1
ariax forge run "$SESSION" --tool structure-tools --timeout-seconds 120 --json -- structure-tools align /inputs/structure-tools/1ubq-transformed.pdb --reference /inputs/structure-tools/1ubq-protein.pdb --engine tmalign --out-dir /workspace/structures/tmalign1
ariax forge run "$SESSION" --tool structure-tools --timeout-seconds 120 --json -- structure-tools contacts /inputs/structure-tools/identity.pdb --altloc occupancy --partner-a A --partner-b B --cutoff 4 --out-dir /workspace/structures/contacts1
ariax forge run "$SESSION" --tool structure-tools --timeout-seconds 120 --json -- structure-tools geometry /inputs/structure-tools/identity.pdb --altloc occupancy --overlap 0.4 --out-dir /workspace/structures/geometry1
ariax forge run "$SESSION" --tool structure-tools --timeout-seconds 120 --json -- structure-tools sasa /inputs/structure-tools/1ubq-protein.pdb --probe-radius 1.4 --slices 100 --threads 1 --out-dir /workspace/structures/sasa1
```

Wait on each returned command ID with `ariax forge watch "$SESSION" "$COMMAND_ID"
--timeout 180 --json`, and read its logs. A waiting timeout does not establish the
remote command outcome. Query the same ID and retain its request before deciding
on an explicit correction. Never automatically replay scientific work.

Kabsch uses unweighted CA pairs. Default correspondence requires identical
chain/residue IDs and residue names. For deliberate renumbering, upload a pairs
JSON with `mobile`/`reference` objects containing `chain`, `number` and `insertion`,
then pass `--pairs /inputs/structure-tools/pairs.json`. Each residue may occur
once, and at least three nondegenerate pairs are required. Record that choice.

US-align/TM-align adapt single standard-protein chains. Preserve `native.txt`,
`transform.txt`, native superposition exports and `result.json`. `tm_mobile` and
`tm_reference` use their respective whole-chain lengths. The saved aligned pairs
identify the CA correspondence. For a protein complex, run direct native US-align
with explicit multimer/model settings and inspect its chain assignment:

```sh
ariax forge run "$SESSION" --tool structure-tools --timeout-seconds 300 --json -- USalign /inputs/mobile-complex.cif /inputs/reference-complex.cif -mm 1 -mol prot -ter 1 -o /workspace/structures/complex1 -m /workspace/structures/complex1-matrix.txt
```

The parent output directory must exist. Direct native US-align can select chains
with `-chain1`/`-chain2` and a chosen chain map with `-chainmap`. Keep those choices
and the full native report. Complex correspondence and non-protein modes need
their own native acceptance evidence. [Pinned US-align help](https://github.com/pylelab/USalign/blob/1fa25a958fe3095900eba2ef9b48562bdc462251/USalign.cpp)

Contacts include selected cross-partner non-H/D atoms at or below the stated
Angstrom cutoff; empty contacts are a valid outcome. SASA is exposed area in
Angstrom squared using FreeSASA Lee-Richards/ProtOr. The adapter accepts standard
proteins, so explicitly remove ligands/waters first if present. Geometry reports
backbone distances and heavy-atom radius overlaps with its exclusions and
unscored elements. It is not a validated clashscore or physical energy.

## Repair and explicit relaxation

PDBFixer/OpenMM preparation keeps raw bytes, selected coordinates, repaired
coordinates, before/after residue/atom identity, changes and settings. Missing
sequence loops are detected from available sequence records and never built by
this adapter. Nonstandard replacement and heterogen removal require explicit
flags. Unsupported parameterizations fail.

```sh
ariax forge run "$SESSION" --tool structure-tools --timeout-seconds 900 --json -- structure-tools prepare /inputs/structure-tools/1ubq-missing-nz.pdb --remove-heterogens --ph 7 --seed 7 --platform CPU --threads 1 --relax --restraint-k 1000 --tolerance 10 --max-iterations 200 --out-dir /workspace/structures/prepare1
```

This bounded example removes waters and repairs LYS A27 NZ, adds hydrogens at pH 7
and minimizes Amber14/OBC2 with HBonds, NoCutoff and the stated heavy-atom restraint.
`--platform Reference` is an explicit alternate CPU platform. Omitting `--relax`
stops after repair. `--replace-nonstandard` explicitly allows PDBFixer's recorded
substitutions. Keep `raw.pdb`, `selected.cif`, `repaired.cif`, `relaxed.cif` and all
settings. Inspect residue identity and finite coordinates. Energies are kJ/mol;
total, restraint and physical contributions remain separate. A maximum iteration
count does not establish convergence. [PDBFixer v1.11](https://github.com/openmm/pdbfixer/blob/v1.11/Manual.html),
[OpenMM 8.2](https://docs.openmm.org/8.2.0/userguide/application/02_running_sims.html)

## Foldseek shared binary and selected database

The image supplies the executable Foldseek 10-941cd33 binary with its source
metadata and license. The `foldseek` command on PATH invokes that packaged binary.
Named database assets mount as read-only data.
`foldseek-fixture` contains a native two-entry database with the prefix
`/models/foldseek-fixture/db`, constructed from 1UBQ and its rigid copy. The full
selected native databases mount at `/models/foldseek-pdb/db` (PDB250101) and
`/models/foldseek-swissprot/db` (AlphaFold Swiss-Prot v6/2025_03). Each asset retains
its sequence, structure, coordinate and available cluster members. Source metadata
and the native `db.version` identify the publisher snapshot. The binary also
exposes `structureto3didescriptor` for the SaProt stability reader. With `--chain-name-mode 1`, its Foldseek 10 TSV has four columns: header with chain suffix, amino-acid sequence, 3Di sequence, and comma-separated geometry features. Preserve the header and use AA/3Di columns 2/3.
[Foldseek 10 source](https://github.com/steineggerlab/foldseek/blob/10-941cd33/src/FoldseekBase.cpp)

Use scratch for native temporary files and workspace for saved results. Create
fresh writable output/scratch directories before direct native commands. Example:

```sh
ariax forge run "$SESSION" --tool foldseek --timeout-seconds 60 --json -- mkdir -p /workspace/structures/foldseek1 /scratch/structures/foldseek1
ariax forge run "$SESSION" --tool foldseek --timeout-seconds 300 --json -- foldseek easy-search /inputs/structure-tools/1ubq-protein.pdb /models/foldseek-fixture/db /workspace/structures/foldseek1/search.tsv /scratch/structures/foldseek1/search --threads 1 --chain-name-mode 1 --alignment-type 2 -a 1 -e 10 --format-output query,target,evalue,bits,alnlen,qlen,tlen,qtmscore,ttmscore,qaln,taln
```

Search rows are tab-separated and headerless with the exact stated field order.
Retain query/target IDs, E-values, bit scores, lengths, aligned sequences and both
TM-score normalizations. Empty search output can be valid; the native qualification
case requires its known self-hit. A hit is structural similarity, with its native
statistical definition, and does not demonstrate binding.

For a project-specific database, deliberately choose/upload structures, stage
only those files in a writable directory, then run `foldseek createdb DIR PREFIX
--threads 1 --chain-name-mode 1`. Save all prefix files and the source selection.
Run `foldseek easy-cluster DIR OUTPUT_PREFIX SCRATCH --threads 1 -c 0.9 --cov-mode 0
--min-seq-id 0.9` for the explicitly selected set. Keep representative/member TSV
and FASTA exports with the exact thresholds. The pinned native workflow writes `OUTPUT_PREFIX_cluster.tsv`, `OUTPUT_PREFIX_rep_seq.fasta` and `OUTPUT_PREFIX_all_seqs.fasta`. The selected full snapshots support the same direct search interface. Use eight
CPU threads for the full-database example below and keep its temporary files on
scratch.
[Versioned Foldseek search/clustering documentation](https://github.com/steineggerlab/foldseek/blob/10-941cd33/README.md)


## Search the complete selected databases

```sh
ariax forge run "$SESSION" --tool foldseek --timeout-seconds 60 --json -- mkdir -p /workspace/structures/full1 /scratch/structures/full1
ariax forge run "$SESSION" --tool foldseek --timeout-seconds 1800 --json -- foldseek easy-search /inputs/structure-tools/1ubq-protein.pdb /models/foldseek-pdb/db /workspace/structures/full1/pdb.tsv /scratch/structures/full1/pdb --threads 8 --chain-name-mode 1 --alignment-type 2 -a 1 -e 0.001 --format-output query,target,evalue,bits,alnlen,qlen,tlen,qtmscore,ttmscore,qaln,taln
ariax forge run "$SESSION" --tool foldseek --timeout-seconds 1800 --json -- foldseek easy-search /inputs/structure-tools/1ubq-protein.pdb /models/foldseek-swissprot/db /workspace/structures/full1/swissprot.tsv /scratch/structures/full1/swissprot --threads 8 --chain-name-mode 1 --alignment-type 2 -a 1 -e 0.001 --format-output query,target,evalue,bits,alnlen,qlen,tlen,qtmscore,ttmscore,qaln,taln
```

Wait for each command before reading its result. Search settings control which
rows are returned. A stricter filter can yield an empty TSV; preserve the query,
database version, thresholds and successful native exit status with that result.
The PDB publisher database includes its native clustering. Inspect selected
representatives and any explicit cluster expansion when interpreting coverage.
The Swiss-Prot snapshot covers its named curated proteome collection.

For a downstream 3Di consumer, retain the exact query file beside its descriptor:

```sh
ariax forge run "$SESSION" --tool foldseek --timeout-seconds 300 --json -- foldseek structureto3didescriptor /inputs/structure-tools/1ubq-protein.pdb /workspace/structures/full1/descriptor.tsv --threads 1 --chain-name-mode 1
```

Match the header's basename/chain and amino-acid sequence to the original input.
Each amino acid must have one 3Di token. Use the existing stability reader to
construct interleaved tokens when passing this descriptor onward. Search scores
and stability predictions retain their separate units and interpretations.

The prepared PDB and Swiss-Prot assets occupy 5,987,536,958 and
2,608,318,065 bytes. Their retained archives are 5,987,614,720 and
2,608,353,280 bytes. The one-query native runs used eight threads, took 5.81 and
11.99 seconds and reached 1,376,740 and 2,150,700 KiB maximum RSS respectively.
Those times exclude Forge startup and readiness. PDB used a complete publisher
snapshot with its native cluster members; neither search trimmed the database.

For the installed full-database tool, allow eight CPUs, 8 GiB RAM and 32 GiB
disk, including both prepared databases, transfer staging and scratch. This is
a planning allowance for the documented query. Native temporary files were
removed after each search; filesystem writes measured 320 and 344 KiB. Batch
queries and retained temporary files need their own space estimate.

## Save and interpret results

Require command success and inspect the actual result files and scientific
identity. Preserve raw/repaired/relaxed stage labels and residue mappings through
other tools. Compare scores only with matching settings and molecule types.
Relaxation potential energy, SASA, geometric overlaps, RMSD and TM-score are
separate quantities. Unsupported metrics remain unavailable.

```sh
ariax forge sync "$SESSION" --wait --json
ariax forge files "$SESSION" --path /workspace/structures --checkpoint "$CHECKPOINT" --json
ariax forge link "$SESSION" /workspace/structures/geometry1/result.json --checkpoint "$CHECKPOINT" --json
```

Set `CHECKPOINT` from the completed sync; choose an actual saved path for the
link. Use saved checkpoint paths and the project link for sharing. Preserve the project
identity and human hold through pause/resume. Resume restores files and requires
an explicit decision on the next command.
