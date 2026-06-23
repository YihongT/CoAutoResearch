# Releasing

Maintainer-only notes for publishing CoAutoResearch to npm. Contributors do not
need this — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Before the first public release

1. Confirm the package name in `package.json` is available, or choose a scoped
   package name.
2. Configure npm trusted publishing for this GitHub repository.
3. Keep `npm test` and `npm run pack:dry-run` passing on all CI platforms.

## Cutting a release

1. Bump `package.json` to a new version — npm versions are immutable once
   published.
2. Update [CHANGELOG.md](CHANGELOG.md).
3. Publish a GitHub Release for the version. The release workflow runs tests,
   performs a package dry run, then publishes with provenance:

   ```bash
   npm publish --provenance --access public
   ```

After publication, users install with `npm install -g co-auto-research` and
update with `npm install -g co-auto-research@latest`.

## Trusted publisher settings

These must match the GitHub repository and release workflow:

- owner: `YihongT`
- repository: `CoAutoResearch`
- workflow: `release.yml`
- publish command: `npm publish`
