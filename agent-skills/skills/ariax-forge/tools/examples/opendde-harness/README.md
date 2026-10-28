# Harness workflow examples

Use [controller.md](controller.md) to run the native deterministic controller
and explicitly continue saved optimizer state. `controller-cycle.yaml` and
`controller-continuation.yaml` supply one- and two-cycle CRLF2/VHH ABAG
workflows using `openai-codex/gpt-6.1-sol`. Keep `fold.deterministic: true`;
the worker accepts false, but nondeterministic execution is outside this
documented scope. Paid Quality phases, arbitrary workloads and separate-host
recovery are not established by these examples. Scores do not establish
experimental binding.

Locate these files with `ariax skills forge --tool opendde-harness --json` and
set `HARNESS_EXAMPLES` to `data.examples["opendde-harness"]`. Inspect the live
catalog's exact tool/model/mode and resources before using either workflow.
The controller guide covers model dependencies, authentication, limits and
the original operation IDs required for continuation.

`bridge.mjs` is a separate adapter for already prepared fold batches. Keep it
inside the installed CLI package and use Node >=20 on a trusted remote
controller. Read [the saved-batch guide](../../opendde-harness.md) for prepare,
submit, status, stop and explicit item continuation. It does not restore the
native optimizer or compute native loss/gates. Its explicit PyTorch triangle
kernels differ from the controller's auto kernels; numerical equivalence is
not established.

Files under `task/`, `batch-run/` and `fold-request.json` are authored source
inputs. Match their native batch positions, sequences, seed, flags and
environment to the actual original FoldRequest before using real data.
Successful outputs require all four native file roles for each original
seed/sample. Missing outputs remain unavailable; pending and failed items
retain those states. These inputs are not completed native results.
