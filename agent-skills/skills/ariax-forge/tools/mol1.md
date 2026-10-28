# Mol-1 molecular structure prediction

**Draft offering: native execution, installation and restoration are untested.**
This guide records the proposed Forge interface at upstream source
[`6ad1a133f919dc79b4f829bdc24fad28b9c4d3f0`](https://github.com/molence/Mol-1/tree/6ad1a133f919dc79b4f829bdc24fad28b9c4d3f0).
The initial candidate modes are `protein-monomer` and `ligand-ccd`, using
ubiquitin and ubiquitin plus CCD ATP respectively. Mol-1 was absent from the
live public catalog at the initial 2026-10-28 check. A bundled guide does not
establish account availability, qualified modes or a resource minimum. Inspect
the live catalog before selecting or spending on it.
The tool key and guide ID are `mol1`; `mol-1` is a guide alias only.

Mol-1 predicts the joint structure of specified proteins, DNA, RNA, ligands and
ions. Choose it when the requested experiment calls for this model's cofolding
method or a separately qualified comparison with other predictors. It predicts
supplied molecular identities, rather than generating binder sequences or
measuring affinity. Compare the actual qualified modes of [Boltz-2](boltz2.md),
[Protenix](protenix-models.md), [RF3](foundry.md) and
[OpenFold3/OpenBind](openfold3.md). Preserve an explicit model choice; similar
input schemas do not make their models, assets or scores interchangeable.

```sh
ariax forge catalog --task molecular-prediction --compact --json
ariax forge catalog --tool mol1 --json
ariax skills forge --tool mol1 --json
ariax skills forge --reference mol1 --read --json
ariax skills forge --reference mol1-inputs --read --json
ariax skills forge --reference mol1-outputs --read --json
```

## Interface, assets and scope

The initial interface uses the native module directly:

```text
python -m mol.runner.inference --input_json_path INPUT.json --dump_dir OUTPUT
```

It reads prepared JSON without invoking the protein MSA search preprocessing in
`mol pred`. Native `mol pred -i INPUT.json -o OUTPUT` remains an upstream
interface, but is not the initial Forge recipe: its default `--use_msa true`
can send protein sequences to the public ColabFold service when an MSA is
missing or its path does not exist. This guide does not authorize that service
or the `mol msa`/`mol prep` search commands. Keep templates and RNA MSA search
disabled. Supplied protein MSAs and explicit no-MSA inference are separate
experiments; see [input rules](mol1/inputs.md).

The proposed package separates two read-only named assets:

| Asset | Mount and content |
| --- | --- |
| `mol1-models` | `/models/mol1-models/checkpoint/mol-1-base.pt` |
| `mol1-chemical` | `/models/mol1-chemical/common/` with CCD definitions, RDKit conformers, PDB clusters and release metadata |

The prepared image configures `MOL_ROOT_DIR` to resolve these separate mounts;
keep its configured root and pass the checkpoint explicitly. Upstream normally
downloads missing default weights; the proposed image blocks that fallback.
An explicit absent checkpoint fails instead. Do not download weights
or reference data in a customer command, replace assets with another predictor's
files, or make `/models` writable. Missing assets are a tool-preparation failure.
The selected named asset/source identity and distribution terms must accompany
qualification; the reviewed source identifies a mutable public weight URL and
does not establish an explicit weight distribution license.

Disposable temporary, Python, Torch extension, Triton, CUDA and other JIT caches
belong under `/scratch`. Forge supplies `HOME=/workspace`; save inputs, commands,
logs, structures and confidence in `/workspace`. The small
[example runner](examples/mol1/run.py) sets those cache paths and uses the native
module without changing its scoring.
The final image, selected assets, kernel/runtime compatibility, measured memory,
per-mode science checks and fresh restoration remain pending remote evidence.
The two candidate modes remain untested. Broader multimer, ligand/ion,
nucleic-acid, modification, covalent, supplied-MSA, template and batch
capabilities in upstream source are **not qualified Forge modes** by virtue of
this guide. Training and fine-tuning are outside this recipe.

## Defaults and a bounded smoke

These are the pinned **direct runner** settings, not the short flags of
`mol pred`. Each option takes a value, including booleans. The fixture's default
profile preserves native sampling; disabling MSA changes conditioning, so it is
not the full upstream default experiment.

| Direct-runner option | Native default | Fixture default / smoke |
| --- | --- | --- |
| `--model_name` | `mol-1-base` | same / same |
| `--seeds` | `101` | same / same |
| `--model.N_cycle` | `20` | `20` / `20` |
| `--sample_diffusion.N_step` | `200` | `200` / `200` |
| `--sample_diffusion.N_sample` | `5` | `5` / `1` |
| `--dtype` | `bf16` | same / same |
| `--device` | `auto` | `cuda:0` / `cuda:0` |
| `--use_msa` | `true` | `false` / `false` |
| `--use_template`, `--use_rna_msa` | `false` | same / same |
| `--need_atom_confidence` | `false` | `true` / `true` to retain PAE and mappings |
| `--use_seeds_in_json` | `false` | same / same |
| `--enable_tf32` | `false` | same / same |
| `--triangle_multiplicative`, `--triangle_attention` | `cuequivariance` | same / same, subject to image qualification |
| `--infer_setting.sample_diffusion_chunk_size` | `1` | same / same |
| `--diffusion_cache_mode` | `full` | same / same |

The direct runner defaults to cuEquivariance; `mol pred` instead defaults to
`auto` for both kernels. Do not interchange those defaults silently. Upstream
changes precision by token count and forces FP32/Torch on compute capability
7.x; retain resolved settings and hardware with results. Explicit seeds do not
guarantee bitwise equality across kernels, devices or environments. Longer
sequences, atom-tokenized chemistry, more samples and more seeds need capacity
assessment. No Forge timing or VRAM floor has been measured. A reduced smoke
checks execution only and cannot support an accuracy or production-size claim.

## Stage and run

Read the [platform lifecycle](../SKILL.md) and [inputs/outputs flow](../outputs.md).
After live qualification and within existing compute authorization, choose a
compatible GPU and a bounded session. Creating a session starts billing;
preparation and idle time count toward its limit.

```sh
ariax pricing --json
ariax forge create --name mol1-pilot --gpu GPU --gpu-count 1 --tools mol1 --max-gpu-hours LIMIT --json
ariax forge status SESSION --json
ariax forge tools wait SESSION mol1 --timeout 1800 --json
```

Use the returned session UUID as `SESSION`. Set `EXAMPLES` to the installed
`data.examples.mol1` directory returned by `ariax skills forge --tool mol1 --json`.
Upload both required files; this exact fixture has no companion MSAs or structures.

```sh
ariax forge inputs add "$SESSION" --file "$EXAMPLES/monomer.json" --path mol1/monomer.json --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/run.py" --path mol1/run.py --json
ariax forge inputs status "$SESSION" JSON_INPUT_ID --json
ariax forge inputs status "$SESSION" RUNNER_INPUT_ID --json
```

Wait until **each** returned input is `ready` and the tool is `ready`. The
76-residue ubiquitin monomer is the initial protein candidate fixture. Use a
fresh directory; the runner refuses to reuse an existing one.

```sh
ariax forge run "$SESSION" --tool mol1 --gpus 0 --cwd /workspace --timeout-seconds 1800 --json -- \
  python /inputs/mol1/run.py --input /inputs/mol1/monomer.json \
  --out-dir /workspace/mol1/default-001 --profile default
ariax forge watch "$SESSION" COMMAND_ID --timeout 1800 --json
ariax forge command "$SESSION" COMMAND_ID --json
ariax forge logs "$SESSION" COMMAND_ID --tail 1000 --json
```

For an explicitly chosen reduced execution check, use the same invocation with
`--out-dir /workspace/mol1/smoke-001 --profile smoke`. This retains 20 cycles
and 200 steps and reduces only samples from five to one. The
[runner source](examples/mol1/run.py) shows all native argv and saves them with the result. The equivalent scientific
command for the default fixture is:

```sh
ariax forge run "$SESSION" --tool mol1 --gpus 0 --cwd /workspace --timeout-seconds 1800 --json -- \
  python -m mol.runner.inference \
  --input_json_path /inputs/mol1/monomer.json \
  --dump_dir /workspace/mol1/native-001 \
  --load_checkpoint_path /models/mol1-models/checkpoint/mol-1-base.pt \
  --model_name mol-1-base --device cuda:0 --seeds 101 \
  --model.N_cycle 20 --sample_diffusion.N_step 200 --sample_diffusion.N_sample 5 \
  --use_msa false --use_template false --use_rna_msa false \
  --need_atom_confidence true
```

This equivalent command relies on the prepared image's `/scratch` cache
configuration; prefer the example runner to retain full logs and provenance.
The platform `--gpus 0` reserves a GPU; native `cuda:0` addresses that container's
visible device. Multi-GPU throughput and concurrent workloads are unqualified.
Do not rerun after a lost response or a watch timeout: inspect the same command
ID first. A new intentional attempt needs a fresh output directory.

## Inspect, save and close

Check the terminal command state and exit code, then the
[output inventory and scientific checks](mol1/outputs.md). The default fixture
expects five CIF/summary/full-data triples under
`predictions/ubiquitin/seed_101/predictions/` inside its run directory; smoke
expects one. Preserve error reports and failed samples. A completed process or
high confidence score does not establish a correct fold or biological activity.

After all writers stop, inspect for symlinks/special files (checkpointing rejects
them), then complete and inspect the checkpoint before closing:

```sh
ariax forge run "$SESSION" --tool base -- sh -eu -c 'find /workspace/mol1 ! -type f ! -type d -print'
ariax forge sync "$SESSION" --wait --json
ariax forge checkpoint "$SESSION" CHECKPOINT_ID --json
ariax forge files "$SESSION" --checkpoint CHECKPOINT_ID --path /workspace/mol1 --json
ariax forge close "$SESSION" --json
ariax forge status "$SESSION" --json
```

Use the completed sync's checkpoint ID. Confirm `closed` for resource release
and inspect persistence separately. Download only required files within the
user's storage constraints. Restoration recovers saved files, not running model
state; verify a completed restore before choosing any new prediction.

Code, weights, chemical data and service terms are separate. Read the
[public provenance/terms notice](examples/mol1/NOTICE.md); repository Apache-2.0
licensing does not establish rights to separately hosted weights.
