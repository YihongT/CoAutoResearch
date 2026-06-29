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
- `manuscript/figures/FIGURE_SPECS.md` when present as a secondary spec cache
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
- Is each active figure/table placed inline at the specific manuscript section,
  subsection, or paragraph location where the final manuscript would use it?
- Does each active figure/table state the result, conceptual basis, or local
  manuscript job it carries, not only its visual form?
- Does `manuscript/BLUEPRINT.md` contain every active figure/table block in
  manuscript reading order, with placement, inclusion status, role, figure
  content/panel layout or publication-ready table body, complete caption, source
  artifact/spec path, local evidence/provenance links, target-venue rationale,
  and remaining blocker?
- For active tables, does the blueprint include the publication-ready Markdown
  table body directly in the local manuscript position, with final intended
  rows, columns, readable labels, caption, notes/definitions/abbreviations when
  needed, source traceability, key result, and target-venue fit?
- For figures, is a spec/visual brief sufficient for the current scope unless a
  final rendered figure asset already exists?
- If there are no active tables, does the blueprint explain why no table is
  needed, which candidate tables were considered, and where the needed
  comparison or evidence mapping is carried in the manuscript architecture?

## Pass Standard

Use `Decision: pass` only when every active figure/table required for the
declared scope is final enough for that scope: inclusion decision made, source or
artifact traceable, caption precise, labels readable, and target-audience fit
checked. The final blueprint must also be self-contained for figure/table status
and rationale in the exact manuscript location where each display belongs.
Candidate assets, unresolved display inventory, missing captions, missing
source artifacts, image-source figures without a Markdown preview image in the
inline BLUEPRINT.md figure block, display specs that only live in
`FIGURE_SPECS.md`, active figures/tables that only appear in a back-matter plan,
active tables that are only column/row/comparison specs or source links rather
than publication-ready inline tables, missing local placement, missing result
mapping, missing target-venue rationale, stale bundle notes, or "acceptable for
now" displays require `Decision: continue`.

## Output Schema

Follow `instructions/reviewers/REVIEW_TAXONOMY.md`. Include explicit reviewed
input paths for figure specs, table materials, blueprint sections, trial
artifacts, and any candidate display files. If there are no active figures or
tables, still write the file and judge whether the no-display or no-table
rationale is sufficient for the current scope.
