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

If acquiring, filing, resolving, or interpreting user-provided resources, read `instructions/RESOURCE_INTAKE.md`.

If converting prior work, raw user input, old repos, previous experiments, or proposals, read `instructions/CONVERSION.md`.

If updating manuscript-facing files, read `instructions/MANUSCRIPT.md`.

---

## Adaptive Intake Router

Before framing, conversion, or normal research execution, route the latest user message and UI payload:

1. If explicit UI resources are present, file them under `resources/` and update `resources/user_input/RESOURCE_MANIFEST.md` first.
2. If unattached resource clues are present, follow `instructions/RESOURCE_INTAKE.md`.
3. If newly filed resources materially affect `PROJECT.md`, `STATE.md`, `CURRENT_FINDINGS.md`, or manuscript direction, run `instructions/CONVERSION.md`.
4. If a formal human intervention changes direction, follow `instructions/INTERVENTION_PROTOCOL.md`, then run conversion only if canonical state needs reinterpretation.
5. If a plan-level correction makes the active plan or project framing invalid, update the active plan and `STATE.md`; run conversion only if canonical project state is no longer valid.
6. If there are no prior materials or the user explicitly starts from scratch, use `instructions/COLD_START.md`.
7. Otherwise continue the normal execution loop.

Do not create or revise `PROJECT.md` from a user message that names prior work, a repo, dataset, papers, or files until resource intake is complete, blocked with a clear user question, or explicitly not needed.

---

## Folder Operation Contract

Use this contract whenever deciding where to read, write, move, or summarize information.

| Path | Role | Read when | Write/update when | Must not contain |
|---|---|---|---|---|
| `PROJECT.md` | Canonical research proposal and target definition | before substantive work | cold start, conversion, or true project-definition change | trial logs, raw outputs, temporary thoughts |
| `resources/` | Raw inputs and external materials | when grounding, converting, acquiring resources, or checking provenance | when adding user brief, prior work, literature, seed papers, data-source notes | accepted current truth unless promoted elsewhere |
| `workspace/` | Live executable workspace | when executing, debugging, analyzing, generating outputs | when adding or modifying code, notebooks, configs, working data, generated outputs | authoritative claims without trial/report traceability |
| `research_trajectory/STATE.md` | Current control state | before every trial and after human intervention | when objective, plan, method status, constraints, blockers, active resources, or next step changes | raw logs, full artifacts, literature dumps |
| `research_trajectory/CURRENT_FINDINGS.md` | Latest global synthesis of findings/results/claims/evidence | before interpreting results or updating manuscript | when accepted/tentative/rejected findings, active claims, limitations, or evidence map changes | raw outputs, command logs, full notebooks |
| `research_trajectory/trials/` | Audit trail of planned work packages | before continuing, reviewing, or synthesizing recent work | for every substantive planned work package | global-only summaries without a concrete work package |
| `research_trajectory/notes/` | Sparse, topic-based knowledge notes | when looking for reusable resource, method, process, or human-preference lessons | when a trial or review creates reusable knowledge that does not belong in a canonical state file; update `index.md` whenever adding or retiring a topic note | routine trial summaries, execution logs, or duplicates of `PROJECT.md`, `STATE.md`, `CURRENT_FINDINGS.md`, reports, or resource manifests |
| `research_trajectory/human_interventions/` | Formal human control inputs | before major steps and when resolving contradictions | only when a user message changes direction, constraints, methods, claims, resources, venue, or priority | progress questions, ordinary pauses, log requests |
| `manuscript/` | Manuscript blueprint and deliverable-facing materials | when story, claims, figures, tables, or venue fit matter | when manuscript-facing structure/evidence/figures/tables/reviews change | exploratory raw outputs not promoted as candidate deliverables |
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

Do not duplicate full method implementation in `CURRENT_FINDINGS.md`. Method implementation lives in `workspace/`; method status and rationale live in `STATE.md`.

---

## Workspace-to-Trial Artifact Rule

`workspace/` is the live working area, not the canonical record.

If a file in `workspace/` is used as evidence for a trial, then the trial `REPORT.md` must cite its path and explain how it was produced.

If the file is stable and small enough, copy it into:

`research_trajectory/trials/<trial_id>/artifacts/`

If the file is large, generated, external, or should remain in `workspace/`, keep it there but record in `REPORT.md`:

- exact path;
- command or notebook used;
- config;
- data source;
- relevant commit hash if available;
- whether it is accepted, tentative, rejected, or only exploratory.

A result is not accepted merely because it exists in `workspace/`.

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

A trial is a planned research work package. It may include multiple actions if they serve one coherent objective, are planned before execution, and remain interpretable afterward.

A trial is not required for trivial edits, ordinary clarification, progress reporting, or temporary pauses.

Do not write trial plans in the root directory. Do not write trial reports only in chat.

---

## Standard Run Loop

