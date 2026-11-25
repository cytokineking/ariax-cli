# Managed project lifecycle

Use this reference with the selected protocol guide and live schema. See
[engine choice](engine-choice.md) to pick a protocol, [agent workflow](../SKILL.md)
for auth, and [recovery & support](recovery.md) for failures or lost replies.

## 1. Discover contract & prices

```sh
ariax protocols --json
ariax pricing --json
ariax schema PROTOCOL --json            # lean job schema (--details for full, --raw for JSON Schema)
```

All five managed protocols return compact output by default (`status`, `validate`,
`submit`, `candidates`, `projects`); follow `data.action.command` and add
`--details` only when full diagnostics/provenance are needed, or `--fields a,b`
to project JSON fields.

## 2. Prepare and validate inputs

Start from a [bundled example](examples.md) and reconcile with the live schema.
Never add `user_id` to job JSON; keep explicit user epitope constraints exact.

```sh
ariax inputs inspect --input ./target.pdb -f job.json --json   # compact; add --full for per-residue map
ariax inputs prepare --input ./target.pdb -f job.json --output ./prepared --json
ariax validate -f ./prepared/job.json --input ./prepared/input.pdb --json
```

- `inputs inspect`/`prepare` require no account; `--pdb ID` fetches RCSB directly.
- BindCraft2 multi-file bundles use `--input-dir DIR` instead of `--input FILE`.
- Validate and submit the prepared `job.json` and input copy together.
- Structure-backed BoltzGen and BindCraft2 require `--input` / `--input-dir` on
  both `validate` and `submit`. Direct uploads stream from the CLI to object
  storage via short-lived URLs (never through Ariax app servers).
- Request missing structures first and inspect sequence metadata before asking
  for a separate sequence. Supply unresolved full sequences in `sequence_by_chain`
  (PXDesign) or `protocol_config.target.sequences` (ESMFold2). Never invent
  missing residues or guess numbering across gaps.

| Protocol | Residue register |
| --- | --- |
| BindCraft v1.5 | PDB author chain/residue IDs; PDB input required |
| BindCraft2 | Native structure author chain/residue selectors; first target `input.pdb` or `input.cif` |
| BoltzGen | Canonical 1-based positions; mmCIF uses `label_asym_id` / `label_seq_id` |
| PXDesign | PDB author IDs (contiguous only); direct mmCIF requires matching selected author/label IDs |
| ESMFold2-pipeline | Author residue IDs; CLI normalizes mmCIF chains/atoms in the prepared copy |

## 3. Pricing and GPU policy

Check `ariax pricing --json` before choosing GPUs. `allowed_gpus` lists
alternatives for one allocation (not a GPU count); `priority_mode` orders them.
Only explicit `turbo_mode: true` with `turbo_multiples` (2, 4, or 8) requests
multi-GPU parallelism (never enable without user authorization; Turbo multiplies
hourly spend and does not pool VRAM for one complex).

Every effective policy must include at least one compatible **core GPU**:

| Protocol | Core GPU identifiers |
| --- | --- |
| BindCraft v1.5 / FreeBindCraft, BindCraft2, BoltzGen | `H100`, `A100_80GB`, `L40S`, `RTX6000PRO` |
| PXDesign | `H100`, `A100_80GB`, `L40S` (excludes Blackwell & `RTX6000PRO`) |
| ESMFold2-pipeline | `H100`, `A100_80GB`, `RTX6000PRO` (requires ≥80 GB VRAM) |

Supplemental classes (`A100_40GB`, `A6000`, `H200`, `B200`) alone do not meet
the core rule. `RTX6000PRO` is distinct from `RTX6000ADA` and `A6000`. Broaden
`allowed_gpus` across compatible classes within budget to improve availability;
update a paused project's policy with `ariax gpu-preferences PROJECT_ID -f prefs.json`.
Read `data.rates[].hourly_rate`, `standard_hourly_rate`, `promotion`, and
`quote_is_binding`; rates are per complete allocation-hour (do not multiply
Turbo allocation rates again). See [campaign forecasting](campaigns.md#forecast-from-observed-work).

## 4. Submit, monitor, and export

```sh
ariax submit -f ./prepared/job.json --input ./prepared/input.pdb --name my-run --wait
ariax status PROJECT_ID --json
ariax projects --json                          # summary default; add --details for full rows
ariax projects export PROJECT_ID -o job.json   # read-only config export (excludes stored inputs/MSAs)
```

Project names allow `[A-Za-z0-9-]` up to 27 chars. For interrupted waits, lost
replies, pause/restart/abort, or provisioning/job failures, see [recovery & support](recovery.md).

## 5. Results, candidates, and logs

```sh
ariax candidates PROJECT_ID --view final --json
ariax results PROJECT_ID --json
ariax results PROJECT_ID --download ./results          # auto-verifies checksums; rerun to resume
ariax results PROJECT_ID --path output/Trajectory --download ./results
ariax jobs --project PROJECT_ID --json
ariax logs JOB_ID --list
ariax logs JOB_ID --tail 200                           # up to 5000; add --log-ref PATH for worker logs
ariax runs PROJECT_ID --json                           # recorded settings per job (see recorded-settings.md)
```

- Check `project.design_count_source`: `project_counters` (BindCraft/BC2/ESMFold2)
  vs. `candidate_evidence` (BoltzGen/PXDesign).
- Use [candidates](candidates.md), [interpretation](interpretation.md), and each
  engine's `outputs.md` before ranking. `--eligible` is unsuitable for
  PXDesign/BoltzGen where eligibility may be `unknown`.
- `ariax logs` returns retained project compute logs only (never platform/API
  logs). Web project URL: `https://www.ariax.bio/projects/<engine>/<id>`.
- **Exit codes:** `0` ok, `1` usage, `2` auth, `3` forbidden, `4` not found,
  `5` validation, `6` payment, `7` conflict, `8` rate limit, `9` network/timeout,
  `10` server, `130` interrupted. Follow [safe scripted output](examples.md#safe-scripted-output).
