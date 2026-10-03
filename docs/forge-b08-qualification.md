# Forge B08 qualification, October 2, 2026

B08 passed the remote image checks and the installed-CLI Hyperstack campaign. Base and ipSAE produced their expected outputs. Boltz2 completed one native GPU prediction in 54.6 seconds, and its output files passed the checks below. A fresh VM restored the selected checkpoint after the source VM had been deleted. Both sessions closed with verified provider, tunnel and DNS cleanup. The separate builder was also deleted.

## Scope and environment

The installed CLI used the public Next.js agent API, API-key authentication and signed backend requests. FastAPI and ARQ drove the ordinary provider/bootstrap/runtime path. The campaign used real Hyperstack L40 full VMs, Docker, Cloudflare tunnels and private R2 object transfers.

A disposable Supabase stack hosted Auth, PostgREST and PostgreSQL on the remote builder, with 59 accepted migrations applied. Its dedicated campaign user received test credits, and `DEVELOPMENT_MODE=0` exercised the normal credit debit. Redis and the API/worker ran in a separate local campaign directory. Production deployment remains a later release step.

All images were built on the remote Linux amd64 L40 VM. The workstation ran the control plane and CLI. There were at most two concurrent GPU VMs: the builder and one Forge session. The source session was fully closed before restore creation.

## Private publication and host access

The published tags are `ghcr.io/cytokineking/ariax-forge-base:b07`, `ghcr.io/cytokineking/ariax-forge-ipsae:b07` and `ghcr.io/cytokineking/ariax-forge-boltz2:b07`. All packages remain private. The recorded registry check returned HTTP 200 for authenticated manifest access and HTTP 401 for anonymous access to each tag.

Bootstrap accepts `FORGE_GHCR_USERNAME` and a separate `FORGE_GHCR_READ_TOKEN` scoped to `read:packages`. It writes standard Docker auth under `/etc/ariax-forged/docker`, with directory mode 0700 and file mode 0600. The daemon's systemd unit selects that directory through `DOCKER_CONFIG`. Fresh source and restore VMs pulled the private images. Workload inspection confirmed UID/GID 10001, read-only roots and input/model mounts; host credentials and the Docker socket remained outside workload mounts.

The complete `boltz2` asset contains `mols.tar`, extracted `mols/`, `boltz2_conf.ckpt` and `boltz2_aff.ckpt`. Its tar contains 8,106,342,400 bytes and was uploaded to the private `ariax-model-artifacts` bucket at `ariax-forge/science-models/b08-2026-10-02/boltz2.tar`. Model preparation checked all 45,230 regular files for workload readability. Publication took 88.3 seconds through multipart upload.

The full deployment catalog stayed outside Git in protected configuration selected by `FORGE_CATALOG_PATH`. Its model URL was a temporary authorized HTTPS URL. Generate a fresh URL with enough lifetime for preparation before a later deployment. The checked-in base/ipSAE catalog and the visibly unqualified Boltz2 example are documented separately in the runtime science directory.

## Execution and persistence

| Observation | Evidence |
|---|---|
| Partial readiness | Source base execution and checks completed while Boltz2 was installing. The restored base checks also ran before Boltz2 readiness. |
| Inputs | All eight local fixture files imported through the installed CLI; restored input bytes matched every original fixture. |
| Base | Native Python created the expected one-line JSON output; its checker passed on both sessions. |
| ipSAE | Native vendored v3 executable produced directional values A→B 0.212489 and B→A 0.063193, with expected by-residue output. The restored output checker passed. |
| GPU | CUDA tensor execution used an NVIDIA L40, Torch 2.9.0+cu128 and CUDA 12.8 at workload UID 10001. |
| Boltz2 | Native 2.2.1 prediction used three recycles, 200 diffusion steps, one sample and seed 7. Docker recorded 54.561 seconds. Requested CIF, confidence JSON, PAE and pLDDT files were present. |
| Output inspection | Chains A/B matched the two eight-residue inputs; coordinates and confidence values were finite. PAE had shape 16×16, and pLDDT had 16 entries. The fresh restored session passed the same checker. |
| Checkpoint versions | Checkpoint one had 26 files and 32,384 bytes. Checkpoint two had 25 files and 32,374 bytes, containing the newer version and omitting the deleted path. Downloads confirmed both versions. |
| Restore | The source VM was absent before destination creation. The destination began with an empty command journal and ready restored inputs. Four explicit Python checks passed; no prediction was replayed. |
| Closed downloads | The source's newer file remained downloadable after close. After the restored VM closed, its CIF and newer version downloaded from the final checkpoint and matched the source bytes exactly. |

The Boltz fixture is a synthetic sixteen-residue execution case with empty MSAs and no affinity request. Its observed pTM was 0.240379 and iPTM was 0.226511. These measurements describe this fixture; biological binding accuracy remains outside its scope. Boltz2-to-ipSAE token mapping also remains unqualified.

