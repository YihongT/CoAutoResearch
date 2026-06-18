# Contributing

This file is for contributors and maintainers. User-facing setup and product
usage belong in `README.md` and `docs/`.

## Local Checks

Clone the repository for development:

```bash
git clone https://github.com/YihongT/CoAutoResearch.git
cd CoAutoResearch
```

Install the local checkout as the global CLI while developing:

```bash
npm link
```

After that, `co-auto-research` points at this checkout. Pulling changes updates
the command implementation without reinstalling the package.

Run the same checks before opening or merging changes:

```bash
npm test
npm run pack:dry-run
```

The test script verifies the reusable project template, UI flow expectations,
and CLI smoke behavior.

## Documentation Site

The public documentation source lives in `docs/`. It should stay written from a
user perspective: installation, first run, continuing work, platform notes, and
safe remote use.

To test the docs site locally:

```bash
python -m pip install -r docs/requirements.txt
sphinx-build -b html docs /tmp/coauto-docs-site
python -m http.server 4027 --directory /tmp/coauto-docs-site
```

Do not add GitHub Pages setup instructions to the public docs navigation.

## npm Publishing

Before the first public npm release:

1. Confirm the package name in `package.json` is available or choose a scoped
   package name.
2. Configure npm trusted publishing for this GitHub repository.
3. Keep `npm test` and `npm run pack:dry-run` passing on all CI platforms.
4. Bump `package.json` to a new version before each publish; npm versions are
   immutable once published.
5. Publish a GitHub Release for the version. The release workflow runs tests,
   performs a package dry run, then publishes with provenance.

The workflow publish step is:

```bash
npm publish --provenance --access public
```

The trusted publisher settings should match:

- owner: `YihongT`
- repository: `CoAutoResearch`
- workflow: `release.yml`
- publish command: `npm publish`

After publication, user-facing installation can become:

```bash
npm install -g co-auto-research
```

Updates can then use:

```bash
npm install -g co-auto-research@latest
```
