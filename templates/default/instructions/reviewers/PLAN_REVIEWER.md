# Plan Reviewer

## Purpose

Review a trial `PLAN.md` before execution.

## Required Reading

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

Use one of:

- `approved`
- `revise_plan`
- `continue_with_caution`
- `blocked`
