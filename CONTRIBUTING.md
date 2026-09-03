# Contributing

Issues and focused pull requests are welcome. Before submitting a change, run:

```sh
npm test
```

After committing the candidate, run `npm run test:package`. It builds both
development and stable packages, installs them offline without optional native
dependencies in a temporary prefix, and checks version identity, bundled skills,
same-version channel migration, and executable shadowing. It never changes the
user's global installation.

Use `npm run pack:github -- /path/to/output` for a development artifact or
`npm run pack:npm -- /path/to/output` for a reviewed stable artifact. These require
a clean committed checkout and embed its revision without changing source files.
The stable GitHub release workflow attaches the exact package and checksum;
npm publication remains a separate, explicitly authorized release step. Publish
that reviewed `.tgz`, not a new package made from an uncommitted working directory.

Never commit API keys, signed transfer URLs, user inputs, downloaded results,
or resume-state files.