Source session: `4ff33167-8498-465e-8407-45d9ef9d0c83`, provider VM `1078555`. Restore session: `6a3950c6-b69a-451e-9f00-d54960449621`, provider VM `1078576`. The selected restore checkpoint was `19178308-17c1-420a-ab60-bde5ef652d49`. Both source and restored sessions saved a later final checkpoint during close.

Polling first observed source base readiness at 22:08:40 UTC and all source tools ready by 22:18:09. The restore VM's base was ready at 22:31:02, with Boltz2 ready at 22:50:56. These are observation bounds. The restore's cold image/model preparation occupied about twenty minutes after base readiness, while the base and ipSAE output checks remained usable. This transfer variability is recorded for later deployment sizing.

## Corrections and verification

The remote build exposed unconstrained cuEquivariance dependencies replacing the intended Torch family. The recipe now selects Torch 2.9.0 and cuEquivariance 0.5.1, and includes the C/C++ toolchain required by native Triton compilation. Earlier failed attempts remain in the image evidence; the successful corrected prediction used a new output directory.

The private-pull smoke check exposed a Docker SDK constructor mismatch: a normalized `http+docker://localhost` value was unsuitable for constructing another API client. The pull client now converts that exact local value to the Unix socket URL while preserving injected HTTP endpoints. Standard SDK auth loads from the root-only Docker configuration.

The first live local upload exposed three S3 client call sites that treated a botocore client as a context manager. They now use `contextlib.closing`. The import had not been accepted, and retrying the same input ID after correction succeeded. A regression case now drives signed HTTP upload admission through the real botocore presigner with dummy credentials. That case catches the observed SDK incompatibility without sending a storage request.

| Check | Result |
|---|---|
| Existing backend lifecycle cases | 10 passed using a short temporary socket path. |
| Final backend file integration cases | 2 passed, including the real SDK presigner regression. |
| Joined file/lifecycle workflow after the S3 correction | 4 existing scenarios passed. |
| Runtime pull, cancellation and installation cases | 21 passed; the real Docker SDK config smoke check also passed. |
| Formatting | Four changed backend Python files passed Black; integration diffs passed whitespace checks. |
| Live campaign | Native execution, private pulls, input import, checkpoints, restore, closed downloads, billing and cleanup passed. |

The first lifecycle test attempt used a temporary Unix-socket path longer than the platform limit. Repeating with a short base directory passed. A new regression assertion initially compared an encoded URL path to a decoded key; correcting that assertion made the SDK test pass. These test-harness corrections are retained in the local logs.

Accepted implementation commits before this report: backend `6b2faab65a12cf1b819e54237aa027b84374016d`, runtime `5d7b96b` and CLI `10753ec`. Backend includes private registry bootstrap, the campaign preparation scripts and the storage fix. Runtime includes the complete asset preparer and qualified image recipes. CLI behavior during the campaign used the accepted B05–B07 implementation.

## Billing, cleanup and retained evidence

| Resource | Elapsed hours through confirmed absence | Provider estimate |
|---|---:|---:|
| Remote builder and disposable database | 1.8020 | $1.8142 |
| Source Forge VM | 0.3425 | $0.3448 |
| Restored Forge VM | 0.4374 | $0.4404 |

The provider estimate uses the live quoted L40 plus public-IP rate of $1.00672043/hour, from each allocation/start record through confirmed absence. Confirmation lag makes this a conservative elapsed-time estimate; the provider invoice can differ. Total estimated provider compute cost was $2.60. The user's compute ceiling was $100.

Each disposable Ariax instance has one credit transaction matching its accumulated cost. `last_billing_check` and `stopped_at` equal the recorded close request, at the configured customer rate of 2.5 credits/hour. These test-account debits are distinct from the provider estimate. Both Forge instances reached `verified_terminated`; Cloudflare confirmed their tunnels deleted and DNS records absent.

The builder `1078494` was confirmed absent at 2026-10-02T22:54:01.039018+00:00. Final provider inventory confirmed that all three owned VMs were absent. Dedicated local API, worker, frontend, Redis and SSH-forward processes were stopped after the last closed-session downloads. Published private images and the private model archive remain available for subsequent work.

Evidence is preserved at `/Users/aaronring/Forge-rebuild/2026-10-01/evidence/b08-2026-10-02`. Its manifest lists native logs, output files, checkpoint/session records, publication metadata, cleanup and billing records, and the small remote image evidence bundle. A credential scan passed before copying. Credentials and temporary authorized URLs remain outside that evidence directory and Git.

The subsequent [B12 report](forge-b12-qualification.md) records completed native and lifecycle acceptance across both providers. Current deployment requirements are in [the release handoff](forge-release.md).
