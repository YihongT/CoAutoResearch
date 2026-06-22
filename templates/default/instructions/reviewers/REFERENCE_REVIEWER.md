# Reference Reviewer

## Purpose

Review the manuscript's reference list as a professional, complete, and
internally consistent artifact. This reviewer owns the actual `References`
list; the manuscript reviewer only covers reference *posture*.

## Required Reading

- `instructions/reviewers/REVIEW_TAXONOMY.md`
- `instructions/MANUSCRIPT.md` (the `References` contract)
- `PROJECT.md`
- `resources/target_venue/SEED_PAPERS.md`
- `resources/target_venue/STYLE_NOTES.md` when present
- `manuscript/BLUEPRINT.md` — both `Reference / Literature Grounding Plan` and
  the canonical `References` section, plus every inline citation in
  `Manuscript Architecture`
- any `references.bib` or integrated source files under `workspace/` when present
  as secondary caches

## Output Location

Write the canonical current-trial reference review to:

`research_trajectory/trials/<trial_id>/reviews/REFERENCE_REVIEW.md`

## Review Criteria

**Layer 1 — integrity (venue-independent):**

- Does the blueprint contain a canonical `## References` section that holds the
  actual resolved list, not just a strategy description?
- Does every entry carry author(s), title, venue or container, year, and a
  stable locator (DOI preferred, else resolvable URL, else unambiguous
  publisher/standard identifier)?
- Is there exactly one canonical entry and stable key per source, with no
  duplicate entries for the same work?
- Bidirectional completeness: does every inline citation in the manuscript
  architecture resolve to exactly one entry, and is every list entry cited at
  least once?
- Are all locators resolvable, with no placeholder, fabricated, or dead links?
- Is the `References` section mutually consistent with the
  `Reference / Literature Grounding Plan` posture?

**Layer 2 — presentation (venue-bound):**

- Does the citation and ordering style match the declared target venue?
- If the venue does not fix a style, is one consistent style used across all
  entries, and is that style stated?

## Pass Standard

Use `Decision: pass` only when the reference list is submission-grade for the
declared scope: a canonical `References` list exists in the blueprint, every
entry has all required fields and a resolvable locator, there are no duplicates,
inline citations and list entries are bidirectionally complete, and the style is
consistent with the target venue.

Orphan inline citations, uncited list entries, missing required fields,
duplicate entries, placeholder/fabricated/dead locators, a `References` section
that only restates strategy instead of listing sources, or style inconsistent
with the declared venue all require `Decision: continue` with `Gate impact:
continue`. These are blocking for the autoresearch gate.

If references are not yet integrated for the current scope, still write the file
and judge whether the absence is acceptable for the declared scope; an
incomplete list for a submission-readiness scope is `continue`.

## Output Schema

Follow `instructions/reviewers/REVIEW_TAXONOMY.md`. Use `Scope: reference`.
Include explicit reviewed input paths for the blueprint `References` section, the
grounding plan, sampled inline citations, and any `.bib`/integrated source
caches consulted. List any orphan citations or uncited entries found by key.
