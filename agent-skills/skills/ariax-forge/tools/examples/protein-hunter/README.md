# Protein-Hunter protein-binder example

`protein-binder.json` supplies the PD-L1 sequence from the original
Protein-Hunter Boltz example and requests one 90-residue, two-cycle attempt with
single-sequence MSAs and native 0.8/0.8 confidence thresholds. No generated binder
or experimental binding result is supplied. The selected fork is
`91513a2f78987a84e92e6de5a735fe1e12e0f265`.

Find this directory through `ariax skills forge --tool protein-hunter --json`,
field `data.examples["protein-hunter"]`. Read [the guide](../../protein-hunter.md)
for staging and execution, and check the authenticated catalog for availability.
The adapter supplies model mounts and disables native independent validation.
Native MPNN uses seed 111; the adapter fixes no Boltz or initial-sequence seed.

The consumer requires LigandMPNN’s `solublempnn_v_48_020.pt`, which differs from
the original ProteinMPNN soluble-trained checkpoint. Preserve all native failures,
best-cycle records, unavailable metrics and acceptance fields. New configurations
need new staged paths and explicit new command IDs. Use
[saved results](../../../outputs.md) for checkpointing inputs and outputs.
