# Forge B12 qualification

Updated October 3, 2026. The approved B12 implementation and staging acceptance are complete. The installed CLI exercised tool selection, late model grants, native GPU work and lifecycle recovery. Both Ubuntu versions passed the managed installer. Cross-provider restoration and normal-worker credit exhaustion and expiry passed. Campaign resources were deleted. The earlier B11 closure remains historically unexplained; the repeated workload completed without that failure.

## Implementation and verification

Tool selections have durable UUIDs and a backend record separate from the original create request. Repeating an accepted selection preserves its result, and a new selection explicitly retries failed preparation. Queued priorities can change while active preparation continues. A stale health report cannot erase newly selected tools. The CLI saves selection IDs before dispatch and documents how to reuse them.

The backend catalog stores asset object keys and archive formats. Immediately before downloading an absent model, the daemon requests a temporary URL through its session-authenticated HTTPS callback. Storage credentials stay in the control plane. Completed shared assets are reused by name. The callback refuses redirects and validates its response and expiry.

Policy inspection uses one firewall snapshot while checking the existing isolation rules. Errors distinguish a policy mismatch from a failed observation. Timed-out probes terminate their process groups, and failure still closes admission. Installation supports Ubuntu 22.04 and 24.04 with managed Python 3.12. Before changing storage, the installer checks actual Docker and containerd inventories and preserves existing stores.

The integrated runtime suite passed 80 tests. Twenty-six backend cases passed through PostgreSQL, Redis, file persistence and the installed CLI. The Vast adapter/client checks passed 134 tests after the live saved-offer correction. Two focused HTTPS callback and authorization/expiry cases passed after the callback fix. The CLI recovery workflow and npm/GitHub package-installation checks passed. Added coverage targets lost tool delivery, stale health, preparation retry, delayed grants, withdrawn provider offers and policy-probe descendants; it uses existing application flows and substitutes impractical external boundaries.

The combined runtime run first exposed a test race: its policy deadline changed after the observer had already started. Setting that deadline before startup made the controlled timeout case deterministic. The retained initial failure and corrected full run are in the evidence directory.

## Repeated Hyperstack workload

Baseline session `bf15780e-9646-447e-aec1-daf780daedf4` used the accepted pre-B12 release on Hyperstack L40 VM `1078988`. All five native workflows passed, including BindCraft2 design/MPNN and FreeBindCraft design/MPNN with three CUDA relaxations. Cancellation and a runtime restart passed. The same running container completed once across the restart.

The session stayed available beyond the original B11 failure interval. A delayed checkpoint, changed file version, deletion, archive download and subsequent command passed before explicit closure after about 34 minutes. Its archive held 43 workspace files and 16 inputs. Runtime, container, tunnel and control-plane observations were retained outside the VM. These observations establish a successful repeat; the deleted B11 journal cannot establish its original close trigger.

## Vast installation, selection and native work

Integrated session `e13c5886-de80-41ab-a75d-53c1cb93b58f` ran on Vast VM `53979315`, an actual Ubuntu 22.04 KVM guest with an RTX PRO 6000 Blackwell Workstation GPU, driver 580.95.05 and managed Python 3.12.15. Docker and containerd used the selected Forge storage. The host policy check passed, services were active, and Docker live-restore remained disabled as required by the failure-closure design.

The VM initially restored the Hyperstack checkpoint with an empty command journal. Every archived input and workspace file matched by bytes; the changed version and deletion survived. Restoration initiated zero native predictions.

After admission was disabled, a new Vast create returned `provider_unavailable` and created no session, job or instance. The existing session remained usable. A base command survived the API and normal-worker restart and finished once. While another base command ran, a controlled private-registry authentication failure left ipSAE preparation failed. Redelivery of the same selection stayed failed; a new explicit selection succeeded after authentication was restored. Priority changes moved queued FreeBindCraft ahead of BindCraft2 without interrupting Boltz2 preparation. Repeating the original create request returned the original session and project.

Boltz2 completed GPU prediction and passed its structure, confidence and PAE checks. BindCraft2 produced its trajectory and MPNN candidate. The first native FreeBindCraft attempt, seed 585694, completed normally but upstream rejected its trajectory for initial pLDDT 0.65 and clashes. Its checker correctly failed on zero completed designs. One explicitly recorded additional attempt used the same settings and thresholds, a fresh output directory and command UUID. Seed 765181 passed the native output checks, including the MPNN FASTA, all seven structures and three completed OpenMM CUDA relaxations. Both attempts remain in the evidence. The bounded scientific cases establish executable workflows.

Cancellation and a second runtime restart passed on Vast. The running command retained container `4015773274b5` and completed once. Container inspections confirmed UID 10001, read-only roots and input/model mounts, one shared AF2 directory, and no mounted host credentials.

