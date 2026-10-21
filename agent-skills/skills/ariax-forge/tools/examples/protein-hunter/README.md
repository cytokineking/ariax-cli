# Protein-Hunter proposed fixture

Source-only B53b readiness input. No native run or passing binder is supplied.
The PD-L1 sequence follows the original Protein-Hunter Boltz example.
The fork is `91513a2f78987a84e92e6de5a735fe1e12e0f265`.

`protein-binder.json` declares one length-90, two-cycle attempt with single-sequence
MSAs and unchanged native 0.8/0.8 confidence thresholds. The wrapper supplies
fixed model mounts and disables native independent validation. Native MPNN uses
seed 111; other scientific RNG seeds remain native and can be unavailable.

Read [the guide](../../protein-hunter.md) before staging. The proposed tool and
its exact soluble checkpoint are not registered or qualified. Retain all native
failures, best-cycle records, unavailable metrics and zero accepted designs.
New versions need new staged configuration paths and explicit new command IDs.
Restore keeps files and performs no scientific replay.

The current single-checkpoint consumer contract requires native LigandMPNN
`solublempnn_v_48_020.pt` (6,681,301 bytes; complete legal/source tar <=8 MiB),
not B27's differently laid out ProteinMPNN soluble checkpoint. A compatible
B27q canonical packet may share that unchanged basename at the documented mount;
B55 registration and remote native loading remain open.
