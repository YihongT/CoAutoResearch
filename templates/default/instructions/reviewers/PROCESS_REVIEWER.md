# Process Reviewer

## Purpose

Prevent the research process from getting stuck in a local minimum, repeating unproductive trials, or optimizing a small technical issue at the expense of the real research contribution.

Process review is required for every active trial. A dedicated process-review
trial may still be useful when the process itself is the objective.

## When to Invoke

Invoke when:

- several recent trials made little substantive progress;
- the agent is repeatedly fixing the same issue;
- the project seems to be drifting from `PROJECT.md`;
- evidence is not improving despite activity;
- a human asks for a process review;
- the standard autoresearch trial review cycle reaches this reviewer;
- the agent suspects a pivot or strategy change may be needed.

## Output Location

Write the canonical current-trial process review to:

`research_trajectory/trials/<trial_id>/reviews/PROCESS_REVIEW.md`

If the process itself is the objective, create a process-review trial, for
example:

`research_trajectory/trials/000024_process_review/`

That trial still writes `reviews/PROCESS_REVIEW.md`, and summarizes conclusions
in `REPORT.md`.

Do not create `research_trajectory/process_reviews/`.

## Required Reading

- `instructions/reviewers/REVIEW_TAXONOMY.md`
- `PROJECT.md`
- `research_trajectory/STATE.md`
- `research_trajectory/CURRENT_FINDINGS.md`
- `instructions/RESOURCE_SCOUT.md`
- `instructions/REVIEWER_SCOPE_ANALYST.md`
- recent trial `PLAN.md`, `REPORT.md`, and `reviews/` files
- current trial `artifacts/resource_scout/RESOURCE_SCOUT_REPORT.md`, when
  `PLAN.md` says `Scout: required`
- current trial `artifacts/reviewer_spawn/REVIEWER_SPAWN_DECISION.md`
- specialized review output under current trial `reviews/`, when the reviewer
  spawn decision says `Spawn needed: yes`
- `resources/user_input/RESOURCE_MANIFEST.md`, when scout-discovered resources
  were saved or linked
- `research_trajectory/notes/index.md` and relevant topic notes
- relevant formal human interventions

## Review Criteria

Ask:

- Are recent trials producing real research progress?
- Did the current trial complete a research attempt for the declared deliverable,
  or document the first blocker that prevented completion?
- Are recent trials repeatedly producing scaffolds, harnesses, audits, reviewer
  repairs, or manuscript placeholders without completing a research attempt?
- Is the agent stuck on a minor technical issue?
- Is the current Critical Path bottleneck advancing, or have recent trials
  accumulated non-empirical bookkeeping work?
- Have three recent closed trials reported `Empirical progress: no` while a
  Critical Path item remains open?
- Are we optimizing an unimportant metric or artifact?
- Should the next step be execution, method revision, literature grounding, seed paper review, manuscript restructuring, or human intervention?
- Is the current target venue still plausible?
- Are current claims supported by evidence?
- Is reusable knowledge buried in reports, duplicated across canonical files,
  or missing from the topic-based notes index?
- If the plan required Resource Scout, did it run before main execution and
  write `artifacts/resource_scout/RESOURCE_SCOUT_REPORT.md`?
- Were scout-discovered resources recorded in
  `resources/user_input/RESOURCE_MANIFEST.md` as `autoresearch_discovered`?
- If Resource Scout was skipped, was the skip reason valid for the current
  objective rather than a convenience omission?
- Does `artifacts/reviewer_spawn/REVIEWER_SPAWN_DECISION.md` exist for the
  current trial?
- If the reviewer spawn decision says `Spawn needed: yes`, does the named
  specialized reviewer instruction exist under `instructions/reviewers/`, and
  does the named specialized review output exist under current trial `reviews/`?
- If the reviewer spawn decision says `Spawn needed: no`, is the coverage reason
  specific enough to justify relying on the eight core reviewers?
- Does the current trial objective, dataset vintage, population, period, venue,
  and deliverable still match `PROJECT.md`?
- If there is a mismatch, does a formal
  `research_trajectory/human_interventions/pending/SCOPE_CHANGE_<id>.md`
  proposal exist? An unexplained mismatch is blocking and requires filing the
  proposal or reverting to the old scope. A mismatch persisting for two or more
  trials requires `Decision: needs_human`.

## Expected Output

- diagnosis of progress;
- local-minimum risks;
- Resource Scout process status for the current trial;
- Reviewer Scope Analyst decision status for the current trial;
- recommended next trial;
- any required updates to `STATE.md`, `CURRENT_FINDINGS.md`, or topic-based
  knowledge notes.

## Pass Standard

Use `Decision: pass` only when the process is not drifting from `PROJECT.md`, no
unresolved formal intervention or state inconsistency remains, recent trials are
making substantive progress, and no known local-minimum or hidden-TODO risk
needs a follow-up trial. "Process review completed" is not the same as pass.
Repeated incomplete or scaffold-only trials without a documented first blocker
are process failures and require `Decision: continue`. Repeated non-empirical
trials while a Critical Path item is open must make the next action advance the
bottleneck or escalate under the gate rules.

## Output Schema

Follow `instructions/reviewers/REVIEW_TAXONOMY.md`. Include explicit reviewed
input paths for recent trial plans, reports, reviewer files, notes, current
state, and any formal human interventions. If there is not enough trajectory
history to assess process quality, still write the file and record that as an
unassessed area or required action.
