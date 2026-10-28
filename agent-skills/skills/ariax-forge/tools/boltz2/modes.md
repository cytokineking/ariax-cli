# Boltz-2 molecular, MSA/template and affinity modes

Use these native 2.2.1 interfaces for supplied biomolecular inputs. Read
[input conventions](../../references/boltz2-inputs.md),
[result identities](../../references/boltz2-results.md) and
[affinity definitions](../../references/boltz2-affinity.md) before real work.
Preserve the user's exact construct, modifications, chemistry and MSA policy.

| Mode | Packaged inputs under `examples/boltz2/` |
| --- | --- |
| Monomer with supplied A3M | `monomer_a3m.yaml`, `ubiquitin.a3m` |
| Protein pair with supplied paired CSV | `paired_msa.yaml`, `pair_a.csv`, `pair_b.csv` |
| Explicit CIF or PDB protein template | `template_cif.yaml` + `1ubq.cif`; `template_pdb.yaml` + `1ubq.pdb` |
| DNA/RNA, SMILES/CCD ligands and ion | `molecular.yaml` |
| Modified and cyclic polymers | `modified_cyclic_sep.yaml`; `modified_cyclic.yaml` has the known MSE identity limitation |
| Covalent bond | `bond.yaml` |
| SMILES small-molecule affinity | `affinity_smiles.yaml` |
| CCD small-molecule affinity | `affinity_ccd.yaml` |
| Public or selected custom MSA service | `server_msa.yaml`, `complete/server_pair.yaml`, native service flags |
| Multiple structure samples | `complete/samples_2.yaml` |
| Directory batch | `batch/pair.yaml`, `batch/molecules.yaml`; or `complete/batch2/` |

