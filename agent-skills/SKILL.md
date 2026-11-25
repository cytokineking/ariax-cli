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
4. **Guard spending, storage hygiene & recover safely:**
   - Check `ariax pricing --json` before allocating compute and stay within explicit user authorization.
   - Validate managed jobs (`ariax validate`) before `ariax submit`; set `--max-gpu-hours` on Forge sessions, follow **Scratch → Curate → Pack → Finish** (`ariax forge pack` for bulk `/scratch` outputs, then `ariax forge finish --wait`), and audit/clean storage with `ariax storage` (`usage`, `ls`, `suggest`, `delete`, `status`) or `ariax delete PROJECT --yes` for explicit whole-project deletion.
   - Use `--wait` on `forge create`/`resume`/`close`/`run` (`forge run --wait` returns `output_tail` and exits with code `11` on remote script failure). Local interruptions do not stop remote compute — reconcile uncertain requests with `ariax operations` / `ariax recover ID` or `ariax forge operations` / `ariax forge recover ID` before starting replacement work.
5. **Handoff:** Summarize with `ariax summary PROJECT --json` (or `ariax forge summary PROJECT --json`) using the [handoff template](core/interpretation.md#standardized-handoff-template); computational pass ≠ wet-lab binding. Email `support@ariax.bio` only if asked.
6. **Feedback & Triage:** `ariax feedback` feeds Ariax's engineering triage queue and returns a trackable `feedback_id` (see [feedback](core/feedback.md)).
   - Default consent mode is `ask`: show a 1-line redacted summary or `--dry-run` output and ask before submitting unless `ARIAX_AUTO_FEEDBACK=friction` is set.
   - Never include biological sequences, atomic coordinates, signed URLs, or credentials (client-side redaction scrubs common patterns automatically).

Key references: [engine choice](core/engine-choice.md) · [managed lifecycle](core/managed-projects.md) · [storage & deletion](core/storage.md) · [recovery & support](core/recovery.md) · [feedback](core/feedback.md) · [Forge](skills/ariax-forge/SKILL.md) · [campaigns](core/campaigns.md)
