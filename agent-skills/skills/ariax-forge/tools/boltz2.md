# Forge Boltz2 structure prediction

Boltz2 is a GPU tool. B07 preserves native package 2.2.1 and the historical
PyTorch 2.9/CUDA 12.8 family using ordinary image tags. It predicts structure
from a supplied biomolecular specification. The case here is one small
synthetic protein pair; it is an execution qualification case, with no
biological success threshold.

The recipe is prepared, but B07 did not build/publish its image or run a GPU.
The deployment catalog omits Boltz2 until the orchestrator publishes its
complete named asset at an actual Ariax-controlled URL. A visibly unqualified
catalog example is not deployable. Use live tool metadata after B08 gates
pass, not this guide, to establish availability.

For an authorized session with Boltz2 in its deployed catalog:

```sh
ariax forge tools add "$SESSION" --tools boltz2 --priority boltz2 --json
ariax forge tools wait "$SESSION" boltz2 --timeout 1800 --json
ariax forge status "$SESSION" --json
```

Require host `available` and `boltz2` ready. The tool is GPU-class; execution
uses the assigned GPU and never a CPU substitute. `boltz` is on PATH for
direct argv. `SESSION` is an actual session UUID. `EXAMPLES` is the absolute
sibling `examples/` directory. The orchestrator exposes this guide as the
Forge `boltz2` reference during integration.

## Read-only model mount and inputs

The named asset `boltz2` mounts at `/models/boltz2`. The complete published
directory contains `mols.tar`, extracted `mols/`, `boltz2_conf.ckpt`, and
`boltz2_aff.ckpt`. Native 2.2.1 checks all four before preprocessing even for
structure-only requests. B05 prepares this directory before readiness;
commands use the existing mount, without per-command asset inspections.
A missing asset/read-only-write error is a preparation failure to report.

The [bounded YAML](examples/boltz2/complex.yaml) has protein A `AGSTAGST` and
protein B `GSTAGSTA`, each with `msa: empty`. It does not contact an MSA server
and requests no affinity property. These short sequences are synthetic, not
validated binders. For real work establish the user's exact constructs,
chain identities, MSA policy and biological question first. `msa: empty`
chooses single-sequence inference and can affect prediction quality; it is
not a general scientific recommendation.

```sh
ariax forge inputs add "$SESSION" --file "$EXAMPLES/boltz2/complex.yaml" --path boltz2/complex.yaml --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/boltz2/check.py" --path boltz2/check.py --json
ariax forge inputs list "$SESSION" --json
```

Record the input IDs and require both paths `ready`. Observe an importing
input with `ariax forge inputs status "$SESSION" "$INPUT_ID" --json`.

## One bounded native GPU run

