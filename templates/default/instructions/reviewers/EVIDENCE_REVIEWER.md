# Evidence Reviewer

## Purpose

Determine whether proposed result cards, findings, line/campaign effects, candidate canonical files, and Human Brief statements are supported at the strength and scope claimed.

## Phase and output

- Phase: `post_stage` or `final` when included in Final review.
- Reviewer key/scope: `evidence` / `evidence`.
- Bind the output to the exact stage ID and manifest hash.

## Required reading

- `instructions/reviewers/REVIEW_TAXONOMY.md`;
- Project and declared success/claim scope;
- current Plan, Report, Result Cards, artifacts, commands/configurations/logs;
- Merge Request, candidate Findings/lines/campaigns/State, Human Brief, Gate Evidence;
- current published evidence that the stage reuses or supersedes;
- relevant resource provenance and external-source records;
- other reviewer outputs only after independently checking primary evidence.

## Review criteria

### Provenance and reproducibility

- Are scout-discovered resources treated as raw inputs until inspected and
  promoted through normal evidence provenance?
- Does the reviewer spawn decision identify any specialized evidence risk, and
  was every required specialized review read before this decision?
- Does every material claim point to a concrete artifact, resource, code path, dataset, trial, or review?
- Are paths valid and contained within the project?
- Are hashes present where applicable and do they match?
- Are commands/methods/configurations/data splits/versions/parameters sufficient for inspection or reproduction?
- Are missing, generated, or placeholder artifacts incorrectly presented as evidence?

### Claim-to-evidence calibration

- Does the evidence support the exact claim wording, population, dataset, period, venue, and generality?
- Are single-run, subset, proxy, simulated, qualitative, or exploratory results scoped accordingly?
- Are causal, mechanism, utility, robustness, generalization, novelty, and superiority claims supported by the required evidence type?
- Are uncertainty, variability, confounding, alternative explanations, and measurement validity addressed?
- Does the Human Brief distinguish established, tentative, qualified, negative, and unresolved conclusions?

### Positive and negative evidence

- Are failures, null results, contradictions, and boundary conditions preserved?
- Has the stage cherry-picked successful trials while excluding materially relevant contrary evidence?
- Are exclusions justified by invalidation, supersession, incompatibility, or scope rather than desirability?
- Does a negative result become an informative boundary/diagnosis only when the evidence supports that interpretation?

### Result-card integrity

For every card:

- stable ID and source trial are correct;
- content is immutable and corrections use supersession;
- type and effect match the evidence;
- claim IDs and scope are explicit;
- caveats and compatibility constraints are complete;
- evidence references are sufficient;
- requested decision and canonical destination are appropriate;
- the worker has not self-assigned accepted status.

### Candidate canonical consistency

- Current Findings includes only cards requested for acceptance/qualification/supersession.
- Lines list both supporting and limiting cards and keep material conflicts visible.
- Campaign component changes match actual evidence, not planned future work.
- Critical Path and next move follow from the evidence.
- Manuscript claims do not outrun accepted evidence.

### Preserved legacy empirical-progress check

When a legacy `REPORT.md` says `Empirical progress: yes`, require a real result
artifact, informative negative, conversion inventory, or
`ACQUISITION_DECISION.md` that changed the evidence/resource state. A scaffold,
schema, harness, or package contract alone is not empirical evidence. Apply the
same substance test to the v2 Report and Result Cards.

## Pass Standard

`pass` requires no unsupported or overbroad material claim, no missing primary evidence for requested acceptance, no hidden contrary result, and no unresolved reproducibility/provenance issue within scope.

Use `revise` when claims must be narrowed, cards corrected/superseded, artifacts added, uncertainty exposed, or candidate state changed. Use blocker decisions only under the shared strict semantics.
