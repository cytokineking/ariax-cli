# Native YAML inputs

Use `version: 1` YAML, one unique nonempty chain ID per physical copy. The native parser groups equal type/sequence entries, so put identical copies in `id: [A, B]` and ensure their modifications, cyclic state, and MSA agree. Distinct modifications of the same base sequence need separate validated jobs: this parser groups by type/sequence and uses the first item's modifications. Duplicate chain IDs can overwrite chains. Unknown protein/base characters can become unknown tokens; check rather than silently normalizing them.

| Entity | Required representation | Limits to preserve |
| --- | --- | --- |
| Protein | `protein: {id: A, sequence: …, msa: …}` | Uppercase residue sequence; explicit MSA policy. |
| DNA/RNA | `dna` or `rna` with `id`, `sequence` | Use the correct alphabet; no protein MSA generation. |
| Small molecule/cofactor/ion | `ligand` with `id` and exactly one `smiles` or `ccd` | Preserve charge, stereochemistry, tautomer, and atom identity. A CCD code must exist in the prepared molecule dictionary. |
| Modified polymer | `modifications: [{position: 3, ccd: MSE}]` | One-based positions in the supplied sequence, within its length, verified CCD. |
| Cyclic polymer | `cyclic: true` | Polymer only; do not apply to ligand entities. |

FASTA is deprecated and cannot express all YAML features. Do not use generic `>protein_A` headers or invented `--fasta`/`--output` flags.

## MSAs

For each protein choose a supplied `.a3m`, paired `.csv`, explicit `msa: empty`, or authorized generation. Paths are resolved in the command's working directory, not automatically relative to the YAML; use staged absolute VM paths. Verify the query sequence, alignment columns, and recorded sequence identity before launch. For multiple proteins use CSV with `key,sequence` columns when pairing information matters; matching keys associate rows across chains. Native `.a3m` parsing is supported, but an a3m alone does not preserve cross-chain pairing keys.

Omitting `msa` requests generation and fails preprocessing without `--use_msa_server`. That flag discloses sequences to the configured service (default `https://api.colabfold.com`); use it only within user scope. Custom and auto-generated MSAs cannot be mixed in one input. `msa: empty` is explicit single-sequence inference and can reduce accuracy; do not select it merely to solve an OOM or missing file. The native flags are switches: `--use_msa_server false` is invalid. Credentials belong in protected supported environment configuration, not recorded argv or evidence.

## Constraints and templates

Keep an explicit map from original chain/residue numbers (including insertion codes and any requested crop) to the YAML's one-based positions. Constraint indices are **not** original PDB numbering. The parser does not reliably reject zero or out-of-range polymer contact indices; validate them before running.

Examples below show syntax, not recommended interactions. Include only scientific constraints the user supplied or justified:

```yaml
constraints:
  - contact:
      token1: [A, 3]
      token2: [B, 5]
      max_distance: 6.0
      force: false
  - pocket:
      binder: B
      contacts: [[A, 3], [A, 4]]
      max_distance: 6.0
      force: false
```

Pocket binders may be protein, DNA, RNA, or ligand. Polymer contacts use residue positions; nonpolymer contacts use atom names, not a ligand residue number. The documented distance range is 4–20 Å, default 6 Å; do not assume parser acceptance validates that range. `force: true` applies enforcement potentials. `--use_potentials` additionally enables general physical guidance; neither constitutes independent evidence that the predicted interaction is real.

For a covalent bond, use `bond: {atom1: [A, 3, SG], atom2: [L, 1, C1]}` only after verifying actual atoms. Supported guidance here is canonical residues and CCD ligands, with ligand residue index 1; do not guess SMILES-generated atom names or chemical connectivity. Multi-residue CCD ligand lists are native structure inputs, but are excluded from this guide's affinity and interface handoff recipes.

Templates support protein chains with a staged `cif` or `pdb` path, optional `chain_id` (input chains) and `template_id` (template chains). Supply both lists with equal length for an explicit correspondence. Otherwise the native parser searches alignments, which must be inspected before interpreting the run. PDB template subchains can become `A1`, `A2`, `B1`, etc.; inspect actual parsed IDs rather than assuming `A`. Template `force: true` requires a `threshold` in Å. Retain the template bytes, sequence alignment, chain assignment, and any forced tolerance. A template is conditioning, not an independent prediction.

Advanced modified, cyclic, covalent, template, and mixed-polymer inputs are source-reviewed capabilities, not live-qualified examples. Validate their native preprocessing in the actual admitted version before spending on inference; this guide has no general chemical repair or structure-to-sequence adapter.

Source: [Boltz 2.2.1 parser](https://github.com/jwohlwend/boltz/blob/v2.2.1/src/boltz/data/parse/schema.py). Adapted from Forge archive `d8c0b040f553bf9e51a532cb4db693529f50cc70`. Keep the [current native command and complete model mount](../tools/boltz2.md).
