**B05: installation queue and named assets**

Use the runtime worktree assigned in your chat. Read `AGENTS.md`, `docs/forge-contract.md`, and the B05 section of `docs/forge-next-turn-plan.md`. The B05–B07 extension is the current shared boundary. The user requires ordinary image tags and named assets with no added checksums, digest pins, request hashes, compatibility, fallback, or scientific replay.

Implement one durable preparation queue in the existing SQLite journal. Prepare base first. Honor bootstrap selection order and later tool priorities. Keep ready tools and accepted commands usable while another tool installs or fails. Only an explicit selection retries a failed tool. Share published named assets and use Docker's normal image pull. Failed/interrupted downloads or extraction remain private until complete. Set read permissions explicitly under umask 0077 and reject unsafe archive members.

You own new `forged/installer.py`, `forged/assets.py`, and changes to `runtime.py`, `store.py`, `models.py`, and `docker_runtime.py`. Reuse runtime tests and fixtures where useful. B06 owns `app.py`, `config.py`, `paths.py`, file/storage modules, and its new test files. B07 owns `science/`. Package manifests and the contract belong to the orchestrator. Keep existing `/tools` request/response shapes and bootstrap settings; no app/config changes are required to consume the existing ordered selections.

Prove priority, restart recovery of unfinished preparation, shared-asset reuse, and atomic publication through HTTP/SQLite with tiny local transfer fixtures. A ready command must execute while another installation is held or fails. Extend existing coverage for concrete gaps; avoid assertions of source text or private call sequences. Keep GPU execution unqualified until B08. Do not copy old checksum/install-generation machinery from historical branches.

Commit the finished bite. Report its commit, tests, and any exact cross-bite glue needed in your own chat. The orchestrator reads it. Do not start other chats/worktrees, publish, deploy, rent compute, or edit B06/B07 worktrees.
