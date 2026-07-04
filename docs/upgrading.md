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

## Adopt The Critical-Path Deliverable Model

Recent templates add Critical Path accounting, mandatory ongoing-work
conversion, research-critical acquisition decisions, and the two-artifact
manuscript model. Existing projects remain readable by the server, but older
projects should adopt the new fields before long autoresearch runs:

- Re-sync core instructions with `co-auto-research upgrade-project`.
- Add a `## Critical Path` section to `research_trajectory/STATE.md` with the
  current bottleneck and any open data, method, evaluation, figure/table, or
  deliverable dependencies.
- Add `manuscript/PAPER_PLAN.md` for planned evidence obligations and blockers.
  Keep `manuscript/BLUEPRINT.md` for real, source-backed manuscript content only.
- If `resources/ongoing_work/` contains code, data, checkpoints, metrics, or
  manuscript sources, run a conversion trial before normal trials continue.
- For research-critical resources, record acquisition/substitution decisions
  under the trial's `artifacts/resource_scout/` directory.

The UI now gates the Paper-Writing Pack. If the blueprint is still a stub,
contains planned slots, lacks real result sources, or has blocking missing
evidence, export a Research Status Pack instead. The status pack is compatible
with legacy projects and is intentionally labeled as incomplete.
