# Reviewer Scope Analyst Protocol

## Purpose

The Reviewer Scope Analyst is a required trial-local subagent that decides
whether the eight core reviewers cover the current trial's review risks.

It is not a core reviewer and does not add a ninth gate line. It produces a
decision artifact before the core reviewer refresh. If specialized review is
needed, it either reuses an existing reviewer instruction or creates a new one
under `instructions/reviewers/`, then ensures the specialized review output is
written before the eight core reviewers run.

## When To Use

After every substantive trial `REPORT.md` is written and before refreshing the
eight core reviewers, the main execution agent must:

`spawn a Reviewer Scope Analyst subagent to decide whether the eight core reviewers cover the current trial's review risks`

Prefer a real Reviewer Scope Analyst subagent when the runtime supports it. If
subagent orchestration is unavailable, stalls, or fails, complete the same scope
analysis inline as a clearly labeled `Reviewer Scope Analyst fallback`, write
the decision file, disclose the fallback in `REPORT.md`, and continue. Do not
set the gate to `blocked` or `needs_human` solely because Reviewer Scope Analyst
orchestration failed. `blocked` and `needs_human` are whole-loop hard stops, not
reviewer-scope-local outcomes.

If a human answer would help reviewer coverage but useful review or execution
work can continue, report it as a `Human Task Candidates` entry in the decision
artifact for the main execution agent to merge, and keep the gate
`Status: continue`. Do not edit `research_trajectory/HUMAN_TASKS.md` directly.
Only hard stop when no meaningful non-human work remains in the whole
autoresearch loop.

## Required Inputs

The Reviewer Scope Analyst subagent must read:

- `AGENTS.md`
- `PROJECT.md`
- `research_trajectory/STATE.md`
- `research_trajectory/CURRENT_FINDINGS.md`
- current trial `PLAN.md`
- current trial `REPORT.md`
- current trial artifacts
- current trial `artifacts/resource_scout/RESOURCE_SCOUT_REPORT.md`, when present
- `instructions/reviewers/REVIEWER_SPAWNING.md`
- `instructions/reviewers/REVIEW_TAXONOMY.md`
- existing files under `instructions/reviewers/`

## Required Output

Write the decision artifact to:

`research_trajectory/trials/<trial_id>/artifacts/reviewer_spawn/REVIEWER_SPAWN_DECISION.md`

Use this exact decision skeleton:

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

## Decision Rules

Use `Spawn needed: yes` when the current trial has a clear quality risk that the
eight core reviewers do not cover sufficiently, including:

- domain-specific judgment;
- statistics, causal inference, uncertainty, or power-analysis risk;
- dataset, benchmark, annotation, or evaluation-validity risk;
- theory, proof, or formal-methods risk;
- ethics, safety, privacy, governance, or dual-use risk;
- reproducibility, environment, dependency, or artifact-portability risk;
- a repeated blind spot identified by process review;
- an explicit human request for a specialized review perspective.

Use `Spawn needed: no` only when the eight core reviewers are sufficient for the
trial's actual risks. The reason must state why no specialized perspective is
needed.

## If Specialized Review Is Needed

1. Check existing files under `instructions/reviewers/` first.
2. Reuse an existing specialized reviewer when it fits.
3. If no reviewer fits, create a project-specific reviewer instruction under
   `instructions/reviewers/`, for example:
   - `PROJECT_STATISTICS_REVIEWER.md`
   - `PROJECT_ETHICS_PRIVACY_REVIEWER.md`
   - `PROJECT_BENCHMARK_VALIDITY_REVIEWER.md`
4. The spawned reviewer instruction must follow
   `instructions/reviewers/REVIEWER_SPAWNING.md` and
   `instructions/reviewers/REVIEW_TAXONOMY.md`.
5. Run the specialized review before the eight core reviewers and write the
   result to:

`research_trajectory/trials/<trial_id>/reviews/<SPECIALIZED_REVIEW>.md`

## Boundaries

The Reviewer Scope Analyst must not:

- replace any of the eight core reviewer files;
- add a ninth Autoresearch Goal Gate line;
- silently waive a needed specialized review;
- mark the final gate pass;
- edit `research_trajectory/HUMAN_TASKS.md` directly;
- create broad generic reviewer instructions without a current-trial risk.

Process, Evidence, Reference, and Final Gate reviewers must read the decision
artifact. If `Spawn needed: yes`, they must also read the specialized review
output before deciding pass.
