# B25 native fixture

`prepare_boltz.py` runs in base. It fetches Boltz v2.2.1 commit
`cb04aeccdd480fd4db707f0bbafde538397fa2ac`, adds a source-path message to
`predict`, creates one internal relative link and saves a regular source tar,
source record, model choice and bootstrap under `/workspace/custom/boltz`.
Stage it with the other native files under `/inputs/custom-code/native` and
stage `source_bundle.py` under `/inputs/custom-code`.

`bootstrap_boltz.py` runs explicitly in the qualified Boltz image. Pass the
scratch source directory, a fresh scratch environment and a workspace record
path. It reuses image packages, installs only the editable checkout, checks
its imports and dependencies, and performs one CUDA tensor probe. The selected
asset remains `boltz2` at `/models/boltz2`; inference needs a separate command.

`exercise_fixture.py before` saves and runs the edited composition fixture.
After an admitted restore into fresh scratch, `exercise_fixture.py after`
unpacks its saved source, recreates the local wheel/environment and checks a
new output. Stage the original composition files under
`/inputs/custom-code/example` for these two fixture commands.

Use the accepted public same-project session route until B22's `forge resume`
command is integrated. The backend B25 qualifier joins these fixtures to the
public proxy, signed admission, disposable PostgreSQL/Redis and real runtime
containers. Its retained report names the provider, identity, tunnel,
preparation and object-store substitutes.
