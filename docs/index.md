# Welcome to CoAutoResearch's documentation

CoAutoResearch is a human-centered research scaffold. It helps Codex do
substantial research work while keeping the human author able to understand,
steer, defend, and revise the project.

The goal is not a finished artifact you cannot explain. The goal is a traceable
research trajectory you can actually use.

## Key Features

- **Reviewable automation:** project framing, trials, reports, and findings stay
  visible as files.
- **Human control:** interventions can redirect scope, method, venue, claim, or
  priority.
- **Continuation-friendly workflow:** close the browser or terminal, then return
  later with `co-auto-research ls` and `co-auto-research attach`.
- **Remote-friendly UI:** run the server on SSH machines and open it from your
  local browser through a tunnel.

## Quick Start

Install the CLI:

```bash
npm install -g co-auto-research
```

```bash
co-auto-research ui
```

The first command installs the `co-auto-research` executable. The second command
opens a local dashboard. If you are not inside an existing generated project, it
uses `local-projects/`, where you can create projects from the sidebar.

To update later:

```bash
npm install -g co-auto-research@latest
```

```{toctree}
:caption: Get Started
:maxdepth: 2

getting-started
cli
```

```{toctree}
:caption: User Guide
:maxdepth: 2

multiple-projects
remote-server
platforms
upgrading
```

```{toctree}
:caption: Concepts
:maxdepth: 2

conceptual-framework
```
