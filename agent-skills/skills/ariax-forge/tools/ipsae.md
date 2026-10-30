# Forge ipSAE interface scoring

For real inputs and result review, read
[format and mapping limits](../references/ipsae-inputs.md) (`ipsae-inputs`) and [complete metric semantics](../references/ipsae-metrics.md) (`ipsae-metrics`).
Use those IDs with
`ariax skills forge --reference ID --read --json`. The [shared interpretation
guide](../../../core/interpretation.md) covers structure stages and fair comparisons.

ipSAE is a CPU tool. It scores a supplied structure and matched PAE data;
it does not fold sequences. Forge uses ipSAE v3 with Ariax's chain-index and
partner-mask corrections. Use the AF2 JSON/PDB workflow below. Upstream v4 is
outside this tool's scope. Live native Boltz2 consumption remains unverified;
preserve the mapping limits in the [input reference](../references/ipsae-inputs.md).

Use the [interface scorer](interface-scores.md) for explicit
OpenDDE general/ABAG and supported OpenBind-0/Preview2 native handoffs. It checks
their token, residue and atom correspondence before applying these same v3
protein equations. Preview1 stays excluded, split protein tokens remain
unavailable. AF3 input is unsupported. Native
predictor ipTM keeps its reported pair or complex scope.

Require an authorized available session and tool `ipsae` ready:

```sh
ariax forge tools add "$SESSION" --tools ipsae --priority ipsae --json
ariax forge tools wait "$SESSION" ipsae --timeout 1800 --json
ariax forge status "$SESSION" --json
```


## Matched inputs and synthetic example

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
with Ariax's corrections preserved. The runtime retains Roland Dunbrack's
MIT notice and the paper references listed in the
[metric reference](../references/ipsae-metrics.md).

Check matched inputs, chain/residue identities, score completeness, and
plausible interface geometry. High predicted confidence is not experimental
affinity, specificity, expression, or demonstrated binding. Compare runs
using consistent constructs, predictor settings, and cutoffs. Record actual
floating cutoffs because native filenames truncate them to integer suffixes;
choose a fresh output directory to avoid overwriting an earlier result.

Save terminal results before closure:

Set `PROJECT` to the session's returned `project_id`.

```sh
ariax forge sync "$SESSION" --wait --timeout 1800 --json
ariax forge files "$PROJECT" --path /workspace/ipsae-demo --json
ariax forge download "$PROJECT" /workspace/ipsae-demo/toy_10_10.txt --dest ./ipsae-scores.txt --json
```

Require the flush state `saved` before inspecting current project files.
Read the [outputs reference](../outputs.md) with
`ariax skills forge --reference outputs --read --json` for durability/restore
behavior and
[base](base.md) for restore commands. Restore recovers files for
explicit future checks and does not rerun scoring. Finish with `forge close`
and confirm the session is closed.
