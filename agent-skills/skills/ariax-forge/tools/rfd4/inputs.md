# RFd4 inputs and conditioning

The native input is a YAML/JSON condition specification or annotated CIF. An
ordinary structure does not specify which atoms or residues the design must hold
or change. Inspect the target and intended chemistry first, then preserve the
original input, conditions and mapping with the result. Examples under
[`data.examples.rfd4`](../examples/rfd4/README.md) are small syntax cases,
with bounded native evidence; consult the live catalog for their current scope.

## Condition-spec grammar

A file can contain several named designs; `global_args` supplies shared defaults
that each design can override. `input` is a CIF/BCIF path or list of paths with
non-overlapping chain IDs. Each condition has the shape `annotation: value:
[{select: query}, ...]`; the selections are a list even for one entry. JSON
uses the same structure with quoted object keys. This illustrative syntax is
not a separately qualified experiment:

```yaml
global_args:
  input: ./complex.cif
motif_example:
  contig: "A10-12, E1:20-30, A20-22, /0, B1-50"
  conditions:
    C_CRDGRP:
      1:
        - select: "sel('A/*/[10-12,20-22]/[N,CA,C,O]')"
    C_IDX:
      false:
        - select: "sel('A/*/[10-12]')"
          group: motif1
    C_SEQ:
      true:
        - select: "sel('A/*/[10-12,20-22]')"
    C_HOT:
      true:
        - select: "sel('B/*/33')"
    C_SEQ_PROB_CYS:
      0.0:
        - select: "sel('A/E1')"
```

| Element | Meaning |
| --- | --- |
| `A10-12`, `B1-50` | Preserve original input segments; all unselected atoms are dropped. Omit `contig` to keep the input. |
| `E1:20-30`, `20-30` | Named or unnamed expandable span, sampled at generation. Select a named span by `res_name`, such as `sel('A/E1')`; its name must be unique. Optional `P`, `R`, or `D` suffix specifies chain type. |
| `/0` | End a chain run. A run containing preserved segments takes their common input chain and type, even for an earlier expandable span; an all-new run gets a fresh chain ID. A complete contig of only new spans is rejected. |
| `C_CRD: true` | Condition selected atoms on absolute input coordinates. `false` clears that condition. |
| `C_CRDGRP: 1` | Condition internal geometry for selected atoms in coordinate group 1; `null` clears group membership. Clear absolute coordinates before assigning a group. Setting `C_CRD: true` removes group membership. |
| `C_SEQ: true`, `C_HOT: true` | Condition sequence at selected residues, or mark selected hotspot atoms, independently. |
| `C_IDX: false` plus `group` | Unindex selected atoms. Selections sharing a label form one index group with preserved relative offsets. Verify its realized insertion. |

