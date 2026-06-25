# Workspace

`workspace/` is the live workbench for concrete, inspectable work products.

It may contain the latest models, methods, frameworks, system designs, prototypes, implementations, source code, scripts, notebooks, pipelines, simulations, analyses, configs, prompts, schemas, evaluation harnesses, working data, derived data, generated outputs, logs, checkpoints, weights, caches, and temporary analysis files.

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
workspace/prototypes/
workspace/evals/
workspace/prompts/
workspace/schemas/
workspace/results/
workspace/outputs/
workspace/ckpts/
workspace/models/
workspace/logs/
workspace/cache/
workspace/tmp/
```

These are suggestions only. Do not create them unless they are useful.

## Important Semantics

`workspace/` is the current working artifact area.

It is not the canonical research record.

A method, model, framework, system design, or prototype is not accepted merely because an artifact exists in `workspace/`.

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
