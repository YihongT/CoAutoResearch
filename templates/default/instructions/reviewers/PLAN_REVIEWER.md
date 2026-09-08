# Plan Reviewer

## Purpose

Review the current trial Plan before substantive execution. This is a pre-execution review; it does not read outputs that do not yet exist.

## Phase and output

- Phase: `pre_execution`.
- Reviewer key/scope: `plan` / `plan`.
- `stage_id` and `stage_manifest_hash`: null.
- Bind the review to the exact structured Plan bytes. Set
  `extensions.plan_binding.plan_revision` to the integer
  `PLAN.json.plan_revision`, and set
  `extensions.plan_binding.plan_sha256` to the lowercase SHA-256 of the exact
  `PLAN.json` file bytes. These field names are literal; a generic `sha256`
  field does not satisfy the service contract. The required shape is:

  ```json
  {
    "extensions": {
      "plan_binding": {
        "plan_revision": 1,
        "plan_sha256": "<64 lowercase hexadecimal characters>"
      }
    }
  }
  ```

  Correcting this review-only binding does not change the Plan. Do not edit
  `PLAN.json`, increment `plan_revision`, or rerun Resource Scout merely to fix
  a missing/misnamed `plan_binding` field; recompute the hash from the unchanged
  current `PLAN.json` and issue the fresh paired review.

- Write the validated pair only as `reviews/PLAN_REVIEW.json` and
  `reviews/PLAN_REVIEW.md` under the current trial. The service archives a prior
  pair under `reviews/history/<stage_id>/` before opening a new planning stage.
  The agent must never create, copy, or modify review-history or stage-named
  subdirectories.

## Required reading

- `instructions/reviewers/REVIEW_TAXONOMY.md`;
- `PROJECT.md`;
- published `STATE`, `CURRENT_FINDINGS`, active/candidate lines, and affected campaigns;
- current target venue/profile when configured;
- current `PLAN.json/.md` and `EXPERT_ROUTE.json/.md`;
- Resource Scout brief/report and v2 manifest when required or already run;
- relevant accepted result cards and only the prior reports needed for feasibility/provenance;
- relevant formal interventions and reusable notes.

Do not require `REPORT`, `RESULT_CARDS`, `HUMAN_BRIEF`, staged candidate files, or post-stage reviews.

In v2, a required Scout must finish before this review passes. Read its report
and manifest from the same stage/revision-specific Scout subdirectory, and list
every file in the Plan's exact Scout destinations in `reviewed_inputs`. A plan
that postpones required Scout until execution is not ready for approval.

## Review criteria

### Research choice

- Does the plan address the highest-leverage current Critical Path bottleneck?
- Is the “why now” rationale grounded in current line/campaign/venue state?
- Is the local question capable of changing the project belief state, not merely creating bookkeeping?
- Is the selected move preferable to plausible alternatives given expected research value, cost, risk, and human dependency?

### Boundedness and local completeness

- Is there exactly one primary local question?
- Is the trial a coherent research move rather than a trivial ticket?
- Is it smaller than an entire framing, empirical, or manuscript module unless final packaging is explicitly the local objective?
- Are minimum useful output, success conditions, stop conditions, and must-not-do boundaries concrete and testable?
- Will scope expansion become a later trial rather than silently expanding this one?

### Working set and research integrity

- The plan declares possible knowledge-capture outputs when reusable
  resource, method, negative-result, manuscript, process, or preference lessons
  may result?
- Are included trials/cards relevant and compatible?
- Are materially relevant exclusions listed with reasons?
- Does the combination avoid cherry-picking favorable outcomes?
- Are negative, limiting, or superseding results treated honestly?
- Does the plan distinguish proposal, accepted evidence, and uncertainty?

### Method and evidence feasibility

- Are operationalization, comparison, controls, baseline, metric, data, resources, and compute credible for this local question?
- Is a smoke test planned before expensive work?
- Are expected artifacts and provenance sufficient for later evidence review?
- Are method/literature/venue standards routed through the available expert packs?
- Are missing expert packs reported rather than simulated?

### Resource Scout

- Is `required` versus `skipped` justified by current resource availability, freshness, date sensitivity, and research criticality?
- The plan includes the required `Resource Scout Brief`.
- It gives a concrete `Decision reason:` grounded in the overall goal and local question.
- It gives a concrete `Skip reason:` when Scout is skipped.
- It does not skip Resource Scout merely because the trial is small, search may take time, the resource type is unclear, or current resources look probably sufficient.
- If required, are resource types, search scope, known clues, destinations, download policy, and stop criteria auditable?
- If skipped, is the reason substantive rather than convenience?
- If Scout findings materially changed assumptions, was `plan_revision` incremented and is this a rereview?

### Human and venue authority

- Does the trial avoid silently changing a locked venue, human constraint, project identity, or central ambition?
- Is any human-only dependency recognized early?
- If useful work can continue, is the human request non-blocking rather than incorrectly gating the trial?

### Review level request

- Is the requested level at least the likely service minimum?
- Are external-source, venue, manuscript, figure/table, central-line, campaign-pass, final-candidate, and specialized-review triggers declared?
- The agent may request escalation but never downgrade.

### Preserved legacy field checks

For a v1 Markdown plan, also verify the explicit field ownership that existing
projects rely on: `Critical path target: CP<n>`, `Empirical work: yes | no`, and
resource rows using `Criticality: research-critical | contextual`. In v2 these
meanings must be represented by the structured critical-path target, execution
method, Resource Scout decision, and expected evidence fields; migration must
not make them disappear merely because the storage format changed.

## Pass Standard

The shared strict pass rule in
`instructions/reviewers/REVIEW_TAXONOMY.md` applies. A plan passes only when it
is executable and no planning blocker, required action, or critical unassessed
area remains.

## Decision rules

- `pass`: the plan is executable and no planning blocker/action remains.
- `revise`: any criterion above requires correction before execution.
- `blocked`: a non-human operational dependency prevents execution and all useful substitutes are exhausted.
- `needs_human`: one human-only dependency prevents execution and every useful alternative.

Pass means the trial may execute; it does not mean the global autoresearch goal is complete.
