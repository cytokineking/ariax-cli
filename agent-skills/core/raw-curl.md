# Raw `curl` fallback

These examples use only the public `/api/v1` contract. They deliberately keep
the raw key out of the text and shell history by referencing an environment
variable. On a shared machine, prefer the CLI or another client that does not
expose request headers in a process listing.

Ask the user to set `ARIAX_API_KEY` in their own terminal or secret manager.
Never request its value in the agent conversation. The normal CLI workflow uses
`ariax login`; this environment setup is only for the raw REST fallback.

```sh
export ARIAX_BASE_URL='https://www.ariax.bio'
AUTH_HEADER="Authorization: Bearer ${ARIAX_API_KEY:?ARIAX_API_KEY is required}"
```

Use `--fail-with-body` so non-2xx JSON remains visible. Add a fresh request ID
when diagnosing a call; the server also returns `X-Request-Id`.

## Discovery and account

```sh
curl --silent --show-error --fail-with-body \
  "$ARIAX_BASE_URL/api/v1/health" | jq .

curl --silent --show-error --fail-with-body \
  -H "$AUTH_HEADER" "$ARIAX_BASE_URL/api/v1/me" | jq .

curl --silent --show-error --fail-with-body \
  "$ARIAX_BASE_URL/api/v1/protocols" | jq .

PROTOCOL_ID='bindcraft-v1.5'
curl --silent --show-error --fail-with-body \
  "$ARIAX_BASE_URL/api/v1/protocols/$PROTOCOL_ID/schema" | jq .

curl --silent --show-error --fail-with-body \
  "$ARIAX_BASE_URL/api/v1/openapi.json" > ariax-openapi.json
```

If `jq` is unavailable, omit the pipe and inspect the JSON response manually.
Do not submit values copied from an unreviewed response.

## Validate

```sh
curl --silent --show-error --fail-with-body \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  --data-binary @job.json \
  "$ARIAX_BASE_URL/api/v1/validate" | jq .
```

Resolve every validation error before submitting. The normalized job spec in the
response shows what the server accepted. Ariax does not expose a compute-quote
operation; submission uses the account's existing credit and compute-admission
checks.

## Optional structure upload

The API returns a short-lived, single-object PUT URL. Upload the file directly
to that URL without the Ariax authorization header. The reservation name/type
must match submission and expires quickly.

```sh
PROJECT_NAME='my-project'
PROJECT_TYPE='miniprotein'
INPUT_FILE='./target.pdb'

INIT_JSON=$(curl --silent --show-error --fail-with-body \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  --data "$(jq -cn --arg name "$PROJECT_NAME" --arg type "$PROJECT_TYPE" \
    '{project_name:$name,project_type:$type,target_filename:"input.pdb"}')" \
  "$ARIAX_BASE_URL/api/v1/uploads/init")
UPLOAD_INTENT_ID=$(printf '%s\n' "$INIT_JSON" | jq -er '.data.upload_intent_id')
UPLOAD_URL=$(printf '%s\n' "$INIT_JSON" | jq -er '.data.upload_url')
UPLOAD_CONTENT_TYPE=$(printf '%s\n' "$INIT_JSON" | jq -er '.data.upload_headers["content-type"]')

curl --silent --show-error --fail-with-body \
  -X PUT -H "Content-Type: $UPLOAD_CONTENT_TYPE" \
  --upload-file "$INPUT_FILE" "$UPLOAD_URL"
```

Project names use letters, numbers, and dashes only and are limited to 27
characters.

BindCraft currently requires PDB (`target_filename: "input.pdb"`). For
protocols whose orchestrators accept CIF or mmCIF, use
`target_filename: "input.cif"`. Project creation checks that the reserved
object exists, is nonempty, and is no larger than 10 MB, but the API does not
download or parse its content. Raw API users therefore accept content risk in
the disposable GPU VM. Prefer `ariax submit --input` when local validation is
available. Raw API users must also provide any required PXDesign
`sequence_by_chain` or ESMFold2 `protocol_config.target.sequences` values and
validate selectors themselves: BindCraft and ESMFold2 use author residue
numbers; PXDesign uses author numbers for PDB but canonical
`label_asym_id`/`label_seq_id` selectors for direct mmCIF; and BoltzGen binding
rules use canonical 1-based sequence positions. Treat `UPLOAD_URL` as a
temporary secret and do not log or persist it.

