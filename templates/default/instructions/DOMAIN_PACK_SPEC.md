# Domain Pack Specification

## Goal

Allow CoAutoResearch to become more specialized incrementally without changing the general research kernel.

## Required files

A domain pack lives under `instructions/domains/<domain_id>/` and contains:

- `registry.json`
- `DOMAIN.md`
- optional `CAMPAIGNS.md`
- optional `RESULT_CARD_RULES.md`
- optional reviewer instructions under `reviewers/`

## Registry contract

The registry declares:

- stable domain ID and version;
- explicit triggers;
- claim types;
- evidence standards;
- campaign templates;
- method-pack recommendations;
- specialized reviewer registrations;
- incompatibilities and safety constraints.

## Authority boundary

A domain pack may add stricter standards, artifacts, campaign components, or reviewers. It may not:

- redefine trial lifecycle;
- permit direct canonical writes;
- weaken schema validation;
- alter gate priority;
- bypass deterministic review routing;
- mark result cards accepted;
- unlock a human-locked venue;
- silently change project scope.

## Incremental release rule

A new domain pack is enabled only after:

- registry/schema validation;
- pack-specific valid/invalid fixtures;
- routing tests;
- reviewer tests when applicable;
- at least one end-to-end domain fixture;
- documentation of unsupported claim types.
