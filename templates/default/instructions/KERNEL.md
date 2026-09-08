# CoAutoResearch v2 Sequential Research Kernel

## 1. Scope and non-negotiable invariants

This kernel is the canonical v2.0 agent workflow.

- One server-owned invocation closes at most one trial.
- One trial answers one local research question.
- The v2.0 production path is sequential. Do not create parallel batches or multiple active trials.
- Worker-produced results are proposals until a reviewed staged snapshot is published by the service.
- Do not directly modify protected canonical paths.
- Negative evidence and diagnosed failure are valid research outputs.
- Do not hide contradictory evidence or select only favorable trials.
- Do not silently change a locked venue, core project identity, human constraint, or central claim.
- Do not silently mutate instructions. Use an instruction patch proposal.

The authoritative lifecycle is:

`Observe -> Orient -> Route -> Charter -> Preflight -> Execute -> Distill -> Stage Candidate Bundle -> Compute Review Manifest -> Review and Repair Exact Stage -> Derive Merge Decision -> Evaluate Gate -> Validate -> Publish Transaction -> Return Control`

## 2. File classes

### Canonical, service-published state

Examples:

- `PROJECT.md`
- `research_trajectory/STATE.json` and `.md`
- `research_trajectory/CURRENT_FINDINGS.json` and `.md`
- `research_trajectory/HUMAN_TASKS.json` and `.md`
- `research_trajectory/lines/`
- `research_trajectory/campaigns/`
- `resources/target_venue/TARGET_VENUE.json` and `.md`
- `resources/target_venue/VENUE_PROFILE.json` and `.md`
- `manuscript/BLUEPRINT.md`
- `manuscript/PAPER_PLAN.md`

Do not write these directly during an agent invocation.

### Trial proposals and audit

The current trial directory may contain:

- `TRIAL.json`
- `PLAN.json` and `PLAN.md`
- `EXPERT_ROUTE.json` and `EXPERT_ROUTE.md`
- `REPORT.json` and `REPORT.md`
- `RESULT_CARDS.json` and `RESULT_CARDS.md`
- `MERGE_REQUEST.json` and `MERGE_REQUEST.md`
- `reviews/REVIEW_MANIFEST.json` and `.md`
- required reviewer JSON/Markdown pairs
- trial artifacts

`TRIAL.json` is intentionally the only authoritative v2 Trial artifact. It has
no registered paired-Markdown contract. A retained legacy `TRIAL.md` may be
hashed as audit material, but reviewers must not infer a pair from the matching
basename, require it to mirror `TRIAL.json`, or treat disagreement as a v2
blocker. JSON/Markdown consistency applies only where the artifact registry
declares `paired_markdown` or `paired_markdown_pattern`.

`PUBLISH_RECEIPT.json` is service-owned. Do not create or modify it. At publish,
the service atomically finalizes the reviewed `TRIAL.json` lifecycle state,
stage id, review level, outcome, and publish revision in the same transaction as
the canonical update.

### Staging

Write proposed canonical files only under:

`research_trajectory/.staging/<trial_id>/<stage_id>/candidate/`

The service writes `STAGED_UPDATE_MANIFEST.json` at the staging root after it
independently enumerates and hashes every material input. The agent must not
author or replace that service-owned manifest.

### Workbench

Use `workspace/` for live code, analysis, data transformations, generated outputs, logs, models, and experiments. Workspace content is not accepted research truth until referenced by a result card and merge decision.

## 3. Phase 0: launch routing

Before the normal trial loop:

- for an empty project, follow `COLD_START.md` and `PROJECT_FRAMING.md`;
- for existing work, follow `CONVERSION.md`;
- for uploaded or mentioned resources, follow `RESOURCE_INTAKE.md` and complete the Content Inspection Gate;
- for a formal intervention, follow `INTERVENTION_PROTOCOL.md` before selecting the next move;
- for manuscript-facing work, follow `MANUSCRIPT.md`;
- for target venue work, follow `TARGET_VENUE.md`.

Preserve the existing v1 intake, conversion, intervention, resume, fork, restart, checkpoint, and resource provenance semantics unless this kernel explicitly changes control flow.

## 4. Phase 1: Observe

