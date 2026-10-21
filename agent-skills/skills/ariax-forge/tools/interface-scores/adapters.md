# Explicit sample handoff v1

`interface-scores HANDOFF.json --output RESULT.json [--pae-cutoff 10]` reads
one matched prediction sample. AF3 input is unsupported. All input files are preserved. Output is
published by a completed temporary write and atomic move. Invalid input exits
one without overwriting an existing result; an output path cannot replace a
declared original input. An unavailable score is a successful, labeled
scientific outcome, not a fabricated numeric zero.

The [fixtures](../examples/interface-scores/README.md) show each complete format.
Handoff JSON contains:

| Field | Meaning |
| --- | --- |
| `schema` | `interface-scores-v1` |
| `predictor` | `af2`, `boltz2`, `protenix`, `rf3`, `opendde`, `openfold3` |
| `run_id`, `input_id`, `model`, `seed` | Original prediction identity and model choice |
| `sample` | `record_id` plus nonnegative `index`; Boltz uses `rank` because native filenames use confidence rank |
| `pae_units`, `plddt_scale` | `angstrom`; `0-100` for AF2/OpenFold3, `0-1` for Boltz/Protenix/RF3/OpenDDE |
| `files` | Explicit role-to-path mapping; paths relative to handoff or absolute inside the workload |
| `selected_chains`, `sequences` | Distinct structure chain labels and exact selected standard-protein sequences |
| `mapping.tokens` | One entry per native PAE token, in native array order; each entry has `chain`, integer `residue`, `name`, optional `insertion`; `null` explicitly excludes a chemical token |
| `mapping.atoms` | Atom-confidence order, with `chain`, `residue`, `name`, `insertion`, `atom`; required when atom pLDDT is supplied |

Every mapped residue must exist in the structure. Every selected residue must
map to exactly one token and have a CA. mmCIF uses label chain/sequence IDs;
PDB uses its chain, residue and insertion code. Gemmi parses mmCIF quoting and
field ordering. Atom confidence uses array positions and the explicit atom
identity list, never atom serial minus one. Alternative conformers or multiple
models are rejected. Noncontiguous atom serials, repeated residue numbers in
different chains, insertion codes, unsorted chain names and permuted tokens
are supported through the explicit map.

Do not generate a token map merely from matching array dimensions. Obtain it
from the original predictor tokenization/processed record and preserve its
derivation beside the raw outputs. This adapter validates internal consistency;
caller-supplied lineage cannot prove that files came from the stated model,
run or seed. The selected score result retains file paths, exact sample identity,
CA/contact atom indices and PAE token indices for every selected residue.

| Engine | Native input roles and additional mapping |
| --- | --- |
| AF2 | `structure` PDB/CIF and `confidence` JSON: `pae` or `predicted_aligned_error`, residue `plddt`; optional complex `iptm`. No pickle. Explicit token map supplies original residue order. |
| Boltz-2 | `structure`, optional `pae` NPZ key `pae`, optional `plddt` NPZ key `plddt`, optional `summary` JSON. Native matched `<record>_model_<rank>.cif`, `pae_...npz`, `plddt_...npz`, `confidence_...json` basenames are checked. `mapping.chain_indices` maps labels to original output asym indices, without sorting or renumbering; `pair_chains_iptm` retains both directions. |
| Protenix | `confidence` full-data JSON: `token_pair_pae`, `atom_plddt`, `atom_to_token_idx`, `token_asym_id`. `mapping.chain_indices` and `mapping.token_asym_id` retain native integer asym IDs. Every mapped atom and selected CA is checked against its token/residue. |
| RF3 | `confidence` JSON: `pae`, `atom_plddts`, `atom_chain_ids`, `token_chain_ids`, `token_res_ids`. `mapping.chain_iids` maps structure labels to native string chain iids such as `A_1`. `mapping.token_chain_ids` preserves those iids. `mapping.token_res_ids` must equal global zero-based token indices; these are not structure residue numbers. Atom pLDDT is 0-1. |

RF3/OpenFold3 native token identity fields are required when PAE is supplied. Native
atom chain fields, when supplied, must agree with the explicit structure map.
For an optional `chain_pair_iptm` summary, `mapping.summary_chain_order`
records original matrix order. A complex-only summary `iptm` is labeled
`scope: complex`, and is never called a pair ipTM. Missing imported ipTM is
null with `missing_predictor_iptm`. RF3 source emits a complex ipTM, not a
pair ipTM. Do not convert its pair PAE/PDE fields to ipTM.

