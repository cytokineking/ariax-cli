# Forge Protenix model choices

Use Protenix for protein, chemical and nucleic-acid structure prediction.
The package uses the Ariax template-enabled Protenix fork, version `2.0.0`.
Choose a checkpoint explicitly: model features and native defaults differ.

`protenix-models` provides eight checkpoint choices; `protenix-v2` is a separate
tool with bounded internal-development coverage. V2 customer/public
redistribution and production delivery remain outside that scope. Tool
availability follows the selected session's catalog; all nine model identities
stay distinct.

| Exact choice | Native defaults: cycles / steps | Additional native features |
| --- | --- | --- |
| `protenix-v2` | 10 / 200 | Protein/chemical/nucleic; supplied protein/RNA MSA; templates; sequential batch |
| `protenix_base_default_v1.0.0` | 10 / 200 | Supplied protein/RNA MSA and direct templates |
| `protenix_base_20250630_v1.0.0` | 10 / 200 | Supplied protein/RNA MSA and direct templates |
| `protenix_base_default_v0.5.0` | 10 / 200 | Supplied protein MSA |
| `protenix_base_constraint_v0.5.0` | 10 / 200 | Protein MSA, pocket, token/atom contacts and substructure; native checkpoint has no ESM projection |
| `protenix_mini_default_v0.5.0` | 4 / 5 | Supplied protein MSA |
| `protenix_tiny_default_v0.5.0` | 4 / 5 | Supplied protein MSA |
| `protenix_mini_esm_v0.5.0` | 4 / 5 | ESM2-3B; no MSA by default; supplied MSA is explicit |
| `protenix_mini_ism_v0.5.0` | 4 / 5 | Distinct ISM ESM2-3B; no MSA by default; supplied MSA is explicit |

The examples demonstrate execution and molecular identity, not binding,
specificity, accuracy across new inputs or a design hit rate. Larger base-model
examples use reduced 3-cycle/20-step settings; the 51-residue insulin example
uses native defaults. Mini/tiny keep native 4/5 defaults. Capacity for broader
or large default-setting workloads remains unverified. The admission profile
is one GPU with 48 GiB VRAM, eight CPUs and 250 GiB disk, with no fixed RAM
floor; capacity coverage is limited to H100 PCIe. Native commands use eight
CPU threads. Same-seed reruns can differ; deterministic predictions are not
established.

## Prepare and run

The eight-model tool mounts `protenix-models` at `/models/protenix-models` and `protenix-chemical` at `/models/protenix-chemical`, both read-only. The separate v2 tool mounts `protenix-v2` at the same model path. Images contain no weights. Native loading is strict and requires CUDA. Preparation downloads a complete named asset before readiness; scientific commands do not download, replace or fall back to other weights. Scratch must be writable by UID 10001 and permit native compiled CUDA modules to load.

Use an authorized session whose live catalog has admitted the chosen tool. Preserve human holds and project identity.

```sh
ariax forge tools add "$SESSION" --tools protenix-models --json
ariax forge tools wait "$SESSION" protenix-models --timeout 1800 --json
ariax forge status "$SESSION" --json
ariax forge run "$SESSION" --tool protenix-models --timeout-seconds 3600 --json -- forge-protenix --model_name protenix_base_default_v1.0.0 --input_json_path /opt/forge-protenix-fixtures/consumer-complex.json --dump_dir /workspace/protenix/insulin-01 --use_msa false --sample_diffusion.N_sample 1 --seeds 101 --need_atom_confidence true
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 3600 --json
ariax forge logs "$SESSION" "$COMMAND_ID" --tail 1000 --json
ariax forge run "$SESSION" --tool protenix-models --timeout-seconds 120 --json -- python /opt/forge-protenix-check.py /opt/forge-protenix-fixtures/consumer-complex.json /workspace/protenix/insulin-01
ariax forge run "$SESSION" --tool protenix-models --timeout-seconds 120 --json -- python /opt/forge-protenix-handoff.py /opt/forge-protenix-fixtures/consumer-complex.json /workspace/protenix/insulin-01 --run-id "$COMMAND_ID"
```

