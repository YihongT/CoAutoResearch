# Upgrading

Version `0.1.0` treats generated projects as independent working copies.

Each generated project includes:

```text
.co-auto-research-template/manifest.json
```

The manifest records the template version used to create the project. In
`0.1.0`, `co-auto-research upgrade` only reports this information and explains
that automated upgrades are not implemented yet.

For now, treat each generated project as its own working copy. Keep using
`co-auto-research attach <project>` or `co-auto-research ui` to continue the
project you already created.
