# Cold Start Protocol

## Purpose

Use this protocol when the repository is new, mostly empty, initialized from a UI form, and has no filed prior materials yet.

Cold start is the fallback for a new project with no prior resources, or when the user explicitly wants to start from scratch. If the initial input mentions old repos, datasets, proposals, literature, seed papers, prior work, reviews, or other existing materials, run `instructions/RESOURCE_INTAKE.md` before deciding whether conversion is needed.

---

## Inputs

The user may provide none, one, or many of these:

- a one-line research idea;
- target venue or audience;
- old repo or ongoing work;
- old proposal or partial draft;
- datasets or data-source notes;
- literature or seed papers;
- API keys through local `.env`;
- compute constraints.

Most inputs are optional. If input is missing, create placeholders and mark uncertainty explicitly.

---

## Cold Start Steps

1. Preserve raw user input in `resources/user_input/INITIAL_BRIEF.md`.
2. If the input mentions existing materials, follow `instructions/RESOURCE_INTAKE.md` before framing the project.
3. Check `.env.example` and local environment availability when keys or external services are needed. Never write real secrets into tracked files.
4. If filed resources or user corrections materially affect canonical project state, run `instructions/CONVERSION.md`.
5. Create or update `PROJECT.md`.
6. Create or update `research_trajectory/STATE.md`.
7. Create or update `research_trajectory/CURRENT_FINDINGS.md`.
8. Document initialization or conversion decisions in `research_trajectory/trials/000000_project_conversion/` only when conversion actually runs or a coherent initialization record is needed.
9. Initialize `manuscript/BLUEPRINT.md` only if there is enough information to define a useful manuscript architecture.
10. Commit the initialized scaffold.

---

## Required Initial Trial

Cold start should create this trial when initialization involves conversion, important resource interpretation, or non-trivial decisions:

`research_trajectory/trials/000000_project_conversion/`

This trial records how raw inputs were converted or initialized into the current project state.

Use:

- `PLAN.md` for what will be inspected and initialized;
- `REVIEW.md` for checking whether the conversion is coherent;
- `REPORT.md` for what was created, what remains uncertain, and what should happen next;
- `artifacts/` only for small supporting files produced during conversion.

---

## After Cold Start

The project is ready for normal execution when these files are coherent:

- `PROJECT.md`
- `research_trajectory/STATE.md`
- `research_trajectory/CURRENT_FINDINGS.md`
- `research_trajectory/trials/000000_project_conversion/REPORT.md`

Then continue with `instructions/EXECUTION_AGENT.md`.
