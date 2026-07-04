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
- current trial `artifacts/resource_scout/RESOURCE_SCOUT_REPORT.md`, when
  `PLAN.md` says `Scout: required`
- current trial `artifacts/reviewer_spawn/REVIEWER_SPAWN_DECISION.md`
- specialized review outputs named by the reviewer spawn decision, when present
- `resources/user_input/RESOURCE_MANIFEST.md`, when the current trial discovered
  or used external resources
- `manuscript/BLUEPRINT.md` and `manuscript/reviews/` when manuscript-facing
- `manuscript/figures/FIGURE_SPECS.md` when any figure/table/display is active
- `resources/target_venue/SEED_PAPERS.md`, `STYLE_NOTES.md`, and
  `FIGURE_TABLE_NOTES.md` when a target venue is declared
- all non-final current-trial reviewer files under
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
- if the current trial required Resource Scout, the scout report exists, the
  manifest records scout-discovered resources as `autoresearch_discovered`, and
  the report is consistent with the trial's evidence and reference claims;
- if Resource Scout was skipped, `PLAN.md` contains a valid skip reason for the
  declared objective;
- `artifacts/reviewer_spawn/REVIEWER_SPAWN_DECISION.md` exists for the current
  trial;
- if the reviewer spawn decision says `Spawn needed: yes`, the named specialized
  reviewer instruction and specialized review output both exist;
- any specialized review output has no unresolved blocking issue, required
  action, unresolved qualification, or critical unassessed area that conflicts
  with pass;
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
  non-stub, self-contained, target-venue-ready, full-results blueprint with
  explicit organization,
  architecture overview/table of contents, target-manual section architecture,
  compact reader-facing section briefs, paragraph-level writing plans, local
  claim/evidence/result explanations, reader takeaways for inline
  figure/table/algorithm/dataset/benchmark/result blocks, reference plan,
  appendix/supplement plan, qualifications, provenance/audit index, deprecated
  ideas, and submission-readiness summary.
- all Critical Path items in `STATE.md` are `done` or `downgraded` through a
  confirmed human intervention.
- every research-critical resource has an `ACQUISITION_DECISION.md` terminal
  verdict.
- `manuscript/PAPER_PLAN.md` has no remaining blocking evidence unless the
  scope has been formally downgraded by human intervention.
- if the target deliverable has an abstract, the blueprint plans the abstract
  according to the target manual: structured headings when required, otherwise
  4-6 unstructured rhetorical moves, plus target-venue role, claim/evidence
  posture, and word/structure constraints.
- every active figure is placed inline in `Manuscript Architecture` and has a
  title, placement, inclusion status, purpose/result role, content and panel
  layout, visual style, caption draft/current caption, source artifact or spec
  path, preview image using Markdown image syntax when the source is an image
  file, result shown or conceptual basis, provenance links, target-venue fit
  rationale.
- every active table is placed inline in `Manuscript Architecture` and has a
  title, placement, inclusion status, purpose/result role, publication-ready
  Markdown table body in final row/column form, caption draft/current caption,
  table notes or `none`, source artifact or spec path, key result or conceptual
  contrast, provenance links, and target-venue fit rationale. Table specs,
  column lists, comparison logic, or source links are not enough for an active
  manuscript table. If there are no active tables, the
  blueprint must explain in the architecture or appendix/supplement plan where
  the needed comparison or evidence mapping is carried instead.
- every active algorithm, method, dataset, benchmark, or result block is placed
  inline in `Manuscript Architecture` and includes placement, purpose, source
  artifacts or code links, validation/evidence or limitations.
- separate claim/evidence maps, `Figure Plan`, `Table Plan`, and
  `manuscript/figures/FIGURE_SPECS.md` may support audit, but they cannot be
  used as the primary proof that the manuscript blueprint is readable or
  complete.
- `Blocking Missing Evidence` is explicitly `none`; missing evidence may not be
  hidden in `BLUEPRINT.md` or as a non-blocking qualification.
- stale language such as "tentative until source-level evidence checks are
  completed" is absent once evidence/final gates are claimed as pass.

## Artifact Consistency Audit

Before deciding `pass`, write an artifact consistency audit. It must state:

- core instruction baseline status: current or outdated;
- final blueprint section completeness;
- Critical Path status: all items done or confirmed downgraded;
- research-critical acquisition decisions: terminal verdicts present;
- blueprint state: non-stub full-results blueprint;
- Paper Plan remaining blockers status;
- target manual section title/order fidelity;
- architecture overview / table of contents completeness;
- paragraph plan completeness;
- section brief readability as a finished-results paper map;
- local claim/evidence/result explanation completeness;
- blocking missing evidence status;
- inline figure block completeness;
- inline publication-ready table block or no-table rationale completeness;
- inline algorithm/method/dataset/benchmark/result block completeness;
- artifact/section boundary integrity: `Result`, `Dataset`, `Benchmark`,
  `Metric`, and `RSLT...` headings use artifact fields, not section-planning
  fields;
- active result readability: no active result block is merely `planned`,
  `pending`, `TBD`, or waiting on a future trial instead of stating an actual
  reader-facing result summary and takeaway;
- planned result slot integrity: any inline `Result`, `Metric`, `RSLT...`,
  dataset, or benchmark block marked `candidate` must still state an actual
  result summary and source artifact path; missing or pending results belong in
  `manuscript/PAPER_PLAN.md`;
- reference/literature grounding completeness;
- Resource Scout status: required and completed, skipped with valid reason, or
  blocking because missing/undocumented/inconsistent;
- Reviewer Scope Analyst status: decision present, no specialized review needed,
  or specialized review completed without pass-blocking issues;
- reference list integrity: a canonical `References` section exists, the
  Reference reviewer passed, and inline citations and list entries are
  bidirectionally complete with no orphan citations, uncited entries, missing
  required fields, duplicates, or unresolved locators;
- appendix/supplement plan completeness;
- provenance/audit index status;
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
