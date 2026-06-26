# Getting Started

Start here if you want to use CoAutoResearch from a local machine.

## Quick Start

Open the dashboard:

```bash
npx --yes co-auto-research ui
```

This command downloads the CLI if needed, starts the local UI, and opens it in
your browser. Create projects, attach files, revise framing, and start
autoresearch from the UI.

On first launch, the dashboard checks Codex and Claude Code readiness before it
opens project creation. Projects can still be created before runtime setup is
complete; starting an agent run requires a ready selected backend.

## Prerequisites

Install:

- **Node.js 18 or newer** — from the [Node.js downloads page](https://nodejs.org/en/download). Includes `npm`.
- **Python 3** — from the [Python downloads page](https://www.python.org/downloads/). The CLI auto-detects `python3`, `python`, or Windows `py -3`; set `COAUTO_PYTHON` for another path.
- **Git**
- **OpenAI Codex CLI** (default backend) — see the [Codex CLI setup guide](https://developers.openai.com/codex/cli). On macOS/Linux/WSL2:

  ```bash
  curl -fsSL https://chatgpt.com/codex/install.sh | sh
  # or: npm install -g @openai/codex
  ```

  Windows is supported through native Windows or WSL2 ([Codex Windows guide](https://developers.openai.com/codex/windows)).
- **Claude Code CLI** (optional backend) — install and authenticate Claude Code
  to select `Claude Code` in the UI. CoAutoResearch talks to the CLI directly;
  no SDK is added. Claude Code can also be pointed at an Anthropic-compatible
  gateway such as Z.AI GLM from Settings.

Check the basics:

```bash
node --version
python3 --version
codex --version
codex login status
# optional
claude --version
claude auth status
```

On Windows, use `python --version` or `py -3 --version` if `python3` is not
available.

### Claude Code With GLM / Z.AI

To use Claude Code as the runtime while sending model calls to GLM, select
`Claude Code` in Settings, set **Claude provider** to `Z.AI GLM Coding Plan`,
and paste the Z.AI credential. CoAutoResearch injects the Anthropic-compatible
endpoint into Claude Code runs only:

```text
ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
ANTHROPIC_AUTH_TOKEN=<your Z.AI key>
```

Claude Code and Goose-style Anthropic clients should use
`https://api.z.ai/api/anthropic`. Do not put Z.AI's OpenAI-compatible endpoint
`https://api.z.ai/api/coding/paas/v4` into Claude Code.

If you already keep these values in `~/.claude/settings.json` or
`.claude/settings.local.json`, CoAutoResearch reads the `env` block for readiness
checks and run launches. Shell aliases/functions are not inherited by the UI
server; use Claude settings, the Settings gateway form, or set `COAUTO_CLAUDE`
to a wrapper script file.

## Install the CLI Command

For repeated use, install the command once:

```bash
npm install -g co-auto-research
```

This makes `co-auto-research` available in your terminal.

## Start the Dashboard

After installing the CLI command:

```bash
co-auto-research ui
```

The UI opens in your browser. If browser launch is unavailable, open the printed
URL manually.

## Update the CLI

Update the CLI and package-managed UI runtime by reinstalling the latest npm
package:

```bash
npm install -g co-auto-research@latest
```

Updating the npm package updates the CLI, dashboard, and default UI runtime.
Existing project research files are not rewritten automatically. Use
`co-auto-research upgrade` to print the installed version, detected project
template version, and recommended update command.

## Create a Project

1. Click `+` in the left sidebar.
2. Enter a project name.
3. Choose the project default agent backend. Codex is the default; Claude Code
   is optional.
4. Add a research brief, existing folder, paper bundle, or other resources.
5. Review the generated framing before starting the autoresearch loop.

You can change the default backend later in Settings or override one launch
from the launch dialog. If `COAUTO_AGENT_BACKEND` is set in the server
environment, the UI shows that backend as forced and runtime launches use it
until the env var is removed. Only `codex` and `claude` are valid values; other
values are ignored with a visible warning.

Creating a project does not require the selected agent CLI to be installed.
Starting a run does. The UI checks the selected backend and blocks startup with
Codex- or Claude-specific install/auth instructions when the CLI is definitely
missing or unauthenticated.

If you run `co-auto-research ui` outside a generated project, CoAutoResearch
creates a local dashboard folder:

```text
co-autoresearch-projects/
```

Projects created from the UI live there.

## Attach Files

Use the composer `+` button to attach local files to the next message. The UI
also supports paste and drag-and-drop for files. The `+` button files are copied
into `resources/user_input/attachments/` by default. You can reclassify an
attachment in its chip before sending, and uploaded or linked materials are
recorded in `resources/user_input/RESOURCE_MANIFEST.md`.
Files over 50 MB prompt for “Copy into resources,” then copy in chunks with
visible progress before send or launch is enabled again. For existing folders or
prior project bundles, use the resource browser chips. The server-side browser
copies files or symlinks folders into the selected `resources/` category.

## Autoresearch Controls

- `Pause after current turn` lets the current agent turn finish, then prevents
  the autoresearch loop from starting another trial.
- `Stop current run` terminates the currently running agent process.
- `Restart autoresearch` archives the current trials, runtime state, working
  manuscript, generated workspace, and current findings, then starts a new
  Trial 1 in the same project.

Restart keeps user-uploaded or user-confirmed resources available. Resources
that were discovered or generated by a prior autoresearch run become archived
context until you explicitly reattach or confirm them.

## Theme

The dashboard ships with Ivory and Nocturne themes.
The setting is local to the browser and does not clear composer text,
attachments, or context chips.

## Return Later

If you closed the browser or terminal, you can find and reopen existing
projects from the same folder:

```bash
co-auto-research ls
co-auto-research attach my-project
```

`attach` starts the UI for that generated project again. It does not depend on a
previous UI process still running.

## Start From the CLI

For scripting or a single fixed project:

```bash
co-auto-research init my-project
cd my-project
co-auto-research ui
```

## Remote Server

If you are SSH'd into a server:

```bash
co-auto-research ui --remote
```

With `cloudflared` installed on the server, the CLI prints a temporary
Cloudflare browser link after the server starts. Keep the terminal open while
you use the link. If `cloudflared` is missing, the same command prints the
minimal setup steps first. On Linux servers that need an HTTP proxy for
internet access, the CLI can route `cloudflared` through `graftcp` and prints
the one-command `install-graftcp` setup step when that helper is missing.
