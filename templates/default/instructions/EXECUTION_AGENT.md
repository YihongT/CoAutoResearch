# Execution Agent Instructions

## Purpose

This file defines how to operate the scaffold during iterative research.

The execution agent plans, executes, reviews, records, and updates state. It should not directly write a final paper by default. It may update the manuscript blueprint and figure/table specifications when manuscript-facing implications change.

Keep operating records concise but complete enough for another agent or human to resume the project.

---

## Required Reading

Before substantive work, read:

1. `AGENTS.md`
2. `PROJECT.md`
3. `research_trajectory/STATE.md`
4. `research_trajectory/CURRENT_FINDINGS.md`
5. this file

If starting from an empty or newly initialized project, read `instructions/COLD_START.md`.

If creating, revising, or deciding whether to update `PROJECT.md`, read `instructions/PROJECT_FRAMING.md`.

If acquiring, filing, resolving, or interpreting user-provided resources, read `instructions/RESOURCE_INTAKE.md`.

If planning or running agent-initiated resource search for a trial, read `instructions/RESOURCE_SCOUT.md`.

If preparing to refresh trial reviewers, read `instructions/REVIEWER_SCOPE_ANALYST.md`.

If converting prior work, raw user input, old repos, previous experiments, or proposals, read `instructions/CONVERSION.md`.

If updating manuscript-facing files, read `instructions/MANUSCRIPT.md`.

---

## Adaptive Intake Router

Before framing, conversion, or normal research execution, route the latest user message and UI payload:

1. If explicit UI resources are present, file them under `resources/` and update `resources/user_input/RESOURCE_MANIFEST.md` first.
2. If unattached resource clues are present, follow `instructions/RESOURCE_INTAKE.md`.
3. If the next framing, conversion, plan, trial, review, or answer depends on resource content, complete the Content Inspection Gate in `instructions/RESOURCE_INTAKE.md` first. Path-level intake from `RESOURCE_MANIFEST.md`, a symlink listing, a filename, or a short user description is not enough for content-grounded claims.
4. If newly filed resources materially affect `PROJECT.md`, `STATE.md`, `CURRENT_FINDINGS.md`, or manuscript direction, run `instructions/CONVERSION.md`.
5. If a formal human intervention changes direction, follow `instructions/INTERVENTION_PROTOCOL.md`, then run conversion only if canonical state needs reinterpretation.
6. If a plan-level correction makes the active plan or project framing invalid, update the active plan and `STATE.md`; run conversion only if canonical project state is no longer valid.
7. If there are no prior materials or the user explicitly starts from scratch, use `instructions/COLD_START.md`.
8. Otherwise continue the normal execution loop.

Do not create or revise `PROJECT.md` from a user message that names prior work, a repo, dataset, papers, or files until resource intake is complete, blocked with a clear user question, or explicitly not needed. After intake, use `instructions/PROJECT_FRAMING.md` to decide whether the material should update the canonical launch frame.

---

## Folder Operation Contract

Use this contract whenever deciding where to read, write, move, or summarize information.

| Path | Role | Read when | Write/update when | Must not contain |
|---|---|---|---|---|
| `PROJECT.md` | Canonical research proposal and target definition | before substantive work | cold start, conversion, or a project-definition change under `instructions/PROJECT_FRAMING.md` | trial logs, raw outputs, temporary thoughts |
| `resources/` | Raw inputs and external materials | when grounding, converting, acquiring resources, or checking provenance | when adding user brief, prior work, literature, seed papers, data-source notes | accepted current truth unless promoted elsewhere |
| `workspace/` | Live workbench for concrete implementation, execution, analysis, and evaluation artifacts | when building, running, debugging, prototyping, analyzing, evaluating, or inspecting concrete work products | when adding or modifying models, methods, frameworks, system designs, prototypes, code, notebooks, scripts, pipelines, simulations, configs, prompts, schemas, evaluation harnesses, working/derived data, generated outputs, logs, checkpoints, weights, or caches | authoritative claims, accepted conclusions, or current method status without trial/report traceability |
| `research_trajectory/STATE.md` | Current control state | before every trial and after human intervention | when objective, plan, method status, constraints, blockers, active resources, or next step changes | raw logs, full artifacts, literature dumps |
| `research_trajectory/CURRENT_FINDINGS.md` | Latest global synthesis of findings/results/claims/evidence | before interpreting results or updating manuscript | when accepted/tentative/rejected findings, active claims, limitations, or evidence map changes | raw outputs, command logs, full notebooks |
| `research_trajectory/HUMAN_TASKS.md` | Non-blocking human task queue | before choosing each next objective | when a human answer would help but useful autoresearch can continue | hard-stop blockers, formal interventions, or more than three open tasks |
| `research_trajectory/trials/` | Audit trail of planned research attempts | before continuing, reviewing, or synthesizing recent work | for every trial | global-only summaries without a concrete research attempt |
| `research_trajectory/notes/` | Sparse, topic-based knowledge notes | when looking for reusable resource, method, process, or human-preference lessons | when a trial or review creates reusable knowledge that does not belong in a canonical state file; update `index.md` whenever adding or retiring a topic note | routine trial summaries, execution logs, or duplicates of `PROJECT.md`, `STATE.md`, `CURRENT_FINDINGS.md`, reports, or resource manifests |
| `research_trajectory/human_interventions/` | Formal human control inputs | before major steps and when resolving contradictions | only when a user message changes direction, constraints, methods, claims, resources, venue, or priority | progress questions, ordinary pauses, log requests |
| `manuscript/` | Paper plan, manuscript blueprint, and deliverable-facing materials | when story, claims, figures, tables, or venue fit matter | when manuscript-facing structure/evidence/figures/tables/reviews change | exploratory raw outputs not promoted as candidate deliverables; trial logs; control/status/dependency/blocker registers; citation queues |
| `archive/` | Deprecated or misleading materials retained for history | rarely, when checking old context | only after marking what superseded the material | active current files |

