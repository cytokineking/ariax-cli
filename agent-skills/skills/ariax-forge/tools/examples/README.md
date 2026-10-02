These files are small synthetic native examples, bundled beside the Forge
tool guides. They match runtime `science/fixtures/`. They are not biological
predictions or records of image/GPU success.

Set `EXAMPLES` to this directory's absolute path in the guide commands. Obtain
the guide location from `ariax skills forge --reference base --read --json`
after the orchestrator adds reference dispatch; `examples/` is beside that
guide. Before dispatch integration, use this source directory directly.

The base and ipSAE programs/checkers need Python; native ipSAE also needs
NumPy and is supplied by its image. The Boltz2 output checker needs the
image's NumPy and Gemmi packages. Stage all files used by a command through
`forge inputs add`, require ready inputs, then invoke direct argv. Do not
execute the GPU prediction on CPU. Use a fresh workspace root per new run.
