# Concepts

CoAutoResearch is a human-centered research loop. The agent can do substantial
work, but the human remains responsible for direction, claims, evidence, and
revision.

## Research Loop

```{mermaid}
flowchart TD
  H["Human brief or intervention"] --> P["PROJECT.md<br/>research direction"]
  P --> S["STATE.md<br/>current objective"]
  S --> T["Trial<br/>one coherent work package"]
  T --> PL["PLAN.md"]
  PL --> PR["reviews/PLAN_REVIEW.md"]
  PR --> RS["Resource Scout decision/report<br/>when required"]
  RS --> W["Execute in workspace/"]
  W --> RP["REPORT.md"]
  RP --> RA["Reviewer Scope Analyst decision"]
  RA --> RV["reviews/*_REVIEW.md<br/>eight core reviewer files"]
  RP --> F["CURRENT_FINDINGS.md<br/>claims and evidence"]
  F --> M["Manuscript / deliverable<br/>human can defend and revise"]
  M --> S

  H -. "redirect scope, method, claim, venue, or priority" .-> S
  H -. "formal intervention recorded" .-> T

  classDef human fill:#111411,color:#fffdf6,stroke:#111411;
  classDef truth fill:#f4f7ef,stroke:#9aac9b,color:#20231f;
  classDef trial fill:#fffdf7,stroke:#d8cfbd,color:#20231f;
  classDef output fill:#edf3f6,stroke:#9bb4c2,color:#20231f;

  class H human;
  class P,S,F truth;
  class T,PL,PR,RS,RA,RV,W,RP trial;
  class M output;
```

## What the Diagram Means

- The loop is linear enough for a human to follow.
- Every substantive work package gets a plan, report, Resource Scout brief,
  Reviewer Scope Analyst decision, and eight core review files.
- Claims become current only when reflected in findings and evidence records.
- Human intervention is not an afterthought; it is part of the control system.
- The output should be something the human can understand, defend, and revise.

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
