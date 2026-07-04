# Concepts

CoAutoResearch is a human-centered research loop. The agent can do substantial
work, but the human remains responsible for direction, claims, evidence, and
revision.

## Research Loop

```{mermaid}
flowchart TD
  H["Human brief or intervention"] --> P["PROJECT.md<br/>research direction"]
  P --> S["STATE.md<br/>current objective"]
  S --> CP["Critical Path<br/>data, method, evaluation, figures, pack"]
  S --> T["Trial<br/>one coherent work package"]
  T --> PL["PLAN.md"]
  PL --> PR["reviews/PLAN_REVIEW.md"]
  PR --> RS["Resource Scout decision/report<br/>when required"]
  RS --> W["Execute in workspace/"]
  W --> RP["REPORT.md"]
  RP --> RA["Reviewer Scope Analyst decision"]
  RA --> RV["reviews/*_REVIEW.md<br/>eight core reviewer files"]
  RP --> F["CURRENT_FINDINGS.md<br/>claims and evidence"]
  F --> PP["PAPER_PLAN.md<br/>obligations and blockers"]
  PP --> BP["BLUEPRINT.md<br/>real full-results handoff"]
  BP --> M["Export gate<br/>Paper Pack or Status Pack"]
  M --> S

  H -. "redirect scope, method, claim, venue, or priority" .-> S
  H -. "formal intervention recorded" .-> T
  CP -. "bottleneck target" .-> T

  classDef human fill:#111411,color:#fffdf6,stroke:#111411;
  classDef truth fill:#f4f7ef,stroke:#9aac9b,color:#20231f;
  classDef trial fill:#fffdf7,stroke:#d8cfbd,color:#20231f;
  classDef output fill:#edf3f6,stroke:#9bb4c2,color:#20231f;

  class H human;
  class P,S,CP,F truth;
  class T,PL,PR,RS,RA,RV,W,RP trial;
  class PP,BP,M output;
```

## What the Diagram Means

- The loop is linear enough for a human to follow.
- Every substantive work package gets a plan, report, Resource Scout brief,
  Reviewer Scope Analyst decision, and eight core review files.
- `STATE.md` contains a Critical Path table. Trials target the current
  bottleneck instead of drifting into bookkeeping.
- Claims become current only when reflected in findings and evidence records.
- Human intervention is not an afterthought; it is part of the control system.
- The output should be something the human can understand, defend, and revise.

## Critical Path Control

Critical Path items are the dependencies required for a real deliverable: data,
methods, evaluation, analysis results, figures, tables, manuscript assembly, and
final export readiness. Bookkeeping can support those dependencies, but it is
not itself a bottleneck.

If a research-critical resource is missing, the Resource Scout must work through
the acquisition/substitution ladder: user-provided ongoing work, local caches,
official download, alternate official year/version, alternate public dataset,
scope-downgrade proposal, then a concrete human request. Once that ladder is
exhausted for the active bottleneck, remaining audits or cleanup do not justify
continuing the loop.

## Manuscript Deliverables

The manuscript handoff has two artifacts:

| Artifact | Purpose |
| --- | --- |
| `manuscript/PAPER_PLAN.md` | Always-current venue-format plan, evidence obligations, planned displays, and blockers. |
| `manuscript/BLUEPRINT.md` | Exportable full-results manuscript blueprint containing only real, source-backed sections, results, figures, tables, references, and provenance. |

Before results exist, `BLUEPRINT.md` is only a stub that points to the plan and
Critical Path. The UI labels that state as a paper plan or research status, not
a paper-writing handoff. The Paper-Writing Pack is available only when the
blueprint is non-stub, complete, and free of blocking missing evidence.

## Control Surfaces

| Surface | What it controls |
| --- | --- |
| `PROJECT.md` | Overall direction, scope, audience, and constraints. |
| `STATE.md` | Current objective, active plan, blockers, and reviewer gate state. |
| Human interventions | Explicit changes to scope, claim, venue, method, or priority. |
| Reviewer gates | Plan, process, evidence, venue fit, manuscript, figure/table, reference, and final-gate checks. |

Autoresearch stops only after strict reviewer pass. A completed trial, approved
plan, plausible venue fit, coherent manuscript architecture, or targeted
revision-ready draft is progress, not final pass.

## Why This Matters

The system is not optimized for autonomous output at all costs. It is optimized
for research ownership: the human should be able to explain why a claim exists,
where the evidence came from, which alternatives were rejected, and what work
remains open.
