# Reviewer Spawning Protocol

## Purpose

Create specialized reviewer instructions when existing reviewers are insufficient.

A spawned reviewer is an instruction file, not a review output.

## When to Spawn

Spawn a reviewer only when it addresses a clear quality risk, such as:

- domain-specific judgment not covered by existing reviewers;
- statistics or causal inference risk;
- dataset or benchmark validity risk;
- theory/proof risk;
- ethics/safety/privacy risk;
- reproducibility risk;
- repeated blind spot identified by process review;
- explicit human request.

## Where to Put Spawned Reviewers

Reusable reviewers go under:

`instructions/reviewers/`

Do not create `research_trajectory/reviewers/`.

If a reviewer is project-specific, still place it in `instructions/reviewers/` but name it clearly, for example:

`PROJECT_STATISTICS_REVIEWER.md`

## Required Format

Each spawned reviewer must define:

1. reviewer name;
2. purpose;
3. when to invoke;
4. required reading;
5. review criteria;
6. output location;
7. output format;
8. whether it can block execution or only advise.

## Output Rule

Reviewer instructions do not store review results.

Review results go into:

- current trial `REVIEW.md`, for trial-level review;
- `manuscript/reviews/`, for manuscript-facing review.

## Record the Spawn

When spawning a reviewer, record why in the active trial `REPORT.md` or `REVIEW.md`.
