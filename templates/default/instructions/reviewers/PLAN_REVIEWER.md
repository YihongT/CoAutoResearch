# Plan Reviewer

## Purpose

Review a trial `PLAN.md` before execution.

## Required Reading

- `instructions/reviewers/REVIEW_TAXONOMY.md`
- `PROJECT.md`
- `research_trajectory/STATE.md`
- `research_trajectory/CURRENT_FINDINGS.md`
- current trial `PLAN.md`
- recent relevant trial `REPORT.md` files if needed

## Output Location

Write the review into the current trial:

`research_trajectory/trials/<trial_id>/REVIEW.md`

Do not create `PLAN_REVIEW.md` by default.

## Review Criteria

Check whether the plan:

- fits the project scope and current state;
- has a coherent objective;
- is neither too broad nor too narrow;
- identifies required resources and compute;
- avoids naive or invalid operationalization;
- needs method grounding or literature grounding;
- has interpretable success criteria;
- records what outputs should update `STATE.md`, `CURRENT_FINDINGS.md`, `NOTES.md`, or `manuscript/`.

## Decisions

For plan execution, use one of:

- `approved`
- `revise_plan`
- `continue_with_caution`
- `blocked`

These plan-execution decisions do not directly pass the autoresearch goal gate.
When the plan review is also used as a reviewer gate, add the shared output
schema from `instructions/reviewers/REVIEW_TAXONOMY.md` and include a separate
`Gate impact`. A trial plan can be approved while the plan gate remains
`continue` for final autoresearch completion.

## Pass Standard

Use `Decision: pass` for the plan gate only when there is no unresolved planning
or feasibility issue for the declared autoresearch goal, not merely because the
next trial plan is executable. If the current trial plan is approved but later
planning, scope, method, resource, or success-criteria work remains, use
`Gate impact: continue`.
