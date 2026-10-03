# CLI repository

This is the Node.js Ariax CLI. Reuse its existing argument parsing, HTTP client, output/error conventions, atomic file writer, and test runner. Read docs/forge-contract.md and docs/forge-release.md for the current interface and deployment requirements. Keep managed-job behavior intact and credentials out of source/logs.

Use concise spoken prose and describe concrete behavior. Avoid em dashes, rhetorical contrasts, filler, and corporate language.

## Forge implementation constraints

The user directs a robustly simple implementation. Ariax controls the images and weights. Use the current contract in docs/forge-contract.md.

- Do not add artifact hashes/checksums, image digest pins, request hashes, content-addressed caches, signed install plans, identity graphs, verification receipts, or per-command image/weight checks.
- Do not add backwards compatibility, legacy runtime/API modes, fallback providers/transports, or automatic scientific replay.
- Keep authentication, project authorization, container isolation, safe paths, durable request IDs, direct field comparison, allocation ownership, and billing/cleanup correctness.
- Use ordinary image tags, named shared assets, completed-download atomic moves, and Docker's own transfer behavior.
- Build and qualify images on remote GPU VMs. Never build images on the user's workstation or require its Docker daemon for this campaign.
- Prefer existing integration coverage through real application paths. Add a test only for a named plausible failure and an actual coverage gap. Mock only impractical external boundaries. Avoid source inspection, constant assertions, duplicated schema snapshots, private call-sequence checks, and tests that only echo configured mocks.

B12 implementation and staging qualification are accepted. Read docs/forge-b12-qualification.md for native, lifecycle, restoration and cleanup evidence, and docs/forge-release.md for the release handoff. The B11 early-close trigger remains historically unexplained. Keep GHCR packages private and host registry credentials outside workloads. Production rollout is separate. Completed worker assignments are retained through docs/forge-history.md.