Set `COMMAND_ID` from the prediction response and inspect each check/export command. Use a fresh output directory when settings or inputs change. Watch timeouts leave the remote operation running; observe its ID and never replay automatically. `forge-protenix` passes native configuration flags to `runner.inference`; use `protenix pred --help` for the native CLI help surface.

Upload user JSON and supporting files through `ariax forge inputs add`, require their input state `ready`, and use the returned `/inputs` paths. [Package examples](protenix-models/README.md) retain explicit chain identities. Supplied protein A3Ms use `pairedMsaPath`/`unpairedMsaPath` with `--use_msa true`. RNA MSA adds `--use_rna_msa true`; direct templates add `--use_template true` and exact chain/residue mappings. Uploaded copies must rewrite their fixture MSA/template paths. External search belongs to the selected public/custom service and its limits. Grouped template correspondence and explicit batch continuation are described below.

## Substructure priors

Only `protenix_base_constraint_v0.5.0` accepts constraints. Its `constraint.structure.tokens` list names at least two token centre atoms with positive 1-based `entity`, `copy` and `position`, an `atom` name and a finite three-number `coordinate`. Duplicate, missing and non-centre selectors fail. Protein centres use CA; other molecular centres must match the actual tokenizer. The full [substructure fixture](protenix-models/substructure.json) preserves fifteen CA coordinates from the pinned 2LWU example.

```json
"constraint": {"structure": {"tokens": [
  {"entity": 1, "copy": 1, "position": 1, "atom": "CA", "coordinate": [0.0, 0.0, 0.0]},
  {"entity": 1, "copy": 1, "position": 5, "atom": "CA", "coordinate": [8.1, 0.0, 0.0]}
]}}
```

These are soft binned distance features, preserving the native training builder's 4, 8 and 16 Å boundaries and inactive distances below 4 Å. They do not fix absolute coordinates. The native report compares features to the unchanged native builder and measures predicted pair distances against the original coordinates. Pocket and contact priors likewise require actual output geometry inspection.

## Preserve results and confidence

The insulin case writes CIF, native summary/full-data JSON and `insulin_raw_full_data_sample_0.json` under `insulin/seed_101/predictions/`, plus exact model/settings/resource data at the run root. The raw sidecar retains unrounded native confidence, atom coordinates and polymer flags; the original upstream full-data file keeps its native two-decimal formatting. Summary `ptm`/`iptm` use 0–1, summary `plddt` uses 0–100, raw `atom_plddt` uses 0–1 and `token_pair_pae` uses Å. CIF B-factors scale pLDDT by 100 and round to two decimals. Original rounded full-data pLDDT can differ from the CIF by about 0.5 points on the 0–100 scale.

Set the handoff run ID to the actual prediction command ID or attempt identity. Preserve `token_asym_id`, `atom_to_token_idx`, actual CIF atom order and exact model, seed and sample. Protein/nucleotide residue tokens and chemical atom tokens have different units. `ranking_score` includes clash/disorder terms and is not restricted to 0–1. The exported `*_handoff_sample_0.json` uses the `interface-scores-v1` format and points to the unrounded sidecar. Native atom-contact expansion can split protein residues into several tokens. Those samples retain native arrays and an explicit unavailable handoff because the interface scoring adapter currently requires one token per residue. Keep unavailable metrics explicit.

The checker requires all requested items/seeds/samples, finite structures, polymer/chemical identities, confidence shapes and atom/token/chain mappings, and rejects retained native error files. A zero prediction exit alone is insufficient. Keep original failed attempts beside corrected runs.

After commands are terminal, flush actual outputs to the project workspace. Restoration recovers saved files and never reruns predictions.

Set `PROJECT` to the session's returned `project_id`.

```sh
ariax forge sync "$SESSION" --wait --timeout 1800 --json
ariax forge files "$PROJECT" --path /workspace/protenix/insulin-01 --json
ariax forge close "$SESSION" --json
ariax forge status "$SESSION" --json
```

Require confirmed compute/resource release before reporting the session closed. Restore project-local environments explicitly in scratch and preserve the shared human controls.

## Direct templates and explicit batch continuation

The package keeps native inference and provides `python /opt/forge-protenix-batch.py`.
Use it through a selected session whose catalog admits the template-capable tool.
Grouped PDB/minimal-CIF inputs cover feature correspondence and prediction;
grouped full-CIF coverage is limited to feature generation. The examples use
3-cycle/20-step settings and native soft-prior interpretation.

