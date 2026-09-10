# Venue Fit Reviewer

## Purpose

Assess whether the active research line, evidence package, manuscript architecture, and proposed next move fit the configured target venue and lock level.

## Phase and output

- Phase: `post_stage` or `final`.
- Reviewer key/scope: `venue_fit` / `venue`.
- Bind to the exact stage ID/hash.

## Required reading

- `instructions/reviewers/REVIEW_TAXONOMY.md`;
- Project and target audience;
- `TARGET_VENUE.json/.md`, `VENUE_PROFILE.json/.md`, lock provenance;
- representative seed-paper list, style notes, and figure/table notes;
- current active/candidate lines and campaigns;
- Plan, Report, cards, Merge Request, candidate snapshot, Human Brief, Gate Evidence;
- manuscript Blueprint/Paper Plan/draft when applicable;
- Evidence, Manuscript, Figure/Table, and Reference reviews when available.

## Review criteria

### Apply the configured scope first

When `TARGET_VENUE.target_venue` is null, there is no venue-specific admission
standard to satisfy. For a declared general research report, assess the explicit
audience, article type, research question, evidence standard, claim scope, and
readable manuscript architecture. Do not require choosing a conference, creating
a venue profile, or collecting venue seed papers solely to pass this review.
This matches the service's unconfigured-venue readiness rule. A missing or
ambiguous audience/article type, unsupported claim, or unsuitable architecture
still requires correction. Report the reviewed scope; do not return
`not_applicable` or infer submission readiness.

When a venue is configured, including an exploratory or preferred target, apply
the venue/profile and representative-source requirements below. A configured
venue is not optional merely because it is unlocked. Do not remove or change it
to avoid review, or substitute a general report for a requested submission.

### Venue-state integrity

- Is target venue, audience, article type, lock level, and profile path explicit?
- Is venue evidence based on inspected representative sources rather than memory or generic assumptions?
- Are seed papers relevant to the project contribution type, not merely from the venue?
- Is any locked venue change backed by a later formal human intervention?

### Contribution fit

- Does the active line match contribution patterns accepted by the venue?
- Is the paper identity clear: method, system, empirical study, benchmark, theory, design/tool, position, or other?
- Is novelty framed for the venue’s audience and neighboring literature?
- Is the claim posture too broad, too narrow, or mismatched to the venue?

### Evidence standard

- Does the evidence type match venue expectations for the stated contribution?
- Are expected baselines, controls, ablations, user evidence, qualitative grounding, robustness, artifact evaluation, or theoretical proof present or tracked in campaigns?
- Are proxy or formative findings being overstated as venue-level efficacy?
- Does the final-readiness claim account for common rejection risks?

### Manuscript and presentation

- Does section architecture resemble successful representative work without imitation?
- Are introduction pacing, related-work positioning, methods/detail balance, discussion, limitations, appendices, and supplementary materials appropriate?
- Are figures/tables carrying the expected explanatory or evidentiary load?
- Are page/format constraints treated as packaging constraints rather than a reason to omit necessary evidence?

### Trial and campaign implications

- Does the current trial close a venue-relevant gap?
- Is the next move higher venue leverage than low-value polishing?
- Are venue-required campaign components correctly passed, waived, or still open?
- If the venue is exploratory/preferred, is an alternative recommendation evidence-based and clearly non-authoritative?

### Representative-source standard

When a configured venue's fit is material, ground the judgment in an inspected representative
set, normally three to five recent relevant papers or primary venue guidance.
Missing seed papers, an uncertain article type, or generic plausibility is not a
pass. Compare contribution framing, evidence standard, architecture, display
density, appendix/supplement expectations, and claim posture without copying a
source's content or ideas.

## Pass Standard

`pass` requires a defensible audience/contribution match, appropriate evidence and architecture for the reviewed scope, no silent locked-venue change, and no untracked applicable gap. For a configured venue, this includes a defensible venue match; final pass requires the complete profile and all venue-required campaigns to be satisfied. Without a configured venue, the general-report scope above applies; all evidence, manuscript, reference, and other required reviews remain in force.
