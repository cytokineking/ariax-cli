**B04: CLI commands and platform skill**

Implement this bite in the assigned CLI worktree on current main. Read `AGENTS.md` and `docs/forge-contract.md` first. The user requires a robustly simple implementation with no hashes/checksums/pins, backwards compatibility, or fallback paths. Ariax controls the images and weights.

You own the Forge command module, command dispatch/help, small request records, the platform skill, and focused existing CLI/package coverage. B02 owns the daemon; B03 owns the API. Use `/api/v1/forge` on the existing authenticated CLI API origin. The CLI never needs a host endpoint or runtime bearer token.

Implement the create/list/status, tools/add/wait, run/commands/command/watch/logs/cancel, and close surface exactly as documented in the contract. Use existing argument, HTTP, JSON output, and error conventions. Additions that depend on B05 remain normal API calls and surface its current unavailable response clearly. File commands are B06 and should remain absent from the implemented command list.

Generate and save session/command IDs before submission. Reuse/export the current atomic writer and account lookup. Store a small plain request record under `.ariax/forge/{id}.json` with its ID, actor, API origin, request, and latest result. Compare fields directly for a replay. Existing managed-job operations include hashes and compatibility handling; leave them intact and avoid pulling that format into Forge. No generic journal framework is needed.

Expose `--session-id` for create and `--command-id` for run so the agent can recover a lost acknowledgment. Wait/watch timeouts stop local polling while the remote operation continues. Print the ID promptly. The skill should explain base availability, per-tool readiness, direct command execution, cancellation/close, and currently deferred file durability.

Historical CLI behavior and scientific guidance live at `8d0b15cf5b13d2bc2ea7c95bef8e9626fbc332be`, tagged `archive/forge-20261001/forge-skills-final`. Separate guidance is at `421046e`, and the old atomic-publication correction is at `cbbd300`. Consult these as source material. Do not port old direct-host modes, hashes, digest fields, environment generations, compatibility adapters, or the large evidence directories.

Exercise the installed CLI against an HTTP boundary for the meaningful create/run/wait/cancel/close path and lost-response recovery. Retain existing managed BindCraft2/input/skill behavior. Reuse tests before adding cases, and run the relevant package checks. Avoid checking source strings, snapshots of every schema, or mocks that only echo their configured result.

Use GPT-6.1 at xhigh as configured by the orchestrator. Work only in the assigned worktree. Do not change the common contract independently, create more chats/worktrees, publish packages, rent compute, or deploy. Commit the finished bite on the assigned branch. Report the commit, changed command surface, test commands/results, and remaining integration needs in this chat. The orchestrator will read it.
