# Review Taxonomy

## Purpose

Use this shared taxonomy for every reviewer. It is intentionally general so it
can support different domains, methods, and target venues.

The taxonomy draws on mature review patterns: journal peer review, grant
review, critical appraisal, evidence-certainty assessment, transparency
guidelines, artifact review, reporting checklists, and reviewer ethics.

## Core Dimensions

Review only the dimensions relevant to the reviewer role, but do not lower the
standard because the work is early.

1. Importance / fit: the work addresses the project goal, audience, venue, or
   decision need.
2. Novelty / contribution: the contribution is distinct from existing work and
   stated at the right level.
3. Rigor / approach: methods, reasoning, analyses, plans, or synthesis steps can
   support the goal.
4. Evidence certainty / claim calibration: claims are supported at the strength
   used in prose and do not overstate evidence.
5. Traceability / reproducibility: sources, data, code, artifacts, decisions, and
   provenance can be followed by another agent or human.
6. Ethics / risk / integrity: safety, privacy, bias, conflicts, misuse,
   publication ethics, and misleading communication risks are handled.
7. Communication / deliverable quality: outputs are clear, self-contained, and
   useful for the intended audience.
8. Deliverable completeness: final-facing artifacts include the expected
   format, organization, claim/evidence map, figures, tables, references,
   appendix/supplement posture, limitations, and target-venue rationale for the
   declared scope.
9. Readiness / blocking issues: all required actions are resolved for the
   declared scope.

## Canonical Decisions

Use only these decisions in reviewer outputs:

- `pass`: strict pass for the declared scope.
- `continue`: useful progress, but at least one required action, unresolved
  qualification, unassessed critical area, or blocking uncertainty remains.
- `blocked`: progress cannot continue without resolving a non-human blocker
  such as missing files, broken tooling, or inaccessible required resources.
- `needs_human`: a human decision or clarification is genuinely required.

Do not use `approved`, `completed`, `ready`, `plausible`, `acceptable`,
`architecture pass`, or `targeted revision ready` as reviewer decisions. If
those ideas matter, put them under `Qualified / partial passes` and keep
`Decision: continue`.

## Output Schema

Every reviewer output must use this schema:

```markdown
Reviewer: <reviewer name>
Scope: <plan / trial / evidence / venue / manuscript / figure-table / process / final-gate / other>
Decision: <pass / continue / blocked / needs_human>
Gate impact: <pass / continue / blocked / needs_human>
Confidence: <high / medium / low>
Source trial: <research_trajectory/trials/<trial_id>/, or none>
Generated at: <ISO 8601 timestamp>
Instruction file: <instructions/reviewers/<REVIEWER>.md>
Reviewed inputs:
- <explicit file path>
Context summary: <brief summary of what was reviewed and why>
Migration source: <none, legacy REVIEW.md section, backfilled from older reviewer file, or other provenance>

## Blocking Issues

- <none, or concrete blockers>

## Required Actions Before Pass

- <none, or concrete required actions>

## Qualified / Partial Passes

- <things that are acceptable but do not satisfy the whole gate>

## Unassessed Areas

- <critical areas not checked, or none>
```

`Gate impact` must be no stronger than `Decision`. If any blocking issue,
required action, unresolved qualification, or critical unassessed area remains,
`Decision` and `Gate impact` must be `continue`, `blocked`, or `needs_human`,
not `pass`.

Every active trial must have all seven core reviewer files under
`research_trajectory/trials/<trial_id>/reviews/`. A reviewer file can only
support the current gate for its own source trial. Do not carry a pass forward
silently from a previous trial; if content is migrated or backfilled, declare it
in `Migration source` and keep the decision truthful for the reviewed scope.

## Strict Pass Rule

A reviewer may write `Decision: pass` only when all of these are true for the
declared scope:

- no blocking issues remain;
- no required actions before pass remain;
- no unresolved qualification is being treated as accepted;
- no critical area required for the scope is unassessed;
- final-facing artifacts are self-contained enough for a human to inspect,
  defend, and revise without relying on hidden trial logs;
- the output would still be defensible if a skeptical human reviewer inspected
  the cited files and artifacts.

Progress words such as "ready for revision", "architecture is coherent",
"plausible fit", "plan completed", or "evidence supported with qualification"
are not strict pass conditions.