Task-level `templates` accept a direct `pdb` or `cif` path. A `.mmcif` path also uses `cif`.
`chain_id` names target chains; `template_id` names source **author** chains in the same order.
Put chains that share a coordinate frame in one template entry. Separate entries encode
independent templates and do not preserve an inter-chain pose. PDB chain IDs are one character;
mmCIF author chain IDs can be longer and differ from label IDs.

For deliberate correspondence, use `residueMappings` with one entry for every selected target
chain. Both arrays contain strict zero-based sequence indices, never author residue numbers.
Full mmCIF metadata retains missing polymer residues as masked slots; PDB and minimal mmCIF
indices enumerate observed protein residues, including insertion-coded residues. Author numbers
and insertion codes remain available in the source mapping and the native template audit. Query
insertions or omitted correspondence stay masked. The native prediction CIF uses its own target
chain/residue numbering; save the input and source file to retain author correspondence.

```json
"templates": [{
  "cif": "/inputs/complex.cif",
  "chain_id": ["A", "B"],
  "template_id": ["Author_alpha", "Author_beta"],
  "residueMappings": {
    "A": {"queryIndices": [0, 1, 3], "templateIndices": [0, 1, 2]},
    "B": {"queryIndices": [0, 1, 3], "templateIndices": [0, 1, 2]}
  }
}]
```

Without explicit arrays, the native global alignment resolves residue correspondence. Explicit
arrays are preferable for repeated sequences or intentional gaps. Ambiguous chain selection,
duplicate chains/indices, fractional/out-of-range indices, absent source chains, and incomplete
group mappings fail with a concrete error. A flat `queryIndices`/`templateIndices` mapping is
supported for one chain pair. Protein templates are supported by the two public v1 choices;
the constraint checkpoint accepts its native soft priors instead. V2 template
use remains within its bounded internal-development scope.

The shipped `grouped-pdb.json`, `grouped-cif.json` and `grouped-full-cif.json` examples include
a query insertion, absent source residue, author insertion code and explicit two-chain correspondence.
Their diagnostic geometry duplicates the first 2LWU model with a translation; it is a parser/mask
fixture, not a measured biological complex. Inspect native correspondence, masks and output geometry:

```sh
ariax forge run "$SESSION" --tool protenix-models --gpus 0 --timeout-seconds 120 --json -- python /opt/forge-protenix-templates.py /opt/forge-protenix-fixtures/grouped-cif.json --cif /workspace/result/grouped_cif/seed_101/predictions/grouped_cif_sample_0.cif
```

A native task-list JSON is the batch input. Each item runs the unchanged runner and accepted
output checker, with its own input, command, log, native settings/confidence and attempt directory.
Failures retain their files and outcome. Cancellation records an interrupted item when possible;
a killed runner's `running` item is retained as interrupted on its next selected continuation.
`--max-items` deliberately leaves later items pending. Read `batch.json` to distinguish partial
completion from an all-success result. Successful items are skipped and their records/files stay
untouched. Continuation requires explicit item names and unchanged input/model/settings.

```sh
ariax forge run "$SESSION" --tool protenix-models --timeout-seconds 3600 --json -- python /opt/forge-protenix-batch.py --input /opt/forge-protenix-fixtures/template-batch.json --output /workspace/protenix/template-batch --model protenix_base_default_v1.0.0 --cycles 3 --steps 20 --seeds 101 --samples 1 --use-template --max-items 1
ariax forge sync "$SESSION" --wait --timeout 1800 --json
ariax forge files "$PROJECT" --path /workspace/protenix/template-batch --json
```

After cancellation, wait for the command to be terminal before saving. Use the accepted project
Files restore flow to restore the selected input/support files and full output directory at their
original workspace paths. Restore never runs science. Continue only the chosen unfinished work:

```sh
ariax forge run "$RESTORED_SESSION" --tool protenix-models --timeout-seconds 3600 --json -- python /opt/forge-protenix-batch.py --input /opt/forge-protenix-fixtures/template-batch.json --output /workspace/protenix/template-batch --model protenix_base_default_v1.0.0 --cycles 3 --steps 20 --seeds 101 --samples 1 --use-template --continue --items grouped_cif
```

