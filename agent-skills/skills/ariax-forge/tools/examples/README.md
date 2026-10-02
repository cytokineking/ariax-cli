These files are small synthetic native examples, bundled beside the Forge
tool guides. They match runtime `science/fixtures/`. They are not biological
predictions or records of image/GPU success.

Set `EXAMPLES` to the absolute `data.examples.root` path returned by
`ariax skills forge --json`. The same response exposes `data.examples.base`,
`.ipsae`, and `.boltz2` for each fixture directory. Read a native guide with
`ariax skills forge --reference base|ipsae|boltz2 --read --json`, selecting one
reference ID. The `ariax-forge` alias works for discovery and reads.

The base and ipSAE programs/checkers need Python; native ipSAE also needs
NumPy and is supplied by its image. The Boltz2 output checker needs the
image's NumPy and Gemmi packages. Stage all files used by a command through
`forge inputs add`, require ready inputs, then invoke direct argv. Do not
execute the GPU prediction on CPU. Use a fresh workspace root per new run.
