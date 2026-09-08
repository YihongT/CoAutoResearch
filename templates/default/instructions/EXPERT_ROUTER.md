# Expert Router

## Purpose

Select the smallest sufficient set of move, domain, venue, method, and risk instructions for the current trial. Routing changes local standards; it never changes the core lifecycle, write boundary, transaction protocol, or gate semantics.

## Inputs

Read:

- trial target and move;
- primary local question;
- active/candidate lines and campaign gaps;
- target venue and lock level;
- resource and evidence risks;
- project constraints;
- enabled expert-pack registries.

## Required v2.0 route

Every trial loads:

- `KERNEL.md`;
- exactly one primary move playbook;
- `domains/general_research/DOMAIN.md`;
- a target venue profile when configured;
- any method/risk pack actually available and relevant.

V2.0 enables only `general_research` by default and ships optional installed packs for embodied-system safety, human factors/HRI, and venue-specific requirements. Select every installed pack whose declared trigger matches the project, active target venue, trial question, or proposed claim. Do not invent legal, medical, statistical, or other specialist coverage when a required pack is absent. Record the missing pack and its consequence.

The service independently derives required installed packs from stable project and venue signals. Omitting a required installed pack, inventing a pack path, or omitting its registered evidence and safety standards invalidates plan approval.

## Move selection

Choose one primary playbook:

- framing -> `moves/FRAMING.md`
- resource acquisition -> `moves/RESOURCE_ACQUISITION.md`
- method construction -> `moves/METHOD_BUILD.md`
- empirical or analytical test -> `moves/EXPERIMENT_TEST.md`
- failure diagnosis -> `moves/FAILURE_DIAGNOSIS.md`
- cross-trial synthesis -> `moves/SYNTHESIS.md`
- manuscript packaging -> `moves/MANUSCRIPT_PACKAGING.md`
- reviewer repair -> `moves/REVIEW_REPAIR.md`

If a trial appears to need two primary playbooks, narrow the local question or split the work into separate trials.

## Route output

Write `EXPERT_ROUTE.json` and `EXPERT_ROUTE.md` with:

- move pack;
- enabled domain packs;
- method packs;
- venue profile;
- risk flags;
- concrete standards added to the charter;
- review triggers;
- missing packs and impact;
- requested review level.

Pack values are registry identifiers relative to the `instructions/` root, not
project-relative filesystem paths. Therefore:

- write `moves/FRAMING.md`, never `instructions/moves/FRAMING.md`;
- write `domains/physical_ai_safety/DOMAIN.md`, never
  `instructions/domains/physical_ai_safety/DOMAIN.md`;
- use only identifiers returned by the installed registry; do not construct a
  path from a directory discovered with `find`.

Validate these identifiers against `schemas/expert-route.schema.json` before
returning the plan bundle. A filesystem path prefixed with `instructions/` is a
structural plan error even when that file exists.

The service computes the minimum review level separately. The route may escalate but cannot lower it.
