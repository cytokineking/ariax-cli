# Proteina-Complexa native co-design

The tool generates protein sequence and all-atom coordinates together. A supplied ligand keeps its chemical identity. Protein, ligand and atom-motif scaffolding use distinct checkpoint pairs. Shared model directories are read-only:

| Model | Checkpoints under `/models/proteina-complexa` | Conditioning |
| --- | --- | --- |
| Protein | `complexa.ckpt`, `complexa_ae.ckpt` | Existing protein target and native hotspots, v1 |
| Ligand | `complexa_ligand.ckpt`, `complexa_ligand_ae.ckpt` | Supplied ligand, v1, LoRA rank32/alpha64 |
| AME | `complexa_ame.ckpt`, `complexa_ame_ae.ckpt` | Atom motifs and complete ligand/metal context, v2, LoRA rank32/alpha64 |

RF3 uses `/models/foundry-rf3/rf3_foundry_01_24_latest_remapped.ckpt`. AF2 uses `/models/alphafold2`. These reuse the named shared assets. Credentials stay outside workloads.

## Prepare inputs

Find the installed example directory with `ariax skills forge --tool proteina-complexa --json`. Set `EXAMPLES` to its `data.examples["proteina-complexa"]` entry, which contains the original three PDB fixtures, `prepare-inputs.py` and `run-native.py`. Stage each file with:

```sh
ariax forge inputs add "$SESSION" --file "$EXAMPLES/PD-L1.pdb" --path proteina/PD-L1.pdb
```

Repeat for `7v11_ligand_centered.pdb`, `M0024_1nzy_v3.pdb`, `prepare-inputs.py` and `run-native.py`. Inspect each returned input ID with `ariax forge inputs status "$SESSION" INPUT_ID`; every file must be ready.

Run preparation inside the ready remote tool. It fetches the public RCSB CCD records and natural 1CTT/1TNF/1NZY structures, preserves original atom coordinates and names, and writes complete explicit chemistry under `/workspace/proteina-inputs`.

```sh
ariax forge run "$SESSION" --tool proteina-complexa --gpus 0 --timeout-seconds 600 -- \
  python3 /inputs/proteina/prepare-inputs.py \
  --fixtures /inputs/proteina --output /workspace/proteina-inputs
```

PD-L1 uses A1–115 and hotspots A37/A39/A49/A98. The alternate TNF profile uses native A12–157/B12–157/C12–157 and hotspots A113/C73. OQO retains all 38 original atoms, formal charges and CCD bonds. Complete AME uses the natural 1CTT chain-A protein with DHZ and Zn, retaining its coordinates. Its motif is A102 ND1/CG/CE1, A104 OE1/CD, A129 SG/CB and A132 SG/CB/CA. The preparation report records component identities, bonds and omissions.

The older M0024 BCA fixture has 53 observed atoms. O7A/O8A/O9A/P3D are absent from the supplied and deposited structures. Keep that observed subgraph distinct from complete DHZ/ZN chemistry. Do not synthesize missing coordinates.

## Run an explicit native command

Create a new working directory for each attempt. The example runner supplies ordinary native paths and overrides. It preserves 400 sampling steps, seed 5, eight CPUs, native checkpoint loaders and LoRA settings. It sets `AF2_DIR` and the AME v2 environment before native imports. It bounds CPU affinity and OpenMP/MKL pools to eight CPUs so JAX fits Forge’s container process limit on large hosts.

```sh
ariax forge run "$SESSION" --tool proteina-complexa --gpus 0 --timeout-seconds 60 -- \
  mkdir /workspace/protein-01
ariax forge run "$SESSION" --tool proteina-complexa --gpus 0 \
  --cwd /workspace/protein-01 --timeout-seconds 7200 -- \
  python3 /inputs/proteina/run-native.py --model protein \
  --algorithm single-pass --reward none --length 100 --run-name protein-01
```

Use `--model ligand --length 100` for OQO, or `--model ame --length 180` for DHZ/ZN motif scaffolding. Keep the working directory and run name unique. `--inputs PATH` selects another prepared directory; it must retain the same explicit input contract.

| Route | Runner arguments | Native settings |
| --- | --- | --- |
| Single pass | `--algorithm single-pass --reward none` | Unranked generation |
| Best of two | `--algorithm best-of-n --reward rf3` | Native two replicas |
| Beam search | `--algorithm beam-search --reward rf3` | Four branches/four beams, checkpoints 0/100/200/300/400 |
| FK steering | `--algorithm fk-steering --reward rf3` | Four branches/four particles, temperature 0.1 |
| MCTS | `--algorithm mcts --reward rf3` | Twenty simulations per checkpoint, exploration 0.5/constant 1 |
| Protein AF2 reward | `--algorithm single-pass --reward af2` | Native multimer, three recycles, original negative interface-PAE loss |
| Protein greedy refinement | `--algorithm single-pass --reward none --refine greedy` | Fifteen greedy iterations, 1% proposals, three recycles |
| Protein soft/hard/greedy | `--algorithm single-pass --reward none --refine soft` | Soft 45, hard 5, greedy 15, original loss weights and three recycles |

