# Boltz2 small-molecule affinity

This is a source-reviewed extension of the [qualified protein-pair recipe](../tools/boltz2.md).
The complete named `/models/boltz2` asset already includes confidence and
affinity checkpoints before readiness. A separate affinity asset selection
or per-command model inspection is unnecessary. This guide has offline output
checks; no small-molecule affinity inference is qualified by those checks.

Use one specified small molecule against a protein target. The affinity
`binder` names one ligand chain, with one copy and one residue. Protein
binders, DNA/RNA binders, multi-copy entities and multi-residue CCD lists are
outside this head. Retain cofactors and other required context for the
scientific task; RNA/DNA/cofactor-target affinity interpretation remains
outside this recipe.

The native limit is 128 atoms after RDKit's hydrogen removal, which can leave
some hydrogens. Above 56 atoms is outside the reported training size. Preserve
charge, stereochemistry, tautomer and atom identity. Affinity preprocessing
standardizes SMILES; compare the resulting chemical identity to the intended
molecule. Do not prune atoms to obtain admission.

The bundled `science/affinity/affinity.yaml` uses ethanol and a toy protein to
illustrate syntax:

```yaml
version: 1
sequences:
  - protein:
      id: A
      sequence: AGSTAGST
      msa: empty
  - ligand:
      id: L
      smiles: 'CCO'
properties:
  - affinity:
      binder: L
```

After staging the intended input and requiring tool readiness, native argv is:

```sh
ariax forge run "$SESSION" --tool boltz2 --timeout-seconds 3600 --json -- boltz predict /inputs/affinity/affinity.yaml --model boltz2 --cache /models/boltz2 --checkpoint /models/boltz2/boltz2_conf.ckpt --affinity_checkpoint /models/boltz2/boltz2_aff.ckpt --out_dir /workspace/affinity/run1 --accelerator gpu --devices 1 --recycling_steps 3 --sampling_steps 200 --diffusion_samples 1 --max_parallel_samples 1 --sampling_steps_affinity 200 --diffusion_samples_affinity 5 --seed 7 --num_workers 0 --preprocessing-threads 1 --output_format mmcif --write_full_pae
```

This requests one structure sample and five affinity diffusion samples.
Affinity uses the best-ranked saved structure via `pre_affinity_affinity.npz`.
The result `boltz_results_affinity/predictions/affinity/affinity_affinity.json`
belongs to that input; it is not an affinity measurement for every structure
rank. Require both the structural result and affinity result. Inspect skipped
input warnings and requested-versus-produced IDs even after exit zero.

`affinity_pred_value` predicts log10(IC50 in µM), so lower means stronger
predicted affinity. A value of -3 corresponds to 0.001 µM (1 nM), and
pIC50 is `6 - value`. This is a predicted IC50 scale. It supplies neither Kd
nor binding free energy. The native guide's energy-scaled pIC50 label must
not be used as a unit conversion.

`affinity_probability_binary` is the model's 0–1 binder/decoy probability
estimate. Its supervision differs from the value head. Use the value head
mainly for relative comparisons among related active molecules; a favorable
number alone does not validate an inactive molecule. Retain ensemble suffix
`1`/`2` fields when present. `--affinity_mw_correction` defaults off and changes
the ensemble value; record that choice for comparisons.

The [affinity checker](../scripts/boltz2-affinity-check.py) rejects missing,
nonfinite, wrong-type and out-of-range probability values and verifies the
native input-derived filename. It preserves ensemble components. Its output
reports predicted pIC50 without claiming that a file establishes chemistry,
lineage, structural accuracy or binding. Run the structural checks appropriate
to the actual ligand complex as well. [Offline cases](science-checks.md) use
synthetic outputs and do not spend compute.

Before claiming a qualified affinity workflow, retain a remote native run
with the intended molecule, full model readiness, actual processed chemistry,
matched top-rank structure, complete affinity output, terminal logs and saved
checkpoint. AF3/Boltz2 ipSAE handoffs have their own evidence limits.

Sources: [2.2.1 affinity implementation](https://github.com/jwohlwend/boltz/blob/v2.2.1/src/boltz/model/models/boltz2.py),
[writer](https://github.com/jwohlwend/boltz/blob/v2.2.1/src/boltz/data/write/writer.py),
[prediction guide](https://github.com/jwohlwend/boltz/blob/v2.2.1/docs/prediction.md).
Adapted from Forge archive `d8c0b040f553bf9e51a532cb4db693529f50cc70`.
