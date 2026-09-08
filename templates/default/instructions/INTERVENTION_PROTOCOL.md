# Human Intervention Protocol

> **V2 control-plane override.** A formal intervention is the highest-priority input. Chat records the intervention but does not directly mutate canonical research truth. The next autoresearch invocation stages the required canonical changes. A blocking human decision uses `needs_human`; an optional request belongs in non-blocking Human Tasks.


## Purpose

This protocol tells chat and autoresearch agents how to recognize and record formal human interventions.

A formal human intervention is a user message that changes or constrains what the research system should believe, do, avoid, prioritize, or target. Ordinary interaction is not an intervention.

The server does not classify messages semantically. The agent must decide from the user message, the current project context, and this protocol.

Before autoresearch has started, do not create human intervention files. Pre-start changes to venue, scope, paper outline, research objective, contribution framing, constraints, exclusions, success gates, or expected output are launch framing updates; handle them by following `instructions/PROJECT_FRAMING.md` and updating `PROJECT.md` when warranted. A human intervention file is only for steering an existing autoresearch trajectory after a Start/Resume run has created autoresearch state, trials, gate state, or other canonical trajectory context.

## What Is Not A Human Intervention

Do not create or update an intervention for ordinary interaction, including:

- progress, status, or log questions;
- requests to explain, summarize, or locate files;
- clarification questions that do not change research direction;
- temporary pause or stop requests;
- ordinary discussion that does not change what future autoresearch should do.

Answer ordinary interaction directly. Do not mention intervention handling when no intervention was recorded or updated.

## What Counts As A Human Intervention

After autoresearch has started, create or update a pending intervention when the user message changes or constrains the research process, for example:

- correcting the research direction;
- changing the current plan, method, resource priority, target venue, contribution framing, or scope;
- rejecting a method, resource, dataset, claim, assumption, or result;
- adding a constraint or priority for the next autoresearch step;
- requesting a major pivot.

Decision test: does this message change what future autoresearch should believe, do, avoid, prioritize, or target? If yes, record it as a formal human intervention. If no, treat it as ordinary chat.

## Chat-Stage Recording Rules

Chat is not an autoresearch run. In chat mode:

- answer the user first;
- do not start, continue, resume, or plan a trial;
- do not update `research_trajectory/STATE.md`, `research_trajectory/CURRENT_FINDINGS.md`, `research_trajectory/TRAJECTORY.json`, `research_trajectory/NEXT_TRIAL.json`, checkpoints, trials, reviewer files, or manuscript gate files;
- if autoresearch has not started, do not create or update intervention files; use `PROJECT.md` launch framing instead;
- if autoresearch has started and the message is a formal intervention, create or update a pending intervention file under `research_trajectory/human_interventions/`;
- update `research_trajectory/human_interventions/INDEX.md` and `INDEX.json` only for intervention bookkeeping;
- if you recorded or updated an intervention, add one final sentence to your response naming the path.

The UI/server will synchronize pending intervention ids into `NEXT_TRIAL.json` after chat completes.

## Pending Intervention File Format

Use this structure for pending intervention files:

```markdown
# I0001 Short Intervention Title

Created: <ISO timestamp>
Source: UI chat
Status: pending

## Current Effective Instruction

<The latest version of what future autoresearch must follow.>

## Rationale / User Intent

<Why the user is steering this direction.>

## Expected Autoresearch Consequence

<How the next Start/Resume autoresearch should apply it.>

## Scope / Non-goals

<What this does not require or should not change.>

## Open Questions

- <None, or concrete questions.>

## Amendment History

- <timestamp> Initial intervention from chat turn `<message id or summary>`.

## Source Chat Turns

- <timestamp> User: <short quote or summary>
```

If a later user message clarifies the same pending intervention, update the same file's `Current Effective Instruction` and append to `Amendment History` / `Source Chat Turns`. Create a new intervention ID only for a distinct topic.

Do not rewrite interventions whose `INDEX.json` status is `applied` or `superseded`; create a new intervention if the user changes an already-applied direction.

## Autoresearch-Stage Application

When Start/Resume autoresearch is clicked, the execution agent must read every pending intervention before selecting or executing the next objective.

During autoresearch, apply pending interventions to canonical state only when warranted by the actual trial work:

- `PLAN.md` must include `## Human Interventions` explaining how pending interventions affect the trial.
- `REPORT.md` must state which pending interventions were applied, deferred, blocked, or superseded, with reasons.
- Update `STATE.md`, `CURRENT_FINDINGS.md`, manuscript files, or resource notes only when the completed trial genuinely changes them.
- Do not mark an intervention obsolete unless a newer explicit human intervention supersedes it.

The server marks pending interventions as applied only after a valid trial boundary is completed.


## V2 Authority Fields

Venue lock/unlock, project kill, core identity change, authorship/ethics decisions, and private-access grants must cite the formal intervention ID in the staged machine state.
