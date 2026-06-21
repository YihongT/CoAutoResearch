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
- recent trial `PLAN.md`, `REPORT.md`, and `reviews/` files
- `research_trajectory/notes/index.md` and relevant topic notes
- relevant formal human interventions

## Review Criteria

Ask:

- Are recent trials producing real research progress?
- Is the agent stuck on a narrow technical issue?
- Are we optimizing an unimportant metric or artifact?
- Should the next step be execution, method revision, literature grounding, seed paper review, manuscript restructuring, or human intervention?
- Is the current target venue still plausible?
- Are current claims supported by evidence?
- Is reusable knowledge buried in reports, duplicated across canonical files,
  or missing from the topic-based notes index?

## Expected Output

- diagnosis of progress;
- local-minimum risks;
- recommended next trial;
- any required updates to `STATE.md`, `CURRENT_FINDINGS.md`, or topic-based
  knowledge notes.

## Pass Standard

Use `Decision: pass` only when the process is not drifting from `PROJECT.md`, no
unresolved formal intervention or state inconsistency remains, recent trials are
making substantive progress, and no known local-minimum or hidden-TODO risk
needs a follow-up trial. "Process review completed" is not the same as pass.

## Output Schema

Follow `instructions/reviewers/REVIEW_TAXONOMY.md`. Include explicit reviewed
input paths for recent trial plans, reports, reviewer files, notes, current
state, and any formal human interventions. If there is not enough trajectory
history to assess process quality, still write the file and record that as an
unassessed area or required action.
