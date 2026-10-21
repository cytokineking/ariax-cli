# OpenFold3 / OpenBind explicit native choices

OpenBind-0 and Preview2 completed B41's small native panel on October 7, 2026.
The October 9 completion matrix extends functional checks through supplied MSA/template
inputs, SMILES and multiple ligands, homomers, RNA/DNA, modified residues, 512 total
protein residues, eight serial queries, two seeds and eight samples. Independent
native invocations are compared at the original exact tolerance; numerical
differences remain failed comparisons and are preserved in qualification evidence.
A separate insulin diagnostic initialized native Lightning global RNGs before
reference-conformer generation and enabled Torch determinism. Both pairs then
matched complete native arrays exactly. This diagnostic retains its own identity;
the ordinary native defaults and their failed comparisons are unchanged.
Preview2's completion image backports two upstream 0.5.0 feature-plumbing fixes
into its compatible 0.4.3 engine: prepaired MSA row counts and inference template
cache lookup. The checkpoint, architecture and confidence definitions are unchanged.
Original unpatched consumption failures remain retained. The qualified completion images are privately published under the exact October 9
completion tags. Production catalog integration and deployment remain with the
coordinator.
The coordinator owns catalog integration; this B41 assignment retains private delivery through acceptance. Preview1 executed the panel
but showed severe peptide breaks in the tested no-MSA mode and remains unqualified.

| Tool / `--pair` | Engine | Checkpoint | Native panel status |
| --- | --- | --- | --- |
| `openbind-0` | OpenFold3 0.5.0 | `of3-ob-2025-06-30-174k.pt` | Small panel passed readback and supported backbone geometry |
| `openfold3-preview2` | OpenFold3 0.4.3 | `of3-p2-155k.pt` | Separate preview choice; small panel passed |
| `openfold3-preview1` | OpenFold3 0.3.1 | `of3_ft3_v1.pt` | Separate unqualified candidate; exclude from admission |