For ESMFold2 mmCIF uploads, raw clients must also reproduce the CLI preflight.
The deployed reader requires its documented atom-site fields, including both
`_atom_site.label_atom_id` and `_atom_site.auth_atom_id`. Preserve an existing
author atom-ID column; if it is absent, add it to an upload-only copy by copying
the label atom-ID token for every atom row. Stop if label atom IDs are absent,
rows are incomplete, other required fields are missing, or author chain IDs
cannot be mapped unambiguously to one-character alphanumeric IDs. Remap every
chain-addressed target selector when chains change. Do not upload the unchecked
local source and do not reuse an intent containing older, unnormalized bytes.

## Idempotent submission

Create one private local operation directory **before** the spending POST.
Save the exact request body, key, origin, action and account identity there.
The following commands require successful setup; stop if any write or account
lookup fails. Keep the directory until the outcome is resolved.

```sh
# Use a dedicated shell for these commands; any failed setup must stop it.
set -eu
umask 077
OP_DIR=$(mktemp -d './ariax-operation.XXXXXX')
printf '%s\n' "$ARIAX_BASE_URL" > "$OP_DIR/origin"
printf '%s\n' 'project:create' > "$OP_DIR/action"
uuidgen > "$OP_DIR/key"
curl --silent --show-error --fail-with-body -H "$AUTH_HEADER" \
  "$ARIAX_BASE_URL/api/v1/me" -o "$OP_DIR/account.json"
PROJECT_NAME='my-project'
jq -c --arg name "$PROJECT_NAME" --arg upload "${UPLOAD_INTENT_ID:-}" \
  '. + {name:$name}
     + (if $upload == "" then {} else {input_upload_intent_id:$upload} end)' \
  job.json > "$OP_DIR/body.json"
printf '%s\n' '/api/v1/projects' > "$OP_DIR/path"
IDEMPOTENCY_KEY=$(cat "$OP_DIR/key")

# Send only after inspecting the saved files and confirming all setup succeeded.
curl --silent --show-error --fail-with-body \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  --data-binary "@$OP_DIR/body.json" \
  "$ARIAX_BASE_URL/api/v1/projects" -o "$OP_DIR/response.json"
jq . "$OP_DIR/response.json"
PROJECT_ID=$(jq -r '.data.project_id // empty' "$OP_DIR/response.json")
JOB_ID=$(jq -r '.data.job_id // empty' "$OP_DIR/response.json")
```

A `202` response means the operation is still in progress, even if its project
ID is not known. Look up the original key without creating another operation:

```sh
curl --silent --show-error --fail-with-body -H "$AUTH_HEADER" \
  "$ARIAX_BASE_URL/api/v1/operations/$IDEMPOTENCY_KEY?action=project:create" | jq .
```

After a process interruption, select the existing `OP_DIR` and reload its
key, origin, path and body. Verify the current actor and billing account match
the saved account before replay. Never rerun the fresh-directory/key setup to
recover an uncertain submission. Reconcile the retained record or replay the exact request only while
its original retention window remains valid. An ordinary upload intent expires after 15 minutes; retaining the operation
for seven days does not extend that authorization. An expired, unattached
input can block replay before backend execution. Reconcile the original
operation/project before arranging a new upload; do not bypass expiry by
changing the key. A missing record after retention
is not proof that no project was created. A `409 idempotency_conflict` requires
stopping; do not change the key to bypass it.

## Poll, list, job logs, and artifacts

```sh
curl --silent --show-error --fail-with-body -H "$AUTH_HEADER" \
  "$ARIAX_BASE_URL/api/v1/projects/$PROJECT_ID" | jq .

curl --silent --show-error --fail-with-body -H "$AUTH_HEADER" \
  "$ARIAX_BASE_URL/api/v1/projects?status=running&limit=50" | jq .

curl --silent --show-error --fail-with-body -H "$AUTH_HEADER" \
  "$ARIAX_BASE_URL/api/v1/jobs?project_id=$PROJECT_ID&limit=50" | jq .

curl --silent --show-error --fail-with-body -H "$AUTH_HEADER" \
  "$ARIAX_BASE_URL/api/v1/jobs/$JOB_ID/logs?tail=200" | jq .

```

