# Future native tool source index

Maintainers can recover scientific material for tool families absent from the
current Forge catalog here. This index provides no active command recipe.
Managed BoltzGen, PXDesign and ESMFold2 skills describe separate hosted APIs.
A managed capability does not establish a native Forge image or workflow.

## Durable archive

The complete former Forge collection is in the `cytokineking/ariax-cli` Git
archive, commit `d8c0b040f553bf9e51a532cb4db693529f50cc70`, tag
`archive/forge-20261001/forge-skills-final`. Paths below are relative to that
repository at this commit. Retrieve a file from a checkout that contains the
archive with ordinary Git, for example:

```sh
git show archive/forge-20261001/forge-skills-final:agent-skills/skills/ariax-forge-foundry/references/rf3.md
```

The original scientific explanations, examples, source URLs, license notices
and evaluation evidence remain there. Read `evaluation/forge-skills/<skill>/`
for each family's audit, cases and source inventory. Historical runtime
instructions in those files are obsolete. Adapt scientific content to the
current session/direct-argv contract, ordinary image tags and named shared
assets. Keep credentials outside workloads and use current checkpoint/closure
semantics. Do not transplant the old project/profile/generation API.

## Foundry

Archive root: `agent-skills/skills/ariax-forge-foundry/`. All six references
are useful independently:

| Reference under `references/` | Material to retain and recheck |
| --- | --- |
| `rfd3.md` | Dialect-2 specification; sampled contig and source→output register; fixed atoms versus mutable sequence; nonoverlapping indexed/unindexed motifs; paired final CIF/JSON |
| `rfd3na.md` | R/D/protein segment suffixes; chain breaks; input required by the inspected contig parser; genuine AMP conditioning example; explicit nucleotide identity |
| `rf3.md` | Exact component/template/MSA correspondence; early-stop rows without structures; same-seed/sample confidence pairing; actual output schema |
| `proteinmpnn.md` | Exactly one fixed/designed residue/chain selector; insertion-code IDs; config JSON replaces CLI configuration; sample count is batches × batch size; sequence/register verification |
| `ligandmpnn.md` | Retained ligand/ion/NA context with real atoms; fixed side-chain context; protein sequence design; likelihood-derived interface confidence |
| `solublempnn.md` | Native type remains `protein_mpnn` with soluble-trained weights and legacy loading; checkpoint choice defines the model |

The source reviewed there is Foundry `b02eed6a6bdf8f44d14a80cc36e3da13c9f2291c`.
`assets/AMP.pdb` and `assets/FOUNDRY-LICENSE.txt` preserve the conditioned
example and BSD-3-Clause attribution. The AMP example cannot stand in for
unconditional RNA design. MPNN cannot design RNA sequences.

RF3's inspected ranking is `0.8*ipTM + 0.2*pTM - 100*has_clash`, with pTM
substituted for missing single-chain ipTM. JSON and B-factor pLDDT use 0–1.
`token_res_ids` are zero-based token indices, and `chain_ptm` holds mean
chain pLDDT in that revision. A future interface adapter must establish the
actual token/register map. The archived tests do not qualify model inference
or full AtomWorks parsing. Build current images and complete model assets,
then qualify each requested native capability and its fixed-scope/output
checks remotely before exposing it in active discovery.

## Protenix

Archive root: `agent-skills/skills/ariax-forge-protenix/`. Preserve
`references/models.md`, `inputs.md`, `msa.md`, `templates.md`, `constraints.md`
and `outputs.md`, plus the small `assets/` cases and `scripts/check-input.py`.
They describe fork `b806d2540ab326d71edcc47128343e627248c099`.

Nine reviewed model names cover base v1, v2, the 2025-06-30 training cutoff,
base/constraint v0, mini/tiny, mini-ESM and mini-ISM. Model-specific checkpoints
and ESM/ISM companion files must be complete at readiness. Native CLI overrides
can win over model configuration; `use_default_params` changes cycles/steps
and mini-ESM/ISM MSA policy. Keep seeds and sample counts explicit.

Retain supplied protein/RNA MSA query and pairing identity. Grouped multi-chain
templates preserve cross-chain geometry; splitting them into separate entries
loses that conditioning. Explicit query/template indices are zero-based, and
the inspected resolver rejects them on grouped multi-chain entries. Templates
skip chains of four or fewer residues. Distinguish resolved features from an
accepted JSON schema and measure output pose retention.

Protenix exports `token_pair_pae`, 0–1 `atom_plddt`, `atom_to_token_idx`,
`token_asym_id` and `token_has_frame`. Those are not AF3 field semantics.
There is no current ipSAE adapter. Archive model inference was unqualified;
future work needs native model loads, representative inference, grouped-template
features, output identity checks and a separately checked downstream adapter.

## BoltzGen

Archive root: `agent-skills/skills/ariax-forge-boltzgen/`. Preserve
`references/inputs.md`, `protocols.md`, `execution.md` and `outputs.md`.
These cover scaffold and chemical identity, designed/fixed scope, sequence
multiplicity, diffusion count, final diversity budget, and step-dependent files.
The archived execute wrapper is broken on its configured path. Repair and
exercise the actual native entrypoint before issuing any execution recipe.

Final output uses timestamped `final_ranked_designs-*` directories. The filter
can select original/inverse-folded coordinates when refolds are missing, so
ranking membership does not establish refolding. Verify sequence, structure
stage and candidate IDs. Helicon chemistry and cyclic peptide scope require
separate checks. A runtime addition needs the actual image, all stage assets,
correct wrapper/argv and representative design→sequence→refold→selection
results, including a partial/failing-stage case.

## PXDesign

Archive root: `agent-skills/skills/ariax-forge-pxdesign/`. Preserve
`references/inputs.md`, `execution.md` and `outputs.md`: full-sequence/register
mapping, diffusion count, infer/preview/extended modes, predictor remapping,
per-run versus finalized snapshots, and model-dependent score units.

The native selector can fill a requested count with failed rows. Inspect
`pass_af2`, `pass_ptx`, success columns and bucket, retaining model disagreement.
Generation-only output has no evaluation promise. Finalization can write
`results`, then `results_v2`, `results_v3`; retain the selected snapshot.
Native target chains can become A0/B0 with binder last; downstream predictors
may remap them. Qualify complete diffusion and evaluation assets, each exposed
mode, partial results and failed-row ranking behavior before activation.

## ESMFold2 pipeline

Archive root: `agent-skills/skills/ariax-forge-esmfold2-pipeline/`. Preserve
`references/campaign.md`, `validation.md` and `results.md`: target author/label
maps, candidate/shard counts, critic versus independent validation, selection
criteria, conditioning and same-sample artifact joins.

The old companion asset supplied Protenix base v1 while validation planning
and preflight expected v2. Selecting base v1 alone did not fix that preflight.
Resolve the model/asset/interface agreement and verify integrated validation;
bypassing preflight or inventing an import command hides the missing evidence.
A separate prediction does not populate native campaign validation tables.

The validation builder assigns binder A and targets B onward. Retain the role
map, template conditioning, MSA policy, per-model validation reports and raw
confidence when available. A bounded shard run can finish while planned work
remains. Qualification must cover native campaign completeness, integrated
matching-model validation, ranking/exclusions and durable saved results.

## Activation evidence

Each future tool requires a configured image, complete named assets, inspected
native help/input interface, and representative remote execution with checked
scientific artifacts. Keep parser-only, synthetic, source-reviewed and live
results distinct. Add an active guide and discovery entry only for the scope
that this evidence supports; archive presence alone adds no supported tool.
