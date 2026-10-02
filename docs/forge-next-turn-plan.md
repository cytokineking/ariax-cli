# Forge next bite: B08 image preparation and Hyperstack qualification

Updated October 2, 2026. The local integration gate passed against the accepted code and installed CLI review package. Continue from the three `codex/forge-v2-integration` workspaces. The orchestrator owns the campaign, deployment decisions, and final acceptance. Keep worker execution bounded to an assigned repository or build task, using the existing GPT-6.1 xhigh chats and a maximum of three concurrent workers.

## Starting point

| Repository | Integration workspace |
|---|---|
| Backend | `/Users/aaronring/.codex/worktrees/forge-v2-integration/Ariax-Bio-Backend` |
| Runtime | `/Users/aaronring/Forge-rebuild/2026-10-01/forged` |
| CLI | `/Users/aaronring/Forge-rebuild/2026-10-01/cli` |

The accepted implementation commits are listed below. Documentation-only handoff commits may follow them.

| Repository | Accepted implementation |
|---|---|
| Backend | `11d26b4e756f322fad2ea3a33c64289742cb54b3` |
| Runtime | `f6b96921b65f20ea8de3a0bebbfb3054b7e10e31` |
| CLI | `2ea139018bfea323c48e7b548c6d83d109e1da39` |

Check branch names and working-tree state before assigning work. Preserve the original worker branches and unrelated primary-checkout changes. The [contract](forge-contract.md) governs the runtime and API; [the audit](forge-worker-wave2-audit-2026-10-02.md) records accepted commits and local evidence. The [joined acceptance instructions](/Users/aaronring/.codex/worktrees/forge-v2-integration/Ariax-Bio-Backend/docs/forge-joined-acceptance.md) require explicit paths to the runtime source and installed CLI.

The preparation queue, file workflow, lifecycle fixes, and guide-reference dispatch are integrated. Close stops workspace writers before saving a final checkpoint within a shared sixty-second deadline. Preparation can still be cancelling when the daemon returns `closing`; public `closed` requires confirmed provider cleanup. File recovery starts after the existing daemon lock is acquired. Expiry saves changed output when valid transfer credentials are available.

## Prepare the actual deployment material

Build and qualify images on a remote Linux amd64 GPU full VM, as directed by the user. The workstation's Docker daemon is outside the requirements for this campaign. The orchestrator owns provisioning and the spending bound for the remote build/qualification VM. Before allocation, check the current Hyperstack GPU offer and record the budget and cleanup deadline. Stage the accepted source and fixtures on that VM, configure Docker's GPU access, and execute the build and qualification commands there through SSH.

The runtime's [science instructions](/Users/aaronring/Forge-rebuild/2026-10-01/forged/science/README.md) contain the build commands. Run them from the staged runtime checkout on the GPU VM. Build the ordinary base, ipSAE, and Boltz2 image tags and run `science/checks/container_cpu.sh` there. Prepare the complete model directory on the same VM, then execute the bounded Boltz2 fixture in the built GPU image and inspect its native outputs. Preserve the workload UID and restricted container mounts. Record GPU access and native execution before accepting the images for publication. The existing host CPU checks and constructed output tests retain their recorded scope.

Prepare the model bundle on the remote VM. Create one named Boltz2 tar archive containing `mols.tar`, the extracted `mols/` directory, `boltz2_conf.ckpt`, and `boltz2_aff.ckpt` at its root. Use the reviewed upstream assets or complete retained Ariax copies, and preserve the expected native file structure. Publish to an actual Ariax-controlled HTTPS location. Add that URL and the Boltz2 tool entry to `science/catalog.json` after publication. The `UNQUALIFIED` example must remain outside deployment.

Publish the accepted image tags and make the same catalog available to backend validation and VM bootstrap. `FORGE_CATALOG_PATH` selects the backend catalog; `FORGE_RUNTIME_PATH` must contain the accepted runtime source, `pyproject.toml`, and `deploy/`. Verify the deployment environment has the existing compute-signing, Hyperstack, tunnel, and project-scoped storage configuration. Record the exact environment and database migration plan before changing it. The new schema consists of `20261002000000_forge_sessions.sql` and `20261002010000_forge_files.sql`.

This preparation can use one worker for remote image builds and native container checks and another for the model bundle on the same GPU VM. Coordinate separate remote directories and wait for complete assets before GPU qualification. The orchestrator controls VM provisioning, publication, catalog changes, and deployment. Workers report the image tags, asset location, actual build logs, and remaining failures. Keep ordinary tags and named assets; preserve the user's prohibition on content hashes, digest pins, compatibility paths, and fallback execution.

## Run one bounded campaign

Review the remote build/qualification results and deployment material before starting the Forge pilot. Account for the build VM and both later Forge sessions in the campaign cost bound. Use one Hyperstack full VM at a time, release the build VM after accepted artifacts are published, and then create the source session. Set a one-hour expiry on each Forge session. Confirm source cleanup before creating the restore session. A failed attempt returns to diagnosis after cleanup.

Use the installed CLI and the native inputs in [science/B08.md](/Users/aaronring/Forge-rebuild/2026-10-01/forged/science/B08.md). Drive the following observable workflow:

1. Create the source session with ipSAE and Boltz2 selected. Once base is ready, import its fixture and execute the base command while Boltz2 still prepares. Record base readiness and each science tool's preparation time.
2. Stage the native inputs, wait for the required tool, and run the documented ipSAE and Boltz2 commands. Require actual GPU execution for Boltz2. Inspect the requested output files and native logs with the bundled checkers; retain command IDs and fresh output directories for any later explicit run.
3. Save a completed checkpoint, download and inspect the outputs, then close. Confirm owned VM and tunnel removal and stopped billing from the actual provider/control-plane path. Record the persistence outcome separately.
4. Create a new session from the completed checkpoint after source cleanup. Verify restored files and staged inputs, including the chosen version and any deleted path, through explicit checker commands. Close that session and confirm cleanup again.

Capture elapsed startup, asset transfer, native execution, and final cost alongside the observed cleanup state. Native command success and structurally complete files qualify this small execution case. Scientific usefulness still requires the appropriate domain evaluation.

Run the maintained local acceptance again only after a change affects its covered behavior. This campaign removes the Docker, object-storage, tunnel, and provider substitutes used by the local tests. Keep the ordinary authentication, durable request IDs, explicit command recovery, and existing billing path.

## Work after the gate

B09 adds BindCraft2 and FreeBindCraft recipes with shared AF2 assets. B10 can then add the Vast full-VM adapter in parallel. B11 qualifies each advertised scientific/provider combination. Wider tools, custom installation, multi-GPU scheduling, warm pools, snapshots, and migration remain deferred.

The next action is to prepare the concrete B08 remote GPU build, qualification, and publication campaign from the integrated branches. The current integration bite ends with local acceptance and this handoff; cloud allocation and publication require the B08 task to be taken up.