Choose a fresh output root. These explicit settings use three recycles,
200 diffusion steps, one sample, one parallel sample, one device, seed 7,
and full PAE. Zero dataloader workers and one preprocessing thread bound the
small case's process activity. The native settings were checked against
[official 2.2.1 source](https://github.com/jwohlwend/boltz/blob/v2.2.1/src/boltz/main.py).

```sh
ariax forge run "$SESSION" --tool boltz2 --timeout-seconds 3600 --json -- boltz predict /inputs/boltz2/complex.yaml --model boltz2 --cache /models/boltz2 --checkpoint /models/boltz2/boltz2_conf.ckpt --out_dir /workspace/boltz2-demo/run1 --accelerator gpu --devices 1 --recycling_steps 3 --sampling_steps 200 --diffusion_samples 1 --max_parallel_samples 1 --seed 7 --num_workers 0 --preprocessing-threads 1 --output_format mmcif --write_full_pae
ariax forge watch "$SESSION" "$PREDICT_COMMAND_ID" --timeout 3600 --json
ariax forge logs "$SESSION" "$PREDICT_COMMAND_ID" --tail 1000 --json
```

Set `PREDICT_COMMAND_ID` to the returned ID. Require `succeeded` before the
checker below. A timeout ends local waiting; inspect that same remote
command's status/logs and saved request before deciding what happened.
Do not replay a scientific command automatically. Native GPU errors require
diagnosis and a recorded explicit correction, not a CPU/kernel fallback.

## Check files and scientific usability

Native Boltz adds a `boltz_results_complex` directory to the chosen output
root. For the single sample, require all four nonempty files:

```text
/workspace/boltz2-demo/run1/boltz_results_complex/predictions/complex/
  complex_model_0.cif
  confidence_complex_model_0.json
  pae_complex_model_0.npz
  plddt_complex_model_0.npz
```

```sh
ariax forge run "$SESSION" --tool boltz2 --timeout-seconds 60 --json -- python3 /inputs/boltz2/check.py /workspace/boltz2-demo/run1
ariax forge watch "$SESSION" "$CHECK_COMMAND_ID" --timeout 120 --json
```

The [checker](examples/boltz2/check.py) parses the actual CIF, requires chains
A/B with the requested sequences and finite coordinates, checks finite
confidence fields on 0–1, and requires finite nonnegative PAE shape 16×16
and pLDDT shape 16 on 0–1. This protein-only case has one token per residue.
It prints observed confidence without imposing an invented scientific score
target. Full PAE needs explicit `--write_full_pae`. No affinity file is
expected because the YAML requests no affinity prediction.

Inspect logs for skipped inputs and ensure requested-versus-produced IDs
match. Native preprocessing errors can be caught while the process exits
zero. Confidence combines structural/interface predictions; it is not
experimental binding, specificity, expression, or affinity. Inspect chain
placement and interface geometry, and compare results using consistent input
and sampling/MSA settings. [Official output guidance](https://github.com/jwohlwend/boltz/blob/v2.2.1/docs/prediction.md)
and the [writer](https://github.com/jwohlwend/boltz/blob/v2.2.1/src/boltz/data/write/writer.py)
explain these files. Other molecules/affinity and Boltz2-to-ipSAE mapping
remain outside this example's qualification.

Choose a new output directory for changed inputs or settings. In 2.2.1,
`--override` does not clear already processed inputs, so a reused stem can
reuse stale preprocessing. Preserve previous runs, command IDs and settings.

## Save and restore

After prediction and check commands are terminal:

```sh
ariax forge sync "$SESSION" --wait --timeout 1800 --json
ariax forge files "$SESSION" --path /workspace/boltz2-demo/run1 --checkpoint "$CHECKPOINT" --json
ariax forge download "$SESSION" /workspace/boltz2-demo/run1/boltz_results_complex/predictions/complex/complex_model_0.cif --checkpoint "$CHECKPOINT" --dest ./complex_model_0.cif --json
ariax forge close "$SESSION" --json
ariax forge status "$SESSION" --json
```

Use the returned completed checkpoint UUID and require `synced`, then confirm
source `closed`. Listing/download reads completed checkpoint bytes. To
restore that terminal source through B06's ordinary create path:

```sh
ariax forge create --name Boltz2-restored --gpu L40 --tools boltz2 --restore-session "$SESSION" --checkpoint "$CHECKPOINT" --max-hours 1 --json
ariax forge status "$RESTORED_SESSION" --json
ariax forge tools wait "$RESTORED_SESSION" boltz2 --timeout 1800 --json
ariax forge run "$RESTORED_SESSION" --tool boltz2 --timeout-seconds 60 --json -- python3 /inputs/boltz2/check.py /workspace/boltz2-demo/run1
```

Use the new session ID, require host/tool readiness, and watch its check
command before closure. Restore recovers inputs/workspace without replaying
prediction or restoring model caches. The new session prepares named assets
normally. Read the Forge `outputs` reference for storage semantics. Close
and confirm cleanup for the restored session, too. B08 records native GPU
results, elapsed time/cost, and persistence/cleanup qualification.
