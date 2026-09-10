# Target Venue Protocol

## First-class state

Target venue is an active research constraint, not a final formatting field. Store machine state in `resources/target_venue/TARGET_VENUE.json` with a readable Markdown view.

A null `target_venue` means no venue is configured. A general research report
can be reviewed against its declared audience, article type, evidence standard,
and deliverable without selecting a conference or manufacturing a venue profile.
Keep those project requirements explicit. Venue-specific official guidance,
seed papers, and profile readiness apply when a venue is configured; their
absence alone is not a blocker for an explicitly venue-independent report.
This does not imply submission readiness or relax scientific and final review.

## Lock levels

- `exploratory`: alternatives may be investigated and proposed.
- `preferred`: the current working target; changes require a published rationale.
- `locked`: set or removed only by a formal human intervention.

The agent must not silently pivot a locked venue. If evidence shows the locked target is unsuitable, prepare `needs_human` with one concrete venue/scope decision.

## Venue profile

A venue profile records:

- audience and article type;
- contribution patterns;
- evidence standards;
- manuscript structure expectations;
- figure/table expectations;
- appendix/supplement posture;
- common rejection risks;
- inspected seed papers and provenance;
- current official venue or publisher requirements, article-type applicability, access time, and inspection status;
- readiness status.

`profile_status: ready` is necessary but not authoritative by itself. Final venue readiness also requires at least one inspected official requirements source, every recorded requirements source resolved to inspected or excluded, and every seed paper resolved with at least one inspected representative paper.

## Use during research

Venue gaps affect:

- framing;
- candidate move ranking;
- campaign components;
- claim strength;
- manuscript architecture;
- reviewer routing;
- final pass.

Seed papers calibrate style and standards. Do not copy their content, claims, or ideas.

## Deterministic constraint projection

Before framing or manuscript work, project the active target and matching venue
profile into two concrete inputs:

- framing constraints: audience, article type, contribution patterns, evidence
  standards, and rejection risks;
- manuscript-architecture constraints: venue organization and figure/table
  expectations.

Changing the active profile must recompute both inputs. A generic frame or
manuscript outline that merely names the venue does not satisfy this rule.
