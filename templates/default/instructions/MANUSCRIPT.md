# Manuscript Instructions

## Purpose

The manuscript directory maintains a target-aware manuscript blueprint and
candidate deliverable materials.

The canonical manuscript-facing file is:

`manuscript/BLUEPRINT.md`

The blueprint is not final paper prose. It is a self-contained, publication-like
architecture for the final manuscript or deliverable. A human author should be
able to read it from top to bottom and understand the intended paper structure,
where every result/display/method object belongs, what each paragraph must do,
and which source artifacts support each local claim without bouncing through
separate claim, evidence, figure, or table indexes.

It should read like a finished-results paper map: not a speculative proposal,
not camera-ready prose, and not a checklist. Each section should make clear
what the final paper will say, what result or evidence supports it, what
figure/table/method/result object is shown there, and why the section appears
at that point in the target-venue reading order.

Do not promote planned work into a reader-facing result. A heading named
`Result`, `Dataset`, `Benchmark`, `Metric`, or `RSLT...` creates an artifact
block, not a manuscript section. It must use the dataset/benchmark/result block
schema below. Do not put section-planning fields such as `Section brief`, `Local
thesis / purpose`, `Local claims in plain language`, `Placed displays / methods
/ results`, or `Transition job` inside a result block. If the result is not yet
available, keep it as a section writing obligation or list it under `Blocking
Missing Evidence`; do not create an inline result block for planned or pending
work. Do not promote planned work into a reader-facing result.

`Inclusion status: candidate` means the result exists as an observed or computed
artifact with a result summary and source artifact path, but inclusion is not
final. A deferred or missing result is missing evidence and belongs in
`Blocking Missing Evidence`, not in `Manuscript Architecture`.

For a final or gate-passing manuscript-facing deliverable, the blueprint must be
target-venue-ready and readable as a paper map. Cross-references may support
audit and provenance, but they must not replace local explanation.

---

## Required Reading Before Manuscript Updates

Read:

1. `PROJECT.md`
2. `research_trajectory/STATE.md`
3. `research_trajectory/CURRENT_FINDINGS.md`
4. `resources/target_venue/SEED_PAPERS.md`
5. `resources/target_venue/STYLE_NOTES.md`
6. `resources/target_venue/FIGURE_TABLE_NOTES.md`

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

Do not impose a generic AI-paper structure unless that matches the target.
Section titles and order must come from, in priority order:

1. explicit user-provided target manual or venue rules;
2. `resources/target_venue/STYLE_NOTES.md` and
   `resources/target_venue/FIGURE_TABLE_NOTES.md`;
3. target-venue seed papers as style and structure references;
4. the current project scope in `PROJECT.md`.

If the target manual or venue structure is insufficiently known, state that
limitation explicitly in the blueprint instead of inventing venue-specific
requirements.

Seed papers are style and structure references. Do not copy their research
content.

The blueprint must explain the target-venue organization rationale: why the
section order, section depth, display density, evidence posture, reference
style, and appendix/supplement plan fit the declared venue and article type.

---

## Source of Evidence

Use `research_trajectory/CURRENT_FINDINGS.md` as the current accepted/tentative
evidence summary.

Use trial reports and artifacts for provenance.

Do not rely on hidden or unreviewed workspace outputs as manuscript evidence.

---

## What Belongs in `manuscript/`

Allowed:

- manuscript story and architecture;
- section/subsection/subsubsection plans;
- paragraph or rhetorical-move writing obligations;
- inline figure, publication-ready table, algorithm, dataset, benchmark, and
  result blocks;
- captions, labels, panel descriptions, publication-ready table bodies, table
  notes, and method interface sketches;
- manuscript reviews;
- appendix/supplementary plan;
- provenance or audit indexes.

Not allowed by default:

- raw exploratory outputs;
- unreviewed workspace files;
- trial logs as primary manuscript content;
- full paper prose unless explicitly requested.

Captions, figure labels, table titles, publication-ready table entries,
algorithm names, compact display entries, `Section brief`, and `Reader
takeaway` may be written as final deliverable-facing text. Section briefs must
stay compact, usually 2-4 sentences. Paragraph entries must remain writing
plans: they should say what each paragraph must accomplish, which results and
evidence it uses, and how it transitions, without drafting the full paper.

---

## Canonical Blueprint Contract

`manuscript/BLUEPRINT.md` must use the manuscript's final reading order as its
primary organization.

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

The `Architecture Overview / Table of Contents` must list the complete planned
structure, including section, subsection, subsubsection, and deeper titled units
when used. Each entry should link to the corresponding manuscript-architecture
anchor when practical.

The `Manuscript Architecture` section is the canonical content. It must be
organized in target-venue manuscript order, not by claim IDs or display IDs.
Figures, tables, algorithms, datasets, benchmarks, result summaries, captions,
and source links must appear where the final manuscript would use them.

Claim/evidence IDs, figure/table IDs, and source IDs may appear as local
provenance anchors, but the blueprint must not require the reader to jump to a
separate map to understand the section, paragraph, result, figure, table, or
method.

Separate files such as `manuscript/figures/FIGURE_SPECS.md` may remain as
source/spec caches, but they are secondary. They are not the canonical placement
or readability surface.

---

## Manuscript Architecture Requirements

Every titled unit in `Manuscript Architecture` must state:

- target-venue title;
- target-venue role;
- section brief: 2-4 sentences of finished-results paper map prose explaining
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

Paragraphs do not require titles, but each paragraph or move must specify:

- paragraph or move ID;
- rhetorical move;
- content to cover, not full prose;
- local claim/evidence/result to use;
- artifact paths or source links when applicable;
- figure/table/algorithm/result blocks used, or `none`;
- citation posture;
- required qualification, or `none`;
- transition job.

