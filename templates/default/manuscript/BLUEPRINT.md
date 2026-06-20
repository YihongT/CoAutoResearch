# Manuscript Blueprint

This file is the self-contained, target-venue-aware architecture for the active
manuscript or deliverable. It must be useful to a human author without reading
hidden trial logs.

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

Expected figure/table style:

---

## Target-Venue Organization Rationale

Explain why the section order, claim strength, figure/table density, citation
posture, and appendix/supplement plan fit the declared target venue.

---

## Core Story

State the manuscript's central argument in self-contained prose. Do not leave
stale statements such as "tentative until source-level evidence checks are
completed" after the evidence gate has passed.

---

## Accepted Claims And Evidence Map

Use this section only when claims are accepted for the current manuscript. If
claims are not accepted yet, rename this section to `Candidate Claims And
Evidence Map` and keep the autoresearch gate on `continue`.

| Claim ID | Claim | Evidence IDs | Evidence strength | Required qualification | Manuscript location |
|---|---|---|---|---|---|
| C000000 | <accepted claim> | R000000 | <strong / qualified / limited> | <none or exact qualification already reflected in prose> | <section / figure / table> |

Evidence IDs must resolve to `research_trajectory/CURRENT_FINDINGS.md` and the
source trials or artifacts cited there.

---

## Section-By-Section Architecture

### Section 1: <title>

Purpose:

Target-venue role:

Content to include:

Accepted claims:

Evidence:

Figures / tables:

Required qualifications:

---

## Figure Plan

Every active figure must be self-contained here, even if detailed specs also
live in `manuscript/figures/FIGURE_SPECS.md`.

### Figure F000000: <title>

Inclusion status: <active / candidate / supplement / deprecated>

Argument or result role:

Content and panel layout:

Caption draft or current caption:

Source artifact path:

Linked claims:

Linked evidence:

Target-venue fit rationale:

Remaining blocker: <none, or exact blocker>

---

## Table Plan

Every active table must be self-contained here.

### Table T000000: <title>

Inclusion status: <active / candidate / supplement / deprecated>

Argument or result role:

Content, columns, rows, or comparison logic:

Caption draft or current caption:

Source artifact path:

Linked claims:

Linked evidence:

Target-venue fit rationale:

Remaining blocker: <none, or exact blocker>

### No-Table Rationale

If there are no active tables, explain why no table is needed for the target
venue and current argument, whether candidate tables were considered, and which
figures or prose sections carry the claim/evidence mapping instead.

---

## Reference / Literature Grounding Plan

Describe the reference posture required by the target venue. Name the current
seed papers, core literatures, source audits, and any remaining bibliography
work.

---

## Appendix / Supplement Plan

State whether appendix or supplement material is needed. If not needed, explain
why that is appropriate for the target venue and current deliverable.

---

## Blocking Missing Evidence

List only blockers that prevent final gate pass. If any item remains here, the
autoresearch gate must be `continue`.

- none

---

## Required Qualifications / Claim Constraints

List non-blocking qualifications that must already be reflected in manuscript
prose, figure/table captions, and accepted-claim wording.

---

## Deprecated Or Superseded Ideas

List ideas that should not be used unless revived by current state.

---

## Submission-Readiness Summary

State whether the blueprint is ready for the declared scope, what reviewer gates
passed, and what optional human preference or submission-packaging work remains.
