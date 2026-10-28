# Mol-1 outputs, checks and downstream use

Read with `ariax skills forge --reference mol1-outputs --read --json`. This is
the pinned native output contract; the [entry guide](../mol1.md) records the
finite scientific, installation and recovery scope.

## Files and identities

For `--dump_dir OUTPUT`, each job and seed writes:

```text
OUTPUT/JOB/seed_SEED/predictions/JOB_sample_N.cif
OUTPUT/JOB/seed_SEED/predictions/JOB_summary_confidence_sample_N.json
OUTPUT/JOB/seed_SEED/predictions/JOB_full_data_sample_N.json
```

The full-data JSON requires `--need_atom_confidence true`. Samples start at zero
and are ranked by descending `ranking_score` **within each seed** by default;
`sample_0` is that seed's top-ranked sample, not a global rank across seeds/jobs.
Errors are retained under `OUTPUT/ERR/`. A failed input can coexist with successful
outputs: retain both and check the command's terminal state, exit code and logs.
Missing confidence is unavailable, not a zero or a passed scientific filter.

The example runner places native `OUTPUT` at `RUN/predictions` and retains
`input.json`, `run.py`, `command.argv.json`, `run-metadata.json`, `run.log` and
`exit-code.txt` at `RUN`. Metadata records the source/model, profile and expected named assets. Add the
selected asset/source identity and actual runtime/hardware evidence; path names
alone do not establish the selected model bytes. A cancellation may prevent `exit-code.txt` from being written;
use the Forge command record to determine the outcome.

CIF chains follow supplied IDs, or A/B/etc. when omitted. Residues start at 1
along each chain; they are not original experimental author residue numbers.
Upstream reconstructs protein terminal O/OXT geometry before writing structures.
The atom B-factor column contains pLDDT, not crystallographic displacement.
Preserve the original CIF when converting or preparing it downstream.

## Score meanings

| Native field | Scale and interpretation |
| --- | --- |
| Summary `plddt`; CIF atom B factors | 0–100; higher local confidence |
| `chain_plddt`, `chain_pair_plddt`; full-data `atom_plddt` | 0–1; higher local confidence; multiply by 100 before comparing with summary pLDDT |
| `ptm`, `iptm`, `chain_ptm`, `chain_iptm`, `chain_pair_iptm`, `chain_pair_iptm_global` | 0–1; higher predicted structural/interface confidence; inspect the relevant chain pair |
| `gpde`, `chain_gpde`, `chain_pair_gpde`; `token_pair_pae`, `token_pair_pde` | Angstroms; lower predicted distance/alignment error |
| `contact_probs` | 0–1 predicted contact probabilities, not experimentally measured contacts |
| `disorder` | Always zero in this implementation; not a validated disorder estimate |
| `has_clash` | Severe clash flag for distinct polymer chains; false does not establish ligand geometry or absence of all clashes |
| `num_recycles` | Recycles actually run; check against the intended profile |
| `ranking_score` | `0.8*iptm + 0.2*ptm + 0.5*disorder - 100*has_clash`; higher ranks first; can be negative and is not a probability |

Single-chain `iptm` and diagonals of the `chain_pair_*` matrices are native
zeros for non-interfaces, not missing scores. Do not use the monomer's zero
ipTM to reject it as a failed interface or claim an interface measurement.
Low confidence is a scientific observation even when the command succeeds.
None of these scores is binding affinity, Kd, stability or experimental activity.

Full-data `token_pair_pae`, `token_pair_pde` and `contact_probs` are square
**token-indexed** matrices. Standard polymer residues generally contribute one
token; ligands and nonstandard/modified residues can contribute atom tokens.
Use `atom_to_token_idx` and `token_asym_id`, plus the CIF atom/chain identities,
to map axes. Array indices start at zero and must not be treated as one-based
sequence positions. `token_has_frame` records local-frame availability. Native
JSON serialization rounds values; keep those original files and do not invent
extra precision.

## Required inspection

Perform these checks remotely with the prepared scientific environment before
calling a run useful:

1. Confirm every requested job/seed/sample triple is present, nonempty and
   parseable; inspect any `ERR` files and the full log. Default fixture: five
   triples for `ubiquitin`, seed 101; smoke: one triple.
2. Read each CIF. Confirm chain A has the exact 76-residue sequence in
   [monomer.json](../examples/mol1/monomer.json), unique atom identities, expected
   polymer atom coverage and finite coordinates. Inspect geometry and terminal oxygen handling. For a
   real complex, validate all partners, copies, ligands, ions and intended bonds.
3. Check finite confidence values on their documented scales and dimensions.
   This fixture expects 76 tokens, 76-by-76 PAE/PDE/contact arrays, one chain,
   atom mapping length matching the output atom count and token indices in
   `[0, 75]`. Review scores across all samples rather than accepting rank alone.
4. Compare actual recycle count, sample count, MSA/template mode, dtype, kernel,
   hardware and logs with the requested settings. Check the no-search/no-download
   contract and asset identities. A fixture pass supplies no native-fold accuracy
   evidence. The ATP companion checks identity/coverage and is not a reference
   binding pose; compare its atoms with the selected CCD and preserve all mapping
   dimensions rather than assuming monomer token counts.

The central guide records the [native output checks](../mol1.md#recorded-native-checks)
and [installation/recovery checks](../mol1.md#installation-and-recovery-scope).
Their finite scope does not establish broader hardware/input capacity, ATP bond
chemistry, chirality, charge, binding pose, affinity or predictive accuracy.
Installed CLI packaging checks are separate from installing the scientific tool
into a Forge session. Do not promote a reduced smoke to full-default or
larger-input qualification.

## Downstream choices and recovery

Preserve the CIF, summary and full-data JSON as one prediction with its source
input and mappings. Compare a separately qualified predictor on the same exact
molecules if independent model evidence is useful. Use
[structure tools](../structure-tools.md) for geometry/alignment or
[Foldseek](../structure-tools.md) for explicitly selected structural search only
when those tools' current catalog states permit it. PDB conversion can lose
chemical connections, long chain IDs and mmCIF metadata; inspect and record losses.

The existing [interface-score adapters](../interface-scores.md) do not establish
a Mol-1 consumer merely because its output resembles Protenix. Validate a
Mol-1-specific chain/token/atom mapping and score-scale conversion before any
ipSAE or other interface analysis. Do not rename files to masquerade as another
predictor. Sequence redesign through MPNN is a separate experiment requiring
compatible input chemistry and subsequent refolding, not a default continuation
of cofolding. Experimental validation is necessary for binding/function claims.

Complete a [Files checkpoint](../../outputs.md) after writers stop, inspect its
manifest and confirm required outputs, then close and verify resource release.
After a completed restore, inspect saved inputs/outputs before explicitly
choosing any further work. There is no advertised resumable diffusion state or
skip-existing recipe; a retry must not overwrite an earlier run. An uncertain
command retains its original ID until its outcome is reconciled.

Source definitions:
[native writer](https://github.com/molence/Mol-1/blob/6ad1a133f919dc79b4f829bdc24fad28b9c4d3f0/mol/runner/dumper.py),
[confidence computation](https://github.com/molence/Mol-1/blob/6ad1a133f919dc79b4f829bdc24fad28b9c4d3f0/mol/model/sample_confidence.py),
[output specification](https://github.com/molence/Mol-1/blob/6ad1a133f919dc79b4f829bdc24fad28b9c4d3f0/docs/output_format.md).
