---
layout: default
title: Upgrading
---

# Upgrading

Version `0.1.0` treats generated projects as independent working copies.

Each generated project includes:

```text
.co-auto-research-template/manifest.json
```

The manifest records the template version used to create the project. In
`0.1.0`, `co-auto-research upgrade` only reports this information and explains that
automated upgrades are not implemented yet.

Future automated upgrades should:

- update only scaffold-managed files;
- avoid overwriting `PROJECT.md`, `research_trajectory/`, `resources/`,
  `workspace/`, and manuscript content unless explicitly requested;
- preserve user-created trials, resources, UI runtime state, and research
  outputs;
- use the manifest to decide whether a migration is applicable.
