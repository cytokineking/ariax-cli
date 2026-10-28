# Mol-1 provenance and component terms

Reviewed source: Molence Bio's Mol-1 commit
[`6ad1a133f919dc79b4f829bdc24fad28b9c4d3f0`](https://github.com/molence/Mol-1/tree/6ad1a133f919dc79b4f829bdc24fad28b9c4d3f0).
The proposed Forge package is `mol1` version `1.0.0`; no public availability or
qualification is asserted. The model configuration is `mol-1-base`. Code and
model bytes have separate identities: the reviewed release source points to a
mutable checkpoint URL, not an immutable model revision. The eventual remote
evidence must identify the selected named assets and their source, without treating a mutable URL as an immutable revision.

| Component | Recorded source terms and limit |
| --- | --- |
| Mol-1 source code | [Apache License 2.0](https://github.com/molence/Mol-1/blob/6ad1a133f919dc79b4f829bdc24fad28b9c4d3f0/LICENSE). Retain upstream copyright, modification and third-party notices. |
| Model weights | The reviewed repository documents a separate public checkpoint download but does not explicitly establish its distribution license. **Unknown**; do not infer a weight grant from the code license or public access. |
| Chemical/reference data | CCD, conformers, clusters and release metadata derive from upstream data publishers. Their terms and exact snapshots are separate from the code and weights. |
| Search services and databases | Separate access and data conditions apply. These customer recipes do not authorize public ColabFold, template fetching or RNA search. |
| These CLI fixtures, launcher and prose | Authored for this CLI under its existing Elastic License 2.0; no upstream model code, database or structure coordinates are redistributed in this directory. The ubiquitin sequence is reused from the existing CLI fixture cited in the README. |

Mol-1 derives substantially from Protenix. Its
[third-party notices](https://github.com/molence/Mol-1/blob/6ad1a133f919dc79b4f829bdc24fad28b9c4d3f0/THIRD_PARTY_NOTICES.md)
identify ByteDance/Protenix source revision
`bd54a05d047b8925a241056f36d619700604068a`, original copyright and Molence Bio
modifications, and OneFlow/FastFold/OpenFold components. Optional FlashPairformer
`opt_core` and NVIDIA cuEquivariance have their own notices and dependencies;
retain applicable notices with the selected runtime. No claim of rights to
separate model weights follows from a kernel library's license.

Source contracts used for this guide:

- [Direct inference entrypoint](https://github.com/molence/Mol-1/blob/6ad1a133f919dc79b4f829bdc24fad28b9c4d3f0/mol/runner/inference.py), [high-level CLI](https://github.com/molence/Mol-1/blob/6ad1a133f919dc79b4f829bdc24fad28b9c4d3f0/mol/runner/batch_inference.py).
- [Inference defaults](https://github.com/molence/Mol-1/blob/6ad1a133f919dc79b4f829bdc24fad28b9c4d3f0/mol/config/inference.py), [base defaults](https://github.com/molence/Mol-1/blob/6ad1a133f919dc79b4f829bdc24fad28b9c4d3f0/mol/config/base.py), [model architecture](https://github.com/molence/Mol-1/blob/6ad1a133f919dc79b4f829bdc24fad28b9c4d3f0/mol/config/model_type.py).
- [Input schema](https://github.com/molence/Mol-1/blob/6ad1a133f919dc79b4f829bdc24fad28b9c4d3f0/docs/infer_json_format.md), [reference-data provenance](https://github.com/molence/Mol-1/blob/6ad1a133f919dc79b4f829bdc24fad28b9c4d3f0/docs/data_sources.md), [memory controls](https://github.com/molence/Mol-1/blob/6ad1a133f919dc79b4f829bdc24fad28b9c4d3f0/docs/inference_memory.md).

Upstream performance statements do not establish Forge resource minima or
qualification. The current customer guide makes no benchmark-superiority claim.