General rule: raw material starts in `resources/` or `workspace/`; planned work is recorded in `trials/`; current control state is in `STATE.md`; current knowledge state is in `CURRENT_FINDINGS.md`; manuscript-facing synthesis is in `manuscript/`.

---

## State vs Findings Boundary

Use this distinction strictly:

### `STATE.md` answers: what should we do now?

It contains:

- current objective;
- active plan;
- active trial;
- current method status and rationale;
- deprecated or forbidden methods/assumptions;
- active resources;
- blockers;
- current effective consequences of formal human interventions;
- next step.

### `CURRENT_FINDINGS.md` answers: what do we currently believe or know?

It contains:

- active findings/results;
- tentative findings;
- negative or failed findings;
- superseded or rejected findings;
- active claims and evidence map;
- limitations and caveats;
- open questions.

Do not duplicate full method implementation in `CURRENT_FINDINGS.md`. Concrete method, model, framework, system, prototype, and implementation artifacts live in `workspace/`; their current status, rationale, constraints, and next action live in `STATE.md`.

---

## Critical Path Accounting

`research_trajectory/STATE.md` must maintain a `## Critical Path` section.
Create it during cold start or conversion and update it every trial.

Every dependency needed for real deliverable content is a critical-path item:
data, methods, evaluation, models, benchmarks, figures, tables, references,
appendix material, and final `PAPER_PLAN.md` / `BLUEPRINT.md` assembly. A
bookkeeping task, audit register, sync pass, reviewer refresh, or template
repair is never a critical-path item unless it directly unlocks real evidence.

Use this table shape:

```markdown
| ID | Dependency | Status | Evidence / artifact | Owner |
|---|---|---|---|---|
| CP1 | <dependency> | open | <path or decision record> | <agent / human / resource scout / reviewer> |
```

Allowed statuses are `open`, `in_progress`, `done`, `blocked_on_human`, and
`downgraded`.

Each trial must choose one `Critical path target: CP<n>` in `PLAN.md` and record
whether the trial performs empirical work. Each `REPORT.md` must record whether
the critical path advanced and whether empirical progress occurred. Empirical
progress means real data, model, method, evaluation, result, figure, table,
reference, appendix, acquisition, substitution, conversion, or blueprint
promotion work that changes the evidence base. Scaffold, bookkeeping, review
refreshes, status synchronization, or control-file cleanup alone are not
empirical progress.

While any critical-path item is `open`, `in_progress`, or `blocked_on_human`, at
most two consecutive closed trials may report `Empirical progress: no`. The next
trial must advance the current bottleneck or set `Status: needs_human` /
`Status: blocked` with a concrete `Response to human:`.

Every trial must leave `manuscript/PAPER_PLAN.md` and `manuscript/BLUEPRINT.md`
as complete as current evidence allows: obligations and blockers in
`PAPER_PLAN.md`, real source-backed content only in `BLUEPRINT.md`.

---

## Workspace-to-Trial Artifact Rule

`workspace/` is the live workbench for concrete, inspectable work products, not the canonical research record.

If a file in `workspace/` is used as evidence for a trial, then the trial `REPORT.md` must cite its path and explain how it was produced.

If the file is stable and small enough, copy it into:

