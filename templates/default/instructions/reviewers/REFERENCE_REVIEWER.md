# Reference Reviewer

## Purpose

Review source provenance, citation accuracy, coverage, recency where relevant, and bidirectional integrity between inline citations and the reference list.

## Phase and output

- Phase: `post_stage` or `final`.
- Reviewer key/scope: `reference` / `reference`.
- Bind to the exact stage ID/hash.

## Required reading

- `instructions/reviewers/REVIEW_TAXONOMY.md`;
- Resource Manifest, Resource Scout report, seed-paper/venue resources;
- all new or changed external-source claims, quotations, citations, and reference entries;
- current Plan, Report, cards, Merge Request, candidate snapshot, Human Brief;
- manuscript/reference list and relevant line/campaign updates;
- primary sources themselves when available.

## Review criteria

### Source existence and provenance

- Does every source have citation-ready metadata: stable title, author or
  responsible organization, date/version, locator, and access/provenance
  details where applicable?
- Does every cited source exist and match author/title/date/venue/identifier?
- Are URLs, DOIs, arXiv IDs, report versions, dataset/model versions, and access dates accurate where applicable?
- Was the source actually inspected, or only mentioned by another source?
- Are uploaded, discovered, and externally linked resources distinguished?

### Citation-to-claim accuracy

- Does each source support the exact nearby claim?
- Are quotations exact, short, and correctly attributed?
- Are secondary citations used only when primary material is unavailable and disclosed?
- Are limitations, disagreement, and study context represented fairly?
- Are broad field/novelty claims supported by adequate coverage rather than one convenient paper?

### Coverage and balance

- Are major relevant competing approaches, negative evidence, and foundational work covered?
- Is the literature set appropriate to the project scope, contribution type, and venue?
- Is recency handled when the question is date-sensitive?
- Are seed papers representative rather than cherry-picked?

### Reference-list integrity

- Every inline citation has one reference entry.
- Every reference entry is cited or intentionally listed in a documented resource appendix.
- No duplicates, unresolved placeholders, missing required metadata, or inconsistent keys remain.
- Citation keys remain stable across manuscript and artifacts.

### Research-memory integrity

- Literature-derived result cards distinguish empirical source evidence from project-generated evidence.
- External URLs are not treated as durable local artifacts without provenance.
- Copyright-sensitive source material is summarized rather than copied excessively.

### Submission-grade list contract

Each canonical reference entry includes authors, title, venue/container, year,
and a stable locator (prefer DOI, then a resolvable URL or unambiguous publisher
identifier). Every inline citation resolves to exactly one entry, every listed
entry is cited or intentionally documented in a resource appendix, and duplicate,
placeholder, fabricated, dead, or orphan records require revision.

## Pass Standard

`pass` requires accurate, inspectable, balanced, and complete references for the reviewed scope. Missing source inspection, unsupported citation, orphan entry, fabricated metadata, or unresolved locator requires `revise`.
