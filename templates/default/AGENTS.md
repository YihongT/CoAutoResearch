# CoAutoResearch Agent Entry Point

## Mission

Produce research that a human owner can understand, steer, reuse, and defend. Optimize for changes in the project belief state and deliverable readiness, not for more files, more experiments, or more prose.

## Required Route

Before substantive autoresearch work, read in order:

1. `instructions/KERNEL.md`
2. `PROJECT.md`
3. `research_trajectory/STATE.json` and `STATE.md`
4. `research_trajectory/CURRENT_FINDINGS.json` and `CURRENT_FINDINGS.md`
5. `research_trajectory/lines/ACTIVE_LINE.json` when present
6. `research_trajectory/campaigns/INDEX.json` when present
7. `research_trajectory/HUMAN_TASKS.json`
8. pending formal human interventions
9. `resources/target_venue/TARGET_VENUE.json` when present

Then follow `instructions/EXPERT_ROUTER.md` and the selected move playbook.

For project creation, conversion, resource intake, intervention handling, manuscript work, or review, also read the corresponding instruction file named by `KERNEL.md`.

## Core Rule

A trial is one bounded research move that closes one local research question. It is not a miniature paper section and does not have to complete an entire research module. Global completeness is tracked by research lines and campaigns.

## Write Boundary

During an autoresearch invocation, write only to the current trial directory, its staging directory, `workspace/`, permitted resource destinations, note proposals, and instruction patch proposals. Tool and skill scratch files belong under `workspace/tmp/`; never create a project-root `tmp/`, `output/`, or cache directory. Do not directly modify protected canonical state. Proposed canonical changes must be represented in the staged snapshot and merge artifacts. The service publishes validated changes.

## Authority

When sources conflict, use this order:

1. latest formal human intervention;
2. published canonical JSON at the current canonical revision;
3. `PROJECT.md`;
4. published accepted findings, active line, and campaigns;
5. published trial artifacts and merge decisions;
6. notes and inspected resources;
7. archive.

Markdown is the human-readable view. For v2 control flow, validated JSON is authoritative. V1 Markdown remains readable through compatibility logic.

## Legacy project route

When valid v2 machine state is absent, read `LEGACY_AGENTS.md` and
`instructions/LEGACY_EXECUTION_AGENT.md` before operating a v1 project or
legacy trial. Those files preserve the detailed v1 intake, intervention,
review, manuscript, Human Task, note, checkpoint, pause/resume, and trial-loop
contracts. Once valid v2 state exists, this entry point and `KERNEL.md` take
precedence wherever authority or write ownership differs.
