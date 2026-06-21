# Manuscript Blueprint

This file is the self-contained, target-venue-aware architecture for the active
manuscript or deliverable. It must be useful to a human author without reading
hidden trial logs or jumping through separate claim/evidence/display indexes.

Read before editing:

- `PROJECT.md`
- `research_trajectory/STATE.md`
- `research_trajectory/CURRENT_FINDINGS.md`
- `resources/target_venue/SEED_PAPERS.md`
- `resources/target_venue/STYLE_NOTES.md`
- `resources/target_venue/FIGURE_TABLE_NOTES.md`

---

## Target Venue / Audience / Article Type

Target venue:

Audience:

Article type:

Contribution posture:

Evidence standard:

Expected display / method / result style:

---

## Target-Venue Organization Rationale

Explain why the section order, section depth, display density, citation posture,
method/result placement, and appendix/supplement plan fit the declared target
venue and article type.

---

## Core Story

State the manuscript's central argument in self-contained prose. Do not leave
stale statements such as "tentative until source-level evidence checks are
completed" after the evidence gate has passed.

---

## Architecture Overview / Table of Contents

List the complete planned structure in manuscript order. Include every section,
subsection, subsubsection, and deeper titled unit that the manuscript currently
expects to use.

- [Section 1: <target-venue section title>](#section-1-target-venue-section-title)
  - [Subsection 1.1: <subsection title>](#subsection-11-subsection-title)
  - [Figure F000000: <figure title>](#figure-f000000-figure-title)
- [Section 2: <target-venue section title>](#section-2-target-venue-section-title)

---

## Manuscript Architecture

Use the target venue's final reading order. Do not organize this section by
claim IDs, evidence IDs, figure IDs, or table IDs. IDs may appear only as local
provenance.

For each titled unit, `Section brief` should be 2-4 sentences of finished-results
paper-map prose: what this unit argues, what evidence/results/displays it uses,
and why it appears here. Do not write expected-work or future-plan language.
For each display/method/result block, `Reader takeaway` should state what a
reader should understand from the object at this manuscript location.

### Section 1: <target-venue section title>

Target-venue role:

Section brief:

Reader question answered:

Local thesis / purpose:

Local claims in plain language:

Local evidence, results, or artifacts:

Placed displays / methods / results:

Local qualifications:

Transition job:

Paragraph plan:

| Para | Rhetorical move | Content to cover, not full prose | Local evidence / result / artifact | Display / method / result block | Citation posture | Required qualification | Transition job |
|---|---|---|---|---|---|---|---|
| P1 | <move> | <specific content obligation> | <finding IDs plus plain-language support and artifact paths> | <figure/table/algorithm/result block or none> | <citation role> | <qualification or none> | <how this sets up the next paragraph/section> |

#### Subsection 1.1: <subsection title>

Target-venue role:

Section brief:

Reader question answered:

Local thesis / purpose:

Local claims in plain language:

Local evidence, results, or artifacts:

Placed displays / methods / results:

Local qualifications:

Transition job:

Paragraph plan:

| Para | Rhetorical move | Content to cover, not full prose | Local evidence / result / artifact | Display / method / result block | Citation posture | Required qualification | Transition job |
|---|---|---|---|---|---|---|---|
| P1 | <move> | <specific content obligation> | <finding IDs plus plain-language support and artifact paths> | <figure/table/algorithm/result block or none> | <citation role> | <qualification or none> | <how this sets up the next paragraph/section> |

##### Figure F000000: <title>

Placement:

Inclusion status: <active / candidate / supplement / deprecated>

Purpose or result role:

Reader takeaway:

Content and panel layout:

Visual style:

Caption draft or current caption:

Source artifact or spec path:

Result shown or conceptual basis:

Provenance links:

Target-venue fit rationale:

Remaining blocker: <none, or exact blocker>

##### Table T000000: <title>

Placement:

Inclusion status: <active / candidate / supplement / deprecated>

Purpose or result role:

Reader takeaway:

Table number/title:

Publication-ready table:

| Column 1 | Column 2 | Column 3 |
|---|---|---|
| <final row value> | <final row value> | <final row value> |

Caption draft or current caption:

Table notes / definitions / abbreviations: <none, or notes>

Source artifact or spec path:

Key result or conceptual contrast shown:

Provenance links:

Target-venue fit rationale:

Remaining blocker: <none, or exact blocker>

##### Algorithm A000000: <name>

Placement:

Purpose:

Reader takeaway:

Inputs:

Outputs:

Pseudocode / interface sketch:

Assumptions and failure modes:

Validation evidence:

Source code or artifact links:

Remaining blocker: <none, or exact blocker>

##### Result RSLT000000: <name>

Placement:

Metric or result summary:

Reader takeaway:

Source artifact path:

Comparison or baseline logic:

Limitations and uncertainty:

Manuscript claim supported in plain language:

Remaining blocker: <none, or exact blocker>

---

## Reference / Literature Grounding Plan

Describe the reference posture required by the target venue. Name the current
seed papers, core literatures, source audits, and any remaining bibliography
work.

---

## Appendix / Supplement Plan

State whether appendix or supplement material is needed. If not needed, explain
why that is appropriate for the target venue and current deliverable. If no
active tables are used, explain here or in the relevant architecture section
where the necessary comparison/evidence mapping is carried instead.

---

## Blocking Missing Evidence

List only blockers that prevent final gate pass. If any item remains here, the
autoresearch gate must be `continue`.

- none

---

## Required Qualifications / Claim Constraints

List non-blocking qualifications that must already be reflected locally in the
manuscript architecture, captions, table entries, algorithm/result descriptions,
and claim wording.

---

## Provenance / Audit Index

Use this section only for secondary audit. Do not make it necessary for reading
the manuscript architecture.

### Claim / Evidence Index

If useful, list accepted or candidate claim/evidence IDs here after the same
claims have already been explained locally in the relevant manuscript sections.

### Display / Method / Result Inventory

If useful, list active, candidate, deferred, or superseded display/method/result
objects here after active objects have already been placed inline.

### Source Links

List project-relative source paths, trial reports, reviews, and artifact files
that support the blueprint.

---

## Deprecated Or Superseded Ideas

List ideas that should not be used unless revived by current state.

---

## Submission-Readiness Summary

State whether the blueprint is ready for the declared scope, what reviewer gates
passed, and what optional human preference or submission-packaging work remains.
