# Contributing

Thanks for your interest in CoAutoResearch! Contributions of all kinds are
welcome — bug reports, feature ideas, documentation, and code.

The project follows a standard fork-and-pull-request workflow. By participating,
you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).

User-facing setup and product usage live in [README.md](README.md) and
[docs/](docs/); this file is for people changing the project itself.

## Ways to contribute

- **Report a bug** or **request a feature** by opening an issue — please search
  existing issues first.
- **Ask a question** or share an idea in GitHub Discussions.
- **Send a change** as a pull request (see below).

For anything beyond a small fix, please open an issue first so we can agree on
the approach before you invest time — it avoids surprises during review.

Found a security problem? Do **not** open a public issue — see
[SECURITY.md](SECURITY.md).

## Development setup

Clone the repository:

```bash
git clone https://github.com/YihongT/CoAutoResearch.git
cd CoAutoResearch
```

Install the local checkout as the global CLI while developing:

```bash
npm link
```

`co-auto-research` now points at this checkout, so pulling changes updates the
command without reinstalling.

To compare behavior with the current published package, install the latest npm
release in a separate shell or environment:

```bash
npm install -g co-auto-research@latest
```

## Pull request workflow

1. **Fork** the repository and create a branch from `main`
   (for example, `git checkout -b fix/clearer-error-message`).
2. Make your change. Keep it focused — one logical change per pull request.
3. Run the checks locally; they must pass:

   ```bash
   npm test
   npm run pack:dry-run
   ```

   `npm test` verifies the reusable project template, UI flow expectations, and
   CLI smoke behavior.
4. Write a clear commit message and PR description: what changed and why, and
   link the related issue (for example, `Closes #123`).
5. Open the pull request against `main`. A maintainer will review — please
   respond to feedback and keep your branch up to date.

By submitting a contribution, you agree that it is licensed under the project's
[Apache-2.0](LICENSE) license.

## Documentation site

The public documentation source lives in `docs/` and should stay written from a
user perspective: installation, first run, continuing work, platform notes, and
safe remote use.

To preview the docs site locally:

```bash
python -m pip install -r docs/requirements.txt
sphinx-build -b html docs /tmp/coauto-docs-site
python -m http.server 4027 --directory /tmp/coauto-docs-site
```

Do not add GitHub Pages setup instructions to the public docs navigation.

## Releasing

Publishing to npm is handled by maintainers — see [RELEASING.md](RELEASING.md).
Release publishes use npm provenance:

```bash
npm publish --provenance
```
