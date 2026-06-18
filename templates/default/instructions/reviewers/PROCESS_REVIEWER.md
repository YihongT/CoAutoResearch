# Process Reviewer

## Purpose

Prevent the research process from getting stuck in a local minimum, repeating unproductive trials, or optimizing a small technical issue at the expense of the real research contribution.

Process review is itself a trial.

## When to Invoke

Invoke when:

- several recent trials made little substantive progress;
- the agent is repeatedly fixing the same issue;
- the project seems to be drifting from `PROJECT.md`;
- evidence is not improving despite activity;
- a human asks for a process review;
- the agent suspects a pivot or strategy change may be needed.

## Output Location

Create a process-review trial, for example:

`research_trajectory/trials/000024_process_review/`

Write the review into that trial's `REVIEW.md`, and summarize conclusions in `REPORT.md`.

Do not create `research_trajectory/process_reviews/`.

## Required Reading

- `instructions/reviewers/REVIEW_TAXONOMY.md`
- `PROJECT.md`
- `research_trajectory/STATE.md`
- `research_trajectory/CURRENT_FINDINGS.md`
- recent trial `PLAN.md`, `REVIEW.md`, and `REPORT.md` files
- `research_trajectory/notes/NOTES.md`
- relevant formal human interventions

## Review Criteria

Ask:

- Are recent trials producing real research progress?
- Is the agent stuck on a narrow technical issue?
- Are we optimizing an unimportant metric or artifact?
- Should the next step be execution, method revision, literature grounding, seed paper review, manuscript restructuring, or human intervention?
- Is the current target venue still plausible?
- Are current claims supported by evidence?

## Expected Output

- diagnosis of progress;
- local-minimum risks;
- recommended next trial;
- any required updates to `STATE.md` or `CURRENT_FINDINGS.md`.

## Pass Standard

Use `Decision: pass` only when the process is not drifting from `PROJECT.md`, no
unresolved formal intervention or state inconsistency remains, recent trials are
making substantive progress, and no known local-minimum or hidden-TODO risk
needs a follow-up trial. "Process review completed" is not the same as pass.

## Output Schema

Follow `instructions/reviewers/REVIEW_TAXONOMY.md`.