RF3 keeps seed 0, ten recycles, 50 diffusion steps and five complete samples per reward call. Its reward is `-min_ipAE/31`. Beam/FK each make 68 calls; MCTS makes 81. `search.max_batch_size=16` controls branch throughput while the target dataset stays batch 1. A slow search needs an adequate explicit command timeout and enough time under any optional session limit. Missing predictions or fallback zero rewards do not establish a successful search. Preserve the configured settings when comparing search methods.

The supported single-pass, unranked profile matrix covers protein/ligand lengths 32–256 and AME 64–256, baseline batch 4 with four samples, at most 64 supplied ligand heavy atoms and one/two AME chemical components. Multi-item runs use the original target and baseline length 100 for protein/ligand or 180 for AME. RF3 searches use one baseline target, samples 1 and batch 1. AF2 reward and refinement use a single 100-residue PD-L1 binder; refinement runs separately from reward scoring. Protein complexes stay at most 512 residues. `--tnf --model protein --length 32` selects the alternate target; its 438 target residues bound binder length to 74. Resource admission follows the selected catalog record. Wider inputs remain outside the supported profile matrix. Ligand/AME TMOL and ligand-complex AF2 reward/refinement are unsupported.

Plan for one GPU with 24 GiB VRAM, 48 GiB host RAM, 16 CPU cores and 100 GiB disk for these profiles. Measurements used L40 GPUs with a 16-CPU quota and 48 GiB container limit; observed peaks were 14.1 GiB GPU memory and 12.4 GiB container RAM. These allowances include headroom, and smaller hardware has not been established. Check `ariax forge catalog --tool proteina-complexa --json` for availability, model IDs and resource admission.

## Explicit ligand RF3 evaluation

The same image also exposes `rf3 fold`. After a completed ligand run, evaluate its actual complex path while retaining the ligand chain. This explicit route uses seed7, ten recycles,200 steps and one sample, distinct from the coupled search defaults.

```sh
ariax forge run "$SESSION" --tool proteina-complexa --gpus 0 --timeout-seconds 1800 -- \
  env OMP_NUM_THREADS=8 MKL_NUM_THREADS=8 rf3 fold \
  inputs=/workspace/ligand-01/inference/search_ligand_binder_local_pipeline_39_7V11_LIGAND_ligand-01/job_0_n_100_id_0_single_orig0/job_0_n_100_id_0_single_orig0.pdb \
  out_dir=/workspace/ligand-rf3-01 \
  ckpt_path=/models/foundry-rf3/rf3_foundry_01_24_latest_remapped.ckpt \
  seed=7 n_recycles=10 diffusion_batch_size=1 num_steps=200 \
  skip_existing=False early_stopping_plddt_threshold=0 \
  'ground_truth_conformer_selection=[A]'
```

Keep its complete confidence arrays, native ranking, paired CIF and token/atom mapping. The separate RF3 tool also exposes two preprint checkpoints; this Proteina profile uses the latest checkpoint.

## Inspect and retain results

Native `inference/` directories contain generated structures, reward CSVs, timings and original prediction/conditioning NPZ arrays. Hydra logs retain resolved settings. Preserve the supplied chemistry, atom names and component graph alongside PDB exports, which cannot carry all chemical information. Native centering changes global coordinates; compare relative geometry and the retained transform.

RF3 retains every sample CIF, ranking and full confidence/token-to-atom arrays. Its pLDDT is 0–1 and PAE is in Å. `chain_ptm` in this source is mean chain pLDDT. Canonical CIF `Cl` and native annotation `CL` identify chlorine; keep both raw fields. AF2 exports actual native confidence/loss arrays and optimization logs. Refinement retains the unrefined final alongside the selected structure. An exit code of zero can accompany a caught refinement failure; inspect the optimization log and required outputs before treating refinement as complete.

After a rewarded run, native filtering can select the highest-scoring candidate. The following path assumes a protein AF2 run named `protein-ranked-01`:

```sh
ariax forge run "$SESSION" --tool proteina-complexa --gpus 0 --timeout-seconds 300 -- \
  complexa filter /opt/complexa/configs/search_binder_local_pipeline.yaml \
  ++root_path=/workspace/protein-ranked-01/inference/search_binder_local_pipeline_02_PDL1_protein-ranked-01 \
  ++generation.filter.filter_samples_limit=1 ++generation.filter.delete_non_top_n_samples=false
```

Use the actual completed inference directory and matching protein/ligand/AME pipeline. Keep rejected designs and failures. Fold confidence and generated geometry supply no experimental affinity or hit-rate claim.

For an interrupted campaign, retain completed items and the cancelled command. Create a new directory and issue a new explicit command for unfinished work. Restoration never reruns science. Save original inputs, outputs, arrays and failures with `ariax forge sync "$SESSION" --wait`, verify the flush completed and then close. Use [saved results](../outputs.md) for current project links and [project controls](../SKILL.md#project-controls-and-resume) for human pause and same-project resume.
