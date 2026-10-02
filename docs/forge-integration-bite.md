# Forge integration and local acceptance

The user authorized the next bite on October 2, 2026. The orchestrator combines the reviewed B05/B06/B07 commits, applies the lifecycle hooks and existing-test corrections, and owns acceptance decisions. This bite finishes the local integration gate before image publication and the live B08 Hyperstack campaign.

The current contract is `docs/forge-contract.md`. Preserve the user's requirements for ordinary image tags and named assets. Keep one current API and runtime format, existing authentication and billing, and explicit scientific commands. Do not add hashes/checksums, digest pins, compatibility machinery, fallback paths, or automatic scientific replay.

## Source and ownership

The canonical integration workspaces are:

- Backend: `/Users/aaronring/.codex/worktrees/forge-v2-integration/Ariax-Bio-Backend`.
- Runtime: `/Users/aaronring/Forge-rebuild/2026-10-01/forged`.
- CLI: `/Users/aaronring/Forge-rebuild/2026-10-01/cli`.

Only the orchestrator edits those integration workspaces. Workers use the existing isolated worktrees assigned in their follow-up prompts. They read integration sources for acceptance, put scratch data in their own temporary directory, and commit their own changes. Keep at most three workers active, using the existing GPT-6.1 xhigh chats.

| Worker | Owns | Acceptance |
|---|---|---|
| Runtime verification | Runtime README and focused runtime integration coverage in its assigned runtime worktree. | The combined runtime suite passes, including file recovery after rejected startup and a genuine process crash, command isolation, preparation, restore admission, close, and durable output after expiry. Native CPU checks retain their actual qualification limits. |
| Joined workflow | A small maintained backend/frontend acceptance harness and its instructions in the assigned backend worktree. | Real CLI/public proxy/signed backend/SQLite flow with disposable PostgreSQL and Redis. Cover input import, versioned checkpoints, deletion/restore, post-close download, and output durability before provider cleanup while preparation cancels. |
| CLI references | `src/commands/skills.js`, shared skill indexes, Forge guide cross-links, and existing CLI/package coverage in the assigned CLI worktree. | `ariax skills forge --reference outputs|base|ipsae|boltz2 --read --json` and the existing Forge alias work from installed package forms. Discovery exposes those references and example paths; current managed-tool guides still work. |

The orchestrator owns shared contract changes, dependency manifests, production behavior fixes, branch integration, and all future live cloud work. A worker reports a production defect with a reproduction before changing code outside its assignment. There is no need for another abstraction or test framework. Reuse the existing pytest, Vitest, Node, and disposable database facilities. New tests must protect a concrete untested behavior and use real application paths, substituting unsafe or impractical cloud boundaries.

## Existing evidence

The initial review and corrected combined sources are under `/private/tmp/forge-wave2-fix-review`. The earlier full CLI workflow is under `/private/tmp/forge-wave2-audit/joined`. The slow-pull controller check is in `/private/tmp/forge-b05-close-review-5ga4gi5a/joined/test_close_checkpoint.py`. These are source material for a compact maintained workflow, rather than directories to copy wholesale. Preserve the original evidence while working in separate temporary copies.

The first combined follow-up passed both original regressions and all three controller cases. Two older close tests now wait through `closing` until health is terminal before checking installer and temporary-file cleanup. The lifecycle hooks and those adjustments are already applied in the canonical runtime integration workspace.

Use current integration paths or explicit test environment variables instead of permanent references to old worker worktrees or temporary audit directories. Keep AWS SDK versions compatible within each test process. Existing local dependency environments can be reused for this run; adding production dependencies belongs to the orchestrator.

## Handoff

Commit the finished assignment and report the actual test commands/results and any remaining integration needs in the current worker chat. Do not create more chats, agents or worktrees, rent compute, publish, deploy, or apply production SQL. Leave messages to other chats to the orchestrator. Image builds, the controlled Boltz2 asset publication, and native GPU execution remain the next B08 gate.
