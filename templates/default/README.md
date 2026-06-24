# CoAutoResearch Project Scaffold

This repository is a scaffold for iterative, agent-assisted research.

It separates:

- reusable agent instructions;
- project definition;
- raw resources;
- live execution workspace;
- research trajectory records;
- manuscript blueprint and deliverable-facing materials.

## Start Here

For agents:

1. Read `AGENTS.md`.
2. Follow `instructions/EXECUTION_AGENT.md`.
3. If this is a new project, follow `instructions/COLD_START.md`.
4. If importing old work, follow `instructions/CONVERSION.md`.

For humans:

1. Put a short initial idea in `resources/user_input/INITIAL_BRIEF.md`.
2. Put old repos or partial work under `resources/ongoing_work/`.
3. Put old proposals under `resources/proposals/`.
4. Put target-venue papers and notes under `resources/target_venue/`.
5. Add local API keys by copying `.env.example` to `.env`. Never commit `.env`.

## Core Structure

```text
auto_research_project/
├── AGENTS.md
├── PROJECT.md
├── instructions/
├── resources/
├── workspace/
├── research_trajectory/
├── manuscript/
├── ui/
└── archive/
```

## Current-State Files

- `PROJECT.md`: canonical research proposal.
- `research_trajectory/STATE.md`: current control state and next action.
- `research_trajectory/CURRENT_FINDINGS.md`: latest global synthesis of findings, results, claims, and evidence.

## Trial Records

Every substantive research work package belongs under:

`research_trajectory/trials/<trial_id>/`

Each trial has:

- `PLAN.md`
- `REPORT.md`
- `reviews/` with the eight canonical reviewer files
- `artifacts/`

Substantive trials also include a Resource Scout brief in `PLAN.md`, a Resource
Scout report when required, and a Reviewer Scope Analyst decision before the
core reviewers run.

## Design Principle

Keep instructions short at the entry point and precise at the operating layer.

Do not create files just because the scaffold allows them. Create files only when they improve research quality, traceability, or decision-making.
