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
- complete architecture overview / table of contents with all planned section,
  subsection, subsubsection, and deeper titled units;
- research problem motivation;
- novelty and contribution clarity;
- story coherence;
- abstract structure and content plan when the target deliverable has an
  abstract, including target-venue role, rhetorical moves, claim/evidence
  posture, and word/structure constraints;
- paragraph-level writing plan for every active titled unit;
- local claim/evidence/result explanation inside the relevant manuscript
  section, without requiring readers to jump to separate ID maps;
- sufficiency and local placement of figures, tables, algorithms, datasets,
  benchmark results, methods, and captions;
- reference and literature grounding posture;
- appendix and supplement posture;
- treatment of limitations and alternatives;
- whether the manuscript can stand on its own without hidden trial details.

## Pass Standard

Use `Decision: pass` only for submission-readiness or declared final-deliverable
readiness. The manuscript must have no unresolved required revision constraints
for the declared scope, and the review must account for contribution, evidence,
venue fit, displays/methods/results, limitations, references, and
self-contained readability. For manuscript-facing final pass,
`manuscript/BLUEPRINT.md` must be self-contained and target-venue-ready:
target-venue section titles/order/depth, abstract plan when applicable,
paragraph-level writing plans, local claim/evidence/result explanations, inline
figure/table/algorithm/dataset/benchmark/result blocks, captions,
publication-ready inline table bodies for every active table, references,
appendix/supplement posture, blocking missing evidence, required qualifications,
provenance/audit index, and submission-readiness must all be explicit and
mutually consistent.

Each active titled unit must specify the target-venue role, reader question
answered, local thesis or purpose, local claims in plain language, local
evidence/results/artifacts, placed displays/methods/results, local
qualifications, and transition job. Every paragraph row must map to the
relevant local evidence/result/artifact, display/method/result block, citation
posture, qualification, and transition job. Generic rows such as "discuss
results", unplaced figures/tables/algorithms/results, or sections that only
point to claim/evidence IDs require `Decision: continue`.

Separate claim/evidence maps, `Figure Plan`, `Table Plan`, or
`manuscript/figures/FIGURE_SPECS.md` entries may support provenance, but they
cannot substitute for a self-contained manuscript architecture. If a reader
must leave the target-venue reading order to understand what goes where, use
`Decision: continue`.

For active tables, table specs, column lists, row descriptions, comparison
logic, or source links do not substitute for a publication-ready Markdown table
body in the local manuscript position. Use `Decision: continue` if an active
table cannot be read as the table that would appear in the manuscript or
supplement.

If the manuscript architecture is coherent, the story is plausible, or the
deliverable is ready for targeted revision, use `Decision: continue` and record
those positives under `Qualified / Partial Passes`.

## Output Schema

Follow `instructions/reviewers/REVIEW_TAXONOMY.md`. Include explicit reviewed
input paths for the blueprint, manuscript sections, figures, tables, appendix,
target-venue resources, trial report, and any manuscript review mirrors you
consulted.
