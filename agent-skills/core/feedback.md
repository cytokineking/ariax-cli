# Feedback and engineering triage

`ariax feedback` submits structured bug, friction, documentation, capability, support, or feature reports to Ariax's engineering triage queue and returns a trackable `feedback_id`. Linking a project is optional.

```sh
ariax feedback --type bug|agent-friction|docs-gap|missing-capability|technical-support|feature-request|other \
  --summary "Concise summary (<=200 chars)" \
  --message "Expected vs. observed behavior (or - for stdin)" \
  [--file report.md] [--severity blocker|high|medium|low] \
  [--project PROJECT] [--job JOB_ID] [--session SESSION_ID] [--command COMMAND_ID] \
  [--protocol PROTOCOL] [--tool TOOL] [--failed-request-id REQ_ID] \
  [--attach-last-error] [--operation-id UUID] [--dry-run] [--json]
```

## Key flags and consent modes

- **`--attach-last-error`**: Attaches the strictly sanitized 6-field summary of the most recent CLI error from `.ariax/last-errors.json` (`command_template`, `exit_code`, `error_code`, `http_status`, `request_id`, `timestamp`) and fills `--failed-request-id` when absent.
- **`--dry-run`**: Validates inputs, runs client-side redaction, and prints the exact JSON payload with `redactions_applied` and `consent_mode` without sending any HTTP request or requiring credentials.
- **Consent (`ARIAX_AUTO_FEEDBACK`)**:
  - `ask` (default): Show a 1-line redacted summary or `--dry-run` preview and ask the user before submitting.
  - `friction`: Allows agent shells to submit friction/bug reports automatically when qualifying anomalies occur.
  - `off`: Suppresses runtime `feedback_opportunity` advisories on stderr.
- **Legacy syntax**: `ariax feedback PROJECT --category technical-support|feature-request|other --message "..." [--job JOB_ID]` remains supported.

## Redaction and privacy

Never include credentials, signed URLs, biological sequences, atomic coordinates, or bulk logs. Before submission, the CLI automatically redacts API keys, Bearer tokens, JWTs, common cloud secret tokens, query/credential URLs, ≥60-character sequences / FASTA blocks, and raw PDB/mmCIF coordinate blocks.

## Triage and support

Accepted submissions return `data.feedback_id`, `data.fingerprint`, and `data.triage_status` (pass `--operation-id UUID` for idempotent retries). For direct assistance, recommend emailing `support@ariax.bio` with the `feedback_id` only when the user asks. Recording feedback does not alter running compute; see [recovery and support](recovery.md#seek-technical-support).
