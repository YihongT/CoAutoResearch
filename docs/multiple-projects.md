# Multiple Projects

CoAutoResearch can show several generated research projects in one local UI.
Each project remains an independent working copy.

## Start A Dashboard

From the parent folder that should contain generated projects:

```bash
mkdir -p co-autoresearch-projects
co-auto-research ui --projects-dir co-autoresearch-projects
```

The CLI opens the UI automatically on local machines. If it cannot, open the
printed URL manually:

```text
http://127.0.0.1:8765
```

Click `+` in the left sidebar to create a project from the immutable template.
Choose the project's default agent backend in the creation dialog. The new
project appears in the sidebar and becomes the active project. Creating it does
not start research; send a brief and review the direction first.

You can also create projects from the CLI first:

```bash
co-auto-research init my-study
co-auto-research init paper-a
co-auto-research ui --projects-dir .
```

The left sidebar lists each generated project by project name, such as `my-study` and
`paper-a`.

The UI-created project path is always inside the `--projects-dir` folder. If a
folder with the same sanitized name already exists, creation fails instead of
overwriting it.

## Isolation Model

Switching projects changes the active project for all file, resource, trial,
settings, and agent-session API calls.

- `PROJECT.md`, `resources/`, `workspace/`, `manuscript/`, and
  `research_trajectory/` are read and written only inside the selected project.
- Service runtime state is stored outside research files, separated by project.
  `COAUTO_RUNTIME_ROOT` can select a custom service runtime location.
- Per-project agent defaults, including `agent.backend`, are stored in that
  runtime state and can be changed later in Settings.
- Agent commands run with the selected project as the working directory.
- Starting or stopping an agent run affects only the selected project.

Switching the sidebar does not merge projects and does not stop an agent session
that is already running in another project.

## Single-Project Mode

Single-project use is unchanged:

```bash
cd my-study
co-auto-research ui
```

This opens the same UI with only `my-study` in the project list.
