# Autoresearch Goal Gate

## Authority

The machine gate is service-computed from validated staged inputs. Agent recommendations are evidence, not the final status.

The evaluator operates on an **effective post-merge projection**: start from the base canonical revision, apply only card and file decisions authorized by the derived `approved` or `needs_human` Merge Decision in memory, then test the truth table. A rejected Merge Decision never reaches gate evaluation.

## Priority

Evaluate in this exact order:

1. `killed_by_human`
2. `pass`
3. `needs_human`
4. `paused_budget`
5. `blocked`
6. `continue`
7. `no_viable_line`

## Status definitions

### killed_by_human

A formal human intervention or explicit UI action ends the project or current goal.

### pass

Pass requires all of the following:

- one active line is `candidate_final`;
- thesis, scope, contribution, and claim hierarchy are explicit;
- key claims map to previously published accepted/qualified cards or current-trial cards accepted/qualified by the derived Merge Decision;
- limiting and negative evidence is visible;
- all required campaign components are `passed`, `waived_with_rationale`, or `not_applicable`;
- no open Critical Path blocker remains;
- target venue and deliverable standards are satisfied when applicable;
- manuscript/deliverable architecture is coherent for the declared scope;
- review level is `final`;
- every required core and specialized reviewer is strict `pass`;
- a final staged Human Brief exists and states what was proved, not proved, uncertain, and still optional;
- guard, schema, transaction, and consistency checks pass.

The existence of additional polish work does not prevent pass. A high-value move that could reasonably change the central claim, remove a material risk, or alter deliverable readiness does prevent pass.

### needs_human

Use only when one human-only decision, permission, credential, private resource, venue/scope identity choice, authorship/ethics issue, or access change blocks every valuable next move.

Required Human Brief fields:

- exactly one concrete question;
- why it is required now;
- bounded options when useful;
- a recommendation when appropriate;
- `blocking=true`;
- `can_continue_meanwhile=false`.

If useful independent work can continue, use `continue` and add a non-blocking Human Task instead.

### paused_budget

A configured trial, time, token, cost, or checkpoint limit has been reached. This status may win even when a valuable next move exists. State current readiness and the recommended resume move.

### blocked

A non-human operational dependency prevents every valuable next move after documented recovery/substitution attempts. State the blocker and a concrete recovery condition. Do not use for reviewer uncertainty or project failure.

### continue

Requires:

- a viable active/candidate line or credible line-creation/recovery path;
- one concrete bounded next move;
- medium or high expected research value;
- no blocking human dependency;
- no budget stop;
- no universal operational blocker.

### no_viable_line

No defensible line or credible recovery move remains. Continuing would be undirected fishing. Preserve findings, failed lines, artifacts, and possible restart directions.

## Non-blocking human tasks

`research_trajectory/HUMAN_TASKS.json` contains only optional or deferrable requests. It must never be used as a hidden blocking queue.
