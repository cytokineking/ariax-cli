# Project feedback

Use `ariax feedback` to record a project-related problem, feature request, or
other observation for Ariax. Submit when the user asks you to report feedback
or has already authorized reporting the issue. If you notice an unrelated
improvement, offer a short report before submitting it. Do not treat routine
campaign monitoring as permission to upload commentary.

```bash
ariax feedback PROJECT_ID \
  --category technical-support \
  --message "The trajectory CSV is listed, but downloading it returns Archive manifest not found. Listing results succeeds; one download attempt failed." \
  --job JOB_ID \
  --json
```

Use the project UUID or exact unique name. `--job` is optional and must identify
a job belonging to that project. Choose `technical-support`, `feature-request`,
or `other`. Each invocation records one comment; combine related observations
into one concise report. The message limit is 8 KiB of UTF-8 text.

Describe expected versus observed behavior and actions already tried. Include
useful public error text and request/operation IDs when available. Separate
observations from suspected causes. The CLI supplies its version and available
source revision; the server records the submitting account and time.

Exclude credentials, signed URLs, unnecessary scientific inputs, and bulk log
dumps. Use public evidence only; do not seek or expose internal provisioning
diagnostics. A report does not need every field to be useful.

A successful response includes `data.feedback_id`. Give that ID to the user.
For assistance, recommend [support@ariax.bio](mailto:support@ariax.bio) and
include the feedback ID and project ID in the proposed email. Send email only
when the user explicitly asks. Feedback records a comment; it does not create
a support ticket or promise a response time.

If submission times out or returns an uncertain outcome, do not claim it was
recorded or loop submissions. The CLI does not automatically retry the POST;
a deliberate resubmission can create a duplicate. The user can seek support
with the project ID even without a feedback receipt.

Recording feedback does not stop compute, restart a job, or change campaign
settings. Continue to follow the [recovery and support guidance](../SKILL.md#provisioning-and-job-failures).
