# Forge implementation history

Current behavior is defined by [the contract](forge-contract.md), with deployment requirements in [the release handoff](forge-release.md). The B08, B11 and B12 qualification reports retain the scientific and lifecycle evidence.

Completed worker briefs, implementation plans, intermediate audits and superseded integration patches were archived during repository consolidation on October 3, 2026. Their committed versions remain under `archive/cleanup-20261003/codex/forge-v2-integration`. Individual worker tips use `archive/cleanup-20261003/<original-branch-name>`. Earlier `archive/forge-20261001/*` references remain available.

Retrieve a historical file from the local Git archive with:

```sh
git show archive/cleanup-20261003/codex/forge-v2-integration:docs/forge-rebuild-plan.md
```

Private bundles, uncommitted snapshots and extracted documents are preserved outside the repositories at `/Users/aaronring/Forge-rebuild/2026-10-03-cleanup`. The extracted documents for this repository are under `scratch-documents/cli`. This archive contains private local state and stays outside public packages. Historical documents describe their recorded implementation stage; use the current contract for new work.
