# Working on CoAutoResearch

For installation or launch requests, follow [docs/agent-setup.md](docs/agent-setup.md).
It covers the dashboard, existing coding-agent login, and the separate paper-tool environment.
Do not start research or generate a paper just to verify installation.

For product changes, read [CONTRIBUTING.md](CONTRIBUTING.md). The CLI lives in
`bin/auto-research.js`; the dashboard and runtime live in `templates/default/ui/`.
The rest of `templates/default/` is the reusable project scaffold, including
agent instructions, protocol contracts, and JSON schemas.

Keep user projects and verification artifacts outside this repository. Never run
research inside the reusable template. Preserve existing settings, credentials,
and user research; do not replace them during setup or migration.

Reproduce a reported problem before changing behavior. Verify the changed flow
through its real CLI or dashboard entry point and report unverified cases.
This distribution excludes development test suites and fixtures. Packaging and
syntax checks alone do not establish complete runtime correctness.

See [RELEASING.md](RELEASING.md) for preparing and reviewing the npm archive.
