# Multiple Projects

CoAutoResearch can show several generated research projects in one local UI.
Each project remains an independent working copy.

## Start A Dashboard

From the parent folder that contains generated projects:

```bash
co-auto-research init test
co-auto-research init paper-a
co-auto-research ui --projects-dir .
```

Open:

```text
http://127.0.0.1:8765
```

The left sidebar lists each generated project by folder name, such as `test` and
`paper-a`.

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
