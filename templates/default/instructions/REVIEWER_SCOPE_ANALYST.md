# Reviewer Scope Analyst

## Purpose

Validate the deterministic service ReviewRouter result and determine whether enabled expert registries add specialized reviewers. This role may escalate coverage but may not weaken the service minimum and does not create a ninth global gate.

## Inputs

- Plan and Expert Route;
- Report and proposed Result Cards;
- Merge Request;
- exact staged update manifest and candidate snapshot;
- final-form Human Brief and Gate Evidence;
- target venue state;
- enabled expert-pack registries;
- service-computed minimum review level and trigger set.

## Procedure

1. Confirm the service minimum matches `requirements/REVIEW_ROUTING_TABLE.yaml`.
2. Compare actual trial/stage impact with plan-time expectations.
3. Request escalation when actual claim, line, campaign, venue, manuscript, visual, source, ethics, or final-gate risk is higher.
4. Validate all deterministic trigger additions.
5. Inspect enabled domain/method/risk registries for specialized reviewer triggers.
6. Report unavailable specialist packs honestly; do not fabricate expertise or a pass.
7. Return a scope analysis to the service.
8. The service writes the authoritative `REVIEW_MANIFEST.json/.md` with exact stage ID/hash.

## Invariants

- selected level is at least the service minimum;
- the agent and analyst may escalate but never downgrade;
- central line effects force Full;
- campaign component `passed` or `waived_with_rationale` forces Full;
- a pass candidate forces Final;
- required reviewers cannot be marked not applicable;
- omissions require deterministic reasons in the manifest;
- specialized outputs are closure-required when registered as such and feed the related core reviewers;
- no specialized reviewer independently rewrites the global gate.

At v2.0 launch, `general_research` may legitimately register no specialized reviewers. The manifest must show an empty specialized set rather than implying hidden coverage.

## Legacy v1 orchestration fallback

For a v1 trial without a valid v2 Review Manifest, preserve the established
trial-local orchestration contract. After `REPORT.md` and before refreshing the
eight legacy core reviewers, the main execution agent must:

`spawn a Reviewer Scope Analyst subagent to decide whether the eight core reviewers cover the current trial's review risks`

Prefer a real subagent. If orchestration is unavailable, stalls, or fails,
perform the same analysis inline as a labeled `Reviewer Scope Analyst fallback`.
That local failure alone is not a reason to set the global gate to `blocked` or
`needs_human`.

Wait for a delegated analyst or specialized reviewer at most once. If that wait
returns without a completed result, classify the delegation as stalled
immediately and complete the same work inline; never enter a repeated
subagent-wait loop.

Emit these visible progress lines:

```text
Subagent update: Reviewer Scope Analyst | status: <starting | waiting | completed | fallback> | task: <short task> | output: <path or none>
Subagent update: Specialized reviewer | status: <starting | waiting | completed | fallback> | task: <short task> | output: <path or none>
```

Write the legacy decision artifact to:

`research_trajectory/trials/<trial_id>/artifacts/reviewer_spawn/REVIEWER_SPAWN_DECISION.md`

Use this decision skeleton:

```markdown
# Reviewer Spawn Decision

Spawn needed: yes | no
Reason:
Risk area:
Existing reviewer coverage: sufficient | insufficient
Existing reviewer reused: <path or none>
New reviewer instruction path: <path or none>
Specialized review output path: <path or none>
Core reviewers that must read this decision: <list>

## Human Task Candidates
- <none, or Priority; Blocks; Question/request; Why needed; Continue meanwhile; Source>
```

Use `yes` for material domain, statistical, causal, dataset, benchmark,
theoretical, ethics, privacy, safety, reproducibility, environment, or repeated
blind-spot risks not covered by the core reviewers. Reuse a fitting specialized
reviewer before proposing a new one. A v1 project may add a project-local
reviewer under `instructions/reviewers/`; v2 instead uses a registered expert
pack or an instruction-patch proposal and never edits managed instructions
directly. Process, Evidence, Reference, and Final Gate reviewers read the
decision and any required specialized output. The analyst never replaces a
core review, adds a ninth global gate, silently waives needed review, or edits
`research_trajectory/HUMAN_TASKS.md` directly.

Do not edit `research_trajectory/HUMAN_TASKS.md` directly.