Use deeper headings when the target venue or manuscript logic requires them. A
methodology paper should include method subsections, algorithm blocks, and
evaluation/result placement where they belong. An empirical paper should place
datasets, metrics, benchmark results, figures, and tables in Results/Methods
order. A Perspective or review should place conceptual figures, contrast
tables, cases, and agenda items in the rhetorical section where they support the
argument.

---

## Inline Artifact Blocks

Active artifacts must be placed inline inside the relevant manuscript section,
subsection, or paragraph area.

### Figure blocks

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
  file, or `none` when the source is a PDF/spec/non-image artifact;
- result shown or conceptual basis;
- provenance links to findings, trials, or source files;
- target-venue fit rationale;
- remaining blocker, or `none`.

### Table blocks

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
- target-venue fit rationale;
- remaining blocker, or `none`.

For active manuscript tables, a spec is not enough. Column lists, row
descriptions, comparison logic, source links, or `FIGURE_SPECS.md` entries do
not substitute for the actual table body a reader would inspect in the
manuscript. Use the label `Publication-ready table:` immediately before the
Markdown table.

The only exceptions are:

- no active tables, with an explicit no-table rationale;
- supplemental or appendix-only tables, which still require a publication-ready
  table body in the appendix/supplement plan;
- generated numeric tables too large for the main blueprint, which must include
  a publication-ready excerpt, direct source file link, exact manuscript or
  supplement placement, and remaining blocker value.

If there are no active tables, say so in the relevant manuscript architecture
location or in the appendix/supplement plan, and explain where the needed
comparison or evidence mapping is carried instead.

### Algorithm / method blocks

Every active algorithm or method block must include:

- placement;
- method or algorithm name;
- purpose;
- reader takeaway;
- inputs and outputs;
- pseudocode, interface sketch, or step sequence;
- assumptions and failure modes;
- validation evidence or planned evaluation;
- source code or artifact links;
- remaining blocker, or `none`.

### Dataset / benchmark / result blocks

Every active dataset, benchmark, or result block must include:

- placement;
- inclusion status;
- metric or result summary;
- reader takeaway;
- source artifact path;
- comparison or baseline logic when applicable;
- limitations and uncertainty;
- manuscript claim supported in plain language;
- remaining blocker, or `none`.

Active result blocks must be readable by a human without opening trial logs. The
`Metric or result summary` and `Reader takeaway` fields must state the actual
result in plain language. Phrases such as `planned only`, `pending trial`,
`pending source-role check`, `TBD`, `to be filled`, or `Figure planned` are not
valid active result content. If those phrases are still true, the block is not
ready for inline result placement and must be listed under `Blocking Missing
Evidence` with the exact remaining blocker.

Candidate result blocks must meet the same readability standard: an observed or
computed result summary, reader takeaway, and source artifact path. A planned or
pending result is not a candidate result.

---

## References

`manuscript/BLUEPRINT.md` must contain a canonical `## References` section that
holds the actual resolved reference list, not only a strategy description. The
`Reference / Literature Grounding Plan` section states the reference *posture*;
the `References` section is the *artifact* a reader would cite from. The two must
be mutually consistent.

The reference list is governed by two layers.

**Layer 1 — fixed integrity contract (always required, venue-independent):**

- Every entry carries, at minimum: author(s), title, venue or container, year,
  and a stable locator (DOI preferred; otherwise a resolvable URL; otherwise an
  unambiguous publisher/standard identifier).
- One canonical entry per source, with a stable citation key. No duplicate
  entries for the same work.
- Bidirectional completeness: every inline citation resolves to exactly one
  list entry, and every list entry is cited at least once in the manuscript
  architecture. Orphan citations and uncited entries are blocking.
- Locators must be resolvable. Placeholder, fabricated, or dead locators are
  blocking.

**Layer 2 — venue-bound presentation (read from `Target Venue / Audience /
Article Type`):**

- The citation and ordering style follows the declared target venue (for
  example, a numbered Nature-style list for a Nature-family venue).
- If the target venue does not fix a style, use one consistent style across all
  entries — either numbered or author–year — and state which style is used.

The full bibliographic source data (for example a `.bib` file) may continue to
live under `workspace/`, but it is a secondary cache. The canonical
reader-facing list is the `References` section in the blueprint.

---

## Provenance And Audit

Use `Provenance / Audit Index` for secondary traceability only. It may contain:

- accepted or candidate claim/evidence maps;
- source-to-section indexes;
- display inventory;
- deferred figure/table/algorithm candidates;
- superseded claim IDs or evidence IDs;
- links to trials, reports, reviews, source files, and generated artifacts.

This index must not be required to understand the main blueprint. If moving an
old claim/evidence map into provenance leaves the main architecture unclear,
rewrite the local manuscript section instead of relying on the index.

---

## Missing Evidence And Qualifications

Do not mix blockers with rhetorical caveats.

- `Blocking Missing Evidence` contains only evidence gaps that prevent final
  gate pass. Any non-empty item other than `none` requires `Status: continue`.
- `Required Qualifications / Claim Constraints` contains non-blocking limits
  that must already be reflected locally in the manuscript architecture,
  captions, table entries, algorithm/result descriptions, and claim wording.

---

## Manuscript Reviews

Reviews of manuscript-facing deliverables belong in:

`manuscript/reviews/`

Trial-level manuscript review gates belong in the relevant trial's canonical
review file:

`research_trajectory/trials/<trial_id>/reviews/MANUSCRIPT_REVIEW.md`
