# Venue Fit Reviewer

## Purpose

Review whether the current research direction, manuscript blueprint, evidence standard, writing structure, and figure/table style fit the target venue defined in:

```text
PROJECT.md
```

This reviewer should judge venue fit by comparing the project against representative papers from the target venue, not only by using generic intuition.

## Required Reading

Before reviewing, read:

```text
PROJECT.md
research_trajectory/STATE.md
research_trajectory/CURRENT_FINDINGS.md
manuscript/BLUEPRINT.md
resources/target_venue/SEED_PAPERS.md
resources/target_venue/STYLE_NOTES.md
resources/target_venue/FIGURE_TABLE_NOTES.md
```

Also inspect manuscript-facing materials when available:

```text
manuscript/sections/
manuscript/figures/FIGURE_SPECS.md
manuscript/tables/
manuscript/appendix/
```

## Seed Paper Requirement

The venue fit review must be grounded in representative papers from the target venue.

First, check:

```text
resources/target_venue/SEED_PAPERS.md
resources/target_venue/papers/
```

If suitable seed papers already exist, use them as comparison references.

If no suitable seed papers exist, the reviewer should require a trial to collect them before making a strong venue-fit judgment.

A suitable seed set should usually include 3-5 recent and relevant papers from the target venue or closely related venues.

The seed papers are used to compare:

* manuscript structure;
* abstract and introduction style;
* contribution framing;
* evidence standard;
* experiment / analysis organization;
* figure and table density;
* figure/table visual style;
* appendix or supplementary material expectations;
* level of claim strength;
* limitation and discussion style.

Do not copy the content, claims, or ideas of seed papers. Use them only as venue-style and evidence-standard references.

## Review Questions

Evaluate:

1. Does the current project match the target venue's expected contribution type?
2. Is the research question framed at the right level of importance for the venue?
3. Does the manuscript blueprint resemble strong papers from the target venue in structure and pacing?
4. Are the claims too weak, too broad, or mismatched for the venue?
5. Is the evidence standard comparable to recent representative papers?
6. Are the planned figures and tables aligned with the visual and explanatory style of the venue?
7. Does the project need more experiments, stronger analysis, clearer mechanism, better framing, or a different target venue?
8. What specific gaps remain relative to the seed papers?

## Output Location

If the review is part of a trial, write it into:

```text
research_trajectory/trials/<trial_id>/REVIEW.md
```

If the review is manuscript-facing, write it into:

```text
manuscript/reviews/
```

## Output Format

Use the following structure:

```markdown
# Venue Fit Review

## Target Venue

## Seed Papers Consulted

List seed papers and local paths or links.

## Overall Judgment

strong fit / plausible fit / weak fit / wrong venue / cannot judge until seed papers are collected

## Comparison Against Seed Papers

### Structure

### Contribution Framing

### Evidence Standard

### Figures and Tables

### Writing Style

### Appendix / Supplementary Expectations

## Major Gaps

## Required Actions

## Suggested Target Venue Adjustment, if any
```
