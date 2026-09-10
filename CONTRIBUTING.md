# Contributing

Bug reports, feature ideas, documentation, and focused code changes are welcome.
Please follow our [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities
privately as described in [SECURITY.md](SECURITY.md).

## Work from a checkout

Follow [agent setup](docs/agent-setup.md) for prerequisites and provider login.
There is no application dependency installation or build step:

```bash
node bin/auto-research.js doctor
node bin/auto-research.js ui --projects-dir ../coauto-projects
```

Keep research projects outside the repository. Do not modify the reusable
`templates/default/` by running research inside it. Product changes belong in
`bin/` and `templates/default/ui/`; research protocol instructions and schemas
live alongside that UI in the template. Public documentation lives in `docs/`.

## Submit a change

1. Open an issue before a substantial change so the scope can be agreed.
2. Create a branch and keep the change focused. Preserve users' projects and
   existing settings when changing installation, migration, or runtime behavior.
3. Reproduce the original issue and verify the changed behavior through the
   relevant dashboard controls or CLI commands. Include the environment,
   steps, outcomes, and remaining limitations in the pull request.
4. Run `npm run pack:dry-run` and inspect the file list. For packaging changes,
   verify a fresh installation as described in [RELEASING.md](RELEASING.md).
5. Update user-facing instructions when behavior changes, then open the pull
   request against `main`.

This repository contains the product and its documentation. Development test
suites, fixtures, and local verification artifacts are not distributed here.
The packaging workflow builds a tarball; it is not an end-to-end quality gate.
Do not include research data, credentials, generated papers, logs, or local
verification projects in a contribution. A curated documentation example may
include a reviewed paper and selected figures when agreed with the maintainer;
keep its raw project, data, logs, and verification records outside the repository.

## Documentation

Install the documentation dependencies in an isolated Python environment:

```bash
python -m pip install -r docs/requirements.txt
sphinx-build -W --keep-going -b html docs /tmp/coauto-docs-site
python -m http.server 4027 --directory /tmp/coauto-docs-site
```

## Product language

Use English for public documentation and interface text. Agent replies follow the
user’s language. Explain the action and its consequence: adding to a draft is
not sending, requesting a pause is not yet being paused, and recording a result
is not external publication. Preserve API fields, enums, event markers and
recovery-matched diagnostics when polishing visible text. Keep research claims
proportional to their evidence.

## License and releases

Contributions are licensed under [Apache-2.0](LICENSE). Maintainers publish
releases using [RELEASING.md](RELEASING.md).