Ubiquitin templates are input coordinates from [RCSB 1UBQ](https://www.rcsb.org/structure/1UBQ).
The alignment's extra A3M/CSV rows are constructed parser examples rather than
a curated biological MSA. The short mixed complex and constraint examples are
synthetic specifications; they do not establish a natural complex or validate
the specified disulfide. The full protein and chiral L-tyrosine in the affinity
example come from the
[upstream 2.2.1 example](https://github.com/jwohlwend/boltz/blob/v2.2.1/examples/affinity.yaml).
Its explicit `msa: empty` selects single-sequence inference. CCD TYR is a
separate chemical specification requiring inspection of processed charge and
stereochemistry. These examples do not establish measured affinity.

Absolute YAML paths refer to staged VM files. Explicit template matching is A
to CIF A or PDB subchain A1; retain the actual alignment for review. The supplied
pair CSV uses shared integer key 101 and query key -1; row order alone is not
pairing.

## Stage and run

After [tool readiness](../boltz2.md), stage a chosen YAML and every required
sidecar, plus the checker, as ordinary inputs. For example:

```sh
ariax forge inputs add "$SESSION" --file "$EXAMPLES/monomer_a3m.yaml" --path boltz2/monomer_a3m.yaml --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/ubiquitin.a3m" --path boltz2/ubiquitin.a3m --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/check_modes.py" --path boltz2/check_modes.py --json
ariax forge inputs list "$SESSION" --json
```

Require all staged paths ready, the host available and tool ready. Use a fresh
output root and record the returned durable command UUID:

```sh
ariax forge run "$SESSION" --tool boltz2 --gpus 0 --timeout-seconds 3600 --json -- boltz predict /inputs/boltz2/monomer_a3m.yaml --model boltz2 --cache /models/boltz2 --checkpoint /models/boltz2/boltz2_conf.ckpt --out_dir /workspace/boltz2-a3m/run1 --accelerator gpu --devices 1 --recycling_steps 3 --sampling_steps 200 --diffusion_samples 1 --max_parallel_samples 1 --seed 7 --num_workers 0 --preprocessing-threads 1 --output_format mmcif --write_full_pae
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 3600 --json
ariax forge logs "$SESSION" "$COMMAND_ID" --tail 1000 --json
```

Other structure inputs use the same native options with their own staged
YAML/output root. Fresh output roots prevent stale native preprocessing when
inputs or settings change. A watch timeout leaves the remote command intact;
inspect the same command and saved request before any explicit retry.

Affinity adds `--affinity_checkpoint /models/boltz2/boltz2_aff.ckpt
--sampling_steps_affinity 200 --diffusion_samples_affinity 5`, with its own
input and output root. Molecular-weight correction stays off unless explicitly
requested and recorded. Require structure output and all six affinity ensemble
fields. Affinity uses the top-ranked saved structure and belongs to the input,
not each rank. Its value predicts log10(IC50 in µM), so pIC50 = 6 minus the value.
Binder/decoy probability has different supervision. Neither head supplies
measured Kd or free energy; protein confidence cannot substitute for either head.
See the [affinity reference](../../references/boltz2-affinity.md) for a full command.

## Generated MSAs and pairing

For generated MSAs, omit `msa` in the input and pass `--use_msa_server
--msa_server_url URL`. This transmits the sequences to that service and must
be within the user's authorized scope. Use the public ColabFold service or the
user's selected compatible service; custom-service end-to-end behavior remains
unverified here. Keep service credentials in protected native environment
settings. Follow the [ColabFold policy](https://github.com/sokrypton/ColabFold#faq),
including serial queries from a shared IP. Forge does not offer an Ariax-hosted
MSA service.

For a two-chain example, stage `complete/server_pair.yaml` and the checker.
After readiness, an explicitly authorized native command is:

```sh
MSA_URL=https://api.colabfold.com
ariax forge run "$SESSION" --tool boltz2 --gpus 0 --timeout-seconds 3600 --json -- boltz predict /inputs/boltz2/complete/server_pair.yaml --model boltz2 --cache /models/boltz2 --checkpoint /models/boltz2/boltz2_conf.ckpt --out_dir /workspace/boltz2-server-pair/run1 --accelerator gpu --devices 1 --recycling_steps 3 --sampling_steps 200 --diffusion_samples 1 --max_parallel_samples 1 --seed 7 --num_workers 0 --preprocessing-threads 1 --output_format mmcif --write_full_pae --use_msa_server --msa_server_url "$MSA_URL" --msa_pairing_strategy greedy
```

Select `--msa_pairing_strategy complete` for complete pairing, using a fresh
output root. Inspect the saved native CSV/A3M row register and processed MSA.
The checker option `--require-paired-chains A B` requires a shared nonnegative
key on nongap homolog rows after the query. Shared query key 0 alone does not
establish pairing. A service that returns only query sequences leaves homolog
pairing unverified. Native service retries do not justify replaying inference
with a new command UUID. Check requested-versus-produced records even after
exit zero; native preprocessing errors may skip inputs.

## Multiple samples and batch inputs

For two serial structure samples, stage `complete/samples_2.yaml`, use it in the
prediction command with a fresh output root, and set `--diffusion_samples 2
--max_parallel_samples 1`. Check `boltz_results_samples_2` with `--samples 2`.

For a batch, stage every YAML and sidecar under the chosen input directory and
pass that directory to `boltz predict`, for example `/inputs/boltz2/complete/batch2`.
Use a fresh output root and verify both YAML record IDs under
`boltz_results_batch2`. The `batch/` example similarly produces
`boltz_results_batch`; inspect each originating YAML separately. Record IDs,
rank counts and raw files must remain associated with their inputs.

## Check the user's results

Run the checker in the ready remote Boltz environment against the actual output
root and originating YAML, for example:

```sh
ariax forge run "$SESSION" --tool boltz2 --gpus 0 --timeout-seconds 120 --json -- python3 /inputs/boltz2/check_modes.py /workspace/boltz2-a3m/run1/boltz_results_monomer_a3m --input /inputs/boltz2/monomer_a3m.yaml --samples 1 --mols-dir /models/boltz2/mols
```

Watch the returned check command and inspect its logs. Use the corresponding
`boltz_results_<input or directory stem>` and actual sample count for other
inputs. For server pairing, add `--require-paired-chains A B` with the intended
chain IDs. A passing check establishes output consistency, not biological
accuracy or measured binding.

The checker reports numeric chain indices, native token mapping, MSA rows and
pairing keys, template correspondence, confidence and processed chemical
identity. Modified polymers keep one token per residue; ligands use atom tokens.
It verifies CIF atom names, matching arrays and the top-ranked pre-affinity
structure. `--mols-dir` inspects trusted native RDKit molecule files; omitting it
leaves chemistry unverified. Review standardization changes, template spans,
constraint geometry and MSA pairing before interpretation. Soft contact
conditioning does not guarantee the requested distance.

Modified-polymer checks compare retained CCD atom names in native AtomV2 and
elements in CIF; charges come from CCD data. Native MSE-to-MET normalization
fails intended MSE identity. The neutral SEP example does not establish
physiological protonation. Resource requirements depend on token count, batch
size and sampling settings; these examples establish no larger-workload capacity
or hardware minimum.

Save exact YAML/MSA/template inputs, raw predictions and complete `processed/`
files, reports, argv/seed/settings, command IDs and logs to a completed checkpoint.
Follow [save and restore](../boltz2.md#save-and-restore), close the session and
confirm resource release. Restore saved files and check their input/rank/chemistry
mapping before reuse; restoration does not replay inference. Keep an existing
held project's identity and use its authorized resume workflow.
