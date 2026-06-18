# Multiple Projects

CoAutoResearch can show several generated research projects in one local UI.
Each project remains an independent working copy.

## Start A Dashboard

From the parent folder that should contain generated projects:

```bash
mkdir -p local-projects
co-auto-research ui --projects-dir local-projects
```

The CLI opens the UI automatically on local machines. If it cannot, open the
printed URL manually:

```text
http://127.0.0.1:8765
```

Click `+` in the left sidebar to create a project from the immutable template.
The new project appears in the sidebar and becomes the active project.

You can also create projects from the CLI first:

```bash
co-auto-research init test
co-auto-research init paper-a
co-auto-research ui --projects-dir .
```

The left sidebar lists each generated project by folder name, such as `test` and
`paper-a`.

The UI-created project path is always inside the `--projects-dir` folder. If a
folder with the same sanitized name already exists, creation fails instead of
overwriting it.

## Isolation Model

Switching projects changes the active project for all file, resource, trial,
settings, and Codex-session API calls.

- `PROJECT.md`, `resources/`, `workspace/`, `manuscript/`, and
  `research_trajectory/` are read and written only inside the selected project.
- UI runtime state stays under that project, usually `ui/.runtime/`.
- Codex commands run with the selected project as the working directory.
- Starting or stopping a Codex run affects only the selected project.

Switching the sidebar does not merge projects and does not stop a Codex session
that is already running in another project.

## Single-Project Mode

Single-project use is unchanged:

```bash
cd test
co-auto-research ui
```

This opens the same UI with only `test` in the project list.
