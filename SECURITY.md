# Security

Please report suspected vulnerabilities privately to support@ariax.bio with
"Security" in the subject line. Do
not include API keys, signed transfer URLs, unpublished structure files, or
other sensitive data in a public issue.

Supported releases receive security fixes on the latest published version.


The agent API exposes scientific intermediates and project-owned diagnostic
metadata, including eligible SQLite ledgers and configuration/checkpoint files.
Logs are read through a sanitized endpoint. Credentials, orchestration code,
opaque storage copies, and bundles containing unsanitized logs are excluded from
raw downloads. The website uses a separate curated presentation policy.
