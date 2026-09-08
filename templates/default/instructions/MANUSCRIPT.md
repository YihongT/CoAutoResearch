# Manuscript Instructions

> **V2 control-plane override.** Manuscript-facing updates during autoresearch are written only into the staged candidate snapshot. The service publishes them after required manuscript/figure/reference/venue reviews. Only published accepted or qualified result cards may support active result claims. Planned results stay in `PAPER_PLAN.md`; they must not appear as completed results in `BLUEPRINT.md`.


## Purpose

The manuscript directory uses a two-artifact model:

- `manuscript/PAPER_PLAN.md` is the always-current venue-format plan. It may
  contain planned sections, evidence obligations, planned figures/tables,
  unresolved blockers, and Critical Path links.
- `manuscript/BLUEPRINT.md` is the cumulative, evidence-backed manuscript
  blueprint, including readable research prose and its structured writing plan.
  It becomes progressively more complete as reviewed results are
  published. It need not be submission-ready during research, but every unit
  it does contain must be real, source-backed, readable in manuscript order,
  and complete for its stated scope.

`BLUEPRINT.md` must contain only real, source-backed manuscript content: real
results, real numbers when relevant, real figure/table/appendix/reference
material, source artifact paths, and reader-facing local explanations. Outside
the explicit `Status: pre-results stub` state, an empty or slot-filled blueprint
is a system failure state. Fix it by producing results through conversion,
acquisition, substitution, analysis, or escalation; do not accumulate planned
slots in `BLUEPRINT.md`.

Before results are available, `BLUEPRINT.md` may be a clearly marked pre-results
stub pointing to `PAPER_PLAN.md` and `research_trajectory/STATE.md` `## Critical
Path`. Once an accepted or qualified research result exists, the stub is no
longer valid: the next staged candidate must promote the cumulative supported
story into `BLUEPRINT.md`. Planned or pending language is legal only in
`PAPER_PLAN.md`.

## Mandatory Result Promotion

When the current Merge Request asks to `accept`,
`accept_with_qualification`, or `supersede` a result card that has a claim ID,
or whose type is positive evidence, negative evidence, diagnostic insight,
boundary condition, claim revision, or method decision:

- stage both `manuscript/BLUEPRINT.md` and `manuscript/PAPER_PLAN.md`;
- integrate the supported result, negative result, boundary, or claim revision
  into the cumulative reader-facing story;
- include every current manuscript-relevant card ID in `Provenance / Audit
  Index`;
- keep all incomplete evidence and future work in `PAPER_PLAN.md`.

If the canonical Blueprint is still a pre-results stub while Current Findings
already names accepted or qualified cards, the staged candidate must perform a
one-time catch-up and list every such published card ID in the provenance
section. This catch-up does not make the manuscript submission-ready; Final
Gate retains the complete venue, evidence, display, reference, and packaging
requirements below.

---

## Required Reading Before Manuscript Updates

Read:

1. `PROJECT.md`
2. `research_trajectory/STATE.md`
3. `research_trajectory/CURRENT_FINDINGS.md`
4. `manuscript/PAPER_PLAN.md`
5. `resources/target_venue/SEED_PAPERS.md`
6. `resources/target_venue/STYLE_NOTES.md`
7. `resources/target_venue/FIGURE_TABLE_NOTES.md`

---

## Target Venue Rule

The manuscript blueprint must reflect:

- target venue;
- target audience;
- research type or article type;
- expected contribution style;
- required evidence standard;
- expected figure/table/algorithm/result style;
- expected appendix/supplementary material.

Do not impose a generic paper structure unless it matches the target. Section
titles and order must come from explicit venue rules, target-venue notes, seed
papers as style references, and `PROJECT.md`, in that order.

Before staging `PAPER_PLAN.md` or `BLUEPRINT.md`, consume the active venue
projection from `TARGET_VENUE.json` and its matching `VENUE_PROFILE.json`.
Apply every projected organization and figure/table requirement, or record the
specific mismatch as a venue/manuscript gap. Passing venue review later is not
a substitute for this architecture input.

