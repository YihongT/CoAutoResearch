# Releasing CoAutoResearch

A release contains the CLI, reusable research template, dashboard, runtime
schemas and protocol contracts, documentation, assets, and license. Research
projects, credentials, installed skills, generated papers, caches, development
test suites, fixtures, and verification reports are not part of the repository
or npm package, except for curated paper PDFs and previews agreed for the
repository's documentation. Those examples live in `docs/_static/examples/`
and are excluded from the npm archive. Their source projects, data, logs, and
verification records remain outside the repository. The four optional paper skills are installed at a pinned
revision by the product's paper-tools setup command.

## Prepare the release

- Review the intended source changes and update `CHANGELOG.md`. Keep an upcoming
  version marked unreleased until publication.
- Keep the version in `package.json`, `package-lock.json`, and the template
  manifests consistent. Follow the managed-template upgrade rules when changing
  protocol or reviewer baselines.
- Verify prerequisites and the one-instruction setup in `docs/agent-setup.md`
  from a fresh checkout. Record which operating systems and backends were
  actually exercised; do not infer platform coverage from packaging success.
- Review `SECURITY.md`, optional paper-tool dependencies, and the contents of the
  package. Run `npm audit --omit=dev --audit-level=high` against the lockfile.

## Build and inspect

```bash
npm run pack:dry-run
npm pack --ignore-scripts --pack-destination ../
```

Inspect the resulting archive. `package.json` defines the npm allowlist; the
archive must include the hidden template manifests and all runtime files.
The GitHub **Package** workflow also builds an archive for review. It has no
publishing credentials and does not upload a release to npm.

## Verify the exact archive

Use a temporary folder outside the source checkout and an isolated installation
prefix. Substitute the absolute path of the archive just built:

```bash
npm install --prefix ./installed --ignore-scripts /absolute/path/co-auto-research-2.0.0.tgz
./installed/node_modules/.bin/co-auto-research version
./installed/node_modules/.bin/co-auto-research doctor
./installed/node_modules/.bin/co-auto-research ui --projects-dir ./projects --no-open
```

On Windows, use `installed\node_modules\.bin\co-auto-research.cmd`.
Open the printed URL. Verify project creation and persistence, selected-provider
login and models, framing, collaboration, trial start/pause/resume, and the
paper-generation flow with suitable disposable research evidence. Check both
themes and narrow layouts. Follow `docs/paper-generation.md` to verify the
separate paper environment. Preserve the result and any unresolved issues in
the maintainer's release review, outside the distribution.

Packaging, syntax checks, and successful startup alone do not establish that
all research and provider workflows are ready. Resolve release-blocking issues
before publication; do not present unverified flows as passed.

## Publish

Publish the reviewed archive using the package owner's authenticated npm
account and configured account protections. Do not rebuild a different archive
between review and publication. After publication, verify the registry version,
install that version in a fresh location, and repeat the startup check. Then
create the matching Git tag and GitHub release with the changelog and archive
checksum. No workflow in this repository publishes automatically.