1. Read the required files.
2. Check `research_trajectory/human_interventions/pending/`.
3. If a pending item is a formal human intervention, follow `instructions/INTERVENTION_PROTOCOL.md` before continuing.
4. Identify the next coherent objective.
5. Create a new trial folder under `research_trajectory/trials/<new_trial_id>/`.
6. Write `PLAN.md` before execution.
7. Create `reviews/` and run the Plan reviewer into `reviews/PLAN_REVIEW.md`; revise `PLAN.md` if the review requires it.
8. Execute mainly in `workspace/` or another clearly justified location.
9. Save or link raw outputs through the trial `artifacts/` and `REPORT.md`.
10. Write `REPORT.md` after execution.
11. Run or refresh all eight core reviewers for this trial and write their canonical files:
    - `reviews/PLAN_REVIEW.md`
    - `reviews/PROCESS_REVIEW.md`
    - `reviews/EVIDENCE_REVIEW.md`
    - `reviews/VENUE_FIT_REVIEW.md`
    - `reviews/MANUSCRIPT_REVIEW.md`
    - `reviews/FIGURE_TABLE_REVIEW.md`
    - `reviews/REFERENCE_REVIEW.md`
    - `reviews/FINAL_GATE_REVIEW.md`
12. A reviewer with little to assess still writes its file with a scoped judgment and explicit unassessed areas.
13. Update only global files that genuinely changed:
    - `research_trajectory/STATE.md`
    - `research_trajectory/CURRENT_FINDINGS.md`
    - `research_trajectory/notes/index.md` and topic notes when knowledge capture changes
    - `manuscript/BLUEPRINT.md`
    - `manuscript/figures/FIGURE_SPECS.md`
14. Update the `Autoresearch Goal Gate` in `STATE.md` so each reviewer line references the current trial's reviewer file path.
15. Commit changes to git.
16. Push if a remote exists and progress is meaningful.

---

## Trial File Templates

### `PLAN.md` should include

- objective;
- rationale;
- required reading/resources;
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
- `FINAL_GATE_REVIEW.md`

Legacy `REVIEW.md` may exist only as a human-readable summary or compatibility
record. Do not treat it as canonical when `reviews/` exists.

Every active trial must produce all eight core reviewer files. No reviewer gate
may silently carry forward from an earlier trial. If a reviewer cannot assess
much in the current trial, it must still write the current trial file with
`Decision: continue`, `blocked`, or `needs_human` as appropriate and list what
was unassessed.

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
- reviewer gate lines for Plan, Process, Evidence, Venue fit, Manuscript, Figure/table, and Final gate;
- the current trial reviewer file path on each reviewer gate line;
- the next action when any gate is not `pass`.

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
- `research_trajectory/CURRENT_FINDINGS.md`
- `manuscript/figures/FIGURE_SPECS.md`, when figures or tables are active
- any manuscript review notes needed to make current status clear

`manuscript/BLUEPRINT.md` must be self-contained and target-venue-ready before
final pass. It must include target venue/audience/article type, organization
rationale, core story, architecture overview/table of contents, manuscript
architecture in target-venue reading order, compact reader-facing section
briefs, local claim/evidence/result explanations, reader takeaways for inline
figure/table/algorithm/dataset/benchmark/result blocks, reference/literature
grounding plan, appendix/supplement plan, blocking missing evidence, required
qualifications, provenance/audit index, deprecated ideas, and
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
paths, or wording such as "tentative until source-level evidence checks are
completed" after evidence/final gates are claimed as pass.

Before marking any gate as `pass`, read `instructions/reviewers/REVIEW_TAXONOMY.md`. Do not treat "approved", "completed", "ready", "plausible", "architecture pass", "supported with qualification", or "targeted revision ready" as pass. Those are partial results and require `continue` unless the relevant reviewer standard is fully satisfied.

The Final gate reviewer is required before the loop can stop. It must confirm
that all seven other current-trial reviewer files exist and pass under the shared
output schema, and that no blocking issues, required actions, unresolved
qualifications, active revision constraints, critical unassessed areas,
outdated reviewer instructions, incomplete final blueprint sections, or stale
pass-conflicting language remain.

If a reviewer cannot yet pass because prerequisites are missing, mark that reviewer as `continue` and make the missing prerequisite the next action or a near-term trial. If a human decision is genuinely required, mark `Status: needs_human` and state the exact question.

---

## Reviewer Spawning

If the current task requires a specialized review perspective not covered by existing reviewers, follow:

`instructions/reviewers/REVIEWER_SPAWNING.md`

Spawned reviewers are instruction files, not review outputs. Their review
results go into the relevant trial `reviews/` directory or `manuscript/reviews/`
when manuscript-facing.

Create a new reviewer only when it addresses a clear quality risk.

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

The agent may search for or download relevant resources when useful for the research objective, including:

- datasets;
- model checkpoints;
- benchmark definitions;
- papers;
- code repositories;
- documentation;
- target-venue seed papers.

Before downloading large or restricted resources, check license, access constraints, disk usage, and whether the resource is necessary.

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