---

## Source of Evidence

Use `research_trajectory/CURRENT_FINDINGS.md` for accepted, tentative, and
rejected findings. Use trial reports and artifacts for provenance. Do not rely
on hidden or unreviewed workspace outputs as manuscript evidence.

---

## What Belongs In `manuscript/`

Allowed:

- `PAPER_PLAN.md` planning obligations and blockers;
- `BLUEPRINT.md` real source-backed manuscript architecture and content;
- inline figure, table, algorithm, method, dataset, benchmark, and result blocks;
- captions, labels, panel descriptions, publication-ready table bodies, table
  notes, method interface sketches, appendix/supplement plans, and provenance
  indexes;
- manuscript reviews.

`manuscript/` must not contain exploratory raw outputs, unreviewed workspace
files as evidence, trial logs, control/status/dependency/blocker registers,
or citation queues. Write readable prose for supported sections as results
accumulate; do not pad the draft to imitate a completed paper.

---

## Canonical Blueprint Contract

`manuscript/BLUEPRINT.md` must use the manuscript's final reading order as its
primary organization and contain only real, source-backed content.

Required top-level sections:

- `Target Venue / Audience / Article Type`
- `Target-Venue Organization Rationale`
- `Core Story`
- `Architecture Overview / Table of Contents`
- `Manuscript Architecture`
- `Reference / Literature Grounding Plan`
- `References`
- `Appendix / Supplement Plan`
- `Blocking Missing Evidence`
- `Required Qualifications / Claim Constraints`
- `Provenance / Audit Index`
- `Deprecated Or Superseded Ideas`
- `Submission-Readiness Summary`

`Blocking Missing Evidence` in `BLUEPRINT.md` must read exactly `- none`.
Blocking evidence gaps live in `PAPER_PLAN.md` and `STATE.md` Critical Path.

The blueprint must not contain trial logs, control/status/dependency/blocker
registers, citation queues, planned result slots, or unresolved blocker fields.
Trial paths are allowed only inside `Provenance / Audit Index`, one concise line
per source. Separate files such as `manuscript/figures/FIGURE_SPECS.md` may
support audit but are not the canonical manuscript-reading path.

---

## Manuscript Architecture Requirements

Every promoted titled unit in `Manuscript Architecture` must state:

- target-venue title;
- target-venue role;
- `Draft prose:` followed by the actual research text for this unit, in
  complete connected paragraphs. State the supported result and its limits,
  cite the relevant references, and refer to the inline figures/tables where
  the reader needs them. This is reader-facing draft text, not instructions
  about what a future writer should write. Put subsequent structured fields
  on their own lines so the prose remains separate from the writing plan;
- section brief: 2-4 sentences of finished-results paper-map prose explaining
  what this unit argues, what evidence/results/displays it uses, and why it
  appears here;
- reader question answered;
- local thesis or purpose;
- local claims in plain language;
- local evidence, results, or artifacts in plain language;
- planned paragraphs or rhetorical moves;
- figures/tables/algorithms/results placed here, or `none`;
- local qualifications and limits;
- transition job.

Paragraph or move rows must specify paragraph or move ID, rhetorical move,
content to cover, local claim/evidence/result, artifact paths or source links,
display/method/result block, citation posture, required qualification, and
transition job.

---

## Inline Artifact Blocks

Write each labeled figure, table, method, or result field on its own line.
Keep captions, notes, source paths, and inclusion status separate; do not join
several fields into one paragraph. This preserves their display and review boundaries.

Active artifacts must be placed inline where the final manuscript would use
them. Valid inline inclusion statuses are `active`, `candidate`, and
`supplement`. A `candidate` result is still a real observed or computed result
with a result summary, reader takeaway, and source artifact path. Deprecated or
superseded objects may appear only in `Provenance / Audit Index`.

### Figure Blocks

