# Forge predictor interface scores


B35q passed remote consumption of 22 retained B40/B41 samples without new
prediction: OpenDDE general and ABAG, OpenBind-0 and Preview2. Eight insulin
dimers passed 920 unchanged v3 comparisons; OpenFold3's eight imported pair
values also matched its native labeled dictionary exactly. Monomer and mixed
cases retain `no_protein_interface` for their single selected protein chain.
The final image reproduced one dimer per checkpoint, and 26 existing scorer
tests passed. This extends the one-CPU/1-GiB qualification through 115 native
tokens and 958 atoms. Larger workloads remain unqualified. B55e privately published this corrected image and verified its ordinary managed pull and original-file guards.
The final correction also rejects output paths that would replace declared
native confidence or feature files. Both original failures were reproduced
on remote copies; three focused preservation checks passed.

The retained B11 Boltz prediction has passed local actual-file scoring and
comparison with the accepted positional v3 script. Both directions, aggregates
and per-residue values agree within v3's printed precision. See the
local acceptance procedure for native
Boltz token export and consuming B31's supplied AF2 handoffs. The actual AF2
76-residue monomer and 21+30-residue insulin handoffs have also passed. Insulin
matches v3 across 116 comparisons; the monomer reports no protein interface.
The three native RF3 dimers also passed 432 v3 comparisons. The scorer used one
CPU and 1 GiB RAM with no GPU; the proposed disk floor is 1 GiB. B35q extends
the measured scope through 115 native tokens and 958 atoms.
AF3 input is unsupported.
Completion uses a small authorized example per distinct import path through real
installation, scoring, saved outputs and restoration, with ordinary resource
measurements. Accepted native evidence covers the retained predictor features;
larger resource sweeps and repeated sample series are optional benchmarks.

Read the [adapter contract](interface-scores/adapters.md) before preparing
real prediction handoffs. The [metric reference](../references/ipsae-metrics.md)
states the retained v3 definitions. Preserve the original model, seed, input,
run and selected sample, all raw confidence/structure files and the token-map
derivation. Dimensions alone cannot establish sample or residue identity.
The caller selects a single sample; the scorer never chooses a best sample.

## Prepare one matched handoff

Use `schema: interface-scores-v1` with explicit role-to-path input files,
selected chain sequences and token/atom mappings. The complete
[synthetic examples](examples/interface-scores/README.md) are mapping checks,
not predictions. Every selected residue maps to one native token and has a
CA. Other chemical tokens may be explicitly excluded with null entries;
retain their original rows in the raw input. Only selected standard protein
chains are scored. Modified residues, nucleic-acid or ligand interface
calibration needs a separately qualified adapter.

| Predictor | Confidence/mapping facts |
| --- | --- |
| AF2 | JSON residue PAE and pLDDT on 0-100; no pickle. Preserve original PAE order. |
| Boltz-2 | Native matched CIF/PAE/pLDDT/summary filenames use confidence rank. Token pLDDT is 0-1. Preserve original output asym IDs, including removed-chain effects; do not sort labels into new indices. |
| Protenix | Native `token_pair_pae`, `atom_plddt` on 0-1, `atom_to_token_idx` and `token_asym_id` are checked against explicit atom/token identity. |
| RF3 | Atom pLDDT is 0-1. Native string token chain iids map explicitly to structure labels. `token_res_ids` are global zero-based token indices, not structure residue numbers. Complex ipTM stays labeled complex. |
| OpenDDE | Native `token_pair_pae`, `atom_plddt` on 0-1, `atom_to_token_idx` and `token_asym_id`. Retain the producer's `native_identity` and `original_input` file roles. The native identity sidecar and original explicit chain sequences must agree with the structure and confidence. The sample index is diffusion order; `lineage.native_filename_rank` retains the separate native filename rank. General and ABAG remain preview choices. |
| OpenFold3 | OpenBind-0 engine 0.5.0 with `of3-ob-2025-06-30-174k.pt`, or Preview2 engine 0.4.3 with `of3-p2-155k.pt`. Per-atom pLDDT is 0-100; native PAE is angstrom. Keep `native_files.confidence`, the exported confidence, native token/asym/residue identities and atom-to-token membership. The sample index is one-based generation order and rank stays null. Preview1 is excluded. |

Require a user-authorized available session and a ready `interface-scores`
tool before running. When the assembled catalog offers the tool:

