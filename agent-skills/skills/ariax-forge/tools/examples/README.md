These are small native execution cases bundled beside the Forge tool guides.
The original five tool directories match runtime `science/fixtures/`. Base, ipSAE and Boltz2 use synthetic
fixtures. BindCraft2 and FreeBindCraft use the retained PD-L1 example target
with one bounded design trajectory per tool: BindCraft2 requests 31 binder
residues and FreeBindCraft requests 80. No generated binder is supplied.
These files are inputs and checkers, not prediction results or records of
image/GPU success.

Set `EXAMPLES` to the absolute `data.examples.root` path returned by
`ariax skills forge --json`. The same response exposes `data.examples.base`,
`.ipsae`, `.boltz2`, `.bindcraft2`, and `.freebindcraft` for each fixture
directory. Read a native guide with
`ariax skills forge --reference base|ipsae|boltz2|bindcraft2|freebindcraft --read --json`,
selecting one reference ID. The `ariax-forge` alias works for discovery and
reads.

The accepted candidate also registers `.af2`, `.structure-tools` and
`.foldseek` fixture paths. MPNN's PDB/plan files live beside its guide at
`data.examples.mpnn`; the individual MPNN tool keys resolve that same
directory. Read `catalog` for the accepted native cases and remaining image,
asset and resource gates, then `mpnn-fixtures`, `af2-fixtures` or
`structure-tools-fixtures` for provenance. Supporting references include
`af2-msa` and `structure-tools-definitions`.

Boltz2's reviewed molecular/affinity fixtures remain at `data.examples.boltz2`.
Read `boltz2-modes` and `boltz2-fixtures` for the twelve qualified cases of
fourteen. Both affinity inputs and the separate SEP cyclic peptide passed;
the original MSE-to-MET identity failure and unselected custom MSA service
remain unqualified. Managed R2 and broader hardware minima remain open.

The base and ipSAE programs/checkers need Python; native ipSAE also needs
NumPy and is supplied by its image. The Boltz2 output checker needs the
image's NumPy and Gemmi packages. The BindCraft2 checker uses its image's
Biotite reader and NumPy; the FreeBindCraft checker uses its image's Gemmi.
FreeBindCraft's `check-limit.py` is an operator probe for the native attempt
budget inside that image, with scratch available. It is separate from design
and output inspection.

Stage every input used by the chosen command through `forge inputs add`,
require ready inputs and invoke native argv in the selected image. The agent
chooses the executable, options or explicit shell. Settings contain absolute
container input/output paths, so update them when changing staged locations
or choosing a fresh output root. Use the actual checker and matching native
version from the tool guide. GPU execution and scientific interpretation
remain distinct gates.

The separate [`science/`](science/) directory contains offline synthetic
preflight and mapping cases recovered from the skill archive, plus a toy
affinity output. Locate it with `data.examples.science` and read
[scientific checks](../../references/science-checks.md) through reference
`science-checks`. These cases add no live workflow qualification.