`research_trajectory/trials/<trial_id>/artifacts/`

If the file is large, generated, external, or should remain in `workspace/`, keep it there but record in `REPORT.md`:

- exact path;
- command, notebook, procedure, or manual workflow used;
- config, prompt, schema, protocol, or design version;
- data, resource, benchmark, or input source;
- checkpoint, weight, log, cache, or generated-output path if relevant;
- evaluation harness, metric, acceptance criterion, or inspection method;
- relevant commit hash, version, or environment details if available;
- whether it is accepted, tentative, rejected, or only exploratory.

A model, method, framework, system design, implementation, or result is not accepted merely because it exists in `workspace/`.

---

## Trial Contract

All substantive work must be organized as a trial under:

`research_trajectory/trials/<trial_id>/`

Example:

`research_trajectory/trials/000001_collect_seed_papers/`

Each trial contains:

- `PLAN.md`: written before execution;
- `reviews/`: canonical per-reviewer review files for this trial;
- `REVIEW.md`: optional legacy compatibility summary only;
- `REPORT.md`: written after execution;
- `artifacts/`: raw outputs, logs, figures, tables, downloaded files, scripts, or other files produced or collected during the trial.

A trial is a complete research attempt for the declared deliverable. If a
target venue is provided, the trial must be target-venue-specific and aim at
submission-readiness for that venue; otherwise it must be complete for the
current `PROJECT.md` deliverable, audience, evidence standard, and expected
output.

A trial may still end `incomplete-blocked`, but only after executing the
acquisition/substitution ladder for its blocker in the same trial or the
immediately following trial. Recording a blocker and then doing side work is
invalid. Scaffold-only, harness-only, schema-only, audit-only, sync-only, or
placeholder-only work is valid only when it directly advances the declared
critical-path target or proves the current bottleneck's terminal verdict.

A trial is not required for trivial edits, ordinary clarification, progress reporting, or temporary pauses.

Do not write trial plans in the root directory. Do not write trial reports only in chat.

---

## Standard Run Loop

1. Read the required files.
2. Check `research_trajectory/human_interventions/pending/`.
3. If a pending item is a formal human intervention, follow `instructions/INTERVENTION_PROTOCOL.md` before continuing.
4. Identify the complete research objective required to make the current
   deliverable submission-ready for the target venue if provided, or
   deliverable-ready under `PROJECT.md` if no target venue is provided.
5. Identify the current Critical Path bottleneck and select the trial's
   `Critical path target: CP<n>`.
6. Create a new trial folder under `research_trajectory/trials/<new_trial_id>/`.
7. Write `PLAN.md` before execution, including the required `Resource Scout Brief`.
8. Create `reviews/` and run the Plan reviewer into `reviews/PLAN_REVIEW.md`; revise `PLAN.md` if the review requires it.
9. If the plan says `Scout: required`, after `PLAN_REVIEW.md` and before main execution, run Resource Scout work: use a real Resource Scout subagent when available, otherwise use the inline Resource Scout fallback to search, file, and report potentially relevant resources for the overall research goal and current trial, including files, papers, datasets, reports, news, and other external resources via web search or appropriate external sources. Save its report to `artifacts/resource_scout/RESOURCE_SCOUT_REPORT.md`, update `resources/user_input/RESOURCE_MANIFEST.md`, and file small public artifacts under `resources/`.
10. If the Resource Scout changes assumptions, required resources, risks, or success criteria, revise `PLAN.md` and rerun the Plan reviewer before execution. If the plan says `Scout: skipped`, the skip reason must be concrete.
11. Execute mainly in `workspace/` or another clearly justified location.
12. Save or link raw outputs through the trial `artifacts/` and `REPORT.md`.
13. Write `REPORT.md` after execution.
14. Run Reviewer Scope Analyst work: use a real subagent when available, otherwise use the inline Reviewer Scope Analyst fallback, to decide whether the eight core reviewers cover the current trial's review risks. Write its decision to `artifacts/reviewer_spawn/REVIEWER_SPAWN_DECISION.md`.
15. If the Reviewer Scope Analyst decision says `Spawn needed: yes`, reuse or create the specialized reviewer instruction under `instructions/reviewers/`, run the specialized review, and write its output under the current trial `reviews/` directory before core reviewer refresh.
16. Run or refresh all eight core reviewers for this trial and write their canonical files:
    - `reviews/PLAN_REVIEW.md`
    - `reviews/PROCESS_REVIEW.md`
    - `reviews/EVIDENCE_REVIEW.md`
    - `reviews/VENUE_FIT_REVIEW.md`
    - `reviews/MANUSCRIPT_REVIEW.md`
    - `reviews/FIGURE_TABLE_REVIEW.md`
    - `reviews/REFERENCE_REVIEW.md`
    - `reviews/FINAL_GATE_REVIEW.md`
