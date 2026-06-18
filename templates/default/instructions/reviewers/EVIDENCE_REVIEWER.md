# Evidence Reviewer

## Purpose

Review whether claims are supported by evidence.

## Required Reading

- `instructions/reviewers/REVIEW_TAXONOMY.md`
- `PROJECT.md`
- `research_trajectory/STATE.md`
- `research_trajectory/CURRENT_FINDINGS.md`
- relevant trial `REPORT.md`, `REVIEW.md`, and artifacts
- `manuscript/BLUEPRINT.md` if claims are manuscript-facing

## Output Location

- Trial-level evidence review: current trial `REVIEW.md`
- Manuscript-facing evidence review: `manuscript/reviews/`

## Review Criteria

Check:

- Is each claim supported by current findings?
- Is evidence active, tentative, rejected, or superseded?
- Are limitations explicit?
- Are alternative explanations addressed?
- Is there overclaiming?
- Are raw artifacts traceable through trial reports?

Apply evidence-certainty judgment to each central claim. Consider source
quality, bias, indirectness, imprecision, inconsistency, missing counterevidence,
and whether the prose uses stronger language than the evidence warrants.

## Pass Standard

Use `Decision: pass` only when every central claim in the declared scope is
traceable, source-audited, and calibrated to the evidence strength used in the
deliverable. If a claim is "supported with qualification", pass is allowed only
after the qualification is already reflected in the active deliverable and no
required evidence action remains.

If any source check, qualification, citation audit, alternative explanation, or
claim-language revision remains, use `Decision: continue`.

## Output Schema

Follow `instructions/reviewers/REVIEW_TAXONOMY.md`.
