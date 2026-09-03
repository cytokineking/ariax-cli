# Agent evidence and fidelity checks

Run a case prompt from `cases/` with an independent agent in an isolated working
directory. Give it the CLI, bundled skills, and named raw fixtures, without
showing the expected checks. These prompts prohibit API/compute calls. For
validation-authorized real cases, retain the actual normalized API response
separately. Do not convert a refusal into agent completion merely because its
configuration later validated independently.

Record an evidence JSON file:

```json
{
  "schema_version": 1,
  "agent": {"name":"Codex", "model":"actual-model-id"},
  "completion": "completed",
  "commands": [["ariax","--version","--json"], ["ariax","inputs","prepare","--input","target.cif","-f","job.json","--output","prepared","--json"]],
  "artifacts": {"cli_build":"cli-build.json", "input":"target.cif", "config":"prepared/job.json", "input_manifest":"prepared/input-manifest.json", "transcript":"transcript.txt"}
}
```

Use paths relative to the evidence file. Add `validation` only for an actual
retained response. Capture CLI build JSON from the executable used, including
source revision and dirty status. Record exact command argument arrays without
credentials. Preserve the case, files, transcript, and tool outputs alongside
the generated hash manifest; hashes alone cannot reconstruct an artifact.

```sh
node scripts/record-agent-evaluation.js evaluation/cases/exact-pxdesign.json evidence.json report.json
```

The recorder never invokes an agent or Ariax. It hashes every artifact, checks
explicit constraints, and separately reports validation and completion. It
returns nonzero for a fidelity mismatch. Freeform missing-information,
unsupported-mode, and recovery answers also require reviewing the retained
transcript; outcome labels alone do not establish correct reasoning.

The existing 2B5I runs are validation-only evidence, with a reported source
build `2ee7595`. They predate this recorder and lack a complete retained command/
response manifest. Preserve them as historical inputs/configurations; do not
retroactively label their missing evidence as verified. Exact selector and
permitted-neighborhood cases are deliberately different tests.