```sh
ariax forge tools add "$SESSION" --tools interface-scores --priority interface-scores --json
ariax forge tools wait "$SESSION" interface-scores --timeout 1800 --json
ariax forge status "$SESSION" --json
```

Stage the handoff and all declared paths through ordinary `forge inputs add`.
Require every input ready before scoring. For the synthetic AF2 example,
`EXAMPLES` is the installed examples root reported by the skill;
`data.examples.interface-scores` locates this package:

```sh
ariax forge inputs add "$SESSION" --file "$EXAMPLES/interface-scores/af2/model.pdb" --path interface-scores/af2/model.pdb --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/interface-scores/af2/confidence.json" --path interface-scores/af2/confidence.json --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/interface-scores/af2/handoff.json" --path interface-scores/af2/handoff.json --json
ariax forge inputs list "$SESSION" --json
ariax forge run "$SESSION" --tool interface-scores --timeout-seconds 120 --json -- interface-scores /inputs/interface-scores/af2/handoff.json --output /workspace/interface-scores/af2.json --pae-cutoff 10
ariax forge watch "$SESSION" "$SCORE_COMMAND_ID" --timeout 180 --json
ariax forge run "$SESSION" --tool interface-scores --timeout-seconds 60 --json -- python3 /opt/interface-scores/check.py /workspace/interface-scores/af2.json --require-available
ariax forge watch "$SESSION" "$CHECK_COMMAND_ID" --timeout 120 --json
```

Use each returned command ID and require success before the dependent check.
On an uncertain response, query the same durable command ID; do not replay
science automatically. Use a new output directory for each explicit run.
The scorer writes completed JSON atomically and refuses to overwrite its
handoff or declared original files.

## Read the result

`pairs` contains every ordered chain pair. `reference_chain` is the PAE row
chain and `partner_chain` is the column chain. Each metric has a value,
status, reason and definition. `residues` records structure residue identity,
PAE token index, CA index and contact-atom index. `by_residue` retains each
reference residue's ipSAE, partner count and d0. `prediction` preserves exact
sample/rank and model identity. Imported predictor ipTM is separate and labels
pair or complex scope.

- ipSAE uses PAE strictly below the supplied cutoff and row-specific protein
  d0; its directional value is the maximum row mean.
- pDockQ uses contact-atom pLDDT and CB/glycine CA contacts <=8 A. It can run
  without PAE and is symmetric.
- pDockQ2 uses directional PAE at those contacts and contact-atom pLDDT.
  Preserve its native definition and values, including values above one.
- LIS uses PAE <=12 A without a distance filter. Preserve both directions.

Unordered `aggregates` explicitly label max-of-directions for
ipSAE/pDockQ/pDockQ2 and mean-of-directions for LIS. No aggregate is a universal
normalized score. Missing PAE makes ipSAE, LIS and pDockQ2 unavailable. Missing
pLDDT or CB makes docking scores unavailable while PAE scores can still run.
Each unavailable metric is null with a reason; malformed arrays/mappings are
rejected. A defined zero with no passing PAE/contact entries stays zero. A
monomer emits no pairs and `no_protein_interface`, never an invented ipSAE.

For the constructed Z/X example, LIS is 2/3 versus 5/12, with aggregate 13/24.
Atom serials are deliberately noncontiguous and CA/CB confidence differs.
The example catches indexing mistakes; it provides no binding evidence.

Confidence metrics do not establish affinity, specificity, expression or
experimental success. Compare consistent constructs, predictor/model,
settings and cutoffs, and preserve rejected/absent data. Do not replace
missing confidence with B-factors, PDE, averaged PAE or zero vectors.

Save results and raw originals before closure:

```sh
ariax forge sync "$SESSION" --wait --timeout 1800 --json
ariax forge files "$SESSION" --path /workspace/interface-scores --checkpoint "$CHECKPOINT" --json
ariax forge download "$SESSION" /workspace/interface-scores/af2.json --checkpoint "$CHECKPOINT" --dest ./interface-scores-af2.json --json
```

Require the returned checkpoint synced. Use the [complete saved-output procedure](interface-scores/saved-output-restoration.md)
for native inputs, reference files, saved-file links and restoration, together
with the [outputs guide](../outputs.md). Restore recovers files for explicit later
checks and does not rerun predictions/scoring. Close owned compute and confirm
closed state when work ends.

Current acceptance covers the supported predictor mappings and their recorded resource envelope.
