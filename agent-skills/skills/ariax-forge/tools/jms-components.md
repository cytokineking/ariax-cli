# Forge JMS constituent scores

These tools calculate JMS constituent scores from a matching sequence and structure. Check `ariax forge catalog --json` for availability before selecting `jms-esm2`, `jms-mpnn`, `jms-esmfold` or CPU `jms-aggregate`. Read this guide with `ariax skills forge --reference jms-components --read --json`; `jms-components-semantics` and `jms-components-fixtures` expose the definitions and inputs.

Native comparisons passed on the 46-residue 1CRN chain A example for ESM2, both historical MPNN checkpoints and CE modes, full ESMFold, the exact eight-seed/two-recycle half-mask protocol, and hybrids 1/3. The original absolute and relative comparison tolerances are 1e-4. Installed availability and larger-input capacity depend on the deployed catalog. These quantities have no established experimental stability accuracy.

`EXAMPLES` is the absolute `data.examples.root` from `ariax skills forge --json`; `SESSION` is your authorized session UUID. Read the [score definitions](jms-components/semantics.md) before combining results.

## Scientific inputs and outputs

ESM2 uses the exact `facebook/esm2_t33_650M_UR50D` checkpoint. It masks every residue separately and computes mean target-token NLL. `esm_pp` is its exponential, and `log_esm_score` is its negative. A fresh result includes per-residue NLL and the mask batch size. CLS/SEP are context only. Sequences are single-record FASTA containing only the 20 canonical amino acids. The input validator rejects truncation and lengths above 1022; the native qualification example has 46 residues, so this validator limit is not a measured capacity guarantee.

ProteinMPNN uses ColabDesign v1.1.0 and the reference `v_48_010` or `v_48_020` JAX checkpoint. `conditional_CE` comes from `get_logits()` with one seeded autoregressive decoding order. `unconditional_CE` comes from `get_unconditional_logits()`. The denominator includes the X output. Pass `--weights /models/proteinmpnn/colabdesign/v1.1.0`. The shared `proteinmpnn` model contains the unchanged official `v_48_010.pkl` and `v_48_020.pkl` from ColabDesign `e7c38e5e70cac56f20f99efbf9d98707c1383ff1`. Constructor and score comparisons passed for the bounded fixture and seed; larger-input resource requirements remain unmeasured. Neither SolubleMPNN, LigandMPNN, AbMPNN nor all-other-residue conditional probabilities are JMS substitutes.

Legacy ESMFold full mode uses the reference serialized model, zero recycles, and virtual-Cβ distance targets across all ordered pairs including the diagonal. `log_CE` is distogram NLL with the reference epsilon; the notebook's `CE` is mean target-bin probability. Mean CA pLDDT uses the 0–100 scale. pTM retains its 0–1 scale. Per-sample NPZ arrays and a predicted PDB accompany the result. The runner checks exported backbone coordinates and sequence and records the native predicted chain/residue mapping back to the input. ESMFold2 and ESMC have separate scientific names.

The [1CRN PDB](examples/jms-components/1crn.pdb) and [FASTA](examples/jms-components/1crn.fasta) retain known crambin chain A, residues 1–46. The PDB must have one model, consecutive canonical residues, complete N/CA/C/O backbone atoms and no unresolved backbone alternate locations or insertion codes. Sequence and selected-chain sequence must match exactly. Prepare any other construct explicitly before JMS scoring.

## Run available tools

For a deployment that exposes these tools, select them and wait for each required tool to be ready:

```sh
ariax forge tools add "$SESSION" --tools jms-esm2,jms-mpnn,jms-esmfold,jms-aggregate --json
ariax forge tools wait "$SESSION" jms-esm2 --timeout 7200 --json
ariax forge tools wait "$SESSION" jms-mpnn --timeout 7200 --json
ariax forge tools wait "$SESSION" jms-esmfold --timeout 7200 --json
ariax forge tools wait "$SESSION" jms-aggregate --timeout 7200 --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/jms-components/1crn.fasta" --path jms/1crn.fasta --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/jms-components/1crn.pdb" --path jms/1crn.pdb --json
ariax forge inputs list "$SESSION" --json
```

Require host available and both inputs ready. Keep the returned input/command IDs. Choose a fresh output directory for every run; existing directories are rejected. GPU commands use an explicitly assigned device and require CUDA. These runs do not build or install models on the user's workstation.

