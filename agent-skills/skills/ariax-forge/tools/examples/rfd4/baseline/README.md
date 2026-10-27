# RFd4 baseline inputs

These are small inputs for bounded native checks. Consult the live catalog for
current availability and qualification. `monomer.yaml` loads the upstream
100-residue unconditioned
annotated monomer without discarding its expandable-segment annotations.
`binder.yaml` adapts the upstream PD-L1 example and selects the target and
hotspot atoms using their original `label_seq_id` values. Paths resolve relative
to each YAML file. A YAML contig renumbers its assembled residues before native
inference sets source labels. Preserve the original-to-assembled mapping and
generated annotations together; output `SA_SRC` alone need not identify the
original target residue IDs. Verify this mapping for each generated output.
In the checked input assembly, original target residues A56, A115 and A123 map
to assembled A40, A99 and A107, respectively; the three hotspot selections
contain six intended atoms. Verify the mapping from that assembled input to each
generated output separately. This input check does not qualify generation.

The input files are from [RFD4-Proteina](https://github.com/RosettaCommons/RFD4-Proteina)
commit `aaccdd2ad0720c180468df5f9cf037a713d403e5`:

- `monomer-short.cif.zst`: `data/benchmarks/monomer/monomer-short.cif.zst`.
- `5o45_cropped.cif.zst`: `docs/examples/inputs/5o45_cropped.cif.zst`.
- `binder.yaml`: adapted from `docs/how-to/input_prep/examples/condition_spec_ppi.yaml`,
  with its companion path changed to the adjacent file and concise comments.

See the adjacent [BSD 3-Clause license](LICENSE). These are inputs, not evidence
of successful generation, binding or experimental activity.