Read the current canonical revision and only the state required for the current decision:

- project definition and constraints;
- active and candidate research lines;
- campaign component status;
- Critical Path;
- accepted and qualified result cards;
- recent published trials;
- pending formal interventions;
- non-blocking human tasks;
- target venue and lock level;
- relevant reusable notes and inspected resources.

Do not read every old report by default. Open older trial evidence only when needed for provenance, compatibility, contradiction, or working-set selection.

Emit semantic trace phase `observe`.

## 5. Phase 2: Orient

Build a short research situation assessment:

- What is the current best research line?
- Which claims are accepted, qualified, weakened, or unresolved?
- What negative or limiting evidence matters?
- Which campaign gaps prevent readiness?
- What is the highest-leverage Critical Path bottleneck?
- Does a human-only or operational blocker already exist?
- What does the target venue require now?

The service, not the worker, derives the ordered Critical Path from published
active-line risks, incomplete campaign components, blocking human locks, and
research-critical resource dependencies. It removes resolved, satisfied,
inactive, contextual, and non-blocking entries, ignores worker-provided rank or
score fields, and exposes only the first three items under its deterministic
priority policy. Treat that order as input; do not replace it with a self-rated
list.

Propose two to four candidate bounded moves. Rank them by:

- Critical Path leverage;
- uncertainty reduction;
- evidence value;
- research-line impact;
- campaign impact;
- venue relevance;
- cost and risk;
- human dependency.

Select one concrete move with the highest expected research value. If no viable path and concrete move exist, do not manufacture work; prepare gate evidence for `no_viable_line`.

Emit semantic trace phase `orient`.

## 6. Phase 3: Expert Route

Follow `EXPERT_ROUTER.md`.

Every trial requires `domains/general_research/DOMAIN.md`. Also select each installed pack whose registry trigger matches the project, active venue, local question, or proposed claim. Select exactly one primary move playbook. Include a venue profile when configured. Record unavailable specialized packs honestly. A final candidate cannot pass while required specialized coverage or official venue evidence is missing.

Write `EXPERT_ROUTE.json` and its Markdown view before finalizing the plan.

Emit semantic trace phase `route`.

## 7. Phase 4: Trial Charter

Create or continue exactly the server-designated trial ID. Write `PLAN.json` and `PLAN.md` before execution.

The plan must define:

- target and move;
- one primary local question;
- why this move is best now;
- Critical Path target;
- affected line and campaigns;
- working set of included trials and result cards;
- only materially relevant exclusions, with reasons;
- minimum useful output;
- measurable success conditions;
- stop conditions;
- explicit must-not-do boundaries;
- resource needs and Resource Scout decision;
- expected result-card types;
- expected human-facing outcome;
- requested review level;
- `parallelism: sequential`.

Local completeness means the question becomes answered, partially answered, diagnosed, or explicitly unresolved under a stop condition. It does not mean finishing an entire framing, experiment, or manuscript module.

Emit semantic trace phase `charter`.

## 8. Phase 5: Preflight

### Resource Scout

Use `RESOURCE_SCOUT.md` when the plan depends on an unavailable, uncertain, date-sensitive, or research-critical external resource. If skipped, state a concrete reason.

### Review manifest preview

Apply `REVIEW_POLICY.md` and the deterministic routing table. The agent may request a stricter level but may not choose below the service-computed minimum.

### Plan Review

Run `PLAN_REVIEWER.md` before substantive execution. The reviewer reads plan-time inputs only. A `revise` decision requires a plan revision and rereview. Execution starts only after Plan Review is `pass`. A genuine human or operational blocker may end preflight with a coherent blocked/needs-human package.

Emit semantic trace phase `preflight`.

## 9. Phase 6: Execute

Execute only the chartered work. Use small smoke tests before expensive work. Preserve commands, configurations, inputs, outputs, hashes, and failure logs required for another person to inspect or reproduce the result.

Stop when:

- the local question is answered;
- the minimum useful output exists;
- a declared stop condition triggers;
- further work would expand scope;
- a human-only decision blocks every useful continuation;
- an operational blocker prevents every useful continuation;
- failure is diagnosed enough to inform the next move.