Two live integration issues were corrected. The provider returned no saved offer for an offer-ID search even though the offer remained available. Revalidation now searches the recorded machine and still requires the exact saved offer and candidate fields; a withdrawn offer produces failure without allocation. The first staging admission also encountered the disposable database's disabled-provider policy. That failed session allocated no VM and remains recorded.

Cloudflare rejected the default urllib client identity before the model callback reached FastAPI. The daemon now sends the stable `ariax-forged` User-Agent. A controlled service update occurred with no active commands and kept failed preparations failed. A new explicit selection obtained fresh grants and installed both model archives. Session authentication, redirect refusal and expiry checks remain in place. The edge configuration was unchanged.

## Normal schedules, restoration and cleanup

The integrated staging stack used all 60 migrations, the public Next.js API proxy, FastAPI, Redis and the normal `start_worker.py` configuration. It had a disposable Supabase database and a campaign-only user. Provider credentials were limited to the two campaign providers. Production data was outside this stack.

The completed Vast archive held 97 workspace files and 18 inputs, totaling 5,292,296 uncompressed bytes. Checkpoint `00e9bb85-f40f-4778-b8ad-1c188d2bde98` saved that archive. With a long base command running, setting the disposable account balance to zero caused the normal credit janitor to pause the project and close the session at `2026-10-03T07:54:16.932417Z`. The final checkpoint retained the command's single start marker. The VM, tunnel and DNS record were confirmed absent. Billing stopped exactly at the close cutoff and matched one credit transaction.

Final session `20b6adcf-a9c2-4050-9a55-9b91606a45e1` restored the Vast checkpoint onto Hyperstack L40 VM `1079125`, using Ubuntu 24.04 and the final managed installer. All 115 archived files matched by bytes, the version/deletion checks passed, and a new native ipSAE run passed its directional-score checker. A long base command then waited for the configured 15-minute expiry. The runtime recorded `session_expired` and cancelled the active command. The configured expiry was `2026-10-03T08:10:29.587950Z`; the backend recorded its close and billing cutoff at `2026-10-03T08:10:37.109031+00:00`. Normal lifecycle processing verified provider, tunnel and DNS deletion. The final checkpoint retained its single start marker, and cold downloads after deletion passed the archive comparison and the newly produced ipSAE output checker. Neither lifecycle case issued a CLI close request.

Both terminal instance ledgers stopped at their recorded close timestamps and matched the corresponding credit transaction. Final inventories confirmed absence of every owned VM. The separate control VM, callback tunnel, DNS entry and local API, worker, frontend, Redis and SSH-forward processes were removed.

| Resource | Provider | VM | Hours through confirmed absence | Estimated cost |
|---|---|---|---:|---:|
| Control VM and disposable database | hyperstack | `1078981` | 2.2138 | $2.2286 |
| source Forge VM | hyperstack | `1078988` | 0.5732 | $0.5771 |
| restored Forge VM | vastai | `53979315` | 0.8285 | $1.2120 |
| expiry Forge VM | hyperstack | `1079125` | 0.2643 | $0.2661 |

B12 compute is estimated at $4.28. Including earlier campaigns, the cumulative estimate is $10.28 against the authorized $100 ceiling. Rates cover the recorded provider GPU/IP or Vast VM/disk quote through confirmed absence. Unitemized network, registry and storage charges are outside this estimate.

## Revisions and handoff

| Repository | Qualified implementation revision |
|---|---|
| Backend | `fbb993b618208f1496010b3ccd614448ecd513f2` |
| Runtime | `0c3c8fe002807b0384690c581e7315e8bea77806` |
| Cli | `92036ce61508e238d0dc84621c610753c4a59ea9` |

These revisions precede this documentation-only handoff. The live backend used `c3d02bbc1ad31e9f371c002c249886d5b7b172e3`; the final backend revision adds callback regression coverage with identical production files. The final Hyperstack installation used the recorded runtime revision. The installed CLI package used the recorded CLI revision.

Durable evidence is stored at `/Users/aaronring/Forge-rebuild/2026-10-01/evidence/b12-2026-10-03`. It includes successful and rejected native runs, byte comparisons, bounded diagnostics, test results, cleanup records, provider estimates and the installed CLI package. Known credentials and credential patterns were scanned, including archive members; protected deployment files are excluded.

Production deployment, Git pushes and public publication were outside this campaign. `FORGE_ENABLE_VASTAI` remains false by default. A deployment needs migration `20261003000000_forge_tool_selections.sql`, the coordinated revisions, a reachable HTTPS `FORGE_CONTROL_PLANE_URL`, and the existing protected `MODEL_ARTIFACT_R2_*` configuration. The B11 early-close trigger remains unproven. Broader tool families, user-installed software, multi-GPU execution and warm pools remain deferred.
