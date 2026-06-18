---
layout: default
title: Hosting the Docs
---

# Hosting the Docs

The simplest hosting path is GitHub Pages. This repository already includes a
Pages workflow that builds the Markdown files in `docs/` with Jekyll and
publishes the result.

## GitHub Pages

1. Push the repository to GitHub.
2. Open the repository settings.
3. Go to **Pages**.
4. Set **Build and deployment -> Source** to **GitHub Actions**.
5. Push to `main`.

The included `.github/workflows/pages.yml` workflow publishes whenever `docs/**`
or the Pages workflow changes.

The public docs URL will look like:

```text
https://<owner>.github.io/<repo>/
```

For private repositories, enable Pages first and set this repository variable:

```text
ENABLE_PRIVATE_PAGES=true
```

GitHub Pages behavior for private repositories can depend on the account or
organization plan, so public repositories are the lowest-friction path.

## Custom Domain

After Pages is enabled, configure a custom domain in **Settings -> Pages**. If
you want the domain tracked in the repository, add `docs/CNAME` with only the
domain name:

```text
docs.example.com
```

Then configure DNS with your domain provider according to GitHub's Pages
instructions.

## Other Hosts

Any static host works because the docs build to static HTML:

- Netlify
- Vercel
- Cloudflare Pages
- an internal static web server

For this scaffold, GitHub Pages is recommended because it requires no extra
build tooling beyond the workflow already in the repository.