The logs endpoint authorizes through the requested job, then reads
project/campaign compute log artifacts stored with that project's outputs.
Restarts may append to or reuse the same compute log object; the
content is not uniquely owned by the requested job. It does not expose Ariax
application, API-server, worker, infrastructure, or other platform logs. If
requesting a specific `log_ref`, use only a discovered or documented compute-log
artifact; the server constrains it to the project's protocol-specific log
directory.

For pagination, pass the opaque `.meta.next_cursor` back as `cursor` without
decoding or editing it. During polling, stop at `completed`, `failed`, `paused`,
or `aborted`. Honor `Retry-After` after `429`/`503`; otherwise back off with a
bounded delay. A local timeout does not cancel remote work.

## Artifact discovery and presigning

Only request a signature for a path returned by authorized discovery. Omit `path` to discover the protocol's output roots, returned in
`meta.output_roots`. Continue through empty pages until `meta.next_cursor` is
null. Use the separate archive-manifest endpoint for sanitized archive names.

```sh
ARTIFACTS_JSON=$(curl --silent --show-error --fail-with-body \
  -H "$AUTH_HEADER" \
  "$ARIAX_BASE_URL/api/v1/projects/$PROJECT_ID/artifacts?limit=100")
printf '%s\n' "$ARTIFACTS_JSON" | jq .
ARTIFACT_PATH=$(printf '%s\n' "$ARTIFACTS_JSON" | jq -er '.data[0].path')

PRESIGN_JSON=$(curl --silent --show-error --fail-with-body \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  --data "$(jq -cn --arg path "$ARTIFACT_PATH" '{paths:[$path]}')" \
  "$ARIAX_BASE_URL/api/v1/projects/$PROJECT_ID/artifacts/presign")
DOWNLOAD_URL=$(printf '%s\n' "$PRESIGN_JSON" | jq -er '.data[0].url')
```

Prefer `ariax results --download` for path containment, streaming temporary
files, atomic publication, and checksum validation. If downloading manually,
discard absolute paths and any path containing empty, `.` or `..` segments;
write beneath a dedicated output directory and do not overwrite existing files.

## Lifecycle calls

These mutate remote state. Use them within the user's existing campaign
authorization; seek approval for a material change outside it.

```sh
curl --silent --show-error --fail-with-body -X POST -H "$AUTH_HEADER" \
  "$ARIAX_BASE_URL/api/v1/projects/$PROJECT_ID/pause" | jq .

curl --silent --show-error --fail-with-body -X POST -H "$AUTH_HEADER" \
  "$ARIAX_BASE_URL/api/v1/projects/$PROJECT_ID/abort" | jq .
```

Restart creates compute work and is subject to the account's existing credit
and compute-admission checks. It preserves the project's existing configuration,
so send an empty JSON object with a new logical-operation idempotency key:

```sh
# Use a dedicated shell for these commands; any failed setup must stop it.
set -eu
umask 077
RESTART_DIR=$(mktemp -d './ariax-restart.XXXXXX')
uuidgen > "$RESTART_DIR/key"
printf '%s\n' '{}' > "$RESTART_DIR/body.json"
printf '%s\n' "$ARIAX_BASE_URL" > "$RESTART_DIR/origin"
printf '%s\n' 'project:restart' > "$RESTART_DIR/action"
printf '/api/v1/projects/%s/restart\n' "$PROJECT_ID" > "$RESTART_DIR/path"
curl --silent --show-error --fail-with-body -H "$AUTH_HEADER" \
  "$ARIAX_BASE_URL/api/v1/me" -o "$RESTART_DIR/account.json"
# Stop on setup failure; persist and inspect the files before this POST.
RESTART_KEY=$(cat "$RESTART_DIR/key")
curl --silent --show-error --fail-with-body \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $RESTART_KEY" \
  --data-binary "@$RESTART_DIR/body.json" \
  "$ARIAX_BASE_URL/api/v1/projects/$PROJECT_ID/restart" -o "$RESTART_DIR/response.json"
jq . "$RESTART_DIR/response.json"
```

Do not call procurement, admin, email, payment, or unversioned endpoints with
an API key. Never send an API key to internal Ariax services.
