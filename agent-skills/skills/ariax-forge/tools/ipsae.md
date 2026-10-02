# Forge ipSAE interface scoring

ipSAE is a CPU tool. It scores a supplied structure and matched PAE data;
it does not fold sequences. B07 preserves Ariax's vendored ipSAE v3 source,
including its archived chain-index/partner-mask corrections. The bounded
qualified source case here uses AF2 JSON/PDB. Current upstream v4 and
Boltz2 token mapping are outside this fixture qualification.

Require an authorized available session and tool `ipsae` ready:

```sh
ariax forge tools add "$SESSION" --tools ipsae --priority ipsae --json
ariax forge tools wait "$SESSION" ipsae --timeout 1800 --json
ariax forge status "$SESSION" --json
```

`SESSION` is an actual session UUID. `EXAMPLES` is the absolute sibling
`examples/` directory. These commands remain unqualified until B05/B06 and
image publication/build qualification pass. The native executable `ipsae`
is on PATH and forwards positional argv to the preserved script. There are
no model assets for this tool. The orchestrator exposes this guide as the
Forge `ipsae` reference during integration.

## Matched inputs and the inspectable fixture

Use a PDB and JSON from the same predicted AF2 model, with identical residue
order across PAE axes and pLDDT. Supply a square nonnegative finite `pae`
(or `predicted_aligned_error`) matrix, a pLDDT vector on the 0–100 scale,
and explicit chain identities. Preserve missing-residue/construct information
when working with real predictions. Chain positions in the PAE array must
match the parsed structure representatives. A matching dimension alone does
not prove matching model identity.

The tiny [PDB](examples/ipsae/toy.pdb) contains glycine CA representatives for
A1, A2, B1, B2, with [JSON](examples/ipsae/scores.json) in that same order.
It is synthetic and does not represent a complete protein or biological
interaction. [Expected values](examples/ipsae/expected.md) are calculated
independently from its deliberately directional PAE blocks.

```sh
ariax forge inputs add "$SESSION" --file "$EXAMPLES/ipsae/toy.pdb" --path ipsae/toy.pdb --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/ipsae/scores.json" --path ipsae/scores.json --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/ipsae/check.py" --path ipsae/check.py --json
ariax forge inputs list "$SESSION" --json
```

Record the input IDs and require all paths ready. Observe an importing input
with `ariax forge inputs status "$SESSION" "$INPUT_ID" --json`.

## Native command and output checks

The native script writes outputs beside the PDB. Copy the structure into a
fresh writable workspace directory first. The explicitly invoked shell is
ordinary argv; Forge does not interpret the command through a host shell.

```sh
ariax forge run "$SESSION" --tool base --timeout-seconds 60 --json -- /bin/sh -c 'mkdir -p /workspace/ipsae-demo && cp /inputs/ipsae/toy.pdb /workspace/ipsae-demo/toy.pdb'
ariax forge watch "$SESSION" "$COPY_COMMAND_ID" --timeout 120 --json
ariax forge run "$SESSION" --tool ipsae --timeout-seconds 60 --json -- ipsae /inputs/ipsae/scores.json /workspace/ipsae-demo/toy.pdb 10 10
ariax forge watch "$SESSION" "$SCORE_COMMAND_ID" --timeout 120 --json
ariax forge run "$SESSION" --tool base --timeout-seconds 60 --json -- python3 /inputs/ipsae/check.py /workspace/ipsae-demo/toy_10_10
ariax forge watch "$SESSION" "$CHECK_COMMAND_ID" --timeout 120 --json
```

Set command variables to the corresponding returned IDs. Require each
preceding command succeeded before the next dependent command. Preserve
those IDs and query status/logs on uncertain responses or local wait timeout.

The positional cutoffs are PAE 10 Å and distance 10 Å. Expected outputs are:

```text
/workspace/ipsae-demo/toy_10_10.txt
/workspace/ipsae-demo/toy_10_10_byres.txt
/workspace/ipsae-demo/toy_10_10.pml
```

The chain table must have A→B `asym` ipSAE 0.212489, B→A `asym` 0.063193,
and A/B `max` 0.212489. The by-residue table has four rows. Both directional
residue/contact counts are 2/2. `ipTM_af=0.5` is supplied fixture metadata.
The [checker](examples/ipsae/check.py) requires these files and values, with
print-rounding tolerance. Missing PAE can make this native script exit zero,
so inspect the files and logs even after command `succeeded`.

## Interpret actual scientific results

ipSAE applies a PAE kernel to entries strictly below the PAE cutoff, with
length-dependent d0; report both `asym` directions. The native `max` row is
not a minimum, average, or probability of binding. In this source, the distance
cutoff changes `dist1`/`dist2` counts, while ipSAE uses the PAE filter. Distances
use CB, or CA for glycine; pDockQ/pDockQ2 use a separate fixed 8 Å contact
cutoff. LIS uses its own PAE cutoff. These settings follow the inspected
[DunbrackLab source](https://github.com/DunbrackLab/IPSAE/blob/f892de5ba6f8567912764c990aae59ee8ce781c4/ipsae.py),
with the archived Ariax corrections preserved.

Check matched inputs, chain/residue identities, score completeness, and
plausible interface geometry. High predicted confidence is not experimental
affinity, specificity, expression, or demonstrated binding. Compare runs
using consistent constructs, predictor settings, and cutoffs. Record actual
floating cutoffs because native filenames truncate them to integer suffixes;
choose a fresh output directory to avoid overwriting an earlier result.

Save terminal results before closure:

```sh
ariax forge sync "$SESSION" --wait --timeout 1800 --json
ariax forge files "$SESSION" --path /workspace/ipsae-demo --checkpoint "$CHECKPOINT" --json
ariax forge download "$SESSION" /workspace/ipsae-demo/toy_10_10.txt --checkpoint "$CHECKPOINT" --dest ./ipsae-scores.txt --json
```

`CHECKPOINT` is the returned completed checkpoint UUID; require `synced`.
Use the Forge `outputs` reference for full durability/restore behavior and
[base](base.md) for the settled restore command. Restore recovers files for
explicit future checks and does not rerun scoring. Finish with `forge close`
and confirm the session is closed. B08 must still prove the built image and
VM path; host-Python source checks do not establish image qualification.