17. A reviewer with little to assess still writes its file with a scoped judgment and explicit unassessed areas.
18. Update only global files that genuinely changed:
    - `research_trajectory/STATE.md`
    - `research_trajectory/CURRENT_FINDINGS.md`
    - `research_trajectory/notes/index.md` and topic notes when knowledge capture changes
    - `manuscript/BLUEPRINT.md`
    - `manuscript/figures/FIGURE_SPECS.md`
19. Update the `Autoresearch Goal Gate` in `STATE.md` so each reviewer line references the current trial's reviewer file path and the current critical-path line.
20. Commit changes to git.
21. Push if a remote exists and progress is meaningful.

---

## Trial File Templates

### `PLAN.md` should include

- objective;
- rationale;
- required reading/resources;
- complete research attempt:
  - critical path target: `CP<n>`;
  - empirical work: `yes | no - <what real data/model/result/resource/blueprint work this trial performs>`;
  - venue or deliverable requirements;
  - resources/data;
  - method/model/system/analysis;
  - implementation/execution;
  - evaluation/results;
  - figures/tables;
  - manuscript updates;
  - reviewer gates;
  - blocking condition if incomplete;
- required `Resource Scout Brief`:

```markdown
## Resource Scout Brief
Scout: required | skipped
Criticality: research-critical | contextual
Decision reason:
Skip reason:
Search scope:
Resource types:
Disciplines/domains:
Known resource clues:
Freshness / date sensitivity:
Download policy:
Expected destinations:
Stop criteria:
```

- planned actions;
- expected outputs;
- compute/resource needs;
- risks and checks;
- success criteria;
- what global files may need updates.

### `reviews/*_REVIEW.md` should include

Each core reviewer file must follow `instructions/reviewers/REVIEW_TAXONOMY.md`
and include provenance:

- reviewer name, scope, decision, gate impact, confidence;
- source trial;
- generated timestamp;
- instruction file path;
- reviewed input paths;
- context summary;
- migration source, if the file was created from legacy content or backfilled.

### `REPORT.md` should include

- what was actually done;
- deviations from plan;
- commands, scripts, notebooks, or procedures used;
- outputs and artifact paths;
- critical path outcome: `advanced | no_change | blocked - <evidence path or decision record>`;
- empirical progress: `yes | no`;
- completion status: `submission-ready`, `deliverable-ready`, or
  `incomplete-blocked`;
- first blocker if completion status is `incomplete-blocked`;
- Resource Scout outcome:
  - `Scout report: research_trajectory/trials/<trial_id>/artifacts/resource_scout/RESOURCE_SCOUT_REPORT.md`;
  - or `Scout skipped: <specific reason from PLAN.md>`;
  - manifest update status for scout-discovered resources;
- Reviewer Scope Analyst outcome:
  - `Reviewer spawn decision: research_trajectory/trials/<trial_id>/artifacts/reviewer_spawn/REVIEWER_SPAWN_DECISION.md`;
  - `Specialized reviewer: <instruction path and review path, or none>`;
- result interpretation;
- whether findings should update `CURRENT_FINDINGS.md`;
- whether method status should update `STATE.md`;
- knowledge capture outcome:
  - `Note updated: research_trajectory/notes/<topic>.md`;
  - `No note: <specific reason>`;
  - `Promoted elsewhere: <PROJECT.md, STATE.md, CURRENT_FINDINGS.md, or manifest path> because <reason>`;
- recommended next step.

---

## Review Policy

Canonical review outputs for trial-level work belong in the relevant trial's
`reviews/` directory, one file per reviewer:

- `PLAN_REVIEW.md`
- `PROCESS_REVIEW.md`
- `EVIDENCE_REVIEW.md`
- `VENUE_FIT_REVIEW.md`
- `MANUSCRIPT_REVIEW.md`
- `FIGURE_TABLE_REVIEW.md`
- `REFERENCE_REVIEW.md`
- `FINAL_GATE_REVIEW.md`

Legacy `REVIEW.md` may exist only as a human-readable summary or compatibility
record. Do not treat it as canonical when `reviews/` exists.

Every active trial must produce all eight core reviewer files. No reviewer gate
may silently carry forward from an earlier trial. If a reviewer cannot assess
much in the current trial, it must still write the current trial file with
`Decision: continue`, `blocked`, or `needs_human` as appropriate and list what
was unassessed. If a reviewer uses `Decision: blocked`, `Gate impact: blocked`,
`Decision: needs_human`, or `Gate impact: needs_human`, it must also include
`Response to human:` with one concise user-facing blocker summary, question, or
decision request.

