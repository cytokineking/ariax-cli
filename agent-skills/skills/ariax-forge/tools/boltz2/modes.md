# Boltz-2 molecular, MSA/template and affinity modes


| Mode | Packaged inputs under `examples/boltz2/` |
| --- | --- |
| Monomer with supplied A3M | `monomer_a3m.yaml`, `ubiquitin.a3m` |
| Protein pair with supplied paired CSV | `paired_msa.yaml`, `pair_a.csv`, `pair_b.csv` |
| Explicit CIF or PDB protein template | `template_cif.yaml` + `1ubq.cif`; `template_pdb.yaml` + `1ubq.pdb` |
| DNA/RNA, SMILES/CCD ligands and ion | `molecular.yaml` |
| Modified and cyclic polymers | `modified_cyclic_sep.yaml` qualified; `modified_cyclic.yaml` retains the failed MSE identity case |
| Covalent bond | `bond.yaml` |
| SMILES small-molecule affinity | `affinity_smiles.yaml` |
| CCD small-molecule affinity | `affinity_ccd.yaml` |
| Public or selected custom MSA service | `server_msa.yaml`, native service flags |
| Directory batch | `batch/pair.yaml`, `batch/molecules.yaml` |

Ubiquitin templates are input coordinates from [RCSB 1UBQ](https://www.rcsb.org/structure/1UBQ),
not B33 model outputs. Trailing line padding was removed while preserving
all 660 atom identities and coordinates in each file. The alignment's extra A3M/CSV rows are constructed parser
examples, not a curated biological MSA. The short mixed complex and constraint
cases are synthetic execution specifications. They do not assert a natural
complex or validate the specified disulfide. The full protein and chiral
L-tyrosine in the affinity case come from the
[upstream 2.2.1 example](https://github.com/jwohlwend/boltz/blob/v2.2.1/examples/affinity.yaml).
Its explicit `msa: empty` records a single-sequence policy. CCD TYR is a separate
chemical specification requiring inspection of its processed charge and
stereochemistry. These cases do not establish measured affinity.

Read [input conventions](../../references/boltz2-inputs.md),
[result identities](../../references/boltz2-results.md) and
[affinity definitions](../../references/boltz2-affinity.md) before real work.
Preserve the user's exact construct, modifications, chemistry and MSA policy.
Absolute YAML paths refer to staged VM files. Explicit template matching is A
to CIF A or PDB subchain A1, with the actual alignment retained for review.
The pair CSV uses shared integer key 101; row order alone is not pairing.

After tool readiness, stage a chosen YAML and its required sidecars, plus the
checker, as ordinary inputs. For example:

```sh
ariax forge inputs add "$SESSION" --file "$EXAMPLES/boltz2/monomer_a3m.yaml" --path boltz2/monomer_a3m.yaml --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/boltz2/ubiquitin.a3m" --path boltz2/ubiquitin.a3m --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/boltz2/check_modes.py" --path boltz2/check_modes.py --json
ariax forge inputs list "$SESSION" --json
```

Require all staged paths ready, the host available and tool ready. Use a fresh
output root and record the returned durable command UUID:

```sh
ariax forge run "$SESSION" --tool boltz2 --gpus 0 --timeout-seconds 3600 --json -- boltz predict /inputs/boltz2/monomer_a3m.yaml --model boltz2 --cache /models/boltz2 --checkpoint /models/boltz2/boltz2_conf.ckpt --out_dir /workspace/boltz2-a3m/run1 --accelerator gpu --devices 1 --recycling_steps 3 --sampling_steps 200 --diffusion_samples 1 --max_parallel_samples 1 --seed 7 --num_workers 0 --preprocessing-threads 1 --output_format mmcif --write_full_pae
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 3600 --json
ariax forge logs "$SESSION" "$COMMAND_ID" --tail 1000 --json
```

The other structure cases use the same native options and their own staged
YAML/output root. The batch uses `/inputs/boltz2/batch`, containing only its two
YAML inputs. Verify both record IDs after exit zero. Fresh output roots prevent
stale native preprocessing when inputs/settings change. A watch timeout leaves
the remote command intact; inspect the same command before any explicit retry.

Affinity adds `--affinity_checkpoint /models/boltz2/boltz2_aff.ckpt
--sampling_steps_affinity 200 --diffusion_samples_affinity 5`, with its own
input and output root. Molecular-weight correction stays off unless explicitly
requested and recorded. Both structure and six-field affinity ensemble output
are required. Affinity uses the top-ranked saved structure; it is an input-level
result, not a measurement for each rank. The value predicts log10(IC50 in µM),
so pIC50 = 6 minus the value. Binder/decoy probability has different supervision.
Neither head supplies measured Kd or free energy, and protein confidence cannot
be substituted for either head.

For generated MSAs, use `server_msa.yaml` with `--use_msa_server
--msa_server_url https://api.colabfold.com`, or the user's selected compatible
service URL. This transmits the sequence and must be within the authorized
scope. Keep service credentials in protected native environment settings.
The public ColabFold ubiquitin case returned 8,192 unpaired MSA rows and passed
native prediction. Native URL override and explicit rejection behavior still need qualification.
The public policy requires serial queries from one IP across the campaign; use
one shared submitting host and only the retained public ubiquitin/insulin fixtures
for qualification. [ColabFold policy](https://github.com/sokrypton/ColabFold#faq). Forge does not offer an Ariax MSA service in this release.

Inspect the actual files with the originating YAML, for example:

```sh
ariax forge run "$SESSION" --tool boltz2 --gpus 0 --timeout-seconds 120 --json -- python3 /inputs/boltz2/check_modes.py /workspace/boltz2-a3m/run1/boltz_results_monomer_a3m --input /inputs/boltz2/monomer_a3m.yaml --samples 1 --mols-dir /models/boltz2/mols
```

Use the corresponding `boltz_results_<input stem>` for other cases.
For the batch, inspect each YAML using the same `boltz_results_batch` root.
The checker reports chain indices, native token mapping, MSA rows/pairing keys,
template correspondence, observed confidence and processed chemical identity.
Boltz-2 modified polymers keep one token per residue; ligands use atom tokens.
It verifies CIF atom names, matching arrays and the top-ranked pre-affinity
structure. `--mols-dir` enables inspection of trusted native RDKit molecule
files; omitting it leaves chemistry unverified. Review standardization changes,
template spans and MSA pairing before interpreting results. A passing output
check establishes consistency only. Modified-polymer checks compare retained
CCD atom names in native AtomV2 and elements in CIF; charges are CCD data.
Native MSE-to-MET normalization fails intended MSE identity. The SEP fixture
uses neutral CCD chemistry and does not establish physiological protonation.

Save exact YAML/MSA/template inputs, raw predictions and complete `processed/`
files, reports, argv/seed/settings, command IDs and logs to a completed checkpoint.
Retain per-device VRAM, RAM, disk and cold/warm timing evidence outside the VM.
Close the owned session through ordinary lifecycle controls and confirm release.
Restore saved files without automatically replaying inference. Keep an existing
held project's identity and follow its authorized platform resume workflow.

## Measured native scope

B33 used one 48 GiB-class L40, 28 CPUs and about 57 GiB host RAM. The largest
fixture had 397 tokens: a 384-residue target and 13 heavy ligand atoms. Runs used
the settings above, including one structure and five affinity samples; the
batch held two records. Maximum observed device memory was 4,909 MiB at
one-second samples and cgroup RAM was 8,998,858,752 bytes. These observations
can miss short GPU peaks and do not qualify larger targets, batches or samples.
They are not hardware minima.


Both template outputs aligned to 1UBQ at Cα RMSD 0.980628 Å. The covalent SG-SG
distance was 2.027085 Å and SEP cyclic closure C-N was 1.334968 Å. The mixed
contact was 7.406507 Å for an 8 Å request; in the batch it was 9.037651 Å with
`force: false`. Soft conditioning does not guarantee the requested maximum.
Exact inputs, processed maps, raw confidence/affinity, both initial CUDA failures,
the corrected SEP check and restoration evidence remain in the runtime B33 report.


## Small functional completion and selected-URL pairing

The October 10 human correction permits small end-to-end campaigns, even a few
designs. The selected functional plan uses two structure samples and two batch
records. Long-input profiles are optional. Keep the twelve accepted bounded
cases and their original settings; MSE-to-MET remains chemically unqualified.
Installation, actual execution and complete Files/R2 restoration still apply.

| Input under examples/boltz2 | Explicit qualification workload |
| --- | --- |
| complete/server_pair.yaml | Insulin A21/B30, omitted msa, native greedy and complete public-service pairing |
| complete/monomer_512.yaml | Optional constructed protein512 stress profile |
| complete/heteromer_768.yaml | Optional stress profile with two chains384 each |
| complete/samples_2.yaml | Ubiquitin76, two structure samples with parallel1 |
| complete/batch2/ | Two distinct ubiquitin76 records for installed batch/restore mapping |


Stage complete/server_pair.yaml, audit_server_url.py and check_modes.py through ordinary inputs and
require both paths ready. For one explicitly authorized greedy run:

```sh
MSA_URL=https://api.colabfold.com:443
ariax forge run "$SESSION" --tool boltz2 --gpus 0 --timeout-seconds 600 --json -- python3 /inputs/boltz2/audit_server_url.py --origin "$MSA_URL" --audit-path /workspace/boltz2-selected-greedy/run1/service-http.json --pairing greedy -- boltz predict /inputs/boltz2/complete/server_pair.yaml --model boltz2 --cache /models/boltz2 --checkpoint /models/boltz2/boltz2_conf.ckpt --out_dir /workspace/boltz2-selected-greedy/run1 --accelerator gpu --devices 1 --recycling_steps 3 --sampling_steps 200 --diffusion_samples 1 --max_parallel_samples 1 --seed 7 --num_workers 0 --preprocessing-threads 1 --output_format mmcif --write_full_pae --use_msa_server --msa_server_url "$MSA_URL" --msa_pairing_strategy greedy
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 600 --json
ariax forge logs "$SESSION" "$COMMAND_ID" --tail 1000 --json
ariax forge run "$SESSION" --tool boltz2 --gpus 0 --timeout-seconds 120 --json -- python3 /inputs/boltz2/check_modes.py /workspace/boltz2-selected-greedy/run1/boltz_results_server_pair --input /inputs/boltz2/complete/server_pair.yaml --samples 1 --mols-dir /models/boltz2/mols --require-paired-chains A B
```

Complete pairing is a separate explicit native command: set both native and
audit pairing arguments to complete and select a new output/audit root. Native generation contacts ticket/pair and ticket/msa for the
two-chain input. The checker requires a shared nonnegative key on nongap
homolog rows after query row0. Shared query key0 alone cannot establish pairing.
Inspect the saved native CSV/A3M row register and processed MSA. A server that
returns only query sequences leaves the actual homolog pairing claim open.
Service protocol retries are native behavior; observing a command never
licenses replaying inference with a new UUID.

The actual HTTP audit requires completed ticket/msa and result/download traffic,
plus ticket/pair with the selected native mode for paired inputs. An alternate
origin fails before sending another request. Query/register and full prediction
checks remain required. Read a saved audit without contacting the service:

```sh
ariax forge run "$SESSION" --tool boltz2 --gpus 0 --timeout-seconds 120 --json -- python3 /inputs/boltz2/audit_server_url.py --origin "$MSA_URL" --audit-path /workspace/boltz2-selected-greedy/run1/service-http.json --pairing greedy --check-only
```

The packaged check_server_url.py performs the separate explicit unusable-endpoint
case with the same public ubiquitin input. It records the native request to a
controlled error endpoint and actual socket/DNS attempts, rejects any external
fallback, and requires the native error plus absent MSA/prediction outputs.
Preserve its true native exit code; Boltz may catch a preprocessing error and
skip the input while exiting zero. An outer timeout remains a failed case.
Its --check-only mode validates saved files without a query or inference.

For a fresh explicit negative-case root on the shared service session:

```sh
ariax forge run "$SESSION" --tool boltz2 --gpus 0 --timeout-seconds 180 --json -- python3 /inputs/boltz2/check_server_url.py --input /inputs/boltz2/server_msa.yaml --out-dir /workspace/b33-complete/U1 -- boltz predict /inputs/boltz2/server_msa.yaml --out_dir /workspace/b33-complete/U1 --model boltz2 --cache /models/boltz2 --checkpoint /models/boltz2/boltz2_conf.ckpt --accelerator gpu --devices 1 --recycling_steps 3 --sampling_steps 200 --diffusion_samples 1 --max_parallel_samples 1 --seed 7 --num_workers 0 --preprocessing-threads 1 --output_format mmcif --write_full_pae --use_msa_server --msa_server_url LOCAL_REJECTING_ENDPOINT --msa_pairing_strategy greedy
ariax forge run "$SESSION" --tool boltz2 --gpus 0 --timeout-seconds 120 --json -- python3 /inputs/boltz2/check_server_url.py --input /inputs/boltz2/server_msa.yaml --out-dir /workspace/b33-complete/U1 --check-only
```

For the functional multi-sample check, use complete/samples_2.yaml with the
same native settings, --diffusion_samples 2 and --max_parallel_samples 1; check
boltz_results_samples_2 with --samples 2. The batch check supplies
/inputs/boltz2/complete/batch2 as the native input directory and checks each of
its two YAML record IDs against boltz_results_batch2 with --samples 1. Affinity
keeps its native 200 steps and five affinity samples. These small cases exercise
installed dispatch, output mapping and restoration. They establish no larger
capacity or biological-accuracy claim.

R1/R2 stress rows are optional and never gate functional acceptance. The old
samples_5.yaml and batch4 inputs retain their original bytes as prior-plan
fixtures. The selected functional path uses samples_2.yaml and batch2.
Qualification runs on an authorized remote GPU VM with the existing transfer
permissions.

A completed checkpoint must include every registered input and all raw native
processed/predictions/MSA/template files, previous failures, six-field affinity
heads, settings and logs. After restoration, prepare the named models normally
and run these output checks against saved files. Keep the same pairing/sample
requirements. Both affinity inputs require their own native atom maps and CLI
consumer, including the restored outputs. Empty scratch and command history
are expected after Files restore; prediction is never resumed automatically.

## Small offline examples

These four examples use registered inputs under complete/. Reuse accepted
outputs when checking other modes. Set SESSION to the ready session and give
each invocation a fresh COMMAND_ID; retain that ID when reconciling a submission.
The batch example needs both complete/batch2/ files registered. The affinity
examples retain five native affinity samples and 200 affinity steps.

```sh
# R3: two serial structure samples
ariax forge run "$SESSION" --tool boltz2 --gpus 0 --command-id "$COMMAND_ID" --timeout-seconds 600 --json -- boltz predict /inputs/boltz2/complete/samples_2.yaml --out_dir /workspace/b33-complete/R3 --model boltz2 --cache /models/boltz2 --checkpoint /models/boltz2/boltz2_conf.ckpt --accelerator gpu --devices 1 --recycling_steps 3 --sampling_steps 200 --diffusion_samples 2 --max_parallel_samples 1 --seed 7 --num_workers 0 --preprocessing-threads 1 --output_format mmcif --write_full_pae
```

```sh
# R4: two input records
ariax forge run "$SESSION" --tool boltz2 --gpus 0 --command-id "$COMMAND_ID" --timeout-seconds 600 --json -- boltz predict /inputs/boltz2/complete/batch2 --out_dir /workspace/b33-complete/R4 --model boltz2 --cache /models/boltz2 --checkpoint /models/boltz2/boltz2_conf.ckpt --accelerator gpu --devices 1 --recycling_steps 3 --sampling_steps 200 --diffusion_samples 1 --max_parallel_samples 1 --seed 7 --num_workers 0 --preprocessing-threads 1 --output_format mmcif --write_full_pae
```

```sh
# A1: SMILES affinity
ariax forge run "$SESSION" --tool boltz2 --gpus 0 --command-id "$COMMAND_ID" --timeout-seconds 300 --json -- boltz predict /inputs/boltz2/affinity_smiles.yaml --out_dir /workspace/b33-complete/A1 --model boltz2 --cache /models/boltz2 --checkpoint /models/boltz2/boltz2_conf.ckpt --accelerator gpu --devices 1 --recycling_steps 3 --sampling_steps 200 --diffusion_samples 1 --max_parallel_samples 1 --seed 7 --num_workers 0 --preprocessing-threads 1 --output_format mmcif --write_full_pae --affinity_checkpoint /models/boltz2/boltz2_aff.ckpt --sampling_steps_affinity 200 --diffusion_samples_affinity 5
```

```sh
# A2: CCD affinity
ariax forge run "$SESSION" --tool boltz2 --gpus 0 --command-id "$COMMAND_ID" --timeout-seconds 300 --json -- boltz predict /inputs/boltz2/affinity_ccd.yaml --out_dir /workspace/b33-complete/A2 --model boltz2 --cache /models/boltz2 --checkpoint /models/boltz2/boltz2_conf.ckpt --accelerator gpu --devices 1 --recycling_steps 3 --sampling_steps 200 --diffusion_samples 1 --max_parallel_samples 1 --seed 7 --num_workers 0 --preprocessing-threads 1 --output_format mmcif --write_full_pae --affinity_checkpoint /models/boltz2/boltz2_aff.ckpt --sampling_steps_affinity 200 --diffusion_samples_affinity 5
```

Observe each retained command with `ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 600 --json` and read its logs. Check every result with check_modes.py and its exact registered input; require two ranks for R3 and one rank per R4 record. Use the installed boltz2-affinity-check consumer for both affinity JSON files, preserving all six native heads and atom mappings.
