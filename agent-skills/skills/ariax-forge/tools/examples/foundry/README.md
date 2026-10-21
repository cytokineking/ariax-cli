# Prepared Foundry examples

The manifest contains twenty-six small native cases and fifteen larger resource
cases. Each entry records its submitted argv, checkpoint, structural expectation
and input identity. Original settings and scientific failures remain attached to
those cases. The [Foundry guide](../../foundry.md) explains current sample controls
and observed limits; [output notes](../../foundry/outputs.md) explain confidence
and geometry findings. Use a tool only when it is present in the configured
catalog. The image includes the matching manifest and checker at
`/opt/forge-foundry`.

Set `EXAMPLES` to this installed directory. Upload the selected case JSON and every
referenced input under `foundry/inputs/NAME`, preserving the paths in the JSON.
The complete upload can be prepared with the existing file CLI:

```sh
for file in "$EXAMPLES"/inputs/*; do
  ariax forge inputs add SESSION --file "$file" --path "foundry/inputs/$(basename "$file")"
done
```

Check each returned input ID with `ariax forge inputs status SESSION INPUT_ID`
and wait for `ready` before starting a scientific command.

Then run one named case with its explicit tool, for example:

```sh
ariax forge run SESSION --tool rfd3 --timeout-seconds 3600 -- \
  python3 /opt/forge-foundry/fixtures/run_case.py rfd3-unconditional
ariax forge run SESSION --tool rf3 --timeout-seconds 3600 -- \
  python3 /opt/forge-foundry/fixtures/run_case.py rf3_preprint_921-complex
```

The helper writes the chosen case to `/workspace/outputs/CASE` and requires a fresh
directory. RF3 record files are under `/workspace/outputs/CASE/CASE`, with the
paired sample beneath `seed-7_sample-0`. To inspect retained outputs, use
`--check-only`. It executes no retry.
The exact native command is in `cases.json`; user work can invoke native argv
directly in a separate fresh output location.

`input-identity.json` records actual source chains, author residues and chemical
atoms. Mixed RF3 inputs use the native DNA/RNA chain-type enum values. Real
coordinate inputs are derived from pinned upstream examples and carry
the adjacent source license. RF3 small sequences and the A3M are synthetic inputs.
`expected/` files describe explicit polymer and chemical identity, with no quality
threshold. They do not establish motif geometry, symmetry, RNA base pairing,
chemical bond order, chirality or binding. Retain and inspect those native results
before making the corresponding scientific claim.

RF3 panel names identify the exact offered checkpoint. Each model has monomer,
mixed molecule complex, supplied MSA and polymer/ligand template cases. Design
cases use one sample and 50 timesteps; RF3 also uses one recycle. Reduced settings
reach execution and do not establish useful design performance.

Generation uses `AMP-generation.pdb` on chain L to avoid collisions with generated
chain A. RF3 keeps its original AMP input. Explicit NA ranges such as `24-24R`,
`24-24D` and `12-12D` preserve the requested polymers at the pinned source.

Inspect a saved generation case without inference:

```sh
ariax forge run SESSION --tool rfd3na -- \
  python3 /opt/forge-foundry/fixtures/generation_consume.py \
  /workspace/outputs/rfd3na-multipolymer --case rfd3na-multipolymer
```

The generation consumer measures fixed correspondence, C2, AMP chirality,
RASA/HBPLUS and RNA pair geometry. Default partial diffusion and fixed DNA retain
their 0.05 Å tolerance failures. Explicit full-precision comparisons pass that
same threshold. Requested RNA pairs, extra pairs, burial and donor/acceptor
satisfaction remain individual findings. The complete fixed-ligand writer
preserves the parsed conditioning graph; earlier unavailable topology remains
with those saved outputs. A diagnostic exit zero retains each false result.

A small functional generation run uses one sample at 200 timesteps; use two for a
batching check. The original manifest entries retain their reduced controls and
the resource entries retain their larger controls. Invoke native argv in a fresh
output directory to choose a different sample count. For full sample analysis,
pass the exact count to `consume.py` or `generation_consume.py` with
`--expected-samples N --report /workspace/reports/CASE.json`. Keep this report
outside the native output directory so later inspection sees the same file set.

The retained single-sample preprint 1/24 template AMP C1' failure remains visible.
Its separate ten-recycle/200-step comparison clears all four centers. RF3 full
precision remains unqualified after a native cuEquivariance BF16 guard failure.