The Resource Scout is not a ninth core reviewer. It is a trial preparation
step checked by existing reviewers: Plan checks the brief and skip reason,
Process checks whether required scout outputs exist, Evidence checks whether
scout outputs expose missing evidence or overclaiming, Reference checks source
metadata and citation readiness, and Final gate blocks pass when a required
scout step is missing, undocumented, or inconsistent with evidence claims.

The Reviewer Scope Analyst is also not a ninth core reviewer. It is a required
pre-review coverage subagent. Its decision artifact must exist for every
trial before the eight core reviewers are refreshed. If it says
`Spawn needed: yes`, the specialized reviewer instruction and specialized
review output must exist before the core reviewer decisions can pass.

Review outputs for manuscript-facing deliverables may also be mirrored or
summarized in:

`manuscript/reviews/`

but the current trial's canonical reviewer file remains required.

Process review can still be the objective of a dedicated trial, for example:

`research_trajectory/trials/000024_process_review/`

That trial still writes all eight files under its own `reviews/` directory.

Do not create `research_trajectory/process_reviews/`.
Do not create `research_trajectory/reviewers/`.
Reviewer instructions live under `instructions/reviewers/`.

---

## Autoresearch Goal Gate

When running under the UI autoresearch `/goal` loop, one completed trial is not the same as completing the goal.

Maintain a section inside `research_trajectory/STATE.md`:

`## Autoresearch Goal Gate`

Use this section to decide whether the autoresearch loop should continue or stop. It must include:

- `Status: pass`, `continue`, `blocked`, or `needs_human`;
- reviewer gate lines for Plan, Process, Evidence, Venue fit, Manuscript, Figure/table, Reference, and Final gate;
- the current trial reviewer file path on each reviewer gate line;
- the next action when any gate is not `pass`;
- `Response to human: <one concise user-facing question or decision request>`
  when `Status: blocked` or `Status: needs_human`.
- `Critical path: CP<n> - <bottleneck>; empirical progress this trial: yes|no`.

The `Status:` value must be exactly one bare token: `pass`, `continue`,
`blocked`, or `needs_human`. Do not write decorated status text such as
`continue - needs human later`; put explanatory text in `Next action`,
`Response to human`, reviewer files, reports, or `HUMAN_TASKS.md`.

The autoresearch goal is complete only when `Status: pass` and every required
current-trial reviewer file has `Decision: pass` and `Gate impact: pass`,
including the Final gate reviewer.

Use gate lines like:

```markdown
- Evidence reviewer: pass - `research_trajectory/trials/<trial_id>/reviews/EVIDENCE_REVIEW.md`
```

For manuscript-facing projects, a pass also requires a final synthesis step
before the gate is marked pass. That step must update:

- `manuscript/BLUEPRINT.md`
- `manuscript/PAPER_PLAN.md`
- `research_trajectory/CURRENT_FINDINGS.md`
- `manuscript/figures/FIGURE_SPECS.md`, when figures or tables are active
- any manuscript review notes needed to make current status clear

`manuscript/BLUEPRINT.md` must be self-contained and target-venue-ready before
final pass. It must include target venue/audience/article type, organization
rationale, core story, architecture overview/table of contents, manuscript
architecture in target-venue reading order, compact reader-facing section
briefs, local claim/evidence/result explanations, reader takeaways for inline
figure/table/algorithm/dataset/benchmark/result blocks, Markdown preview images
for image-source figures, reference/literature grounding plan,
appendix/supplement plan, blocking missing evidence, required qualifications,
provenance/audit index, deprecated ideas, and
submission-readiness summary.

Do not use a separate claim/evidence map, `Figure Plan`, `Table Plan`, or
`manuscript/figures/FIGURE_SPECS.md` as the primary manuscript-reading path.
They may support audit only. Every active display, method, dataset, benchmark,
result, caption, and source link must appear where the final manuscript would
use it.

The blueprint must not contain stale contradictions. Examples that block pass:
active claims presented as final while local manuscript sections still describe
them as candidate, `Blocking Missing Evidence` containing real unresolved
blockers, active artifacts only described in a back-matter plan,
figures/tables/algorithms/results missing inline placement, captions or source
paths, image-source figures without inline Markdown preview images, or wording
such as "tentative until source-level evidence checks are completed" after
evidence/final gates are claimed as pass.