Selectors use `sel('chain/res_name/res_id/atom_name')`, with `*` for skipped
fields and brackets for lists or ranges. Query expressions can combine selections
with `and`, `or`, and `not`. Direct `C_INTCRD` edits and two-body selection-pair
grammar are not supported in condition specs. Native controls also include
`C_SEQ_PROB_<TOKEN>`, `C_HB`, burial (`C_RAS`), aromatic interactions, CATH,
centroids, salt bridges, hydrophobic contacts and metal coordination; their
presence does not independently qualify them in Forge. Read the pinned
[condition reference](https://github.com/RosettaCommons/RFD4-Proteina/blob/aaccdd2ad0720c180468df5f9cf037a713d403e5/docs/reference/yaml-json.md)
and [condition definitions](https://github.com/RosettaCommons/RFD4-Proteina/blob/aaccdd2ad0720c180468df5f9cf037a713d403e5/src/rfproteina/conditions.py)
for values and restrictions.

A condition specification loads one or more structures under a design key,
uses `contig` to retain segments and insert designable spans, then applies
`conditions`. Any input atom outside retained contig segments is dropped. Omit
`contig` to retain the entire input. Relative companion paths resolve against
the **specification's directory**, not the command working directory. Upload
every referenced file with that relative layout and wait for each input ID.
When combining multiple inputs, chain IDs must not overlap.

`contig` and condition selectors use the original input mmCIF `label_seq_id`
before contig renumbering. Author numbering and viewer display numbering can
differ. Native inference rebuilds `SA_SRC` from the assembled input's current
chain/residue IDs, even for preannotated CIFs. Preserve and verify the
original-to-assembled-to-output mapping; output source labels alone cannot
recover the original selection. Path selectors use
`chain/res_name/res_id/atom_name`: to select atom N in chain B, use
`sel('B/*/*/N')`, filling preceding fields. Expandable segments have no original
residue ID; use their appropriate named segment selection.

For example, target backbone internal-coordinate conditioning (`C_CRDGRP`) and
target sequence conditioning (`C_SEQ`) are independent from a hotspot (`C_HOT`).
A hotspot alone fixes neither coordinates nor sequence. A sidechain or atom-type
condition may also expose sequence information. Check actual masks rather than
inferring them from a short description. Overlapping conditions for the same
annotation resolve in declaration order, last write wins. Validate nonempty
selections, the designable length range, fixed versus designed regions and the
intended target context before spending compute.

## Export a mapping before generation

For a condition spec, the packaged `checks/export_mapping.py` uses native loading
and contig assembly, checks that final assembly preserves atom identity/order,
and writes original `label_seq_id`, assembled IDs and expected inference
`SA_SRC` for preserved atoms. It deliberately omits expandable placeholders from
the original-atom table. Upload the helper and inspect its input ID, then run it
in the ready RFd4 tool (replace `SPEC` with an absolute `/inputs` path):

```sh
ariax forge inputs add "$SESSION" --file "$EXAMPLES/checks/export_mapping.py" --path rfd4/checks/export_mapping.py --json
ariax forge inputs status "$SESSION" MAPPING_HELPER_INPUT_ID --json
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 120 -- \
  python /inputs/rfd4/checks/export_mapping.py --spec "$SPEC" \
  --output /workspace/rfd4/input-maps/binder-001.json
```

Use a fresh output filename. This is the pre-sampling input map, not an output
verification: compare the expected source labels, identities and intended masks
with each full generated CIF, including inserted or expanded regions. For the
bundled binder, the [fixture checker](recipes.md) also maps assembled target
residues to output residues and checks its six selected hotspot atoms. An
annotated CIF supplied directly can carry existing source labels, but inference
rebuilds them too; retain and compare the pre-inference annotations separately.

Fresh-structure loading can clean the input, add missing atoms and convert MSE
to MET; loading with `input_as_annotated_cif: true` preserves existing
conditions. Choose deliberately and record changes. For ligands, metals and
nucleic acids, retain component identity, charges, bond orders, stereochemistry
and missing-atom information; do not invent missing coordinates. A soft
condition requires an observed adherence check, not an assumption it passed.

Native `prevalidate_inputs=true` checks each authored input before generation;
its prevalidation pass skips sampling transforms. For partial diffusion or
inverse folding, explicitly check that the seed coordinates are finite before
generation and check generated coordinates afterward. A successful process exit
does not establish finite output: in one checked case native prevalidation
accepted a seed with nonfinite atoms. Do not silently repair those atoms.

After the tool and input are ready, set `SEED` to the actual annotated CIF path
inside `/inputs`. This conservative check runs in the RFd4 image, rejects an
empty structure and requires every atom coordinate to be finite:

```sh
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 120 -- python -c '
import sys
import numpy as np
from atomworks.io import parse
from rfproteina.utils.parse_presets import ANNOTATED_CIF
atoms = parse(sys.argv[1], config=ANNOTATED_CIF)["assemblies"]["1"][0]
count = int((~np.isfinite(atoms.coord).all(axis=1)).sum())
print("atoms", len(atoms), "nonfinite", count)
sys.exit(1 if not len(atoms) or count else 0)
' "$SEED"
```

Run the same check on each actual generated CIF under `/workspace`, substituting
its exact path for `"$SEED"`. This inspects that CIF, not a YAML/JSON spec's
assembled structure: contigs and fresh-input preprocessing can change or add
atoms, so a finite source CIF alone does not prove the assembled seed is finite.

For a condition spec, stage its companions alongside it and set `SPEC` to its
actual path under `/inputs`. Check finite heavy-atom coordinates after native
assembly, before sampling:

```sh
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 120 -- python -c '
import sys
from pathlib import Path
import numpy as np
from rfproteina.inference_utils.condition_spec import (
    build_annotated_atom_array_from_condition_spec, load_spec_file, split_global_args,
)
path = Path(sys.argv[1])
examples = split_global_args(load_spec_file(path))
if not examples:
    raise ValueError("The condition spec has no examples")
for name, spec in examples.items():
    atoms = build_annotated_atom_array_from_condition_spec(
        spec, spec_dir=path.parent, example_id=name, validate=True
    )["atom_array"]
    heavy = ~np.isin(np.char.upper(atoms.element.astype(str)), ["H", "D"])
    bad = heavy & ~np.isfinite(atoms.coord).all(axis=1)
    print(name, "heavy atoms", int(heavy.sum()), "nonfinite", int(bad.sum()))
    if not heavy.any() or bad.any():
        raise ValueError("The assembled seed must have finite heavy-atom coordinates")
' "$SPEC"
```

Finite coordinates do not establish that masks, chemistry or residue mappings
match the intended design.
Inspect any failure before deciding how to correct an input. For reproducibility
preserve the specification, every companion file, materialized conditions when
produced, resolved settings, seed and output annotations. Check generated
sequences and coordinates against the actual conditions.

Source: [native condition specifications](https://github.com/RosettaCommons/RFD4-Proteina/blob/aaccdd2ad0720c180468df5f9cf037a713d403e5/docs/how-to/input_prep/yaml-json.md).
This Forge adaptation inherits the attribution in the [entrypoint](../rfd4.md).
