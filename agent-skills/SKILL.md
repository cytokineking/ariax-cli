---
name: ariax-agent-access
description: Route protein design, structure prediction, and molecular workflows across Ariax managed protocols and Forge via the Ariax CLI.
---

# Ariax agent workflow

1. **Discover first (no auth needed):** Run `ariax discover --query "<goal>" --json` to pick between a **managed protocol** and **Forge**, then read only the selected guide:
   - Managed: `ariax skills PROTOCOL --read --json` and `ariax skills --reference managed-projects --read --json`
   - Forge: `ariax forge catalog --tool TOOL --with-guide --json` and `ariax skills forge --read --json`
2. **Managed vs. Forge:**
   - **Managed project** (`bindcraft2`, `boltzgen`, `pxdesign`, `bindcraft-v1.5`, `esmfold2-pipeline`): turnkey binder design with automatic compute, artifacts, and cleanup.
   - **Forge** (`ariax forge`): interactive GPU/CPU sessions for structure prediction, inverse folding, scoring/QC, search, or custom multi-stage pipelines — you manage commands, syncs, and session closure.
   - Managed and Forge settings differ even for shared engine names; always check the live schema or tool catalog.
3. **Authenticate:** Check `ariax me --json`. If unauthenticated or rejected, ask the user to run `ariax login` with a key from <https://www.ariax.bio/settings/api-keys>. Never ask for, print, or inline API keys in argv, URLs, or job JSON.
4. **Guard spending & recover safely:**
   - Check `ariax pricing --json` before allocating compute and stay within explicit user authorization.
   - Validate managed jobs (`ariax validate`) before `ariax submit`; set `--max-gpu-hours` on Forge sessions and explicitly `ariax forge finish` / `close` when done (idle time is billed).
   - Local interruptions do not stop remote compute. Reconcile uncertain requests with `ariax operations` / `ariax recover ID` or `ariax forge operations` / `ariax forge recover ID` before starting replacement work.
5. **Handoff:** Report computational scores alongside native filters and caveats (see [interpretation](core/interpretation.md)); computational pass ≠ wet-lab binding. Record project-linked bugs or feature requests with `ariax feedback` (see [feedback](core/feedback.md)); email `support@ariax.bio` only if asked.

Key references: [engine choice](core/engine-choice.md) · [managed lifecycle](core/managed-projects.md) · [recovery & support](core/recovery.md) · [Forge](skills/ariax-forge/SKILL.md) · [campaigns](core/campaigns.md)