Before marking any gate as `pass`, read `instructions/reviewers/REVIEW_TAXONOMY.md`. Do not treat "approved", "completed", "ready", "plausible", "architecture pass", "supported with qualification", or "targeted revision ready" as pass. Those are partial results and require `continue` unless the relevant reviewer standard is fully satisfied.

The Final gate reviewer is required before the loop can stop. It must confirm
that all non-final current-trial reviewer files exist and pass under the shared
output schema, and that no blocking issues, required actions, unresolved
qualifications, active revision constraints, critical unassessed areas,
outdated reviewer instructions, incomplete final blueprint sections, or stale
pass-conflicting language remain.

`Next action` is the system's next step. `Response to human` is the user-facing
question or decision request the UI should show.

If a reviewer cannot yet pass because prerequisites are missing, mark that
reviewer as `continue` and make the missing prerequisite the next critical-path
action or a near-term trial. `Status: blocked` and `Status: needs_human` are both
hard stops. Use `blocked` for a non-human critical-path blocker that cannot be
repaired or routed around by the acquisition/substitution ladder, conversion, or
another critical-path-advancing trial. Use `needs_human` when the current
critical-path bottleneck genuinely needs a human decision, scope confirmation,
credential, private resource, or environment/access change and the
acquisition/substitution ladder has a documented terminal verdict. Remaining
bookkeeping, audits, manuscript cleanup, state repair, or reviewer refresh work
never justifies `continue` once the current bottleneck is human-gated. In both
hard-stop cases, write the exact user-facing blocker or question in
`Response to human:`.

External file access failures are not automatically human blockers. When a
trial needs a public file body such as a ZIP, CSV, PDF, dataset, or code
artifact, follow the Download Integrity And Fallback Ladder in
`instructions/RESOURCE_SCOUT.md`: verify HTTP status, content type, size,
magic bytes/archive listing/header rows/checksum when available; quarantine
HTML or error-page downloads; retry with safe downloader variants, user agent,
configured proxy/direct profiles, official alternate links, and verified local
caches; record all attempts. Only after that ladder is exhausted may the gate
ask the user for a file or network change. If useful work can continue through
metadata, alternate public resources, or a follow-up retrieval trial, use
`Status: continue` rather than `needs_human`.

### Non-Blocking Human Tasks

Maintain `research_trajectory/HUMAN_TASKS.md` for human questions, requests,
uploads, approvals, or preference checks that would improve the project but do
not stop useful autoresearch work. The main execution agent is the only
canonical writer for this file. Resource Scout, Reviewer Scope Analyst, core
reviewers, and specialized reviewers must report `Human task candidates` in
their own artifacts or reviews; after reading those artifacts, the main
execution agent merges, deduplicates, closes stale entries, and writes the
canonical queue.

Use this exact task block format:

```markdown
### HT0001: <short title>
Status: open | answered | closed | deferred
Priority: high | medium | low
Blocks: none | final_pass | future_trial
Question: <one concrete human question/request>
Why needed: <why the agent cannot resolve it alone>
Continue meanwhile: <specific non-human work that can continue>
Source: <trial/report/state path>
Created: <ISO timestamp>
Updated: <ISO timestamp>
```

Rules:

- keep at most three `Status: open` tasks;
- merge duplicate topics before adding a new task;
- close stale tasks when answered, superseded, or no longer needed;
- `Blocks` may only be `none`, `final_pass`, or `future_trial`; it is not a
  hard-stop field;
- do not set `Status: needs_human` merely because a human answer would be
  useful;
- if useful autoresearch work can continue, keep the gate `Status: continue`
  and merge any relevant human request into `HUMAN_TASKS.md`;
- absorb `Human task candidates` from Resource Scout reports, Reviewer Scope
  Analyst decisions, and reviewer files instead of letting those agents write
  the canonical queue directly;
- if the current critical-path bottleneck is genuinely human-gated and the
  acquisition/substitution ladder has a documented terminal verdict, use the
  Autoresearch Goal Gate `Status: needs_human` with a concrete
  `Response to human:`. Queue useful-but-nonblocking requests here instead.

### Subagent Progress Visibility

When starting, waiting on, completing, or falling back from trial-local
subagent work, the main execution agent must emit this exact single-line status
format in its visible update stream:

```text
Subagent update: <Resource Scout | Reviewer Scope Analyst | Specialized reviewer> | status: <starting | waiting | completed | fallback> | task: <short task> | output: <path or none>
```

Rules:

- emit `Subagent update: Resource Scout ...` before running or waiting on
  Resource Scout work, and emit `completed` or `fallback` after its report path
  is known;
