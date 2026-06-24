# Upgrading

Update the installed CLI and package-managed UI runtime with npm:

```bash
npm install -g co-auto-research@latest
```

Check the installed version:

```bash
co-auto-research version
```

Each generated project includes:

```text
.co-auto-research-template/manifest.json
```

The manifest records the template version used to create the project.
`co-auto-research upgrade` reports the installed CLI version, the detected
project template version, and the npm update command.

Updating the npm package updates the CLI, dashboard, and default UI runtime used
by `co-auto-research ui` and `co-auto-research attach`. Existing project
research files are not rewritten automatically.

## Update Project Instructions

Reviewer and trial-protocol instructions are part of the quality gate. If the UI
or `doctor` reports that an older project has outdated core instructions, update
only the managed core instruction files:

```bash
co-auto-research upgrade-project
```

For all projects in the default dashboard folder:

```bash
co-auto-research upgrade-project --all --projects-dir co-autoresearch-projects
```

The command writes a backup under `archive/template_migrations/`, installs the
latest core reviewer and protocol files, and leaves research content plus custom
extra reviewers or other instruction files alone.
