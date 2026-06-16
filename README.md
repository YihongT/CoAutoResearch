# CoAutoResearch

CoAutoResearch is a human-centered AI research scaffold: it helps agents do
serious research work while keeping the human author able to understand, steer,
defend, and revise the project.

Most "auto research" systems optimize for autonomous output: generate ideas,
run experiments, write reports, or produce papers. CoAutoResearch optimizes for
research ownership. The goal is not a finished artifact you cannot explain. The
goal is a traceable research trajectory you can actually use.

## Why It Is Different

- **Human as PI.** Formal human interventions can change direction, scope,
  methods, claims, venue, and priority, and those decisions become part of the
  project record.
- **Linear, legible progress.** The agent chooses one coherent next objective,
  writes a plan, executes, reports, and updates state. You can follow the work
  without learning a hidden search tree.
- **Traceable evidence.** Claims, findings, artifacts, limitations, and rejected
  paths are separated instead of buried in chat logs or generated prose.
- **Revision-ready research.** The system is designed so the human can answer
  reviewers, defend assumptions, and continue the project after AI assistance.
- **Clean reusable template.** Users create independent project copies; the
  reusable template is never mutated during normal research work.

## Prerequisites

Install these before creating a project:

- **Node.js 18+**: install from the official [Node.js downloads page](https://nodejs.org/en/download). Node includes `npm`, which is used to install or run CoAutoResearch.
- **Python 3**: install from the official [Python downloads page](https://www.python.org/downloads/). The CLI auto-detects `python3`, `python`, or Windows `py -3`. Set `COAUTO_PYTHON` if your Python executable uses another path.
- **Codex CLI**: follow the official [OpenAI Codex CLI setup guide](https://developers.openai.com/codex/cli). OpenAI documents Windows support through native Windows or WSL2 in the [Codex Windows guide](https://developers.openai.com/codex/windows). On macOS/Linux and WSL2:

  ```bash
  curl -fsSL https://chatgpt.com/codex/install.sh | sh
  ```

  If you prefer npm:

  ```bash
  npm install -g @openai/codex
  ```

Verify your environment:

```bash
node --version
npm --version
codex --version
```

## Documentation

- [Documentation home](docs/index.md)
- [Conceptual framework](docs/conceptual-framework.md)
- [Multiple projects](docs/multiple-projects.md)
- [Platform support](docs/platforms.md)
- [Remote server setup](docs/remote-server.md)
- [Upgrading generated projects](docs/upgrading.md)

When this repo is pushed to GitHub, the included GitHub Pages workflow can host
the docs automatically from `docs/`. In the repository settings, set
**Pages → Build and deployment → Source** to **GitHub Actions**. The workflow
will publish on pushes to `main` that change `docs/**`.

## Quick Start

From this repository checkout:

```bash
node bin/auto-research.js init my-project
cd my-project
node ../bin/auto-research.js ui
```

After npm publication, the intended flow is:

```bash
npx co-auto-research init my-project
cd my-project
co-auto-research ui
```

Open the UI at:

```text
http://127.0.0.1:8765
```

If port `8765` is already in use, choose another port:

```bash
co-auto-research ui --port 8780
```

Then open:

```text
http://127.0.0.1:8780
```

To watch several generated research projects from one UI, start the dashboard
from their parent folder:

```bash
co-auto-research init test
co-auto-research init paper-a
co-auto-research ui --projects-dir .
```

The left sidebar will list `test`, `paper-a`, and any other generated projects
under that folder. Each project keeps its own files, runtime state, and Codex
session.

## CLI

```bash
co-auto-research init <dir>
co-auto-research ui [--host 127.0.0.1] [--port 8765]
co-auto-research ui --projects-dir <dir> [--host 127.0.0.1] [--port 8765]
co-auto-research doctor [--host 127.0.0.1] [--port 8765]
co-auto-research upgrade
```

`auto-research` is kept as a command alias.

- `init` copies `templates/default/` into a new empty project directory.
- `ui` starts the Python standard-library UI server inside a generated project.
- `ui --projects-dir <dir>` starts one dashboard that can switch between all
  generated projects directly inside `<dir>`.
- `ui --port <port>` starts the server on a different local port when the
  default `8765` is unavailable.
- `doctor` checks local prerequisites and port availability.
- `upgrade` is advisory in `0.1.0`; generated projects are independent working
  copies and automated upgrades are not implemented yet.

## Project Model

Generated projects separate the pieces that make research usable:

- `PROJECT.md`: canonical research direction.
- `research_trajectory/STATE.md`: current objective, plan, blockers, and next step.
- `research_trajectory/CURRENT_FINDINGS.md`: accepted, tentative, rejected, and open findings.
- `research_trajectory/trials/`: planned work packages with plans, reviews, reports, and artifacts.
- `resources/`: raw inputs, papers, prior work, data notes, and venue materials.
- `workspace/`: executable working area.
- `manuscript/`: manuscript-facing blueprint, figure specs, reviews, and deliverables.

## Remote Servers

For remote use, keep the UI bound to localhost on the server and access it with
an SSH tunnel. See [docs/remote-server.md](docs/remote-server.md).

## Development

```bash
npm test
npm run pack:dry-run
```

The test script verifies that the template does not contain project-specific
artifacts and runs a CLI initialization smoke test.

## Contact

For questions, feedback, or collaboration: <yihong.tang.edu@gmail.com>
