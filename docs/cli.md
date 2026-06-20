# CLI Reference

The package exposes two equivalent commands:

```bash
co-auto-research
auto-research
```

These commands are available after installing the npm package:

```bash
npm install -g co-auto-research
```

To update:

```bash
npm install -g co-auto-research@latest
```

Source-checkout development commands are covered in the contributor guide.

## Commands

| Command | Purpose |
| --- | --- |
| `init <dir>` | Copy the template into a new empty project directory. |
| `ls` | List generated projects under the current folder and `co-autoresearch-projects/`. |
| `attach [project]` | Reopen the UI for an existing generated project. |
| `ui` | Start the local web UI. |
| `ui --projects-dir <dir>` | Start a dashboard over several generated projects. |
| `doctor` | Check local prerequisites and port availability. |
| `upgrade` | Print installed version, detected project template version, and npm update command. |
| `upgrade-project` | Sync core reviewer instructions in an existing project, with backup. |
| `version` | Print the installed CLI package version. |

## Start the UI

```bash
co-auto-research ui
```

Inside a generated project, this serves that project using the package-managed
UI runtime. Outside a generated project, it creates or serves `co-autoresearch-projects/`
as a dashboard.

## Project Dashboard

```bash
co-auto-research ui --projects-dir ./projects
```

The dashboard lists generated projects directly inside `./projects` and can
create new projects from the UI.

## Return to Existing Work

```bash
co-auto-research ls
co-auto-research attach my-project
```

`ls` scans the current directory, immediate generated-project children, and a
`co-autoresearch-projects/` dashboard folder when present. It prints project names,
statuses, and paths.

`attach` resolves a project by display name, directory name, path, or project ID
prefix, then starts the same UI server that `ui --project <path>` would use.
This is the normal command when you closed the browser or terminal yesterday and
want to continue a previous project today.

If you keep projects somewhere else:

```bash
co-auto-research ls --projects-dir ./projects
co-auto-research attach my-project --projects-dir ./projects
```

## Autoresearch Commands

The dashboard exposes these as buttons, and the composer also accepts the same
slash commands:

| Command | Meaning |
| --- | --- |
| `/goal` | Show the current autoresearch state. |
| `/goal resume` | Resume the loop from the latest active trial. |
| `/goal pause` | Let the current turn finish, then prevent the next trial from starting. |
| `/goal restart` | Confirm, archive the current trajectory, and start a new Trial 1. |
| `/status` | Show session and gate status. |
| `/ps` | Show running process state. |
| `/diff` | Show changed files. |

`/goal restart` is not a lightweight reset. It archives existing trials, runtime
state, working manuscript, generated workspace, and current findings under
`archive/restarts/`. User-uploaded or user-confirmed resources remain available;
autoresearch-discovered or generated resources become prior-run context until
you explicitly reattach or confirm them.

The dashboard ships with Graphite Aurora, Museum Tech, and Dark Glass themes.
The setting is local to the browser and does not clear composer text,
attachments, or context chips.

## Update Project Reviewers

The npm package updates the CLI and UI runtime. Existing project research files
are not rewritten automatically, but core reviewer instructions can be synced
when `doctor` or the UI reports an outdated reviewer baseline:

```bash
co-auto-research upgrade-project
```

For a dashboard folder:

```bash
co-auto-research upgrade-project --all --projects-dir co-autoresearch-projects
```

The command backs up previous core reviewer files under
`archive/template_migrations/` and preserves custom extra reviewer files.

## Port and Browser Options

```bash
co-auto-research ui --port 8780
co-auto-research ui --no-open
co-auto-research ui --open
co-auto-research attach my-project --port 8780
```

If the requested port is busy, the server tries the next available port and
prints the actual URL.

## Remote Mode

```bash
co-auto-research ui --remote
```

Remote mode is for SSH-accessible servers. It keeps browser launch disabled on
the server and prints the local SSH tunnel command. The command uses
`user@<ssh-host>` unless `COAUTO_REMOTE_TARGET` is set, because server hostnames
are often not valid SSH aliases from your laptop.

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `COAUTO_PYTHON` | Python executable used to start the UI server. |
| `COAUTO_AGENT_BACKEND` | Force the runtime backend for UI-launched agent runs: `codex` or `claude`. Other values are ignored with a warning. Codex remains the default when unset. |
| `COAUTO_CODEX` | Explicit Codex executable path. |
| `CODEX_BIN` | Alternate Codex executable path. |
| `COAUTO_CLAUDE` | Explicit Claude Code executable path. |
| `CLAUDE_BIN` | Alternate Claude Code executable path. |
| `COAUTO_NO_OPEN` | Disable automatic browser launch. |
| `COAUTO_REMOTE_TARGET` | Override the SSH target printed by `--remote`, for example `yihong@login.example.edu`. |
