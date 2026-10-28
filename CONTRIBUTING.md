# Contributing

Issues and focused pull requests are welcome. Do not add unit tests. Use
syntax and link checks for source and documentation changes.

After committing the candidate, run `npm run test:package` on an authorized
validation host. It checks development and stable packages, bundled guides,
and install/upgrade behavior in a temporary prefix.

Use `npm run pack:github -- /path/to/output` for a development artifact or
`npm run pack:npm -- /path/to/output` for a reviewed stable artifact. These require
a clean committed checkout and embed its revision without changing source files.
The stable GitHub release workflow attaches the exact package and checksum;
npm publication remains a separate, explicitly authorized release step. Publish
that reviewed `.tgz`, not a new package made from an uncommitted working directory.

Publish agent guides and examples only as part of `ariax-cli`. Maintain their
file entries in the CLI package and customer-source manifests. The `agent-skills/`
directory is bundled content; it has no independent npm release.

Never commit API keys, signed transfer URLs, user inputs, downloaded results,
or resume-state files.
