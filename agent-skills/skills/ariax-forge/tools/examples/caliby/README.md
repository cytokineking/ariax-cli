# Caliby installed examples

1CRN is the public46-residue crambin structure from https://www.rcsb.org/structure/1CRN. prepare.py writes a monomer and a synthetic92-residue pair, plus constraints. Copy these regular files into registered inputs as described by the main guide. Use the returned installed examples directory.

commands.json supplies exact native argv in execution order. It generates two partial-diffusion conformers for each cleaned structure, then exercises four checkpoints and four operations on monomer and multichain inputs. Wait after every command and retain its ID/log. Run each check argv through the same Forge tool. Generation outputs are under `/workspace/caliby/ensembles-{monomer,multichain}/cc95-epoch3490-sampling_partial_diffusion-ss1.0-schurn0-ccstart0.0-dx0.0-dy0.0-dz0.0-rewind150/{1crn,pair}`. Run `caliby-check ensemble DIRECTORY` on each before sequence design.

The two-sequence/two-decoy setting is an execution fixture. All four requested model choices retain separate results. The checker verifies sequence fields, chain lengths, finite total energies, fixed A1-5 and chain B, A6 alphabet restriction, and designed CIF identity. Preserve the whole output tree through Files sync, then inspect the same checks after fresh restore. The mode guide describes substantive settings and scientific limits.