Keep supporting templates/MSAs at the saved paths. Relative paths in the input are anchored to
its directory; per-chain `templatesPath` JSON may use absolute supporting paths. Restore all
successful files before continuing. The batch is sequential and obeys the existing command GPU
reservation, timeout and human controls. It adds no automatic replay or session lifecycle.

For later design pipelines, use the existing `/opt/forge-protenix-handoff.py` on a successful
attempt's `input.json` and `native` directory. Set `--run-id` to its original command ID plus
item/attempt identity. This retains native confidence and the scoring adapter's availability boundary. Template
and substructure geometry remains a soft prior; preserve the reported deviations.

Use [saved results](../outputs.md) for current project `forge link` paths,
and [project controls](../SKILL.md#project-controls-and-resume) for human
pause and same-project resume. **Resume workspace** starts a same-project
session; inspect and use it. **Allow agent to resume later** leaves compute
stopped until an authorized agent resume. Never automatically replay science.

## V2 standalone example

The standalone examples contain a 76-residue monomer, the same protein with
ATP/MG, and RNA8/DNA8 with a supplied query-only RNA MSA. They use native
10-cycle/200-step defaults, seed 101 and one sample per task. Query-only MSA
input contains no searched homologs. These small examples do not establish
broader capacity or throughput. The admission floor remains GPU48 GiB/CPU8/
disk250 GiB, with no fixed RAM floor.

Use the separate v2 tool and model asset when admitted by the live catalog.
The image's two-item input contains the existing 76-residue monomer and
protein/ATP/MG examples. Omitting cycle/step flags retains native defaults:

```sh
ariax forge tools add "$SESSION" --tools protenix-v2 --json
ariax forge tools wait "$SESSION" protenix-v2 --timeout 1800 --json
ariax forge run "$SESSION" --tool protenix-v2 --timeout-seconds 3600 --json -- python /opt/forge-protenix-batch.py --input /opt/forge-protenix-fixtures/v2-small-batch.json --output /workspace/protenix/v2-small-01 --model protenix-v2 --seeds 101 --samples 1
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 3600 --json
ariax forge logs "$SESSION" "$COMMAND_ID" --tail 1000 --json
ariax forge run "$SESSION" --tool protenix-v2 --timeout-seconds 120 --json -- python /opt/forge-protenix-confidence.py /workspace/protenix/v2-small-01/item-0000/attempt-001/input.json /workspace/protenix/v2-small-01/item-0000/attempt-001/native
ariax forge run "$SESSION" --tool protenix-v2 --timeout-seconds 120 --json -- python /opt/forge-protenix-confidence.py /workspace/protenix/v2-small-01/item-0001/attempt-001/input.json /workspace/protenix/v2-small-01/item-0001/attempt-001/native
ariax forge run "$SESSION" --tool protenix-v2 --timeout-seconds 3600 --json -- python /opt/forge-protenix-batch.py --input /opt/forge-protenix-fixtures/rna-msa.json --output /workspace/protenix/v2-rna-01 --model protenix-v2 --seeds 101 --samples 1 --use-msa --use-rna-msa
ariax forge watch "$SESSION" "$COMMAND_ID" --timeout 3600 --json
ariax forge logs "$SESSION" "$COMMAND_ID" --tail 1000 --json
ariax forge run "$SESSION" --tool protenix-v2 --timeout-seconds 120 --json -- python /opt/forge-protenix-confidence.py /workspace/protenix/v2-rna-01/item-0000/attempt-001/input.json /workspace/protenix/v2-rna-01/item-0000/attempt-001/native
```

Capture each prediction command ID before watching or submitting readback.
The batch adapter applies the molecular identity checker per successful item
and preserves failed attempts. Inspect batch.json for two successes in the first
run and one in the RNA/DNA run. Save the full input/support/result directories
and check saved outputs after restoration without prediction replay.
v2 uses the same shared chemical bundle at `/models/protenix-chemical`, with no
ESM/ISM companion. Supplied MSA and direct/grouped template inputs keep the
explicit identities and supporting-file paths described above. Retain their
native arrays and measured soft-prior deviations through the complete Files save
and same-project restore flow.