The RF3 source reference is Foundry
`94c78ab125c6ef2cc7d1226de86d1bd578bf8bee`,
[`predicted_error.py`](https://github.com/RosettaCommons/foundry/blob/94c78ab125c6ef2cc7d1226de86d1bd578bf8bee/models/rf3/src/rf3/utils/predicted_error.py).
Protenix source context is Ariax fork
`b806d2540ab326d71edcc47128343e627248c099`,
[`confidence.py`](https://github.com/cytokineking/Protenix/blob/b806d2540ab326d71edcc47128343e627248c099/protenix/model/sample_confidence.py).
Boltz context is 2.2.1. The retained B11 Boltz output passed local consumer
acceptance using native processed records, without sorting chain labels or
deriving identity from shape. See the local acceptance procedure.
B31's supplied actual AF2 monomer/insulin handoffs also passed local consumption.
Their native Protein token sidecars establish the 76 and 21+30 residue axes;
native PDB/rounded JSON confidence agree. Native confidence rank 5 remains
distinct from sample index 0 in the retained handoffs. All three offered RF3 choices passed native consumption. Eight accepted B29 Protenix choices passed 928 native v3 comparisons.


The score definitions are Roland Dunbrack's retained ipSAE v3 protein
definitions. ipSAE averages the PAE kernel strictly below the user cutoff
with row-specific protein d0, then takes the maximum reference row. LIS
uses PAE <=12 A without a contact filter. Docking scores use CB, or glycine CA,
at <=8 A. Atom-based predictors use the contact atom's pLDDT, not its CA or
mean over all atoms. pDockQ can run without PAE; ipSAE/LIS can run without
pLDDT or CB; pDockQ2 requires both. Missing data yields null with a reason;
malformed/nonfinite data is rejected. Genuine no qualifying PAE/contact pairs
produces a defined zero. A monomer has no pairs and reports
`no_protein_interface` for all four metrics.

Output includes both ordered pair directions, labeled unordered aggregates
and per-reference-residue ipSAE values. No universal combined score or
automatic sample selection is provided. The native positional v3 command
continues to write its original text/by-residue/PyMOL files. Array adapter
results are a distinct JSON format.

## Export native RF3 identities

On the CPU scorer image, run the owned native exporter explicitly:

```sh
python /opt/interface-scores/native_handoff.py REQUEST.json --output HANDOFF.json
interface-scores HANDOFF.json --output RESULT.json --pae-cutoff 10
```

The request supplies `predictor`, `run_id`, `input_id`, `model`, `seed`, `sample`,
`input_sequences` and `files` (`structure`, `confidence`, optional `summary`).
Paths are relative to the request or absolute inside the workload. This exporter
supports complete standard-protein samples only. It rejects mixed/modified
protein samples; an explicitly prepared v1 map can exclude other chemical tokens
when every selected protein chain meets the scoring contract. All originals are
preserved. It exports files and identities without launching inference.

RF3 export requires the accepted Foundry native-mapping annotations:
`atom_token_ids`, `atom_res_ids`, `atom_res_names`, `atom_names`. It checks them
against the original mmCIF atom order, maps native string chain iids to labels, and keeps
global zero-based token IDs and original 0–1 atom pLDDT. The native summary
`chain_ptm` is retained as mean chain pLDDT on 0–1, with its original chain order;
it is never interpreted as per-chain pTM. The scorer exposes that meaning under
`native_confidence`.

The unchanged positional v3 reference accepts the common atom-confidence dialect. For
RF3 comparisons only, a clearly labeled derived JSON multiplies native atom
pLDDT by 100 and copies PAE unchanged; raw RF3 files remain untouched. The reference copy changes only
`_atom_site.id` to one-based atom positions
for v3, which reads confidence at atom ID minus one. Every coordinate and atom
identity remains exactly equal to the original; raw RF3 IDs stay untouched. RF3 complex ipTM is excluded from pair-ipTM comparison.
Reference tolerances remain half the last printed v3 digit: 0.0000005 for pair
ipSAE, 0.00005 for pDockQ/pDockQ2/LIS and per-residue ipSAE, 0.0005 for per-residue d0.


The eight accepted native-default Protenix insulin A/B handoffs passed direct
v3 comparison (928 checks). For the reference dialect only, native
`token_pair_pae` is copied as `pae`, native `atom_plddt` is multiplied by 100
and named `atom_plddts`, and the original `chain_pair_iptm` matrix is copied
with its A, B, ... order. Original coordinates are byte-identical copies.
The helper rejects a different summary order rather than remapping it for v3.
Raw inputs and scientific scoring definitions stay unchanged. The native
atom-contact expansion with several tokens per residue remains explicitly
unavailable; no residue aggregation is supported. The recorded consumer comparisons cover the eight accepted checkpoints. B35q qualified
OpenDDE general/ABAG and OpenBind-0/Preview2 consumers separately.


## OpenDDE and supported OpenFold3 handoffs

OpenDDE uses the accepted B40 exporter and original `token_pair_pae`,
`atom_plddt`, `atom_to_token_idx` and `token_asym_id`. Keep `native_identity`
and `original_input` in `files`; both are required for direct correspondence
checks. Models are exactly `opendde_v1:general` and `opendde_v1:abag`.
`sample.index` is native diffusion order; `lineage.native_filename_rank` retains
the separate sorted filename rank. No model prediction is required to export
or score retained output. Both choices retain their preview designation.

OpenFold3 consumes the B41 handoff and its `native_files.confidence` JSON,
without loading feature PT/pickle files. Native `plddt` must equal exported
`atom_plddts`; PAE must agree exactly. Retain the original native token index,
asym/residue identity, atom-to-token membership and native atom identity.
Accepted engine/checkpoint pairs are OpenBind-0 0.5.0 with
`of3-ob-2025-06-30-174k.pt` and Preview2 0.4.3 with `of3-p2-155k.pt`.
The sample index is one-based generation order, and rank stays null.
Preview1 remains excluded after its retained peptide geometry failure.

For both predictors, score only complete standard protein chains with one
token per residue. Preserve chemical rows and exclude their tokens explicitly;
a split protein residue is rejected without aggregation or replacement arrays.
PAE rows name reference residues and columns name partners. Docking scores use
native CB/glycine-CA atom pLDDT. Native pair ipTM and complex ipTM retain their
original scopes; absent confidence remains unavailable.

Declared `native_files` paths are also protected from scorer output replacement,
including original native confidence and feature files. Preserve their role names
and bytes when staging and restoring the complete input tree.
