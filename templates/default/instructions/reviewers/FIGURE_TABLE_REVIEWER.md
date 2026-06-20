# Figure and Table Reviewer

## Purpose

Review figure and table quality, especially target-venue fit and communication value.

## Required Reading

- `instructions/reviewers/REVIEW_TAXONOMY.md`
- `PROJECT.md`
- `research_trajectory/CURRENT_FINDINGS.md`
- `resources/target_venue/FIGURE_TABLE_NOTES.md`
- `resources/target_venue/SEED_PAPERS.md`
- `manuscript/BLUEPRINT.md`
- `manuscript/figures/FIGURE_SPECS.md`
- candidate figures/tables if present

## Output Location

Write the canonical current-trial figure/table review to:

`research_trajectory/trials/<trial_id>/reviews/FIGURE_TABLE_REVIEW.md`

If the review is manuscript-facing, you may also mirror or summarize it under
`manuscript/reviews/`, but the current trial file remains required.

## Review Criteria

Check:

- Does each figure/table support the core story?
- Is it visually professional for the target venue?
- Are captions informative and precise?
- Are axes, labels, baselines, uncertainty, and comparisons clear?
- Are conceptual figures specified in enough detail before generation?
- Are result plots traceable to trial artifacts?
- Is each active figure/table placed in specific manuscript paragraphs in
  `manuscript/BLUEPRINT.md`?
- Does each active figure/table state the result or conceptual basis it carries,
  not only its visual form?
- Does `manuscript/BLUEPRINT.md` summarize every active figure/table with
  inclusion status, argument or result role, content, visual style when
  applicable, complete caption, source artifact, linked paragraphs, linked
  claims/evidence, target-venue rationale, and remaining blocker?
- For tables, is the `Spec+source` representation sufficient: compact tables
  shown inline when useful, larger tables linked to a source artifact with
  columns/rows, key results, and caption specified?
- If there are no active tables, does the blueprint explain why no table is
  needed, which candidate tables were considered, and where the claim/evidence
  mapping is carried instead?

## Pass Standard

Use `Decision: pass` only when every active figure/table required for the
declared scope is final enough for that scope: inclusion decision made, source or
artifact traceable, caption precise, labels readable, and target-audience fit
checked. The final blueprint must also be self-contained for figure/table status
and rationale. Candidate assets, unresolved display inventory, missing captions,
missing source artifacts, missing linked paragraph placement, missing result
mapping, missing target-venue rationale, stale bundle notes, or "acceptable for
now" displays require `Decision: continue`.

## Output Schema

Follow `instructions/reviewers/REVIEW_TAXONOMY.md`. Include explicit reviewed
input paths for figure specs, table materials, blueprint sections, trial
artifacts, and any candidate display files. If there are no active figures or
tables, still write the file and judge whether the no-display or no-table
rationale is sufficient for the current scope.
