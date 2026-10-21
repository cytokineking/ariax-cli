# Capability discovery

Start with the live catalog and choose the scientific task:

```sh
ariax forge catalog --task binder-design --details --json
ariax forge catalog --task antibodies --details --json
ariax forge catalog --task molecular-prediction --details --json
ariax forge catalog --task sequence-optimization --details --json
ariax forge catalog --task validation-search --details --json
ariax skills forge --reference capabilities-matrix --read --json
```

Each returned tool has a `capabilities.guide` alias. Read that installed reference
with `ariax skills forge --reference ALIAS --read --json` before preparing inputs.
A missing `capabilities` object means its routing and qualification are unknown.
The catalog describes available metadata; session tool state establishes readiness.
Base is included automatically when a session is created.

For binder design, compare BoltzGen, BindCraft2, FreeBindCraft, Foundry RFD3,
Genie3, Proteina-Complexa, native PXDesign and the experimental ESMFold2 pipeline.
Antibody tasks route to RFantibody, AbMPNN and the documented antibody modes in
those generators. Molecular prediction uses Boltz2, AF2, RF3, Protenix, Biohub
ESMFold2, OpenDDE and OpenFold3/OpenBind. Sequence optimization includes native
MPNNs, FAMPNN, stability models and the distinct JMS components. Validation and
search uses ipSAE/interface adapters and structural tools at their actual state.

`qualification` identifies each declared model and native mode. `native`,
`installation` and `restoration` report separate observations. `passed` applies
to the stated `scope` and `workload`; `held` records a current restriction.
`untested` means a named case has not run, while `unknown` means the selected
records do not establish the fact. Upstream maturity is independent of these
observations. Resource floors remain in `resources` and `models[].resources`;
null retains an unmeasured value. A successful reduced example supplies no
experimental binding, stability or efficacy result.

Code, weight and database terms have separate records. `recorded` means the
cited statement was preserved for that selected component. Follow its actual
conditions and the tool guide. An unknown term requires its underlying record
before a new distribution decision. A code license does not establish the terms
of weights or databases. Scientific references remain alongside source versions.

## Runnable installed example

Discover `data.examples.capabilities` from `ariax skills forge --json`. Set
`EXAMPLE` to that returned directory. This local read-only metadata example runs
with Node and uses a synthetic mixed-status catalog; it makes no scientific call.

```sh
node "$EXAMPLE/inspect.mjs" "$EXAMPLE/catalog.json" antibodies
```

The result contains `example-antibody` with native `passed`, installation `held`
and restoration `untested`, plus its one-chain/two-sequence workload. The
`example-predictor` belongs to a different task. To inspect the live response,
save `ariax forge catalog --json` to an ordinary text file and pass that file to
the same command. Preserve the selected source/model, mode, inputs, native
outputs and rejection records in Files before closing compute. The tool guide
supplies exact native argv and output units.

[Full inventory and scopes](capabilities/matrix.md) includes the accepted campaign
joins, selected terms references and unavailable modes. [Campaign recipes](../references/campaign-recipes.md)
retain the rejected motif and ligand cases. New cohort sizes and untested modes
need their own stated scope.
