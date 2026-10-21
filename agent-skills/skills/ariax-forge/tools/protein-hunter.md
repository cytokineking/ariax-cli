# Protein-Hunter

Protein-Hunter explores protein binders through a native Boltz hallucination and
LigandMPNN sequence-design loop. Each explicit attempt saves every cycle and its
actual scientific outcome. Computational confidence supplies no experimental
binding, affinity or expression result. This is an experimental tool.

The selected implementation is the
[Ariax fork](https://github.com/cytokineking/Free-Protein-Hunter/tree/91513a2f78987a84e92e6de5a735fe1e12e0f265)
of the [original Protein-Hunter source](https://github.com/yehlincho/Protein-Hunter/tree/a3e048e96c93953f022d15a4d35cd744b7e39e41).
Its customized predictor and controller stay paired. It uses Boltz-2 and the
native LigandMPNN soluble checkpoint; original ProteinMPNN SolubleMPNN is a
different model. Use the saved native outcome and a separately requested
Boltz-2 refold when assessing a candidate.

## Prepare an attempt

Set `SESSION` and `PROJECT` from your available Forge session. Discover examples
with `ariax skills forge --json`; `data.examples.root` gives their absolute root.
The `protein-hunter` reference and `protein-hunter-fixtures` alias provide this
guide and its small canonical example.

```sh
ariax forge project "$PROJECT" --json
ariax forge tools add "$SESSION" --tools protein-hunter --json
ariax forge tools wait "$SESSION" protein-hunter --timeout 1800 --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/protein-hunter/protein-binder.json" --path protein-hunter/protein-binder.json --json
ariax forge inputs list "$SESSION" --json
```

Require each staged input to be ready and project controls to permit work.
Choose a fresh UUID `ATTEMPT` for both the durable command and adapter attempt.
Use an isolated campaign directory:

```sh
ariax forge run "$SESSION" --tool protein-hunter --gpus 0 --command-id "$ATTEMPT" --timeout-seconds 1800 --json -- protein-hunter attempt --campaign /workspace/protein-hunter/pdl1 --config /inputs/protein-hunter/protein-binder.json --attempt-id "$ATTEMPT"
ariax forge watch "$SESSION" "$ATTEMPT" --timeout 1800 --json
ariax forge logs "$SESSION" "$ATTEMPT" --tail 1000 --json
```

The bundled example supplies the PD-L1 construct, a 90-residue binder, two design
cycles and native 0.8/0.8 confidence thresholds. For your target, establish the
construct, ordered sequences and intended mode before writing a new config.
Keep every previous version and its results. The adapter calls native
`run_single_design(0, ...)` once; an existing attempt directory refuses execution.

## Configuration and conditioned inputs

`target_sequences` contains ordered uppercase canonical protein sequences.
Optional `starting_sequence` accepts canonical amino acids and X. Native options
include `num_cycles`, `min_protein_length`, `max_protein_length`, `percent_x`,
`temperature`, `high_iptm_threshold`, `high_plddt_threshold`, `alanine_bias`,
`alanine_bias_start`, `alanine_bias_end`, `omit_aa` and `exclude_p`.
The native MPNN seed is 111. The adapter fixes no Boltz or initial-sequence seed.

The conditioned protein route additionally accepts:

| Field | Meaning |
| --- | --- |
| `cyclic` | Native cyclic binder feature, boolean. |
| `template_path`, `template_cif_chain_id` | One staged PDB/CIF path and an explicit comma-separated template chain per ordered target. Both fields are required together. |
| `contact_residues` | One comma-separated residue group per target, separated by `|` across targets. Binder is A; ordered targets start B. |
| `use_auth_numbering` | Interpret contacts in the staged template's author numbering; requires a template. Native mapping validates positions. |
| `contact_cutoff` | Native CA-distance cutoff in angstroms. |
| `max_contact_filter_retries` | Explicit native cycle-zero contact-filter retry bound. |
| `target_msas` | One staged A3M path per ordered target. Its first query must exactly match the target. The native cache/parser consumes these alignments without an online query. |

Paths must identify regular files under `/inputs` or `/workspace`. Stage the
template and A3M alongside the JSON configuration. A small combined example
uses one target, binder length 30, one design cycle, `cyclic:true`, template chain B,
contacts `2,3`, author numbering, a two-sequence target A3M and
`max_contact_filter_retries:1`. The usual 200 diffusion steps and three recycles
remain native. Other sizes and combinations need their own evidence.

The native contact filter requires at least two target CA residues within the
strict cutoff. Its controller may proceed after retry exhaustion or a contact
check exception; preserve that warning and inspect the saved contact geometry.
Pocket conditioning and high confidence do not establish that a requested
contact formed. Cyclic input similarly needs inspection of native bonds and
closure geometry in the captured arrays and structure.

This protein-binder route accepts PDB templates and supplied target alignments.
Molecular targets and live MSA service selection are outside its supported scope.
The template and supplied-MSA path carries the selected target identity and
native chain mapping through each cycle.

The tested conditioned example uses a 30-residue cyclic binder and 122-residue
target, one design cycle, a PDB template and a two-sequence supplied A3M. Both
predictions retain cyclic period 30; measured terminal C-to-N distances were
1.34 and 1.32 angstrom. Its design-cycle ipTM 0.7293 missed the unchanged 0.8 gate,
so the native result remained rejected with zero accepted designs. Broader
sizes and input combinations remain outside this bounded evidence.

For PDB templates, configuration names the author chain. The captured predictor
input records its native subchain label, such as author B mapped to label B1.
The target's prediction chain remains B. Missing template chains are rejected
before model work.

## Inspect saved science

Each attempt lives at `/workspace/protein-hunter/pdl1/attempts/ATTEMPT`.

| File | Contents |
| --- | --- |
| `settings.json` | Every effective native default and selected setting before execution. |
| `result.json` | Actual attempt state, supplied configuration, prior choice and native outcome/failure. |
| `native/designs/design_stats.csv` | Native initial and design-cycle identities, sequences and scores. |
| `native/designs/ph_UUID_d0_cN.pdb` | Each native cycle complex, with binder A and ordered targets B onward. |
| `native/best_designs/` | Native best-cycle record and any selected structure. |
| `arrays/prediction-NNNN.npz` and `.json` | Lossless native tensors, structured atoms/residues/chains/bonds, token features, exact input and metric availability. Prediction 0000 is cycle zero. |

The fork averages both directional binder/partner ipTM values, then averages
partners. Best selection requires alanine fraction<=0.20, ipTM and complex
pLDDT at their configured thresholds; strictly higher ipTM wins. Cycle zero
is retained but cannot become the best. Native ipSAE is its PAE-only equation.
Missing PAE can appear as zero in native CSV; capture metadata marks that metric
unavailable. Preserve the CSV, raw values and JSON nulls. Critical missing or
nonfinite coordinates/pLDDT fail after raw capture, retaining partial outputs.

Native `accepted:null` describes an unvalidated saved candidate, and
`accepted:false` describes rejection. `accepted_designs` stays 0 on this route.
The retained canonical comparisons include both scientifically rejected runs
and a filter-passing best with acceptance unset. Preserve all these outcomes.

After a completed native best-cycle pass, export one explicitly chosen version
and use the [Boltz-2 guide](boltz2.md) for a separate refold:

```sh
ariax forge run "$SESSION" --tool protein-hunter --gpus 0 --command-id "$EXPORT_COMMAND" --timeout-seconds 60 --json -- protein-hunter export --attempt "/workspace/protein-hunter/pdl1/attempts/$ATTEMPT" --destination /workspace/protein-hunter/pdl1/selected-v1.yaml
ariax forge watch "$SESSION" "$EXPORT_COMMAND" --timeout 120 --json
```

Export checks the actual chosen sequence and refuses rejected/incomplete
attempts or an existing destination. Retain referenced template/MSA inputs when
refolding a conditioned export. A separate refold never rewrites native acceptance.

## Save, restore and explicit continuation

After writers stop, create and retain a completed checkpoint:

```sh
ariax forge sync "$SESSION" --wait --timeout 900 --json
ariax forge files "$SESSION" --path /workspace/protein-hunter/pdl1 --checkpoint "$CHECKPOINT" --json
ariax forge close "$SESSION" --json
ariax forge status "$SESSION" --json
ariax forge project "$PROJECT" --json
ariax forge resume "$PROJECT" --restore-session "$SESSION" --checkpoint "$CHECKPOINT" --control-revision "$REVISION" --gpu L40 --tools protein-hunter --max-gpu-hours 1 --json
```

Require synced persistence and a terminal source. Human holds require verified
web approval and a fresh revision. Approval starts no work. Read restored
settings, native outcomes, inputs and raw arrays before another command.
Scratch and command history are recreated separately; Files never replays science.

Continuation uses a fresh UUID and preserves the chosen terminal predecessor:

```sh
ariax forge run "$RESTORED_SESSION" --tool protein-hunter --gpus 0 --command-id "$NEXT_ATTEMPT" --timeout-seconds 1800 --json -- protein-hunter attempt --campaign /workspace/protein-hunter/pdl1 --config /inputs/protein-hunter/protein-binder.json --attempt-id "$NEXT_ATTEMPT" --previous "/workspace/protein-hunter/pdl1/attempts/$ATTEMPT"
```

This starts a new complete attempt. An interrupted native cycle remains
unresolved until its Forge status settles. After a lost response or watch
timeout, inspect the same command ID and retained logs before deciding anything.
The existing attempt directory continues to protect its saved version.
