# Forge scientific skill recovery

October 3, 2026. The CLI now packages scientific preparation and interpretation
references for FreeBindCraft, Boltz2, ipSAE and native BindCraft2. Existing
Forge IDs, command examples and model mounts remain authoritative. New finite
reference IDs expose the detailed guides and three local checkers through the
existing `ariax skills forge --reference ID --read` path. `data.examples.science`
locates separate synthetic cases. The original 18 runtime fixture files are
unchanged.

## Source checks

The source archive is `cytokineking/ariax-cli` commit
`d8c0b040f553bf9e51a532cb4db693529f50cc70`, tag
`archive/forge-20261001/forge-skills-final`. The bundled future-source index
retains exact archive paths, scientific caveats and prerequisites for Foundry,
Protenix, BoltzGen, PXDesign and ESMFold2. It adds no runtime tool family.

FreeBindCraft source `d12747d` was checked against the current
`science/images/freebindcraft/native-fail-fast.patch`. The recovered guide
uses the patched rejected-trajectory count and CUDA failure behavior. Its
fixed-score table uses actual native CSV labels and alternative-scoring
values. Filter behavior was checked in `check_filters`, including unknown,
None and nonfinite values. Both complete family presets were inspected.

Boltz 2.2.1 schema, main command, tokenizer, affinity model and writer supplied
entity/MSA/register rules, native argv and output-rank/metric semantics.
Readiness still prepares complete confidence and affinity assets together.
The ipSAE archive and current vendored v3 source match after trailing-whitespace
normalization. Format dispatch, atom/token masks, sidecar discovery, imported
ipTM and per-column `max` behavior were reviewed in that source.

Native BindCraft2 1.0.1 source at
`e6d30f6ea2e5bbc2f62ae7fa722f183da6c6c29f` supplied settings, preset precedence,
selectors and output semantics. The managed skill contributed scientific
context; its job schema, upload and status APIs remain separate.

## Verification paths

`node --test test/skills.test.js` exercises actual CLI discovery and reads for
all advertised Forge resources, preserving alias and path-rejection coverage.
`node scripts/test-package.js` builds and installs npm/GitHub packages into a
disposable prefix, exercises Forge recovery and lifecycle, reads every reference,
runs the standard-library helper examples and checks packaged handoff files.
It requires a clean committed checkout, as before.

`python3 test/forge-science-checks.py` exercises the packaged helper command
lines via paths returned by the CLI. Its corruption cases protect against
wrong hotspot registers, mismatched AF3/Boltz2 identity and arrays, missing
native sidecars, and invalid affinity values. It uses Python with NumPy and
adds no package dependency. Pass `--ipsae-script` with the current runtime's
vendored source to score the two synthetic complexes and check directional
values, imported pair ipTM, LIS and output completeness. These checks avoid
GPU inference and do not simulate a successful prediction.

The skill-creator validator checks the Forge and shared SKILL.md entrypoints.
A link/fixture smoke check verifies local references and all 18 unchanged
runtime fixture files.

Parent review found that NumPy could coerce a boolean mixed into a numeric
JSON PAE matrix into 0 or 1. The helper now validates JSON number types before
array conversion. The added CLI-level corruption case failed before the fix;
it protects against treating a threshold mask as measured PAE. The scientific
suite now covers 44 cases when native ipSAE scoring is included.

## Qualification limits

B08/B09/B12 live evidence for the existing native examples is unchanged.
AF3 and standard-protein Boltz2 handoffs have source review and synthetic
native scoring checks. Real predictor outputs, original chain/token metadata,
matching raw files and a deployed-image scoring run remain required for live
handoff qualification. Mixed molecules and modified residues require separate
mapping work.

The affinity checker validates JSON values, units and input-derived filename.
A representative remote affinity run must still establish processed chemical
identity and matched top-ranked structure/affinity artifacts. Source-reviewed
linear-peptide, advanced Boltz2 and broader BindCraft2 recipes likewise need
representative GPU evidence before qualification. No compute was rented,
scientific prediction launched, runtime changed or deployment performed for
this recovery.
