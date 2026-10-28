# Capability discovery

Start with the live catalog and choose the scientific task:

```sh
ariax forge catalog --task binder-design --compact --json
# Substitute antibodies, molecular-prediction, sequence-optimization or validation-search.
ariax forge catalog --tool TOOL --json
ariax skills forge --tool GUIDE --json
```

Select a tool from the compact summary, then read its full catalog entry before
choosing a mode or spending. Use its `capabilities.guide` value for `GUIDE` and read
that installed reference with `ariax skills forge --reference GUIDE --read --json`
before preparing inputs. Load the [full guide index](capabilities/matrix.md) only
when comparing additional methods.
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

The [RFd4 guide](rfd4.md) describes native joint sequence and all-atom design.
Its presence in the CLI does not establish a live catalog
entry, qualified scientific mode or measured resource minimum. Consult the live
catalog before considering it alongside existing design methods.

[Mol-1](mol1.md) documents candidate protein-monomer and CCD-ligand prediction
with prepared JSON and no public MSA search. Two bounded native cases passed
on an L40; installation and restoration remain pending. Consult the live catalog
before selecting it. Broader upstream cofolding modalities remain outside scope.

[Tmol](tmol.md) provides protein energy scoring, interface interaction scoring
and Cartesian minimization through an uploaded Python adapter. It needs no model
download. These weighted energies are not measured binding affinities; use the
live catalog's separate mode qualifications and the guide's preparation rules.

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

Discover `data.examples.capabilities` from `ariax skills forge --tool capabilities --json`. Set
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
