# Contributing

This file is for contributors and maintainers. User-facing setup and product
usage belong in `README.md` and `docs/`.

## Local Checks

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

## Release Dry Run

The release workflow currently runs a package dry run. Publishing should only be
enabled after npm trusted publishing or an equivalent token-based setup is
configured for the repository.
