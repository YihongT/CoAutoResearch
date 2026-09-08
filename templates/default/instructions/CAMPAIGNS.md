# Campaigns

## Purpose

Campaigns track global completeness requirements across multiple bounded trials. They do not select the immediate next move.

## Component states

- `not_started`
- `in_progress`
- `partial`
- `tentative`
- `passed`
- `waived_with_rationale`
- `not_applicable`
- `blocked`

Only `passed`, `waived_with_rationale`, and `not_applicable` satisfy final readiness.

## Sources

Create only campaigns required by:

- project success criteria;
- active research line;
- enabled domain/method pack;
- target venue;
- deliverable type;
- reproducibility, safety, or ethics obligations.

Do not create a fixed empty checklist for every project.

## Relationship to Critical Path

Campaigns answer: what completeness components remain?

Critical Path answers: which one to three bottlenecks should be attacked next?

STATE derives its Critical Path from campaign blockers, line-killing uncertainties, human locks, and resource dependencies. Do not copy full campaign tables into STATE.

## Updates

Only published merge decisions update component status. A campaign component can be downgraded when later evidence invalidates an earlier result. Marking a component `passed` or `waived_with_rationale` forces Full review.
