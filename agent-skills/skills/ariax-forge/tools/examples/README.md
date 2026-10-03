These are small native execution cases bundled beside the Forge tool guides.
They match runtime `science/fixtures/`. Base, ipSAE and Boltz2 use synthetic
fixtures. BindCraft2 and FreeBindCraft use the retained PD-L1 example target
with deliberately reduced design searches; no generated binder is supplied.
These files are inputs and checkers, not prediction results or records of
image/GPU success.

Set `EXAMPLES` to the absolute `data.examples.root` path returned by
`ariax skills forge --json`. The same response exposes `data.examples.base`,
`.ipsae`, `.boltz2`, `.bindcraft2`, and `.freebindcraft` for each fixture
directory. Read a native guide with
`ariax skills forge --reference base|ipsae|boltz2|bindcraft2|freebindcraft --read --json`,
selecting one reference ID. The `ariax-forge` alias works for discovery and
reads.

The base and ipSAE programs/checkers need Python; native ipSAE also needs
NumPy and is supplied by its image. The Boltz2 output checker needs the
image's NumPy and Gemmi packages. Both binder output checkers need Gemmi,
provided by their respective images. FreeBindCraft's `check-limit.py` is an
operator probe for the native attempt budget inside that image, with scratch
available. It is separate from design and output inspection.

Stage every input used by the chosen command through `forge inputs add`,
require ready inputs and invoke native argv in the selected image. The agent
chooses the executable, options or explicit shell. Settings contain absolute
container input/output paths, so update them when changing staged locations
or choosing a fresh output root. Use the actual checker and matching native
version from the tool guide. GPU execution and scientific interpretation
remain distinct gates.
