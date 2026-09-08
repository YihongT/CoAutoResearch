# Merge Evaluation and Publication Decision

## Purpose

Convert a reviewed candidate stage into a service-owned Merge Decision without allowing an agent to self-approve canonical truth.

## Agent responsibility

The current sequential agent writes:

- REPORT;
- immutable proposed RESULT_CARDS;
- MERGE_REQUEST with requested per-card decisions and canonical changes;
- candidate canonical files under staging;
- final-form HUMAN_BRIEF;
- GATE_EVIDENCE.

The agent must not publish `MERGE_DECISION.json`, change canonical revision, or mark a proposed card canonically accepted.

## Service inputs

After exact-stage review closure, the service reads:

- current canonical revision;
- trial Plan, Expert Route, Report, proposed Result Cards, and artifacts;
- Merge Request;
- exact staged update manifest and candidate files;
- Review Manifest and all required reviewer outputs bound to the same stage hash;
- current canonical lines, campaigns, findings, venue state, and manuscript state.

## Derived decisions

For each requested card, the service derives one of:

- `accept`;
- `accept_with_qualification`;
- `reject`;
- `supersede`;
- `defer`;
- `needs_human`.

The decision is always about the card named by `card_id`. In particular,
`supersede` means **this new card supersedes every earlier card named in this
new card's non-empty `supersedes` array**. Never assign `supersede` to the old
card merely because a later card replaces it. Request `accept` or
`accept_with_qualification` for a new superseding card when appropriate; the
service derives the earlier cards' canonical `superseded` status from the new
card's declared links. Old frozen cards that are not themselves being accepted
as superseding cards must be `defer` or `reject` as warranted.

For each candidate canonical file, the service derives:

- `apply`;
- `omit`;
- `needs_human`.

The overall Merge Decision is:

- `approved` when the exact reviewed candidate stage is coherent and publishable;
- `rejected` when the requested canonical state must not publish and the trial must return to repair or explicit invalidation;
- `needs_human` when formal human authority is required.

## Deterministic guardrails

- Never accept a result card with unresolved or stale required review.
- Every post-stage review must match the exact stage hash.
- Preserve negative and conflicting evidence.
- Do not merge incompatible scopes without an explicit qualification.
- Do not let recency automatically supersede older evidence.
- Reject a backwards supersede request: a card with an empty `supersedes`
  array cannot request `supersede`, and the IDs in a superseding card must name
  cards that predate it in canonical or immutable trial history.
- Do not unlock a locked venue without a later formal intervention.
- Do not mark campaign components satisfied from plans, placeholders, or unreviewed artifacts.
- Do not publish a stale base revision.
- When any requested substantive change is rejected, require a repaired stage rather than silently publishing a materially different partial snapshot.
- For `needs_human`, undecided result cards remain proposed or deferred; only safe blocker/state updates may publish.

## Output

The service writes `MERGE_DECISION.json` and the checked Markdown view.

- `approved` and `needs_human` may proceed to an effective post-merge projection, Goal Gate evaluation, and transaction validation.
- `rejected` is non-publishable: do not compute or publish a Goal Gate for that stage. Return to repair or explicit invalidation and create a new hash-bound stage.

The published Human Brief must retain the exact reviewed narrative. Its neutral outcome changes become visible as applied only when the Merge Decision and Publish Receipt confirm them.
