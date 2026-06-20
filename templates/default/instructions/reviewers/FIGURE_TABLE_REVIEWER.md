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

- Trial-level figure/table review: current trial `REVIEW.md`
- Manuscript-facing review: `manuscript/reviews/`

## Review Criteria

Check:

- Does each figure/table support the core story?
- Is it visually professional for the target venue?
- Are captions informative and precise?
- Are axes, labels, baselines, uncertainty, and comparisons clear?
- Are conceptual figures specified in enough detail before generation?
- Are result plots traceable to trial artifacts?
- Does `manuscript/BLUEPRINT.md` summarize every active figure/table with
  inclusion status, argument or result role, content, caption, source artifact,
  linked claims/evidence, target-venue rationale, and remaining blocker?
- If there are no active tables, does the blueprint explain why no table is
  needed, which candidate tables were considered, and where the claim/evidence
  mapping is carried instead?

## Pass Standard

Use `Decision: pass` only when every active figure/table required for the
declared scope is final enough for that scope: inclusion decision made, source or
artifact traceable, caption precise, labels readable, and target-audience fit
checked. The final blueprint must also be self-contained for figure/table status
and rationale. Candidate assets, unresolved display inventory, missing captions,
missing source artifacts, missing target-venue rationale, stale bundle notes, or
"acceptable for now" displays require `Decision: continue`.

## Output Schema

Follow `instructions/reviewers/REVIEW_TAXONOMY.md`.
