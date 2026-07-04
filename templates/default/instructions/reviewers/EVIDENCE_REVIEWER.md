# Evidence Reviewer

## Purpose

Review whether claims are supported by evidence.

## Required Reading

- `instructions/reviewers/REVIEW_TAXONOMY.md`
- `PROJECT.md`
- `research_trajectory/STATE.md`
- `research_trajectory/CURRENT_FINDINGS.md`
- current trial `PLAN.md`, `REPORT.md`, `reviews/`, and artifacts
- current trial `artifacts/resource_scout/RESOURCE_SCOUT_REPORT.md`, when present
- current trial `artifacts/reviewer_spawn/REVIEWER_SPAWN_DECISION.md`
- specialized review outputs named by the reviewer spawn decision, when present
- `manuscript/BLUEPRINT.md` if claims are manuscript-facing

## Output Location

Write the canonical current-trial evidence review to:

`research_trajectory/trials/<trial_id>/reviews/EVIDENCE_REVIEW.md`

If the review is manuscript-facing, you may also mirror or summarize it under
`manuscript/reviews/`, but the current trial file remains required.

## Review Criteria

Check:

- Is each claim supported by current findings?
- Is evidence active, tentative, rejected, or superseded?
- Are limitations explicit?
- Are alternative explanations addressed?
- Is there overclaiming?
- Are raw artifacts traceable through trial reports?
- For result-dependent deliverables, did the trial produce actual result
  evidence, a negative result, or a documented first blocker?
- If `REPORT.md` says `Empirical progress: yes`, is that supported by a real
  artifact, result, conversion inventory, or `ACQUISITION_DECISION.md` that
  changed evidence/resource state?
- If `REPORT.md` says `Empirical progress: no`, is the lack of empirical
  progress reflected honestly in Critical Path status and next action?
- Do Resource Scout outputs reveal missing evidence, counterevidence,
  benchmark/data gaps, or source-quality issues that should prevent pass?
- Are scout-discovered resources treated as raw inputs until promoted through
  a trial report or canonical findings/state update?
- Does the reviewer spawn decision or any specialized review identify evidence,
  statistics, benchmark-validity, reproducibility, ethics, safety, privacy, or
  domain-specific risks that should prevent pass?

Apply evidence-certainty judgment to each central claim. Consider source
quality, bias, indirectness, imprecision, inconsistency, missing counterevidence,
and whether the prose uses stronger language than the evidence warrants.
Do not treat unexecuted scaffolds, schemas, harnesses, or package contracts as
empirical, model, benchmark, or result evidence.

## Pass Standard

Use `Decision: pass` only when every central claim in the declared scope is
traceable, source-audited, and calibrated to the evidence strength used in the
deliverable. If a claim is "supported with qualification", pass is allowed only
after the qualification is already reflected in the active deliverable and no
required evidence action remains.

If any source check, qualification, citation audit, alternative explanation, or
claim-language revision remains, use `Decision: continue`.

## Output Schema

Follow `instructions/reviewers/REVIEW_TAXONOMY.md`. Include explicit reviewed
input paths for the findings, claim/evidence map, trial report, artifacts, and
manuscript files you assessed. If there is little evidence to assess in the
current trial, still write the file with a scoped judgment and unassessed areas.