- emit `Subagent update: Reviewer Scope Analyst ...` before running or waiting
  on reviewer-scope work, and emit `completed` or `fallback` after its decision
  path is known;
- emit `Subagent update: Specialized reviewer ...` only when the reviewer scope
  decision says `Spawn needed: yes`, then update it when that review completes
  or falls back;
- this line is for UI visibility only. It must not affect gate status, reviewer
  decisions, pass/fail logic, or the outer autoresearch loop.

---

## Reviewer Spawning

Before refreshing core reviewers, follow:

`instructions/REVIEWER_SCOPE_ANALYST.md`

The main execution agent must run Reviewer Scope Analyst work to decide whether the eight core reviewers cover the current trial's review risks, using a real subagent when available and the inline fallback when subagent orchestration is unavailable, stalled, or failed.

If that decision says a specialized review is needed, follow:

`instructions/reviewers/REVIEWER_SPAWNING.md`

Spawned reviewers are instruction files, not review outputs. Their review
results go into the relevant trial `reviews/` directory or `manuscript/reviews/`
when manuscript-facing.

Create a new reviewer only when the Reviewer Scope Analyst identifies a clear
quality risk that existing reviewer instructions do not cover.

---

## Knowledge Capture Contract

`research_trajectory/notes/` is not a trial log and not a second copy of
current state. It is a sparse, searchable knowledge base for reusable lessons
that help future agents choose better actions.

Use topic-based notes, not one growing notebook:

- `research_trajectory/notes/index.md`: map of active notes by topic and kind.
- `research_trajectory/notes/NOTES.md`: compatibility entrypoint pointing to
  `index.md`.
- `research_trajectory/notes/<topic>.md`: one durable lesson per file, named by
  topic in kebab case.

Every trial report must include a `Knowledge Capture` section with exactly one
of these outcomes:

- `Note updated: research_trajectory/notes/<topic>.md`
- `No note: <specific reason>`
- `Promoted elsewhere: <PROJECT.md, STATE.md, CURRENT_FINDINGS.md, or manifest path> because <reason>`

Write or update a topic note only when the lesson is reusable across future
trials and is not already better represented as project definition, current
state, accepted/tentative findings, resource provenance, or an artifact.

Good topic notes capture:

- what worked, failed, or should not be retried;
- how to use a high-value resource or prior-work bundle;
- a method warning, negative result, or process lesson;
- a recurring human preference that affects future choices but does not belong
  in `PROJECT.md`.

Do not write notes for:

- routine execution details;
- repeated summaries of trial reports;
- logs, raw outputs, or command transcripts;
- a note only because a trial happened;
- facts that should instead be promoted to `PROJECT.md`, `STATE.md`,
  `CURRENT_FINDINGS.md`, or `resources/user_input/RESOURCE_MANIFEST.md`.

Each topic note must cite its source paths and contain frontmatter:

```markdown
---
created: YYYY-MM-DD
kind: resource | method | negative-result | manuscript | process | preference
source: <trial, resource, review, or intervention path>
status: active | superseded
---
```

---

## Resource Folder Routing

Use `resources/` for raw or external inputs. Do not treat resources as current truth until promoted into `PROJECT.md`, `STATE.md`, `CURRENT_FINDINGS.md`, or a trial report.

Before grounding any plan, conversion, evidence review, venue review, manuscript
synthesis, or current-state update in a user-provided resource, complete the
Content Inspection Gate in `instructions/RESOURCE_INTAKE.md`. Record the files
inspected and any skipped files in the relevant PLAN, REPORT, review, or
manifest entry.

- `resources/user_input/INITIAL_BRIEF.md`: raw user one-line or short initial brief. Preserve it; do not overwrite unless asked.
- `resources/user_input/NOTES.md`: additional raw user notes.
- `resources/ongoing_work/`: old repos, partial work, previous experiments, partial drafts, existing data. Treat as read-only input until migrated.
- `resources/proposals/`: old or external proposals and research briefs.
- `resources/literature/`: papers, literature notes, deep research reports.
- `resources/data_sources/`: dataset links, access notes, licensing/provenance notes.
- `resources/target_venue/SEED_PAPERS.md`: selected seed papers from the target venue.
- `resources/target_venue/papers/`: local copies of seed papers when legally and practically available.
- `resources/target_venue/STYLE_NOTES.md`: venue writing and structure notes.
- `resources/target_venue/FIGURE_TABLE_NOTES.md`: venue figure/table style notes.

When an ongoing-work, proposal, or mixed bundle contains embedded bibliographies, reference exports, literature PDFs, target-venue materials, or data artifacts, surface those nested resources into the matching resource folder before using them for planning, evidence review, venue review, or manuscript synthesis. Preserve the original bundle as raw input and record the surfaced path in `resources/user_input/RESOURCE_MANIFEST.md`.

