# Laboratory exchange example

Run every helper on the remote Forge host. Use `ariax skills forge --tool lab-feedback --json`
to find this directory in `data.examples["lab-feedback"]`. The [primary guide](../../lab-feedback.md)
gives exact native argv. `prepare.py --csv /inputs/lab-feedback/proteinbase.csv
--out /workspace/lab-feedback/public-review` selects two actual public BLI records
sharing a target, writes a complete offline shortlist and creates separate marked
synthetic controls. The source CSV must come from the permitted ProteinBase export
and be retained with attribution. It is downloaded only on the remote host.

`check.py --ledger /workspace/lab-feedback/exchange.json` checks saved identity and
provenance. `--controls` checks the independent artificial
control ledger: two differing KD values survive and the third has missing units.
No artificial record represents a ProteinBase or laboratory measurement.

Save the original CSV, ledger, draft, identity map and assay context using the
[Files guide](../../../outputs.md).

Preserve the exported data and metadata under the terms at
[ProteinBase](https://proteinbase.com/download): “This work used Proteinbase by
Adaptyv Bio under ODC-BY license”. The full dataset stays outside this package.
