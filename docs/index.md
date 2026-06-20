# Welcome to CoAutoResearch's documentation

CoAutoResearch is a human-centered research scaffold. It helps a local agent
backend do substantial research work while keeping the human author able to
understand, steer, defend, and revise the project. Codex is the default backend;
Claude Code is optional.

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

Open the dashboard:

```bash
npx --yes co-auto-research ui
```

This starts the local dashboard and opens it in your browser. Create projects,
attach files, revise framing, and start autoresearch from the UI.

For repeated use, install once with `npm install -g co-auto-research`, then run
`co-auto-research ui`.

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
