# Final Gate Reviewer

## Purpose

Decide whether the autoresearch goal is truly complete. This reviewer aggregates
the other reviewer outputs and current project state. It does not replace
domain, evidence, venue, manuscript, figure/table, process, or plan review.

## Required Reading

- `instructions/reviewers/REVIEW_TAXONOMY.md`
- `PROJECT.md`
- `research_trajectory/STATE.md`
- `research_trajectory/CURRENT_FINDINGS.md`
- current trial `PLAN.md`, `REPORT.md`, `reviews/`, and artifacts
- `manuscript/BLUEPRINT.md` and `manuscript/reviews/` when manuscript-facing
- `manuscript/figures/FIGURE_SPECS.md` when any figure/table/display is active
- `resources/target_venue/SEED_PAPERS.md`, `STYLE_NOTES.md`, and
  `FIGURE_TABLE_NOTES.md` when a target venue is declared
- all six other current-trial reviewer files under
  `research_trajectory/trials/<trial_id>/reviews/`

## Output Location

Write the canonical current-trial final gate review to:

`research_trajectory/trials/<trial_id>/reviews/FINAL_GATE_REVIEW.md`

If the review is manuscript-facing, you may also mirror or summarize it under
`manuscript/reviews/`, but the current trial file remains required.

## Review Criteria

Check:

- every required reviewer used the shared output schema;
- every required current-trial reviewer file exists and has `Decision: pass`
  and `Gate impact: pass`;
- reviewer instructions are current for this project; an outdated or missing
  core reviewer file is a blocker;
- there are no unresolved blocking issues, required actions, unresolved
  qualifications, or critical unassessed areas;
- `STATE.md`, `CURRENT_FINDINGS.md`, `manuscript/BLUEPRINT.md`, recent trial
  reports, and manuscript reviews do not contain active revision constraints
  that contradict a pass;
- "trial completed", "plan approved", "plausible venue fit", "architecture is
  coherent", "supported with qualification", or "ready for targeted revision"
  are not being treated as final pass;
- if the goal is manuscript-facing, the deliverable is at submission-readiness
  level for the declared target, not merely ready for another revision phase.
- if the goal is manuscript-facing, `manuscript/BLUEPRINT.md` is a
  self-contained, target-venue-ready blueprint with explicit organization,
  accepted claims, evidence map, target-manual section architecture,
  paragraph-level writing plan, figure plan, table plan, reference plan,
  appendix/supplement plan, blockers, qualifications, deprecated ideas, and
  submission-readiness summary.
- if the target deliverable has an abstract, the blueprint plans the abstract
  according to the target manual: structured headings when required, otherwise
  4-6 unstructured rhetorical moves.
- every active figure has a title, inclusion status, argument/result role,
  content and panel layout, caption draft/current caption, source artifact path,
  result shown or conceptual basis, linked manuscript paragraphs, linked claim
  IDs, linked evidence IDs, target-venue fit rationale, and remaining blocker
  value.
- every active table has a title, inclusion status, argument/result role,
  content/columns/rows/comparison logic, caption draft/current caption, source
  artifact path, key results shown, linked manuscript paragraphs, linked claim
  IDs, linked evidence IDs, target-venue fit rationale, and remaining blocker
  value. Compact tables may be included directly; larger tables must link to a
  source artifact. If there are no active tables, the blueprint must explain why
  no table is needed and what carries the claim/evidence mapping instead.
- `Blocking Missing Evidence` is empty or explicitly `none`; missing evidence
  may not be hidden as a non-blocking qualification.
- stale language such as "tentative until source-level evidence checks are
  completed" is absent once evidence/final gates are claimed as pass.

## Artifact Consistency Audit

Before deciding `pass`, write an artifact consistency audit. It must state:

- reviewer baseline status: current or outdated;
- final blueprint section completeness;
- target manual section title/order fidelity;
- paragraph plan completeness;
- accepted claims vs candidate claims status;
- blocking missing evidence status;
- figure plan completeness;
- figure paragraph placement completeness;
- table plan or no-table rationale completeness;
- table paragraph placement and source/result completeness;
- reference/literature grounding completeness;
- appendix/supplement plan completeness;
- stale contradiction scan result;
- exact reason the gate can pass, or the exact next action if it cannot.

## Output Schema

Follow `instructions/reviewers/REVIEW_TAXONOMY.md`.

Use `Decision: pass` only when the autoresearch loop should stop. If any
required current-trial reviewer file is missing, non-passing, ambiguous, or
scoped below final readiness, use `Decision: continue` and list the exact
required action.

A final-gate output without an artifact consistency audit is incomplete and
must not be treated as pass.
