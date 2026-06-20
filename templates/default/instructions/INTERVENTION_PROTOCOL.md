# Human Intervention Protocol

## Purpose

This protocol handles formal human interventions during research execution.

A formal human intervention is a user message that changes or constrains what the research system should believe, do, avoid, prioritize, or target.

Formal interventions are recorded under:

`research_trajectory/human_interventions/`

Ordinary interaction is not recorded as an intervention.

---

## What Is Not a Human Intervention

Do not create a human intervention file for ordinary interaction, such as:

- asking for progress;
- asking for clarification;
- asking where a file is;
- asking the agent to summarize current status;
- asking the agent to pause temporarily;
- asking the agent to show logs;
- asking a factual question about the current run;
- asking for a non-direction-changing explanation.

These messages may be answered directly.

If useful, update no files. If the answer reveals a durable high-value insight, it may be added to `research_trajectory/notes/NOTES.md`, but only if it satisfies the notes policy in `instructions/EXECUTION_AGENT.md`.

---

## What Counts as a Human Intervention

Create an intervention when the user message changes or constrains the research process.

Examples:

- correcting the research direction;
- changing the current plan;
- rejecting a method;
- adding a constraint;
- changing target venue;
- changing contribution framing;
- invalidating a result or claim;
- telling the agent to stop using a resource, method, dataset, or assumption;
- requesting a major pivot.

Decision test:

Does this message change what the research system should believe, do, avoid, prioritize, or target?

If yes, it is a formal human intervention.
If no, it is ordinary interaction.

---

## Intervention Handling Steps

When a formal intervention arrives:

1. Pause the current research action if safe.
2. Create a new file under `research_trajectory/human_interventions/` with the next ID, such as `I0001_change_target_venue.md`.
3. Update `research_trajectory/human_interventions/INDEX.md`.
4. Update `research_trajectory/STATE.md` with the current effective consequence.
5. Update the active trial `PLAN.md`, `REPORT.md`, or relevant `reviews/*_REVIEW.md` file if the intervention affects it.
6. Update `research_trajectory/CURRENT_FINDINGS.md` if any finding, claim, evidence status, or limitation changes.
7. Update `manuscript/BLUEPRINT.md` or `manuscript/figures/FIGURE_SPECS.md` if manuscript-facing implications changed.
8. Continue only under the updated state.

Do not delete old intervention files. They are an audit trail.

---

## Pending Human Interventions

External tools or a UI may write pending intervention drafts to:

`research_trajectory/human_interventions/pending/`

Before major steps, the execution agent should check this folder.

If a pending message is a formal human intervention, process it into the official intervention index.
If it is ordinary interaction, answer it without creating an intervention file.
