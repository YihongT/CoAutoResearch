# Review Policy

## Authority

The minimum review level and required reviewer set are determined by the service ReviewRouter using the structured plan, expert route, proposed line/campaign/venue/manuscript effects, and gate candidate. The agent may escalate but may not downgrade below the computed minimum.

## Levels

### Light

Base reviewers:

- Plan
- Process

Allowed only when all are true:

- target is resource, process, or manuscript maintenance;
- no new or changed research claim;
- no line effect other than `no_change`;
- no campaign component is promoted beyond `in_progress`;
- no venue, claim hierarchy, active figure/table, or final-gate effect;
- the work is low risk and locally verifiable.

### Standard

Base reviewers:

- Plan
- Process
- Evidence

This is the default substantive trial level.

### Full

Base reviewers:

- Plan
- Process
- Evidence
- Venue Fit
- Manuscript
- Figure/Table
- Reference

Required for central line changes, claim hierarchy changes, campaign component pass/waiver, venue-lock change requests, major synthesis, or other high-impact work.

### Final

All eight core reviewers, including Final Gate. Required whenever the proposed gate status is `pass`.

## Trigger additions

Regardless of base level:

- new external sources or citations -> Reference;
- configured or affected target venue -> Venue Fit;
- BLUEPRINT, PAPER_PLAN, claim hierarchy, or deliverable architecture change -> Manuscript;
- active figure/table change -> Figure/Table;
- registered domain/method/risk trigger -> specialized reviewer.

## Not applicable

A reviewer is omitted only in `REVIEW_MANIFEST.json` with a deterministic reason. A required reviewer output may not return `not_applicable`.

## Closure

- Enforce JSON/Markdown consistency only for artifact types whose registry
  entry declares `paired_markdown` or `paired_markdown_pattern`; never infer a
  pair merely because adjacent `.json` and `.md` basenames match. In
  particular, v2 `TRIAL.json` is JSON-only. A retained legacy `TRIAL.md` is
  non-authoritative audit material, and disagreement with `TRIAL.json` is not a
  review blocker.
- Every `post_stage` or `final` reviewer records `extensions.card_eligibility`
  for every card in the exact reviewed Merge Request. Each record contains
  `card_id`, `requested_decision`, boolean `eligible`, and a non-empty `reason`.
  Eligibility assesses whether the still-proposed card supports that requested
  decision; it must not require canonical acceptance before the service Merge
  Decision. Pre-execution Plan Review must not assess these cards.
- `revise` means the trial remains open and the affected artifacts must be repaired and rereviewed.
- `blocked` or `needs_human` may close a trial only when the required reviewer set is complete, the Human Brief is actionable, and proposed merge is limited to safe state/blocker updates.
- `pass` means that reviewer found no unresolved issue in its declared scope; it does not by itself make the global gate pass.
- Final global pass requires strict pass from all required core and specialized reviewers.

## Legacy compatibility

A v1 trial without `REVIEW_MANIFEST.json` retains the existing eight-reviewer closure rule. Do not synthesize a v2 manifest retroactively without migration provenance.
