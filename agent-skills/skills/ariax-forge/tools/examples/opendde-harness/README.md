# Harness scientific workflow examples

[controller.md](controller.md) describes the qualified deterministic native
controller and explicit continuation. `controller-cycle.yaml` and
`controller-continuation.yaml` supply the one- and two-cycle CRLF2/VHH settings.
Both scoped campaigns completed with GPT-6.1. Keep `fold.deterministic: true`;
the guide explains that the current worker does not enforce that restriction
for arbitrary callers. Historical default/nondeterministic comparisons failed.

No paid Quality phase ran: each qualified cycle had zero Quality targets.
Account/project admission used a fixture, and fresh logical sessions shared one
physical GPU host. The accepted continuation cases preserve completed outcomes
and original operation IDs. See the controller guide for scientific settings,
authentication, resource requirements and explicit continuation commands.

`bridge.mjs` is a separate saved-batch adapter. It uses installed CLI argument,
UUID, atomic-write and output helpers, so keep it inside the package and use
Node >=20 on the trusted remote controller. Read [the saved-batch guide](../../opendde-harness.md)
for prepare, submit, status, stop and explicit item continuation. It does not
restore the native optimizer. Its explicit PyTorch triangle kernels differ from
the native controller's auto kernels; its numerical comparison remains failed.

Inputs under `task/`, `batch-run/` and `fold-request.json` are authored source
examples rather than completed native results. Their native batch positions,
sequences, seed, flags and environment must match the actual original FoldRequest
when used with real data. Successful outputs require all four native file roles
for each original seed/sample. Missing outputs remain unavailable, and pending
or failed work must be reported honestly. Check current catalog admission before
using either workflow. A source recipe alone does not enable a tool.
