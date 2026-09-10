# Review Taxonomy and Machine Output Contract

## Purpose

This taxonomy governs every v2 core and specialized reviewer. It preserves the rigor of the v1 review system while binding each post-stage judgment to an exact staged candidate state.

## Core review dimensions

Use only dimensions relevant to the reviewer role, but never lower the standard because a trial is early:

1. importance and project fit;
2. novelty and contribution calibration;
3. methodological or reasoning rigor;
4. evidence certainty and claim calibration;
5. traceability, provenance, and reproducibility;
6. ethics, safety, privacy, integrity, and misuse risk;
7. communication and human inspectability;
8. deliverable and venue completeness;
9. readiness and unresolved blockers;
10. consistency with research lines, campaigns, Critical Path, and target venue.

## Review phases

- `pre_execution`: Plan Review before substantive execution; `stage_id` and `stage_manifest_hash` are null.
- `post_stage`: review of the exact candidate stage; both stage fields are required.
- `final`: strict final-readiness review of the exact candidate stage; both stage fields are required.

## Canonical decisions

Use only:

- `pass`: no blocker, required action, unresolved material qualification, or critical unassessed area remains for this reviewer scope.
- `revise`: the stage or plan is useful but must be changed and rereviewed before closure.
- `blocked`: a non-human operational dependency prevents every valuable continuation relevant to the current trial and has a concrete recovery condition.
- `needs_human`: a human-only decision, credential, private resource, authority, or scope choice blocks every valuable continuation relevant to the current trial.

Reviewer decisions are quality-control decisions. They are not the global Goal Gate. A reviewer must not use `continue` as a decision in v2.

## Gate effects

Use one:

- `none`;
- `trial_block`;
- `human_block`;
- `operational_block`;
- `final_pass_block`.

`gate_effect` is descriptive input to the service evaluators. It does not override the service ReviewRouter, MergeEvaluator, or GateEvaluator.

## Strict pass rule

A reviewer may return `pass` only when all are true for the declared scope:

- no blocker remains;
- no required action remains;
- any qualification is already represented as an explicit scope/caveat in the staged state;
- no critical area required by the scope is unassessed;
- every reviewed claim or update is traceable to listed inputs/evidence;
- the exact stage hash matches the reviewed bundle;
- the output remains defensible under skeptical human inspection.

Words such as “plausible,” “ready for revision,” “architecture coherent,” or “mostly complete” are not pass conditions.

## Revise and stage invalidation

`revise` keeps the trial open. Any material correction to the candidate canonical snapshot, Merge Request, Human Brief, Gate Evidence, or referenced trial evidence changes the stage hash. Every affected post-stage review becomes stale and must be rerun.

## Human and operational blockers

Use `needs_human` only when:

- exactly one human-only dependency can be stated;
- it blocks every valuable next move;
- the response to human is one concrete question or request;
- `can_continue_meanwhile` would be false.

If useful work remains, add a non-blocking human-task candidate and return `pass` or `revise` according to review quality; do not return `needs_human`.

Reviewers must not edit canonical `research_trajectory/HUMAN_TASKS.md`
directly. In the v1 fallback, when the current critical-path bottleneck is human-gated,
the main execution agent promotes the one blocking question;
otherwise reviewer suggestions remain non-blocking Human Task Candidates.

Use `blocked` only for a non-human operational dependency with a concrete recovery condition. Ordinary reviewer uncertainty is `revise`, not `blocked`.

## Required machine output

Write JSON and validate it against `schemas/reviewer-output.schema.json`. After the review write guard passes, the service generates its registered Markdown view. Preserve already approved Plan Review files; do not regenerate those during post-stage review.

Required machine fields include:

- schema and artifact versions;
- project, trial, and review IDs;
- reviewer key and scope;
- phase;
- decision and gate effect;
- confidence;
- summary and context summary;
- instruction file;
- explicit reviewed inputs;
- strengths;
- blockers;
- required actions;
- qualified/partial passes;
- unassessed areas;
- human-task candidates;
- response to human when blocked/needs-human;
- migration source, when any;
- evidence checked;
- exact stage ID and manifest hash for post-stage/final review.

For `post_stage` and `final`, also supply `extensions.card_eligibility` for
exactly the cards requested by the reviewed Merge Request, following
`instructions/REVIEW_POLICY.md` (Closure) and the reviewer-output example.
Use `v2_artifacts.reviewer_card_eligibility_errors(reviews, merge_request)`
alongside exact-stage closure validation before yielding. Its decisions and
reasons are reviewer judgments; the service does not infer them. Pre-execution
Plan Review must not assess post-stage cards. A missing or malformed assessment
is a reviewer-output correction on the same immutable stage, not a reason to
replan or repeat completed experiments.

Every path in `reviewed_inputs` and every non-external path in
`evidence_checked` must preserve the exact on-disk identifier (including
underscores), resolve to a regular project file, and use the SHA-256 of those
exact bytes where a hash is required.

## Optional explanatory Markdown view

The service provides the paired view from JSON. If a richer view is needed before
review, the following structure may be used with the deterministic JSON block;
it is not an additional writing requirement.

### Rendering order

```markdown
# <Reviewer Name> Review

- Review ID:
- Trial:
- Phase:
- Decision:
- Gate effect:
- Confidence:
- Stage ID:
- Stage manifest hash:
- Instruction file:
- Migration source:

## Context Summary

## Reviewed Inputs

## Evidence Checked

## Strengths

## Blockers

## Required Actions Before Pass

## Qualified / Partial Passes

## Unassessed Areas

## Human Task Candidates

## Response to Human
```

Omit no required section; use an empty list or `None` in JSON where allowed.

## Review Manifest authority

The service ReviewRouter determines the required reviewer set. The agent may request escalation but may not downgrade it. A required reviewer may not return `not_applicable`. Omitted reviewers appear only in the Review Manifest with a deterministic reason.

A v1 trial without `REVIEW_MANIFEST.json` retains the legacy eight-reviewer closure rule. Do not fabricate a v2 stage hash for legacy reviews without formal migration provenance.
