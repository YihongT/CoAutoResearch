# Manuscript Reviewer

## Purpose

Review manuscript-facing deliverables as a target-venue reviewer would.

## Required Reading

- `instructions/reviewers/REVIEW_TAXONOMY.md`
- `PROJECT.md`
- `research_trajectory/STATE.md`
- `research_trajectory/CURRENT_FINDINGS.md`
- `manuscript/PAPER_PLAN.md`
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
- `PAPER_PLAN.md` coherence: planned obligations tied to Critical Path items,
  specific blockers, no unowned planned displays/results, and consistency with
  the current pre-results stub or promoted blueprint;
- treatment of limitations and alternatives;
- whether the manuscript can stand on its own without hidden trial details.
- artifact state:
  `scaffold-ok | results-partial | paper-ready | structurally-unreadable`.

`structurally-unreadable` means planned slots in manuscript architecture,
status-log content, control registers, dependency registers, citation queues,
contradictory artifact contracts, or trial-log pollution make the blueprint
unusable as a paper-writing handoff. This makes structural repair the mandatory
next action. `scaffold-ok` is valid only when `BLUEPRINT.md` is the explicit
pre-results stub and `PAPER_PLAN.md` coherently carries planned obligations and
blockers.

## Pass Standard

Use `Decision: pass` only for submission-readiness or declared final-deliverable
readiness. The manuscript must have complete real results for the declared
scope, no unresolved required revision constraints, and the review must account
for contribution, evidence,
venue fit, displays/methods/results, limitations, references, and
self-contained readability. For manuscript-facing final pass,
`manuscript/BLUEPRINT.md` must be self-contained, target-venue-ready, and
non-stub:
target-venue section titles/order/depth, abstract plan when applicable,
compact reader-facing section briefs, paragraph-level writing plans, local
claim/evidence/result explanations, inline figure/table/algorithm/dataset/
benchmark/result blocks with reader takeaways, captions, publication-ready
inline table bodies for every active table, Markdown preview images for
image-source figures, references, appendix/supplement posture, required
qualifications, provenance/audit index, and
submission-readiness must all be explicit and mutually consistent.

Artifact headings are not section headings. If a block titled `Result`,
`Dataset`, `Benchmark`, `Metric`, or `RSLT...` uses section-planning fields such
as `Section brief`, `Local thesis / purpose`, `Local claims in plain language`,
or `Transition job`, require `Decision: continue`. Active result blocks must
state the actual metric/result summary and reader takeaway in plain language;
`planned only`, `pending trial`, `TBD`, or similar future-work placeholders are
not acceptable active result content.

Numbered planned result slots do not count as a readable Results section. Any
inline `Result`, `Metric`, `RSLT...`, dataset, or benchmark block in
`Manuscript Architecture` must state an actual result summary and source
artifact path, even when marked `candidate`; otherwise move it to
`PAPER_PLAN.md`.

Each active titled unit must specify the target-venue role, a section brief
that reads as finished-results paper-map prose, reader question answered, local
thesis or purpose, local claims in plain language, local evidence/results/
artifacts, placed displays/methods/results, local qualifications, and
transition job. Every paragraph row must map to the
relevant local evidence/result/artifact, display/method/result block, citation
posture, qualification, and transition job. Generic rows such as "discuss
results", unplaced figures/tables/algorithms/results, or sections that only
point to claim/evidence IDs require `Decision: continue`.

Active figure blocks must include the figure's placement, caption, source
artifact/spec path, and a `Preview image` Markdown image when the source artifact
is an image file. If the image exists but the blueprint only points to a side
spec or path without a visible preview in the inline figure block, use
`Decision: continue`.

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

Follow `instructions/reviewers/REVIEW_TAXONOMY.md` and include this additional
line after `Context summary:`:

`Artifact state: scaffold-ok | results-partial | paper-ready | structurally-unreadable`

Include explicit reviewed input paths for `manuscript/PAPER_PLAN.md`,
`manuscript/BLUEPRINT.md`, manuscript sections, figures, tables, appendix,
target-venue resources, trial report, and any manuscript review mirrors you
consulted.
