# Research State

This file is the current control state of the project.

It answers: what should the agent do now?

It does not store raw results. Use `research_trajectory/CURRENT_FINDINGS.md`
for current accepted/tentative/rejected findings and evidence status.

---

## Current Objective

<Current active objective.>

---

## Current Plan

<Current short-term plan.>

---

## Active Trial

Current active trial:

`research_trajectory/trials/<trial_id>/`

Status: <planned / active / completed / blocked / none yet>

---

## Current Method Status

Concrete method, model, framework, system, prototype, and implementation artifacts live in `workspace/`.

This section records only current method status and rationale.

### Active Methods

- <method / model / framework / system design / prototype / script / config / protocol and path in workspace>

### Rationale

- <why these methods are currently accepted or being tested>

### Deprecated or Forbidden Methods

- <method or assumption that must not be used>

### Open Method Risks

- <methodological concerns still unresolved>

---

## Current Resource Status

Resource intake status: <pending / pass / blocked / not_needed>

Active resources:

- <resource and path>

Missing or ambiguous resources:

- <resource clue and required user action>

Next intake action:

- <next resource intake step or none>

Deprecated resources:

- <resource and reason>

Seed paper status:

- <missing / collecting / available / reviewed / not applicable>

---

## Critical Path

Every dependency needed to produce real results, figures, tables, appendix
materials, and the final manuscript-facing deliverable belongs here.
Bookkeeping-only work is never a critical-path item.

| ID | Dependency | Status | Evidence / artifact | Owner |
|---|---|---|---|---|
| CP1 | <data, method, evaluation, figure, table, or blueprint assembly dependency> | open | <path, decision record, or none yet> | <agent / human / resource scout / reviewer> |

Allowed statuses: `open`, `in_progress`, `done`, `blocked_on_human`, `downgraded`.

Current bottleneck: CP1 - <one-line dependency currently limiting real results>

Consecutive non-empirical trials: 0 (mirror of recent REPORT history; reset on `Empirical progress: yes`, increment on `no`)

---

## Blockers

- <current blockers>

---

## Autoresearch Goal Gate

Status: continue

Required reviewer gates:

- Plan reviewer: continue - pending current trial file `research_trajectory/trials/<trial_id>/reviews/PLAN_REVIEW.md`.
- Process reviewer: continue - pending current trial file `research_trajectory/trials/<trial_id>/reviews/PROCESS_REVIEW.md`.
- Evidence reviewer: continue - pending current trial file `research_trajectory/trials/<trial_id>/reviews/EVIDENCE_REVIEW.md`.
- Venue fit reviewer: continue - pending current trial file `research_trajectory/trials/<trial_id>/reviews/VENUE_FIT_REVIEW.md`.
- Manuscript reviewer: continue - pending current trial file `research_trajectory/trials/<trial_id>/reviews/MANUSCRIPT_REVIEW.md`.
- Figure/table reviewer: continue - pending current trial file `research_trajectory/trials/<trial_id>/reviews/FIGURE_TABLE_REVIEW.md`.
- Reference reviewer: continue - pending current trial file `research_trajectory/trials/<trial_id>/reviews/REFERENCE_REVIEW.md`.
- Final gate reviewer: continue - pending current trial file `research_trajectory/trials/<trial_id>/reviews/FINAL_GATE_REVIEW.md`.

Critical path: CP1 - <bottleneck>; empirical progress this trial: no

Next action: complete cold start or conversion, then create the first complete research attempt.

---

## Recent Formal Human Interventions

See `research_trajectory/human_interventions/INDEX.md`.

Current effective consequences:

- <none yet>

---

## Next Step

<The complete research objective required for the current deliverable.>