Every active figure block must include:

- placement;
- inclusion status;
- purpose or result role;
- reader takeaway;
- content and panel layout;
- visual style;
- exact caption draft or current caption;
- source artifact path or source specification path;
- preview image as Markdown image syntax when the source artifact is an image
  file, or `none` when the source is not an image artifact;
- result shown or conceptual basis;
- provenance links to findings, trials, or source files;
- target-venue fit rationale.

### Table Blocks

Every active table block must include:

- placement;
- table number/title;
- inclusion status;
- purpose or result role;
- reader takeaway;
- publication-ready Markdown table body in final row/column form;
- exact caption draft or current caption;
- table notes, definitions, or abbreviations when needed, or `none`;
- source artifact path or source specification path;
- key result or conceptual contrast shown;
- provenance links to findings, trials, or source files;
- target-venue fit rationale.

For active manuscript tables, a spec is not enough. Column lists, row
descriptions, comparison logic, source links, or `FIGURE_SPECS.md` entries do
not substitute for the actual table body a reader would inspect in the
manuscript. Use the label `Publication-ready table:` immediately before the
Markdown table.

### Algorithm / Method Blocks

Every active algorithm or method block must include:

- placement;
- method or algorithm name;
- purpose;
- reader takeaway;
- inputs and outputs;
- pseudocode, interface sketch, or step sequence;
- assumptions and failure modes;
- validation evidence;
- source code or artifact links.

### Dataset / Benchmark / Result Blocks

Every active dataset, benchmark, or result block must include:

- placement;
- inclusion status;
- metric or result summary;
- reader takeaway;
- source artifact path;
- comparison or baseline logic when applicable;
- limitations and uncertainty;
- manuscript claim supported in plain language.

Active result blocks must be readable without opening trial logs. The `Metric or
result summary` and `Reader takeaway` fields must state the actual result in
plain language. Phrases such as `planned only`, `pending trial`, `pending
source-role check`, `TBD`, `to be filled`, or `Figure planned` are not valid
active or candidate result content. If those phrases are still true, the block
belongs in `PAPER_PLAN.md`.

Artifact headings named `Result`, `Dataset`, `Benchmark`, `Metric`, or
`RSLT...` are artifact blocks, not manuscript sections. They must not use
section-planning fields such as `Section brief`, `Local thesis / purpose`,
`Local claims in plain language`, or `Transition job`.

---

## References

`BLUEPRINT.md` must contain a canonical `## References` section with the actual
resolved reference list, not only a strategy. Each entry must include author(s),
title, venue/container, year, and a stable locator when available. Every inline
citation must resolve to one list entry, and every list entry must be cited in
the manuscript architecture.

---

## Provenance And Audit

Use `Provenance / Audit Index` for secondary traceability only. It may contain
accepted or candidate claim/evidence maps, source-to-section indexes, display
inventory, superseded or plan-only object IDs, and concise links to trials,
reports, reviews, source files, and generated artifacts.

This index must not be required to understand the main blueprint.

---

## Missing Evidence And Qualifications

Do not mix blockers with rhetorical caveats.

- `PAPER_PLAN.md` contains missing evidence and blockers.
- `BLUEPRINT.md` `Blocking Missing Evidence` must be `- none`.
- `Required Qualifications / Claim Constraints` contains non-blocking limits
  already reflected locally in the manuscript architecture, captions, table
  entries, algorithm/result descriptions, and claim wording.

---

## Manuscript Reviews

Reviews of manuscript-facing deliverables belong in:

`manuscript/reviews/`

Trial-level manuscript review gates belong in:

`research_trajectory/trials/<trial_id>/reviews/MANUSCRIPT_REVIEW.md`


## V2 Staged Snapshot Inputs

Manuscript reviewers inspect the staged `BLUEPRINT.md`, `PAPER_PLAN.md`, reference state, and active display artifacts. Final pass additionally requires a Final review manifest and a final staged Human Brief.
