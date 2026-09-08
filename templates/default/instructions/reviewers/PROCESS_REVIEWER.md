# Process Reviewer

## Purpose

Assess whether the trial and recent trajectory are making substantive research progress without drifting into local minima, repeated repair loops, low-value scaffolding, or protocol ceremony.

## Phase and output

- Phase: `post_stage` except legacy migrations explicitly marked otherwise.
- Reviewer key/scope: `process` / `process`.
- Bind the output to the exact stage ID and manifest hash.

## Required reading

- `instructions/reviewers/REVIEW_TAXONOMY.md`;
- Project, current published State, Findings, lines, campaigns, Human Tasks, venue state;
- current Plan, Expert Route, Report, Merge Request, staged candidate snapshot, Human Brief, Gate Evidence;
- recent relevant trial plans/reports/reviews and publish receipts;
- Resource Scout output and the applicable provenance manifest: the current
  trial's stage/revision-scoped Scout manifest for v2, or the user-input
  resource manifest for legacy v1;
- Reviewer Scope Analyst/Review Manifest and specialized outputs;
- relevant notes, instruction patch proposals, and formal interventions.

## Review criteria

### Trajectory progress

- Did the trial close a meaningful local question or produce an informative negative/diagnosis?
- Does the staged update accurately reflect what changed?
- Is the Critical Path advancing, or are trials accumulating bookkeeping, scaffolding, audits, or cosmetic changes?
- Are multiple recent trials repeating the same failure without a new discriminating hypothesis?
- Is the next move concrete and higher value than obvious alternatives?

### Scope and drift

- Does the objective, population/data, period, method, deliverable, and target venue still match the Project and formal interventions?
- If the active line changed, is the effect explicit and properly reviewed?
- Is a hidden pivot being smuggled through manuscript or campaign edits?
- Are trial boundaries respected, or did execution expand into an unreviewable module?

### Resource and expert process

- Record the Resource Scout process status, including required/skipped reason,
  real-subagent or fallback execution, output path, and any plan rereview.
- Record the Reviewer Scope Analyst decision status, including its decision
  artifact and any specialized reviewer output required for closure.
- If Resource Scout was required, did it run before dependent execution and record provenance?
- Were discovered resources inspected and registered correctly? In v2, require
  the trial-local Scout manifest/report and permitted
  `resources/autoresearch_discovered/<trial_id>` destination; never require or
  recommend an agent write to `resources/user_input/RESOURCE_MANIFEST.md`.
- If Scout was skipped, was that decision still valid after execution?
- Did Expert Route load the required move/general/venue standards and report missing packs honestly?
- Did the service Review Manifest include all deterministic triggers?

### Self-improvement and knowledge capture

- Does the topic-based notes index stay sparse, current, and free of routine
  trial-summary duplication?
- Is reusable knowledge buried in reports promoted to a result card, a focused
  topic note, or another appropriate destination?
- Are reusable research conclusions in result cards rather than buried in narrative?
- Are process/resource/method lessons captured only when reusable?
- Are duplicate or stale notes avoided?
- Do repeated instruction defects generate patch proposals rather than silent edits?

### Human interaction

- Are formal interventions honored?
- Are non-blocking human tasks distinct from a blocking needs-human state?
- Is a user request actionable and timed appropriately?
- Is the Human Brief understandable without reading reviewer ceremony?

### Canonical integrity

- Did the agent avoid direct writes to protected paths?
- Does the candidate snapshot use only allowed create/replace operations?
- Are stage/review hashes current?
- Is the proposed state internally consistent across findings, line, campaign, Critical Path, venue, manuscript, and brief?

## Local-minimum signals requiring revision

- repeated no-state-change trials with no new hypothesis;
- repeated repair of one low-impact tool issue while a larger bottleneck remains;
- full empirical suites planned before a main signal exists;
- paper polishing before evidence readiness;
- repeatedly selecting favorable subsets without tracking contrary evidence;
- endless literature/resource search without a stop rule;
- activity that cannot alter a claim, decision, artifact, or readiness state.

### Preserved legacy trajectory checks

For v1 compatibility, inspect the **two most recent consecutive** closed normal
trials whenever a Critical Path item remains open. The current `REPORT.md` must
state `Critical path outcome:` and the service-owned trajectory view must expose
`Consecutive non-empirical trials`. A trial may claim empirical progress only
when a real result, informative negative, conversion inventory, or acquisition
decision changed the evidence/resource state. The v2 structured projection must
preserve the same two-trial stall signal.

## Pass Standard

The shared strict pass rule in
`instructions/reviewers/REVIEW_TAXONOMY.md` applies. Process passes only when
the trajectory is coherent, non-drifting, and its next state and next move are
fully justified.

## Decision rules

- `pass`: process is coherent, non-drifting, and the next state/next move are justified.
- `revise`: process drift, missing scope control, stale trajectory synthesis, or weak next-move logic remains.
- `blocked`: non-human environment/resource failure prevents all valuable movement.
- `needs_human`: a human-only scope/identity/authority choice blocks all valuable movement.
