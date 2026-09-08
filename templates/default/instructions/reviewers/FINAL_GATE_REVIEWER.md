# Final Gate Reviewer

## Purpose

Perform the strict final human-defensibility review of the exact candidate stage when the proposed Goal Gate is `pass`.

## Phase and output

- Phase: `final`.
- Reviewer key/scope: `final_gate` / `final_gate`.
- Bind to the exact final stage ID/hash.
- This reviewer is required only at Final review level and cannot be omitted.

## Required reading

- `instructions/reviewers/REVIEW_TAXONOMY.md` and all core/specialized reviewer
  outputs for the same stage hash;
- Project and formal interventions;
- current and candidate State, Findings, Human Tasks, lines, campaigns, venue state, manuscript control files;
- Plan, Expert Route, Report, Result Cards, artifacts, Merge Request, Human Brief, Gate Evidence;
- transaction/stage validation summary;
- final deliverable and export posture;
- relevant resources, notes, and instruction patches that affect final claims.

## Final readiness criteria

### Research-line readiness

- The candidate post-merge projection contains exactly one active line with status `candidate_final`.
- Thesis, contribution, claim hierarchy, scope boundary, supporting cards, limiting cards, conflicts, exclusions, and kill criteria are explicit.
- No material contradiction is hidden or unresolved.
- The final line remains defendable under the target audience/venue.

### Campaign readiness

- Every required component is `passed`, `waived_with_rationale`, or `not_applicable`.
- Waivers have human/project authority and do not disguise missing central evidence.
- No component is merely planned, tentative, partial, in progress, or blocked.

### Evidence readiness

- Every key claim maps either to already published accepted/qualified cards or to current-trial proposed cards explicitly requested for `accept`/`accept_with_qualification` in the exact Merge Request.
- Current-trial proposed cards are reviewed for **eligibility** before merge; this reviewer must not pretend they are canonically accepted before the service Merge Decision exists.
- Evidence paths/hashes/provenance are valid.
- Negative and limiting evidence is visible in findings, line, manuscript, and Human Brief where material.
- Claim strength matches evidence certainty.
- Reproducibility/audit trail is adequate for the declared deliverable.

### Process and canonical integrity

- Record the Resource Scout status and verify that required acquisition,
  substitution, inspection, and provenance work closed coherently.
- Record the Reviewer Scope Analyst status and verify that every required
  specialized reviewer is present, exact-stage bound, and passing.
- The exact stage passed every required core and specialized reviewer.
- No reviewer is stale, missing, revise, blocked, or needs-human.
- Protected-path guard, schema validation, JSON/Markdown consistency, base revision, and transaction-preflight checks pass.
- The agent did not self-publish a Merge Decision, Goal Gate, revision, or receipt.

### Venue and deliverable readiness

- Target venue constraints and evidence standards are satisfied when applicable.
- The active venue profile cites current inspected official venue or publisher guidance for the exact article type; a draft, inferred, stale, or unverified profile cannot pass.
- Every installed domain pack required by the project, venue, claims, or risks is routed, and every unavailable required specialization is an explicit blocker or claim limitation.
- Manuscript/deliverable architecture is coherent and free of reader-facing placeholders.
- Figures/tables/references are complete for the declared scope.
- Appendix, supplement, artifact, limitations, ethics/safety, and availability posture are explicit.

## Artifact Consistency Audit

Before passing, reconcile the candidate and published state across `STATE`,
`CURRENT_FINDINGS`, active/candidate lines, campaigns, Human Tasks, target venue,
`manuscript/PAPER_PLAN.md`, `manuscript/BLUEPRINT.md`, the final deliverable,
review outputs, Merge Request, Human Brief, and Gate Evidence. The audit includes
paragraph plan completeness, claim/evidence/result mapping, references,
appendix/supplement posture, and every active display. An active table requires a
publication-ready Markdown table body; a column list, row description,
comparison plan, or source link is not a finished table.

For a manuscript-facing final candidate, the audit also verifies compact
reader-facing section briefs, local claim/evidence/result explanations, and
reader takeaways for every inline figure, table, algorithm, dataset, benchmark,
and result block. It explicitly checks artifact/section boundary integrity:
`Result`, `Dataset`, `Benchmark`, `Metric`, and `RSLT...` headings must use
artifact fields rather than section-planning fields.

The canonical v2 output is `reviews/final_gate.json` with checked Markdown at
`reviews/final_gate.md`. A v1 trial retains its canonical legacy output at
`reviews/FINAL_GATE_REVIEW.md`; migration must not silently relabel that review
as a v2 stage-bound decision.

### Human ownership readiness

The reviewed Human Brief clearly states:

- what was established;
- what was not established;
- major uncertainty and limitations;
- the final research line and evidence;
- remaining optional next work;
- any decision the human should make after delivery.

The brief must be understandable without reading hidden logs or all reviewer files.

### No hidden next blocker

- Critical Path has no open blocker required for the declared deliverable.
- No medium/high-value required move remains that could reasonably change the central claim or resolve a blocking readiness risk.
- Optional future research is distinguished from required completion work.

## Pass Standard

The shared strict pass rule in
`instructions/reviewers/REVIEW_TAXONOMY.md` applies. Final pass additionally
requires every final-readiness criterion and every required reviewer for the
exact stage to pass with no hidden next blocker.

## Decision rules

- `pass`: every final-readiness criterion is met and all other reviewers for the exact stage pass.
- `revise`: any final requirement remains incomplete, inconsistent, unreviewed, or overstated.
- `blocked`/`needs_human`: allowed only under shared strict semantics; a pass proposal must then be withdrawn.

A Final Gate review without an artifact consistency audit, stage-hash check, campaign/line check, and Human Brief check is incomplete.

## Decision scope

A `pass` means only that the exact structured candidate passed the configured automated checks. It is not a claim of factual correctness, novelty, independent peer review, editorial acceptance, regulatory compliance, certification, or formal submission readiness. Those determinations remain explicit human decisions after reviewing the evidence package.
