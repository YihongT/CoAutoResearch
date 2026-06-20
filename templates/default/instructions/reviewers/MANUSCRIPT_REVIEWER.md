# Manuscript Reviewer

## Purpose

Review manuscript-facing deliverables as a target-venue reviewer would.

## Required Reading

- `instructions/reviewers/REVIEW_TAXONOMY.md`
- `PROJECT.md`
- `research_trajectory/STATE.md`
- `research_trajectory/CURRENT_FINDINGS.md`
- `manuscript/BLUEPRINT.md`
- manuscript sections, figures, tables, appendix, and reviews when present
- target venue seed papers and style notes when relevant

## Output Location

Write the canonical current-trial manuscript review to:

`research_trajectory/trials/<trial_id>/reviews/MANUSCRIPT_REVIEW.md`

If the review is manuscript-facing, you may also mirror or summarize it under:

`manuscript/reviews/`

but the current trial file remains required.

## Review Criteria

Evaluate:

- target venue fit;
- fidelity to the target manual, venue style notes, and seed-paper section
  structure;
- target-venue organization rationale;
- research problem motivation;
- novelty and contribution clarity;
- story coherence;
- abstract structure and content plan when the target deliverable has an
  abstract;
- paragraph-level writing plan for every active section;
- claim/evidence alignment;
- sufficiency of figures and tables;
- placement of figures/tables/results in specific paragraphs;
- reference and literature grounding posture;
- appendix and supplement posture;
- treatment of limitations and alternatives;
- whether the manuscript can stand on its own without hidden trial details.

## Pass Standard

Use `Decision: pass` only for submission-readiness or declared final-deliverable
readiness. The manuscript must have no unresolved required revision constraints
for the declared scope, and the review must account for contribution, evidence,
venue fit, figures/tables, limitations, references, and self-contained
readability. For manuscript-facing final pass, `manuscript/BLUEPRINT.md` must be
self-contained and target-venue-ready: accepted claims, evidence, target-venue
section titles/order, abstract plan when applicable, paragraph-level writing
plan, figures, tables, captions, references, appendix/supplement posture,
blocking missing evidence, required qualifications, and submission-readiness
must all be explicit and mutually consistent.

Each active section must specify the section thesis, reader question answered,
narrative role, and a paragraph plan that states what each paragraph covers
without drafting full paper prose. Every paragraph row must map to the relevant
claims/evidence, results/artifacts, figures/tables, citation posture,
qualification, and transition job. Generic rows such as "discuss results" or
unplaced figures/tables require `Decision: continue`.

If the manuscript architecture is coherent, the story is plausible, or the
deliverable is ready for targeted revision, use `Decision: continue` and record
those positives under `Qualified / Partial Passes`.

## Output Schema

Follow `instructions/reviewers/REVIEW_TAXONOMY.md`. Include explicit reviewed
input paths for the blueprint, manuscript sections, figures, tables, appendix,
target-venue resources, trial report, and any manuscript review mirrors you
consulted.