Stopping additional work at this boundary does not discard work already
completed inside the approved charter. If the local question or declared stop
condition has been satisfied, finish the current REPORT, result cards, Merge
Request, candidate bundle, exact-stage review, and publication. Record the
separate work as a normal recommended next move for the server-owned next
trial. Use `extensions.scope_boundary` only when an out-of-scope discovery
interrupts the current charter before its bounded output can be completed; do
not use it merely because successful work naturally leads to another trial.
For a normally completed trial, omit `extensions.scope_boundary` entirely. If
an out-of-scope discovery does interrupt the charter, the value must be an
object with exactly:

```json
{
  "stopped": true,
  "reason": "<non-empty explanation>",
  "proposed_new_trial": {
    "target": "<target>",
    "move": "<move>",
    "question": "<question>",
    "expected_value": "low | medium | high"
  }
}
```

The `proposed_new_trial` object must also appear byte-for-value in
`recommended_next_moves`. Never use a free-form string for this field and
never fabricate a stop record after the charter has completed.

Do not automatically run main experiments, ablations, sensitivity, downstream evaluation, and manuscript packaging in one trial. Campaigns decide which separate trials are required.

Emit semantic trace phase `execute`.

## 10. Phase 7: Distill

Write the machine JSON first. For `REPORT`, write only `REPORT.json`; after the
execution write guard passes, the service generates the deterministic,
human-readable `REPORT.md` projection before it freezes the stage. For the
other agent-authored paired artifacts, write the checked Markdown view after
the JSON.

### REPORT

Record:

- local-question outcome;
- trial outcome;
- work and procedures;
- artifacts and provenance;
- deviations from plan;
- positive and negative findings;
- limitations and alternative explanations;
- interpretation;
- proposed line and campaign effects;
- venue impact;
- knowledge-capture disposition;
- recommended next moves.

Do not write or repair `REPORT.md` during the agent invocation. It is a
service-owned human projection of the authoritative `REPORT.json`, not a
second narrative authority.

### RESULT_CARDS

Create immutable proposed cards for reusable evidence, negative evidence,
diagnosis, boundaries, artifacts, or decisions. Do not mark them accepted.
Corrections create a new card whose `supersedes` array names the old card. A
Merge Request `supersede` decision is attached to that new card, never to the
old card being replaced.

Cards must cite substantive immutable research material, never the current
trial's mutable control files or reviews. In particular, do not cite `TRIAL`,
`PLAN`, `EXPERT_ROUTE`, `REPORT`, `RESULT_CARDS`, `MERGE_REQUEST`, plan/reviewer
outputs, or service-owned stage metadata as evidence; cite the underlying
versioned artifact or source.

### MERGE_REQUEST

Propose card decisions and canonical changes. State conflicts, qualifications, exclusions, and human implications. Never omit materially relevant conflicting evidence.

Before yielding, set the agent-authored `TRIAL.json` lifecycle proposal to
`distilled`. The agent may use `preflight_passed`, `executing`, or `distilled`
during execution, but it must never claim `staged`, `reviewing`,
`ready_to_publish`, or `published`. Those post-distillation lifecycle states
belong exclusively to the service after it validates and freezes the bundle.

Emit semantic trace phase `distill`.

## 11. Phase 8: Prepare the complete candidate bundle

Prepare one candidate bundle under the current staging directory. Do not touch
canonical files or service-owned manifests. The service turns these inputs into
the hash-bound staged bundle before review.

The staged bundle must contain:

- the candidate canonical snapshot under `candidate/`;
- the final-form `HUMAN_BRIEF.json` and exactly paired `HUMAN_BRIEF.md`, both
  beside each other at the stage root;
- `GATE_EVIDENCE.json` with the agent's structured evidence and recommended
  status, plus its exactly paired `GATE_EVIDENCE.md` beside it at the stage
  root;
- all trial artifacts required by the proposed merge;
- the structured plan, route, report, and gate fields from which the service
  derives review-routing inputs.

### Manuscript promotion boundary

