# Figure and Table Reviewer

## Purpose

Review active publication-facing figures and tables for evidentiary integrity, readability, provenance, accessibility, and consistency with the manuscript and canonical research state.

## Phase and output

- Phase: `post_stage` or `final`.
- Reviewer key/scope: `figure_table` / `figure_table`.
- Bind to the exact stage ID/hash.

## Required reading

- `instructions/reviewers/REVIEW_TAXONOMY.md`;
- active figure/table source files, generation code, data, captions, notes, and rendered outputs;
- Project, Findings, active line, venue profile, Blueprint/Paper Plan/manuscript;
- current Plan, Report, cards, Merge Request, candidate snapshot, Human Brief;
- Evidence and Venue Fit reviews when available.

## Review criteria

### Evidentiary integrity

- Does every visual derive from the cited reviewed data/artifact?
- Are aggregations, filtering, exclusions, normalization, uncertainty, and sample sizes disclosed?
- Are axes, scales, baselines, denominators, labels, and units accurate?
- Are visual choices misleading, truncated, cherry-picked, or inconsistent across conditions?
- Are negative/limiting results omitted from a visual that implies broader success?

### Reproducibility and provenance

- Is source data/code/path/hash recorded?
- Can the visual be regenerated deterministically or with documented variability?
- Are manual edits, annotations, or external assets disclosed?
- Do table values reconcile with machine artifacts and manuscript text?

### Communication

- Does each visual have one clear purpose and takeaway?
- Is caption self-contained, scoped, and claim-calibrated?
- Are legends, labels, typography, resolution, color contrast, and ordering readable at expected publication size?
- Is color not the only channel for meaning?
- Are accessible text alternatives or descriptions planned where appropriate?

### Venue and manuscript role

- Does the visual satisfy an actual argument/evidence need?
- Is it redundant, decorative, or better placed in appendix/supplement?
- Does it follow target-venue norms without imitating a seed paper?
- Are figure/table references and numbering consistent?

### Publication-ready display contract

Every active table must appear at its intended manuscript location as a
**publication-ready Markdown** table with final intended rows and columns,
readable labels, caption, notes/definitions/abbreviations where needed, source
traceability, key result, and venue-fit rationale. Reject active tables that are
only column/row/comparison specs, source links, or back-matter promises. Every
active figure needs its placement, inclusion state, purpose/result role, panel
layout, caption, source path, provenance, venue rationale, and a Markdown preview
when a rendered image exists.

## Pass Standard

`pass` requires accurate, traceable, readable, non-misleading visuals that support the exact claims attributed to them. Missing active visuals, placeholder data, or unreviewed manual transformations require `revise`.
