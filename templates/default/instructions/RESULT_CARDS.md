# Result Cards

## Purpose

Represent reusable research memory as small immutable units with explicit provenance, scope, caveats, and compatibility constraints.

## Creation

Cards are created in `RESULT_CARDS.json` after execution. Every card is `proposed`. The worker cannot accept its own card.

Allowed types:

- positive evidence;
- negative evidence;
- diagnostic insight;
- boundary condition;
- artifact;
- design decision;
- resource decision;
- claim revision;
- method decision;
- process lesson.

Each card must include:

- stable card ID;
- concise summary;
- affected claims;
- effect on claims;
- evidence paths and hashes where possible;
- exact scope;
- caveats;
- compatibility constraints;
- source trial;
- cards it supersedes;
- immutable content hash.

Evidence must be substantive, immutable research material. A card from the
current trial must not cite mutable control artifacts such as `TRIAL`, `PLAN`,
`EXPERT_ROUTE`, `REPORT`, `RESULT_CARDS`, `MERGE_REQUEST`, any current-trial
review, or a service-owned stage/lock/manifest. Cite the underlying versioned
artifact, dataset, command output, observation, or source instead. Reviewer
decisions assess evidence; they are not themselves evidence for the finding.

## Acceptance

Canonical status is derived from a published merge decision:

- accepted;
- accepted with qualification;
- rejected;
- superseded;
- deferred.

When a merge needs human judgment, undecided cards remain proposed or deferred. Do not insert them into current findings or lines.

## Immutability

Do not edit the substantive payload of a card after first distillation. A
correction creates a new card whose `supersedes` array names the earlier card.
The Merge Request decision belongs to the new card: request `supersede` only
for a new card that has a non-empty `supersedes` array, never for the old card
being replaced. The service derives the earlier card's canonical `superseded`
status from an accepted new card and preserves both immutable payloads.

## Composition discipline

A later trial may select cards from non-adjacent trials. It must explain compatibility, conflicts, material exclusions, and why the combination is not cherry-picking.
