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
- **Codex CLI**: default agent backend. Follow the official [OpenAI Codex CLI setup guide](https://developers.openai.com/codex/cli). OpenAI documents Windows support through native Windows or WSL2 in the [Codex Windows guide](https://developers.openai.com/codex/windows). On macOS/Linux and WSL2:

  ```bash
  curl -fsSL https://chatgpt.com/codex/install.sh | sh
  ```

  If you prefer npm:

  ```bash
  npm install -g @openai/codex
  ```

- **Claude Code CLI**: optional agent backend. Install and authenticate Claude Code if you want to select `Claude Code` in the UI. CoAutoResearch talks to the Claude CLI directly; no SDK dependency is added.

Verify your environment:

```bash
node --version
npm --version
codex --version
codex login status
# optional
claude --version
claude auth status
```

On Windows, if the UI cannot start Codex but `codex --version` works in
PowerShell, start `co-auto-research ui` from that same PowerShell session. You
can also set `COAUTO_CODEX` to the full path of `codex.cmd`.
For Claude Code, use `COAUTO_CLAUDE` or `CLAUDE_BIN` to pin `claude.cmd` or
`claude`.

Codex remains the default backend. You can choose `Codex` or `Claude Code` when
creating a project in the UI, change the per-project default in Settings, or
override one launch from the launch dialog. Set `COAUTO_AGENT_BACKEND=claude`
or `COAUTO_AGENT_BACKEND=codex` only when you want the server environment to
force that backend; while set, UI choices are saved but runtime launches use
the forced backend. Other values are ignored with a visible warning.

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

Open the dashboard:

```bash
npx --yes co-auto-research ui
```

That command downloads the CLI if needed, starts the local UI, and opens it in
your browser. Create or continue projects from the dashboard; normal use should
happen in the UI after this point.

For repeated use, install the command once:

```bash
npm install -g co-auto-research
```

Then run:

```bash
co-auto-research ui
```

If your terminal cannot open a browser, open the printed URL manually. Click `+`
in the left sidebar to create a project, then choose the project default agent
backend. Dashboard-created projects live in `co-autoresearch-projects/`.

Project creation does not require the selected agent CLI to be installed yet.
Starting framing, autoresearch, chat, resume, or restart does: the UI checks
`codex --version` plus `codex login status`, or `claude --version` plus
`claude auth status`, and blocks startup with provider-specific setup guidance
when the selected backend is definitely missing or unauthenticated.

To update the CLI and package-managed UI runtime later:

```bash
npm install -g co-auto-research@latest
```

If you are developing from a source checkout, see [CONTRIBUTING.md](CONTRIBUTING.md).

Updating the npm package updates the CLI, dashboard, and default UI runtime. It
does not rewrite existing project research files.

If `doctor` or the UI says an older project has outdated reviewer instructions,
sync only the core reviewer files with:

```bash
co-auto-research upgrade-project
```

For a dashboard folder:

```bash
co-auto-research upgrade-project --all --projects-dir co-autoresearch-projects
```

This backs up previous core reviewer files under `archive/template_migrations/`
and preserves project research content and custom extra reviewers.

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
launch on the server, and prints the SSH tunnel command and local browser URL
after startup. The SSH host is shown as `<ssh-host>` unless you set
`COAUTO_REMOTE_TARGET=user@host`, because the server's machine hostname is often
not the SSH alias you used. Keep the server command running, run the tunnel
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
under that folder. Each project keeps its own files, runtime state, and selected
agent session.

The composer `+` button attaches local files to the next message. By default,
these uploads are copied into the current project's
`resources/user_input/attachments/` folder. You can reclassify an attachment in
the attachment chip before sending, and uploaded or linked materials are indexed
in `resources/user_input/RESOURCE_MANIFEST.md` so the agent can cite the same
project-local record later.
Files over 50 MB are not base64-uploaded. The UI asks whether to copy them into
the matching `resources/` category, shows chunk-copy progress, and only enables
send or launch after the copy finishes or is cancelled. For existing local
folders or prior project bundles, use the resource browser chips; the
server-side browser copies files or symlinks folders into the matching
`resources/` category.

Autoresearch controls use distinct meanings:

- `Pause after current turn` lets the current agent turn finish, then prevents
  the loop from starting another trial.
- `Stop current run` terminates the currently running agent process.
- `Restart autoresearch` archives the current trials, runtime state, working
  manuscript, generated workspace, and current findings, then starts a new
  active trajectory at Trial 1. User-uploaded or user-confirmed resources remain
  available; autoresearch-discovered, generated, or unknown-provenance resources
  become archived prior-run context until you explicitly reattach or confirm
  them.

The dashboard ships with Ivory and Nocturne themes.
The setting is local to the browser and does not clear the composer, attached
files, or context chips.

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
co-auto-research upgrade-project [project-name-or-path] [--all] [--projects-dir <dir>] [--dry-run]
co-auto-research version
```

`auto-research` is kept as a command alias.

- `init` copies `templates/default/` into a new empty project directory.
- `ls` lists generated CoAutoResearch projects under the current directory,
  plus `co-autoresearch-projects/` when present. `list` is an alias.
- `attach [project-name-or-path]` starts the UI for an existing generated
  project. Use this when returning to work after closing the terminal/browser.
- `ui` starts the package-managed Python standard-library UI server. Inside a
  generated project it serves that project; otherwise it creates/serves
  `co-autoresearch-projects/` as a dashboard where projects can be created from the UI.
- `ui --projects-dir <dir>` starts one dashboard that can switch between all
  generated projects directly inside `<dir>` and create new ones from the UI.
- `ui --port <port>` starts port selection from a different local port. If that
  port is busy, the server automatically tries the next available port.
- `ui --open` forces browser launch; `ui --no-open` disables it.
- `ui --remote` is the recommended server mode. It disables browser launch on
  the server and prints SSH port-forwarding instructions for opening the UI
  from your local browser.
- `doctor` checks local prerequisites, port availability, and the package UI
  runtime.
- `upgrade` prints the installed CLI version, detected project template version,
  and the npm update command. Existing project research files are not rewritten
  automatically.
- `upgrade-project` updates core reviewer instructions in an existing project,
  backing up previous core reviewer files under `archive/template_migrations/`.
- `version` prints the installed CLI package version.

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
