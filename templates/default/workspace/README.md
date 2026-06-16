# Workspace

`workspace/` is the live execution workspace.

It may contain the latest runnable code, scripts, notebooks, configs, working data, generated outputs, checkpoints, and temporary analysis files.

However, this scaffold only requires one default subfolder:

```text
workspace/data/
```

All other workspace organization should be chosen by the execution agent based on the needs of the project.

Possible optional folders include:

```text
workspace/src/
workspace/scripts/
workspace/notebooks/
workspace/configs/
workspace/results/
workspace/outputs/
workspace/ckpts/
workspace/models/
workspace/logs/
workspace/tmp/
```

These are suggestions only. Do not create them unless they are useful.

## Important Semantics

`workspace/` is the current working implementation area.

It is not the canonical research record.

A method is not accepted merely because code exists in `workspace/`.

A result is not accepted merely because output exists in `workspace/`.

Accepted findings, current claims, and result summaries must be reflected in:

```text
research_trajectory/CURRENT_FINDINGS.md
```

Current method status, active constraints, rejected assumptions, and next actions must be reflected in:

```text
research_trajectory/STATE.md
```

If a workspace file is used as evidence for a trial, the corresponding trial `REPORT.md` must link to it or copy it into that trial's `artifacts/` folder.
