---
layout: default
title: CoAutoResearch Docs
---

# CoAutoResearch Docs

CoAutoResearch is a human-centered AI research scaffold. It helps agents do
serious research work while keeping the human author able to understand, steer,
defend, and revise the project.

## Start Here

```bash
co-auto-research ui
```

Open `http://127.0.0.1:8765`, then click `+` in the left sidebar to create a
project. If you run this outside a generated project, CoAutoResearch creates a
local `local-projects/` dashboard folder for UI-created projects.

If the default port is busy, CoAutoResearch automatically tries the next
available port and prints the actual URL. To prefer a different starting port:

```bash
co-auto-research ui --port 8780
```

## Guides

- [Conceptual framework](conceptual-framework.html)
- [Multiple projects](multiple-projects.html)
- [Platform support](platforms.html)
- [Remote server setup](remote-server.html)
- [Upgrading generated projects](upgrading.html)

## Project Model

Generated projects separate:

- raw resources;
- executable workspace files;
- research trajectory records;
- current findings;
- formal human interventions;
- manuscript-facing materials.

The core principle is that AI can assist the research loop, but the human
remains able to own, explain, and revise the work.

## Contact

Questions, feedback, or collaboration: <yihong.tang.edu@gmail.com>
