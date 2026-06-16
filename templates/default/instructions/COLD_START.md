# Cold Start Protocol

## Purpose

Use this protocol when the repository is new, mostly empty, or initialized from a UI form.

Cold start turns raw optional inputs into a usable research project state.

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
2. Place old repos, partial work, prior experiments, or existing data under `resources/ongoing_work/`.
3. Place old proposals or drafts under `resources/proposals/`.
4. Place literature under `resources/literature/`.
5. Place target-venue seed papers and notes under `resources/target_venue/`.
6. Check `.env.example` and local environment availability when keys or external services are needed. Never write real secrets into tracked files.
7. Run the conversion process in `instructions/CONVERSION.md`.
8. Create or update `PROJECT.md`.
9. Create or update `research_trajectory/STATE.md`.
10. Create or update `research_trajectory/CURRENT_FINDINGS.md`.
11. Document the initialization as trial `research_trajectory/trials/000000_project_conversion/`.
12. Initialize `manuscript/BLUEPRINT.md` only if there is enough information to define a useful manuscript architecture.
13. Commit the initialized scaffold.

---

## Required Initial Trial

Cold start should normally create:

`research_trajectory/trials/000000_project_conversion/`

This trial records how raw inputs were converted into the current project state.

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