The candidate snapshot must keep the cumulative manuscript synchronized with
research evidence. If the Merge Request asks to `accept`,
`accept_with_qualification`, or `supersede` a manuscript-relevant result card,
the candidate must contain both `manuscript/BLUEPRINT.md` and
`manuscript/PAPER_PLAN.md`. A card is manuscript-relevant when it has a claim
ID or its type is positive evidence, negative evidence, diagnostic insight,
boundary condition, claim revision, or method decision.

`BLUEPRINT.md` must integrate the real result in reader-facing form and list
each such card ID in `Provenance / Audit Index`; `PAPER_PLAN.md` carries the
remaining evidence and packaging obligations. If the current Blueprint is a
pre-results stub while published accepted or qualified cards already exist,
this trial must perform one cumulative catch-up: exit the stub, cover every
published card ID in the provenance section, and organize the supported
results into a progressive research story. Do not copy trial logs or planned
result slots into the Blueprint. The service enforces this boundary before it
writes the immutable stage manifest.

The agent must not create `ROUTING_INPUTS.json`; it is a service-owned,
deterministic projection written only after the execution guard passes.

The agent must not record exact hashes for candidate files whose bytes the
service normalizes before staging, including candidate `STATE` and
`CURRENT_FINDINGS` pairs. `STAGED_UPDATE_MANIFEST.json` is the sole authority
for those final hashes. Agent-authored artifacts such as `MERGE_REQUEST` may
describe the proposed pre-normalization operation, but must not carry a hash
map that will become stale when the service advances revision metadata.

The service validates the candidate paths and base revision, enumerates every
material input and operation, computes the deterministic hash, and writes
`STAGED_UPDATE_MANIFEST.json`. The agent must not author, replace, or imitate
that service-owned manifest. After preparing the inputs, yield to the service;
review resumes only after the service supplies the exact stage ID/hash and
Review Manifest.

Both stage-root Markdown views are mandatory execution outputs. The service
publishes the reviewed Human Brief pair with the Trial and retains the Gate
Evidence pair in the immutable stage as review material.

`HUMAN_BRIEF` does not own the global gate status. The service publishes `GOAL_GATE.json` separately, and the UI joins both artifacts. The brief must nevertheless be consistent with the recommended gate evidence and must contain an actionable human request when a blocking human dependency is claimed.

The staged snapshot may include only create/replace operations allowed by `TRANSACTION_PROTOCOL.md`. The service verifies that no material input is omitted, normalizes and sorts the contract-defined input and operation records, and computes or verifies the complete stage manifest hash.

Emit semantic trace phase `stage`.

## 12. Phase 9: Compute the Review Manifest

Follow `REVIEW_POLICY.md` and `REVIEWER_SCOPE_ANALYST.md`.

The service computes the minimum review level and required reviewer set as a deterministic pure function over the structured plan, route, report, proposed line/campaign/venue/manuscript effects, gate evidence, and staged bundle. The agent may request escalation but may not downgrade the service result.

Accept the service-generated `REVIEW_MANIFEST.json` and checked Markdown view.
It must reference the exact stage ID and stage manifest hash. The agent and
Reviewer Scope Analyst never write or replace this service-owned artifact.

Emit semantic trace phase `review_route`.

## 13. Phase 10: Review and repair the exact stage

Run every reviewer listed in `REVIEW_MANIFEST.json`.

- Plan Review is the pre-execution review already completed and remains part of closure evidence.
- Post-trial reviewers inspect the exact trial and staged bundle, including candidate canonical files, Merge Request, Human Brief, and Gate Evidence.
- Every post-stage review records the exact stage ID and stage manifest hash.
- A `revise` decision requires correcting the trial or staged bundle.
- Any material correction creates a new stage hash and invalidates affected prior post-stage reviews.
- Rerun the deterministic router and every affected reviewer after restaging.
- A trial cannot close while any required reviewer is missing, stale, or `revise`.
- Specialized reviewers are registered by enabled expert packs. The v2.0 general pack may legitimately select none.

The repair loop ends only when all required reviews for the exact final stage are `pass`, or when a coherent `blocked`/`needs_human` stage is complete under the review policy. The reviewed Merge Request and candidate snapshot must be coherent enough for the service to derive a final Merge Decision. No requested acceptance may remain unresolved by a required reviewer.

Emit semantic trace phases `review` and, when needed, `repair`.

