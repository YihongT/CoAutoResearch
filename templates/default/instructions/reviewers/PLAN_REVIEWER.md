# Plan Reviewer

## Purpose

Review a trial `PLAN.md` before execution.

## Required Reading

- `instructions/reviewers/REVIEW_TAXONOMY.md`
- `PROJECT.md`
- `research_trajectory/STATE.md`
- `research_trajectory/CURRENT_FINDINGS.md`
- `instructions/RESOURCE_SCOUT.md`
- current trial `PLAN.md`
- recent relevant trial `REPORT.md` files if needed

## Output Location

Write the canonical current-trial plan review to:

`research_trajectory/trials/<trial_id>/reviews/PLAN_REVIEW.md`

## Review Criteria

Check whether the plan:

- fits the project scope and current state;
- has a coherent objective;
- is neither too broad nor too narrow;
- identifies required resources and compute;
- avoids naive or invalid operationalization;
- needs method grounding or literature grounding;
- has interpretable success criteria;
- records what outputs should update `STATE.md`, `CURRENT_FINDINGS.md`, `manuscript/`, or knowledge notes;
- includes the required `Resource Scout Brief`;
- uses `Scout: required` by default for substantive trials;
- gives a concrete `Skip reason:` if `Scout: skipped`;
- gives enough search scope, resource types, disciplines/domains, download
  policy, expected destinations, and stop criteria for the scout step to be
  auditable;
- declares possible knowledge-capture outputs when the plan may produce reusable
  resource, method, negative-result, manuscript, process, or preference lessons.

## Decisions

Use the shared decisions from `instructions/reviewers/REVIEW_TAXONOMY.md`.
A trial plan can be executable while the plan gate remains `continue` for final
autoresearch completion; record those positives under
`Qualified / Partial Passes` instead of using non-canonical decisions such as
`approved`.

## Pass Standard

Use `Decision: pass` for the plan gate only when there is no unresolved planning
or feasibility issue for the declared autoresearch goal, not merely because the
next trial plan is executable. If the current trial plan is approved but later
planning, scope, method, resource, or success-criteria work remains, use
`Gate impact: continue`.

## Output Schema

Follow `instructions/reviewers/REVIEW_TAXONOMY.md`. Include explicit reviewed
input paths for `PROJECT.md`, `STATE.md`, `CURRENT_FINDINGS.md`, the current
trial `PLAN.md`, and any prior reports used to assess feasibility.