A manuscript `references.bib` or bibliography inside `resources/ongoing_work/` is literature grounding, not a target-venue seed-paper archive. It should be surfaced under `resources/literature/`. `resources/target_venue/papers/` is reserved for local copies of selected seed papers from the target venue or target style.

If a project has a target venue but no seed papers, create an early trial to collect 3-5 recent, relevant seed papers from that venue. Use them for style, structure, evidence standard, and figure/table design, not for copying research content.

---

## Resource Acquisition Policy

For user-provided or inferred resources, follow `instructions/RESOURCE_INTAKE.md` first. This policy covers agent-initiated acquisition during research after intake routing is complete.

For planned trial-level resource search, follow `instructions/RESOURCE_SCOUT.md`.
Scout-discovered resources are recorded as `autoresearch_discovered`, not as
current project truth, until the main execution agent promotes them through a
trial report or canonical state/findings/manuscript update.

For research-critical resources, acquisition is a mandatory part of a complete
research attempt. A resource is research-critical when a critical-path item
depends on it. A trial ending `incomplete-blocked` because of a resource is
valid only when it links an `ACQUISITION_DECISION.md` record showing the current
ladder position or terminal verdict.

The agent must search for, download, activate, or substitute research-critical
resources when needed for the research objective, including:

- datasets;
- model checkpoints;
- benchmark definitions;
- papers;
- code repositories;
- documentation;
- target-venue seed papers.

Before downloading large or restricted resources, check license, access
constraints, disk usage, and whether the resource is necessary. For public
research-critical resources, link-only handling is insufficient unless the
substitution ladder reaches a documented terminal verdict.

Record provenance in the relevant trial `REPORT.md`:

- source URL or citation;
- access date if relevant;
- license or usage constraints if known;
- local path;
- reason for inclusion;
- whether it is raw input, executable dependency, evidence, or style reference.

---

## Compute and Resource Policy

Before compute-heavy jobs, check available resources when possible:

- CPU;
- GPU;
- memory;
- disk space;
- running jobs from other users;
- scheduler or queue status;
- remote or cluster constraints.

Use available resources efficiently to maximize research progress, but do not disrupt other users or unrelated jobs.

Rules:

- do not start heavy jobs blindly;
- run a small test first when possible;
- use idle GPUs when safe and beneficial;
- do not cause other users' jobs to be killed, preempted, or starved;
- record important compute assumptions and resource usage in the trial `REPORT.md`.

---

## Manuscript Routing

Update manuscript files only when manuscript-facing story, claims, evidence,
section structure, figure/table/algorithm/method/dataset/result placement,
venue fit, or deliverable review changes.

Do not put exploratory raw outputs directly into `manuscript/`.

Result plots generated by code should originate from trial artifacts and may be promoted into `manuscript/figures/` only when they are candidate-final.

For non-result conceptual figures, do not draw or generate the figure by
default. Place the figure block inline in `manuscript/BLUEPRINT.md` where the
manuscript uses it. You may also mirror a detailed prompt-like specification in:

`manuscript/figures/FIGURE_SPECS.md`

---

## Human Input Handling

Classify every user message during execution:

### Ordinary interaction

Examples:

- progress check;
- clarification;
- temporary pause;
- request for logs;
- request for current status;
- request for explanation.

Action:

- answer directly;
- do not create a human intervention file;
- do not update `STATE.md` unless the answer reveals a real state inconsistency.

### Formal human intervention

Examples:

- plan correction;
- method correction;
- claim correction;
- resource correction;
- target venue correction;
- major pivot;
- new constraint.

Action:

- follow `instructions/INTERVENTION_PROTOCOL.md`;
- create a human intervention file;
- update `STATE.md`;
- update affected trial, findings, or manuscript files.

---

## Archive Policy

Do not archive casually.

Archive only when a file is misleading, deprecated, or should no longer appear active.

Before archiving, update `STATE.md` or `CURRENT_FINDINGS.md` to explain what superseded the material.

Prefer marking something superseded before moving it.

Do not archive raw trial records unless explicitly instructed.

---

## Git Policy

Use git as the local audit trail.

Commit after meaningful iterations, state updates, trial completion, manuscript blueprint updates, or formal human intervention handling.

Suggested commit prefixes:

- `trial:`
- `state:`
- `findings:`
- `manuscript:`
- `resources:`
- `intervention:`
- `ui:`

Push if a remote exists and progress is meaningful.