## 14. Phase 11: Derive Merge Decision and Evaluate Goal Gate

After exact-stage review closure, the service first derives `MERGE_DECISION.json` from the reviewed stage, Merge Request, Review Manifest, and reviewer outputs. The agent must not self-approve or publish this decision. The service then constructs the effective post-merge projection in memory and evaluates the pure goal gate from `GATE_EVIDENCE.json`, the derived Merge Decision, the reviewed Human Brief, and that projection according to `AUTORESEARCH_GATE.md` and the published truth table. Proposed current-trial cards count toward pass only when the derived Merge Decision accepts or accepts-with-qualification them.

Priority:

1. `killed_by_human`
2. `pass`
3. `needs_human`
4. `paused_budget`
5. `blocked`
6. `continue`
7. `no_viable_line`

A pass candidate automatically requires Final review level and strict pass by all required core and specialized reviewers bound to the exact final stage. The service rejects publication when the computed gate contradicts the reviewed Human Brief, merge decision, or gate evidence.

A derived Merge Decision with `overall_status=rejected` is non-publishable and does not proceed to Goal Gate publication. Return the trial to repair, or explicitly invalidate it and stage a separate coherent terminal package before closure.

For a blocking human decision, the reviewed Human Brief must have:

- `needed=true`;
- `blocking=true`;
- exactly one concrete question;
- `can_continue_meanwhile=false`.

If useful work can continue, the gate remains `continue` and the request is staged as a non-blocking Human Task instead of `needs_human`.

Human Brief outcome vocabulary uses the same whole-trial blocker boundary.
`trial_outcome=blocked` is valid only when Gate Evidence has a universal
non-human operational blocker and no independent valuable move;
`trial_outcome=needs_human` is valid only for a universal blocking human
dependency. A locally blocked acquisition with a viable changed-ingress move
must use `informative_negative`, `no_state_change`, or `advanced`, not
`blocked`. The service checks this before post-stage review and rejects a
contradictory stage.

Emit semantic trace phase `gate`.

## 15. Phase 12: Service validation and recoverable publication

The agent stops after producing a complete, reviewed, hash-consistent trial and staging package. The service then:

1. checks protected-path integrity and quarantines/restores unauthorized canonical writes;
2. validates all JSON Schemas and every artifact-registry-declared
   JSON/Markdown pair;
3. verifies that all required reviews reference the exact final stage hash and pass closure rules;
4. verifies the already derived goal-gate result by rerunning the pure evaluator and validates cross-artifact invariants;
5. acquires the project transaction lock and rechecks the base canonical revision;
6. publishes the already derived Merge Decision and Goal Gate together with the exact approved candidate snapshot and reviewed Human Brief through the journaled recoverable transaction protocol;
7. writes `PUBLISH_RECEIPT.json` with transaction ID, revision, paths, hashes, and gate status;
8. returns control to the UI.

The service must never expose a partially applied canonical revision. Startup recovery rolls back uncommitted transactions and finalizes committed transactions idempotently.

The agent must not create a receipt, increment the canonical revision, publish the goal gate, or start the next trial.

`canonical_revision` fields inside proposed `STATE` and `CURRENT_FINDINGS`
remain at the current base revision in agent output. Before the stage manifest is
hashed and any reviewer runs, the service advances those fields to the target
revision, renders their paired Markdown deterministically, and includes the
exact service-derived bytes in the immutable review snapshot. If either
artifact was not substantively proposed, the service stages a revision-only
copy of the current canonical artifact. This keeps revision ownership in the
service while ensuring reviewers and the transaction validate the same bytes.

Emit semantic trace phases `validate`, `publish`, or `recovery` only when the service reports them.

## 16. Self-improvement

Follow `NOTES_AND_SELF_IMPROVEMENT.md`.

Write a note only when it improves future decisions. Propose instruction changes under `research_trajectory/instruction_patches/`; do not rewrite managed instructions during a research trial.

## 17. V1 compatibility

V1 projects and trials remain readable. A v1 trial without `REVIEW_MANIFEST.json` follows the legacy eight-reviewer closure rule. Do not silently rewrite legacy evidence. Use the formal migration process before publishing v2 canonical JSON.
