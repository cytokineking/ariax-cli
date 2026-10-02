# Forge B09/B10 dispatch, October 2, 2026

The user requested the next bites with concurrent worker chats. Three existing GPT-6.1 xhigh workers have started their assignments. The orchestrator verified all three active after dispatch. Each works on a fresh branch from the accepted B08 integration plus the shared B09/B10 contract. Earlier worker branches remain preserved.

## B09 recipes

Scope: BindCraft2 and FreeBindCraft images, native cases and output checks. Chat ID: `01a0fda9-71b6-7131-9e70-dd93b17f59f8`.

- Worktree: `/Users/aaronring/Forge-rebuild/2026-10-01/b07-forged`
- Branch: `codex/forge-b09-recipes`
- Accepted base: `d5fecbf94dd20686999691bff422f2bb68411cad`
- Prepared assignment: `d9df083114ff087c8d16cc104e7610280da6639f`

Read the committed `docs/forge-b09-b10-worker.md` in the assigned checkout for writable paths and acceptance requirements.

## B09 assets and guides

Scope: Shared alphafold2 asset preparation and both CLI guides. Chat ID: `01a0fda8-8823-7b73-bea6-5ae6d69a8c58`.

- Worktree: `/Users/aaronring/Forge-rebuild/2026-10-01/b05-forged`
- Branch: `codex/forge-b09-assets`
- Accepted base: `d5fecbf94dd20686999691bff422f2bb68411cad`
- Prepared assignment: `6f5e40bf67cc7c625300261706de39bd476320f9`

- Worktree: `/Users/aaronring/Forge-rebuild/2026-10-01/b07-cli`
- Branch: `codex/forge-b09-guides`
- Accepted base: `51768fc327a94e9dda62eb9d31abcec8340cb99a`
- Prepared assignment: `e60077314bcdbae533ec80d912a66c5c09298ded`

Read the committed `docs/forge-b09-b10-worker.md` in the assigned checkout for writable paths and acceptance requirements.

## B10 Vast adapter

Scope: Vast full-VM selection, ownership, lifecycle and billing coverage. Chat ID: `01a0fda9-2313-76c1-8b1e-78e387e5eabb`.

- Worktree: `/Users/aaronring/.codex/worktrees/0256/Ariax-Bio-Backend`
- Branch: `codex/forge-b10-vast`
- Accepted base: `77574e12e6aca29d5a3f2a336b442586e113949b`
- Prepared assignment: `5557bca82b7152218cb7c198b331bb6c69e0a137`

Read the committed `docs/forge-b09-b10-worker.md` in the assigned checkout for writable paths and acceptance requirements.

## Coordination and acceptance

The [shared contract](forge-contract.md) fixes the AF2 asset name and fifteen-file parameter layout. Recipe work and asset preparation can proceed concurrently. Concrete CLI native examples depend on the recipe worker's early command/settings/output contract, which the orchestrator relays before guide acceptance. Vast work proceeds independently in the backend. Its server-only admission switch defaults off until B11 live acceptance; cleanup of accepted sessions remains available when that switch is off.

Workers own implementation and proportionate checks within their assigned paths. The orchestrator owns shared contracts, integration and cloud resources. Remote image builds and large model operations begin after a fresh GPU builder is assigned. All B08 VMs were deleted; their recorded addresses are historical. Keep GHCR packages private. The completed B08 provider estimate was $2.60 against the existing $100 compute ceiling.

The next orchestrator check reviews the two B09 source/asset reports, aligns the native guide contract and prepares the bounded remote build stage. Review the Vast diff and application-flow evidence when its worker finishes. B11 remains the release qualification step for newly advertised tool/provider combinations.