```sh
ariax forge run "$SESSION" --tool jms-esm2 --gpus 0 --timeout-seconds 3600 --json -- jms-components esm2 --sequence-file /inputs/jms/1crn.fasta --mask-batch-size 8 --out /workspace/jms/esm2
ariax forge run "$SESSION" --tool jms-mpnn --gpus 0 --timeout-seconds 3600 --json -- jms-components mpnn --sequence-file /inputs/jms/1crn.fasta --pdb /inputs/jms/1crn.pdb --chain A --model v_48_010 --mode both --seed 0 --weights /models/proteinmpnn/colabdesign/v1.1.0 --out /workspace/jms/mpnn010
ariax forge run "$SESSION" --tool jms-mpnn --gpus 0 --timeout-seconds 3600 --json -- jms-components mpnn --sequence-file /inputs/jms/1crn.fasta --pdb /inputs/jms/1crn.pdb --chain A --model v_48_020 --mode both --seed 0 --weights /models/proteinmpnn/colabdesign/v1.1.0 --out /workspace/jms/mpnn020
ariax forge run "$SESSION" --tool jms-esmfold --gpus 0 --timeout-seconds 3600 --json -- jms-components esmfold --sequence-file /inputs/jms/1crn.fasta --pdb /inputs/jms/1crn.pdb --chain A --mode full --out /workspace/jms/esmfold-full
ariax forge run "$SESSION" --tool jms-esmfold --gpus 0 --timeout-seconds 3600 --json -- jms-components esmfold --sequence-file /inputs/jms/1crn.fasta --pdb /inputs/jms/1crn.pdb --chain A --mode reference-half-mask --out /workspace/jms/esmfold-half
```

Require each command succeeded before starting dependent work or reusing its GPU. Observe returned IDs with `forge watch`, `forge command` and `forge logs`. A local wait timeout leaves the command running. Query an uncertain command ID before deciding on an explicit new run.

## Missing constituents and supported aggregation

Hybrid 1 uses `-ratio * conditional_CE + (1-ratio) * half-mask pLDDT`; hybrid 3 uses `ratio * log_esm_score + (1-ratio) * half-mask pLDDT`. The ratios are explicit. The reference notebook's recorded fits were 0.9 and 0.85625, respectively. The paper publishes supplementary data with these exact score columns. A bounded sample supports raw 0–100 pLDDT and `log_esm_score = -ln(esm_pp)`; full-dataset refitting remains unrun. The paper rounds the hybrid 3 ratio to 0.86. These scores are computational quantities, not predicted experimental ΔG.

Both hybrids require `avg_mask_esmfold_plddt_recyc2` from the reference half-mask protocol: LM mask rate 0.5, two recycles, eight seeds 0–7, eval mode. The qualified native image installs the exact historical `sokrypton/esm` beta revision used by the JMS masked notebook. It draws a fresh Bernoulli CUDA mask before each of the three folding passes per sample; only LM residue tokens are masked, while folding tokens remain unchanged. It requests LM contacts, uses linker `XX` and index offset 512, and averages final CA pLDDT across residues and seeds. The exact protocol passed independent native comparison on the bounded fixture. A loaded model without the required interface writes status unavailable and exits 2.

The aggregate CLI compares sequence and, where present, chain/residue/backbone identity directly. It also requires the intended checkpoint, score units and conditioning. Missing constituents yield status unavailable, value null and an explicit missing list, with exit 2. This remains true at ratio 0 or 1. Duplicate components, nonfinite scores, ESMC/ESMFold2 inputs and mismatched identities are rejected.

Both commands passed with real compatible native half-mask output. For another run, require fresh successful constituent outputs before aggregation:

```sh
ariax forge run "$SESSION" --tool jms-aggregate --timeout-seconds 60 --json -- jms-components aggregate --components /workspace/jms/mpnn010/result.json /workspace/jms/esmfold-half/result.json --hybrid hybrid1 --ratio 0.9 --out /workspace/jms/hybrid1
ariax forge run "$SESSION" --tool jms-aggregate --timeout-seconds 60 --json -- jms-components aggregate --components /workspace/jms/esm2/result.json /workspace/jms/esmfold-half/result.json --hybrid hybrid3 --ratio 0.85625 --out /workspace/jms/hybrid3
```

Other notebook hybrids need out-of-scope AF2/ESM-IF constituents or have inconsistent published formulas. The original TrMRF/TrROS paths await separate native qualification and managed delivery on the approved 6MRR-A alternative; historical reproduction of the unavailable r9_900 input structure and its original results remains unverified.

## Retain inspectable results

Inspect `result.json` status, model, conditioning, sequence and structure fields, plus actual per-residue/sample output. The bounded native qualification compared actual component values with independently executed reference functions and measured resources. Bundled examples contain inputs. Keep the complete result directories from your own commands, including per-residue arrays, structures and recorded settings. The 46-residue ESMFold example used a sampled peak of 9080 MiB GPU memory and 9477906432 bytes container memory; larger inputs can require more. Choose hardware from the deployed tool requirements.

```sh
ariax forge sync "$SESSION" --wait --timeout 1800 --json
ariax forge files "$SESSION" --path /workspace/jms --checkpoint "$CHECKPOINT" --json
ariax forge download "$SESSION" /workspace/jms/esm2/result.json --checkpoint "$CHECKPOINT" --dest ./jms-esm2-result.json --json
```

Use the completed checkpoint UUID returned by sync. Keep NPZ arrays, PDB exports, JSON results and exact argv together. Saved files remain available after compute closes. Restoration does not rerun scoring. Follow the [outputs guide](../outputs.md) for saved-result links and normal session cleanup.

Use [saved results](../outputs.md) for checkpoint-pinned `forge link` paths,
and [project controls](../SKILL.md#project-controls-and-resume) for human
pause and same-project resume. Web approval clears a hold without allocating
compute; restoration leaves the next scientific command explicit.