Upstream [engine/checkpoint compatibility](https://github.com/aqlaboratory/openfold-3/blob/v0.5.0/openfold3/entry_points/parameters.py)
requires Preview2 to use an engine below 0.4.4dev0. OpenBind-0 is a separately
trained checkpoint. Preview2 145k is outside this package. Code/weights use the
upstream Apache 2.0 statements. The [OpenBind release](https://openbind.uk/news/blog-openbind-0-advancing-open-molecular-structure-prediction/)
is its primary model card. Preview1 uses the original public `openfold` bucket,
object `openfold3_params/of3_ft3_v1.pt`. Release cards, source revisions and download
metadata are retained in B41 evidence. No new access agreement was acquired.

The native query JSON contains `queries` and named query `chains`. Each chain has
`molecule_type`, `chain_ids`, and `sequence` or ligand `ccd_codes`/`smiles`.
The [small inputs](openfold3/queries.json) contain ubiquitin, insulin chains A/B,
and ubiquitin with RNA, DNA and AMP. All three pairs produced two samples per query
with seed 42, three recycles and 200 diffusion steps. The completion profiles cover supplied synthetic protein/RNA MSAs, paired insulin
MSAs, direct/alignment-based 1UBQ templates, toluene SMILES, AMP plus toluene, and
a single SEP substitution. Synthetic alignments test feature consumption, not
homology or predictive accuracy. Covalent bonds, cyclic chains, glycans and
pocket constraints remain outside the selected matrix. MSA service
selection and training/fine-tuning are outside the package.

With the configured completion catalog, stage the matching files through the normal input API.
Use the [OpenBind runner](openfold3/runner-openbind.yaml) or
[Preview2 runner](openfold3/runner.yaml), with MSA-server and template generation disabled:

```sh
ariax forge tools add SESSION --tools openbind-0 --json
ariax forge tools wait SESSION openbind-0 --timeout 1800 --json
ariax forge inputs add SESSION --file "$OPENFOLD3_EXAMPLES/queries.json" --path queries.json --json
ariax forge inputs add SESSION --file "$OPENFOLD3_EXAMPLES/runner-openbind.yaml" --path runner-openbind.yaml --json
ariax forge inputs add SESSION --file "$OPENFOLD3_EXAMPLES/check_outputs.py" --path openfold3/check_outputs.py --json
ariax forge inputs list SESSION --json
```

`OPENFOLD3_EXAMPLES` is the installed `ariax-forge/tools/openfold3` directory;
reference registry integration remains with the coordinator. Require session available, tool ready and
each returned input ID ready before prediction. Read pending inputs with
`forge inputs status SESSION INPUT_ID`. Then submit:

```sh
ariax forge run SESSION --tool openbind-0 --gpus 0 --timeout-seconds 1800 -- \
  openfold3-native --pair openbind-0 --query-json /inputs/queries.json \
  --runner-yaml /inputs/runner-openbind.yaml --samples 2 \
  --out-dir /workspace/openbind-small
```

For Preview2, change both the Forge tool and `--pair` to `openfold3-preview2` and
use `runner.yaml`. Omit `--samples` to retain the native five-sample default;
`--samples 2` is an explicit smaller example. Use a fresh output directory and the pair matching the selected
tool image. The launcher runs one native invocation; preparation supplies assets
and the native loader reports errors. The separate
[Preview1 runner](openfold3/runner-preview1.yaml) requires the engine's `pae_enabled`
preset to load the checkpoint; its no-MSA geometry remains unsuitable for admission.

Each weight asset mounts read-only at `/models/openfold3/PAIR`; the shared
`openfold3-ccd` asset mounts at `/models/openfold3/ccd`. Cache files use
`/scratch/openfold3`. The completion workload uses one L40, eight allowed CPUs and 48 GiB container
RAM on a host with at least 250 GiB initially free. The measured device has 49,140 MiB VRAM. The earlier 32 GiB recommendation
has not been qualified on a 32 GiB device. Use the measured L40 profile, eight CPUs,
48 GiB container RAM and 250 GiB initially free payload space. Observed peaks do not establish a smaller hardware
floor. Protein length is bounded at 512 total residues (monomer or 256+256),
query batch at eight serial queries, seeds at two and samples at eight.
The 256/512 profiles use repeated ubiquitin and establish execution/mapping
bounds only. RNA is bounded at 32 residues, DNA at 32+32, and tested small ligands at AMP
plus seven-heavy-atom toluene. Larger combinations are unqualified. Builds and native runs used the owned remote GPU VM.

Supplied MSAs require native filenames and matching runner configuration. Use
[runner-custom-msa.yaml](openfold3/runner-custom-msa.yaml) for files named
`custom.a3m`, with the query as the first row and explicit per-chain paths in
`main_msa_file_paths` / `paired_msa_file_paths`. For paired inputs use [runner-paired-msa.yaml](openfold3/runner-paired-msa.yaml),
which registers `custom` in `msas_to_pair` and `paired_msa_order`; keep paired row order aligned across
chains. Check actual saved `msa`, `msa_mask` and `num_paired_seqs` features;
a successful parse alone does not demonstrate consumption. Supplied templates
use native `template_cif_paths` and `template_cif_chain_ids`, or native alignment
paths plus `template_preprocessor_settings.structure_directory`. OpenBind's direct
`--templates` path consumed nonzero template features. Preview2's original direct
and alignment runs completed with zero template masks; retain those failures.
The completion backport enables Preview2's native template path. An explicit cached
workflow is also available: run the pinned upstream standalone preprocessor through
the staged [helper](openfold3/preprocess_templates.py), then predict from its
processed JSON with template generation disabled:

```sh
ariax forge run SESSION --tool openfold3-preview2 --timeout-seconds 120 -- \
  python /inputs/openfold3/preprocess_templates.py --query-json /inputs/template-query.json \
  --output-json /workspace/template-query.processed.json \
  --work-dir /workspace/template-preprocessing --structure-directory /inputs/template-structures
```

Stage that helper alongside the input structures. Use `/workspace/template-query.processed.json`
for the subsequent native prediction's `--query-json`; omit `--templates` to keep
its saved cache path. Use [runner-template-cache.yaml](openfold3/runner-template-cache.yaml)
with `template_preprocessor_settings.structure_directory` matching the staged
structure directory supplied to the helper. Inspect `template_pseudo_beta_mask` and
`template_backbone_frame_mask` in the trusted fresh native features.
The MSA server remains disabled. Native validation errors and incomplete-query
failures remain failures; use the logs and a fresh output path after correcting input.

Inspect native CIF, confidence JSON, aggregate JSON, timing, summary, configs and
saved features. Native files are preserved. Saved pLDDT and CIF B-factors use
0–100; PAE/PDE use angstrom. `sample_1` identifies the first generated sample;
native ranking scores are retained separately and no rank is invented.
Preview1 reports native pTM/ipTM and chain summaries but its full-confidence
writer omits the PAE matrix. PAE-based interface calculations remain unavailable.
Each engine's native metric definitions are retained.

The launcher exports `interface-scores-v1` handoffs with predictor `openfold3`,
native atom/token mappings and selected standard protein chains. The normalized
confidence copy preserves native values. RNA/DNA/ligand tokens remain mapped and
excluded from protein-only selections. B35q passed six retained samples for
each supported checkpoint. Keep `native_files.confidence` and
`native_files.features` with the handoff's native token index, asym/residue
identity, atom-to-token membership and native atom map. The consumer reads
native confidence JSON and those maps without loading PT/pickle features.
Complete standard protein chains require one token per residue. Preview1
and split protein tokens remain excluded.

The [output checker](openfold3/check_outputs.py) reads structure and handoff files
and checks molecular/chain identity, native array equality and summary availability.
Watch the prediction command to terminal success, inspect its logs, then invoke
the staged checker explicitly on the remote workload:

```sh
ariax forge run SESSION --tool openbind-0 --gpus 0 --timeout-seconds 120 -- \
  python /inputs/openfold3/check_outputs.py /workspace/openbind-small \
  --output /workspace/openbind-small-check.json
```


```sh
ariax forge tools add SESSION --tools interface-scores --json
ariax forge tools wait SESSION interface-scores --timeout 1800 --json
ariax forge run SESSION --tool interface-scores --timeout-seconds 120 -- \
  interface-scores /workspace/openbind-small/insulin/seed_42/insulin_seed_42_sample_1_handoff.json \
  --output /workspace/interface-scores/openbind-insulin-sample-1.json --pae-cutoff 10
```

For Preview2, use its own output root and recorded `result.json` path.
Retain native files and handoff through checkpoint/restoration. Earlier
producer handoffs can carry the historical consumer-amendment note; the
corrected scorer accepts supported maps and reports current availability.
Its output guard protects every declared native confidence and feature path.
Read [interface scoring](interface-scores.md) for the result.

Native pair-ipTM retains `symmetric_native_pair`; eight imported values matched
their original dictionaries. PAE stays angstrom in native order and atom
pLDDT stays 0–100. Single-protein cases return `no_protein_interface`;
missing scores remain unavailable. B35q's four-checkpoint panel passed 920
unchanged-v3 comparisons through 115 native tokens/958 atoms.
Workloads beyond the finite completion profiles remain unqualified. AF3 is outside Ariax support.

For B34 geometry, use [geometry_input.py](openfold3/geometry_input.py) to create a
fresh CIF copy with modeled occupancy 1.0. It verifies existing atom columns remain
unchanged. Run the shipped geometry command on that copy. Reports retain overlaps
and backbone distances. These checks do not establish experimental accuracy,
binding affinity, ligand pose accuracy or complete chemical stereochemistry.

Checkpoint useful files with `ariax forge sync SESSION --wait`. View CIFs through
the Files page. Restore retains files without scientific replay; inspect restored
native and handoff files before requesting another prediction. See the
[Forge output/file workflow](../outputs.md).

Use [saved results](../outputs.md) for checkpoint-pinned `forge link` paths,
and [project controls](../SKILL.md#project-controls-and-resume) for human
pause and same-project resume. Web approval clears a hold without allocating
compute; restoration leaves the next scientific command explicit.
