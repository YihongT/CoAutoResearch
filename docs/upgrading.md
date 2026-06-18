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
