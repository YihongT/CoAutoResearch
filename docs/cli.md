# CLI Reference

The package exposes two equivalent commands:

```bash
co-auto-research
auto-research
```

These commands are available after installing the package, for example from a
cloned repository with:

```bash
npm install -g .
```

Without a global install, run the same entrypoint from the repository:

```bash
node bin/auto-research.js <command>
```

## Commands

| Command | Purpose |
| --- | --- |
| `init <dir>` | Copy the template into a new empty project directory. |
| `ls` | List generated projects under the current folder and `local-projects/`. |
| `attach [project]` | Reopen the UI for an existing generated project. |
| `ui` | Start the local web UI. |
| `ui --projects-dir <dir>` | Start a dashboard over several generated projects. |
| `doctor` | Check local prerequisites and port availability. |
| `upgrade` | Report template version information. Automated upgrades are not implemented in `0.1.0`. |

## Start the UI

```bash
co-auto-research ui
```

Inside a generated project, this serves that project. Outside a generated
project, it creates or serves `local-projects/` as a dashboard.

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
`local-projects/` dashboard folder when present. It prints project names,
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
the server and prints the local SSH tunnel command.

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `COAUTO_PYTHON` | Python executable used to start the UI server. |
| `COAUTO_CODEX` | Explicit Codex executable path. |
| `CODEX_BIN` | Alternate Codex executable path. |
| `COAUTO_NO_OPEN` | Disable automatic browser launch. |
| `COAUTO_REMOTE_TARGET` | Override the SSH target printed by `--remote`. |
