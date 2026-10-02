# CLI repository

This is the Node.js Ariax CLI. Reuse its existing argument parsing, HTTP client, output/error conventions, atomic file writer, and test runner. Read the assigned docs/forge-worker-b06.md or b07.md brief and docs/forge-next-turn-plan.md for this wave. Keep managed-job behavior intact and credentials out of source/logs.

Use concise spoken prose and describe concrete behavior. Avoid em dashes, rhetorical contrasts, filler, and corporate language.

## Forge implementation constraints

The user directs a robustly simple implementation. Ariax controls the images and weights. Use the current contract in docs/forge-contract.md.

- Do not add artifact hashes/checksums, image digest pins, request hashes, content-addressed caches, signed install plans, identity graphs, verification receipts, or per-command image/weight checks.
- Do not add backwards compatibility, legacy runtime/API modes, fallback providers/transports, or automatic scientific replay.
- Keep authentication, project authorization, container isolation, safe paths, durable request IDs, direct field comparison, allocation ownership, and billing/cleanup correctness.
- Use ordinary image tags, named shared assets, completed-download atomic moves, and Docker's own transfer behavior.
- Work only in your assigned worktree and bite. Coordinate contract changes through the orchestrator. Do not create more chats/worktrees, rent compute, publish, or deploy during bites 02–07.
- Prefer existing integration coverage through real application paths. Add a test only for a named plausible failure and an actual coverage gap. Mock only impractical external boundaries. Avoid source inspection, constant assertions, duplicated schema snapshots, private call-sequence checks, and tests that only echo configured mocks.
- Commit the completed bite, then report its changes, test commands/results, and integration needs in the worker chat. The orchestrator reads that chat.
