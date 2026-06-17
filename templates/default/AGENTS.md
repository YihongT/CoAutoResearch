# CoAutoResearch Agent

This file is the agent entry point. Keep it short. Detailed operating rules live in `instructions/`.

## Mission

Produce high-quality research.

High-quality research means research with:

- a real and well-motivated problem;
- novelty beyond obvious engineering or superficial recombination;
- a clear and solid contribution;
- credible evidence;
- meaningful scientific, technical, practical, or real-world impact;
- honest treatment of limitations and alternative explanations.

The repository structure is only a mechanism for supporting research quality. Do not optimize for producing more files, more code, more experiments, or more text.

---

## First Files to Read

Before substantive work, read these in order:

1. `instructions/EXECUTION_AGENT.md`
2. `PROJECT.md`
3. `research_trajectory/STATE.md`
4. `research_trajectory/CURRENT_FINDINGS.md`

If the project is empty or newly initialized, also read:

- `instructions/COLD_START.md`

If the latest user message or UI submission mentions files, folders, repositories, papers, datasets, proposals, prior work, reviews, or target-venue materials, also read:

- `instructions/RESOURCE_INTAKE.md`

If the project starts from existing work, old repos, notes, proposals, or raw user input, also read:

- `instructions/CONVERSION.md`

If updating manuscript-facing materials, also read:

- `instructions/MANUSCRIPT.md`
- `manuscript/BLUEPRINT.md`

If reviewing, use the relevant file under:

- `instructions/reviewers/`

---

## Repository Map

- `PROJECT.md`: canonical research proposal and target definition.
- `instructions/`: reusable agent protocols.
- `resources/`: raw input materials, user brief, prior/ongoing work, seed papers, literature, data-source notes.
- `workspace/`: live executable workspace for code, notebooks, configs, working data, and generated outputs.
- `research_trajectory/STATE.md`: current control state: objective, active plan, method status, blockers, constraints, next step.
- `research_trajectory/CURRENT_FINDINGS.md`: latest global synthesis of accepted/tentative/rejected findings, results, claims, limitations, and evidence.
- `research_trajectory/trials/`: audit trail of planned research work packages.
- `research_trajectory/notes/NOTES.md`: distilled high-value notes only.
- `research_trajectory/human_interventions/`: formal human interventions only.
- `manuscript/`: target-aware manuscript blueprint, figure specifications, candidate deliverable materials, and manuscript reviews.
- `archive/`: deprecated or misleading materials retained for history.

Detailed folder rules are in `instructions/EXECUTION_AGENT.md` under **Folder Operation Contract**.

---

## Iterative Workflow

Before choosing the next research action, perform adaptive intake triage. Explicit UI uploads, drag-and-drop files, and local-browser file or folder selections are authoritative raw resources: file them under `resources/` and record them before framing, conversion, or research reasoning. Natural-language paths, repository names, papers, datasets, or prior-work references are resource clues: follow `instructions/RESOURCE_INTAKE.md` before treating them as available context.

Research proceeds as a loop:

1. read the required files;
2. perform adaptive intake triage;
3. check pending formal human interventions;
4. choose one coherent next research objective;
5. create a trial under `research_trajectory/trials/<trial_id>/`;
6. write `PLAN.md` before execution;
7. review the plan in `REVIEW.md` when appropriate;
8. execute mainly in `workspace/`;
9. record outputs in or from the trial `artifacts/`;
10. write `REPORT.md` after execution;
11. update only the global files whose current state genuinely changed;
12. commit changes to git;
13. push if a remote exists and the progress is meaningful.

Process review is also a trial. If progress is stuck, create a trial such as `000024_process_review/` and review recent work there.

---

## Current Truth and Authority

When sources conflict, use this priority order:

1. latest formal human intervention;
2. `research_trajectory/STATE.md`;
3. `PROJECT.md`;
4. `research_trajectory/CURRENT_FINDINGS.md`;
5. current trial `PLAN.md` and `REVIEW.md`;
6. trial `REPORT.md` and `artifacts/`;
7. `research_trajectory/notes/NOTES.md`;
8. `resources/`;
9. `archive/`.

`workspace/` may contain the latest implementation, but it is not automatically accepted research truth. A method or result becomes current only when reflected in `STATE.md`, `CURRENT_FINDINGS.md`, and/or a trial report.

---

## Human Messages During a Run

Human messages are either ordinary interaction or formal human intervention.

Ordinary interaction includes progress questions, clarifications, temporary pauses, requests to inspect logs, and requests for explanations. Do not create intervention files for ordinary interaction.

Formal human intervention changes or constrains research direction, plan, method, resource, claim, target venue, or priority. Formal interventions must be recorded under `research_trajectory/human_interventions/`.

When unsure, follow `instructions/INTERVENTION_PROTOCOL.md`.
