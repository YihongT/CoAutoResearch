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

On Windows, if the UI cannot start Codex but `codex --version` works in
PowerShell, start `co-auto-research ui` from that same PowerShell session. You
can also set `COAUTO_CODEX` to the full path of `codex.cmd`.

## Documentation

- [Documentation home](docs/index.md)
- [Getting started](docs/getting-started.md)
- [Concepts](docs/conceptual-framework.md)
- [CLI reference](docs/cli.md)
- [Multiple projects](docs/multiple-projects.md)
- [Remote servers](docs/remote-server.md)
- [Platform support](docs/platforms.md)
- [Upgrading generated projects](docs/upgrading.md)

## Quick Start

Clone the repository and install the CLI command once:

```bash
git clone https://github.com/YihongT/CoAutoResearch.git
cd CoAutoResearch
npm install -g .
```

Then start the dashboard:

```bash
co-auto-research ui
```

The CLI opens the UI in your browser after the server starts. If your terminal
cannot open a browser, open the printed URL manually. Then click `+` in the left
sidebar to create a project. Dashboard-created projects live in
`local-projects/`.

If you do not want to install a global command, run the same CLI entrypoint
directly from the repository:

```bash
node bin/auto-research.js ui
```

To update a clone-based install later:

```bash
cd CoAutoResearch
git pull
npm install -g .
```

If you update the checkout often, use `npm link` once instead of reinstalling
after each pull. It keeps the global `co-auto-research` command pointed at this
checkout.

The printed URL will look like:

```text
http://127.0.0.1:8765
```

If port `8765` is already in use, CoAutoResearch automatically tries the next
available port and prints the actual URL. To prefer a different starting port:

```bash
co-auto-research ui --port 8780
```

Then open:

```text
http://127.0.0.1:8780
```

To suppress browser launch:

```bash
co-auto-research ui --no-open
```

For remote servers, use remote mode:

```bash
co-auto-research ui --remote
```

Remote mode keeps the UI bound to server-local `127.0.0.1`, skips browser
launch on the server, and prints the exact SSH tunnel command and local browser
URL after startup. Keep that server command running, run the printed `ssh -L`
command from your local machine, then open the printed local URL in your local
browser.

To come back later, list known projects from the current folder and attach to
one:

```bash
co-auto-research ls
co-auto-research attach my-project
```

`attach` starts the same UI server for the selected generated project; it does
not require a background process from the previous day to still be running.

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

In dashboard mode, the sidebar `+` button can also create a new project from the
same immutable template. This is the simplest path for normal use; `init`
remains available for scripting.

## CLI

```bash
co-auto-research init <dir>
co-auto-research ls [--projects-dir <dir>]
co-auto-research attach [project-name-or-path] [--projects-dir <dir>] [--host 127.0.0.1] [--port 8765] [--open] [--no-open] [--remote]
co-auto-research ui [--host 127.0.0.1] [--port 8765] [--open] [--no-open] [--remote]
co-auto-research ui --projects-dir <dir> [--host 127.0.0.1] [--port 8765] [--open] [--no-open] [--remote]
co-auto-research doctor [--host 127.0.0.1] [--port 8765]
co-auto-research upgrade
```

`auto-research` is kept as a command alias.

- `init` copies `templates/default/` into a new empty project directory.
- `ls` lists generated CoAutoResearch projects under the current directory,
  plus `local-projects/` when present. `list` is an alias.
- `attach [project-name-or-path]` starts the UI for an existing generated
  project. Use this when returning to work after closing the terminal/browser.
- `ui` starts the Python standard-library UI server. Inside a generated project
  it serves that project; otherwise it creates/serves `local-projects/` as a
  dashboard where projects can be created from the UI.
- `ui --projects-dir <dir>` starts one dashboard that can switch between all
  generated projects directly inside `<dir>` and create new ones from the UI.
- `ui --port <port>` starts port selection from a different local port. If that
  port is busy, the server automatically tries the next available port.
- `ui --open` forces browser launch; `ui --no-open` disables it.
- `ui --remote` is the recommended server mode. It disables browser launch on
  the server and prints SSH port-forwarding instructions for opening the UI
  from your local browser.
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

## Contact

For questions, feedback, or collaboration: <yihong.tang.edu@gmail.com>
