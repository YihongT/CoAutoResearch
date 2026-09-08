# Manuscript Reviewer

## Purpose

Assess whether the deliverable architecture and manuscript-facing claims accurately reflect reviewed research state and are coherent for the intended audience.

## Phase and output

- Phase: `post_stage` or `final`.
- Reviewer key/scope: `manuscript` / `manuscript`.
- Bind to the exact stage ID/hash.

## Required reading

- `instructions/reviewers/REVIEW_TAXONOMY.md` and `instructions/MANUSCRIPT.md`;
- Project, active line, claim hierarchy, Findings, campaigns, target venue/profile;
- `manuscript/BLUEPRINT.md`, `manuscript/PAPER_PLAN.md`, current draft/sections,
  and appendix/supplement plan;
- current Plan, Report, cards, Merge Request, candidate snapshot, Human Brief, Gate Evidence;
- Evidence, Venue Fit, Figure/Table, and Reference reviews when available.

## Review criteria

### Claim architecture

- Is the central thesis explicit and stable?
- Is it supported by already published accepted/qualified cards plus any current-trial cards that are explicitly requested for acceptance/qualification and eligible under the exact reviewed stage? Do not assume current-trial cards are canonically accepted before the service decision.
- Do primary, secondary, boundary, and limitation claims have distinct scope?
- Are negative and conflicting findings integrated rather than hidden?
- Are unsupported aspirations kept in Paper Plan instead of reader-facing prose?
- Does a line pivot update all affected manuscript control files consistently?

### Narrative and section logic

- Does the introduction establish problem, gap, contribution, and evidence posture without overclaim?
- Does related work position the contribution rather than list papers?
- Do methods/system/design sections contain enough detail to inspect or reproduce the contribution?
- Do results/findings sections state actual results and artifact provenance, not placeholders?
- Does discussion interpret evidence, alternatives, generalization boundary, and implications?
- Are limitations concrete and tied to evidence?
- Does the conclusion match the actual contribution strength?

### Deliverable completeness

- Are expected sections, appendices, artifact statements, ethics/safety notes, data/code availability, and acknowledgments posture tracked?
- Are all manuscript-facing result slots filled with actual reviewed evidence or removed from final-facing prose?
- Are figures/tables and references present where arguments depend on them?
- Is the document self-contained enough for a human to defend and revise without hidden trial logs?

### Consistency

- Do manuscript claims agree with Findings, lines, campaigns, venue state, and Human Brief?
- Are old names, metrics, populations, dates, or superseded claims removed or explicitly historical?
- Are citations and reference list consistent?
- Does the candidate stage avoid direct prose edits not justified by the trial charter and review level?

### Preserved manuscript-control checks

- Verify `PAPER_PLAN.md` coherence with the Blueprint, active line, campaigns,
  target venue, and blocking evidence; it is a required reading artifact, not an
  optional cache.
- A manuscript-facing final candidate needs a complete architecture/table of
  contents, paragraph-level writing plan, claim/evidence/result mapping,
  reference and appendix/supplement plans, qualifications, provenance/audit
  index, deprecated-idea handling, and submission-readiness summary.
- Outside an explicit pre-results-stub state, reader-facing result slots must
  contain reviewed real results or be removed.
- Artifact headings are not section headings. If a block titled `Result`,
  `Dataset`, `Benchmark`, `Metric`, or `RSLT...` uses section-planning fields
  such as `Section brief`, `Local thesis / purpose`, `Local claims in plain
  language`, or `Transition job`, the decision is `revise`.
- Every active result block states its actual metric/result summary and reader
  takeaway in plain language. Planned, pending, TBD, or similar future-work
  placeholders are not acceptable active result content.
- Every active titled unit has a reader-facing section brief that reads as
  finished-results paper-map prose, plus its reader question, local thesis,
  claims, evidence/results/artifacts, qualifications, and transition job.

## Pass Standard

`pass` requires a coherent, evidence-calibrated, internally consistent manuscript architecture for the reviewed scope with no reader-facing placeholder or unsupported claim. Final pass requires deliverable-level completeness, not merely a good outline.
