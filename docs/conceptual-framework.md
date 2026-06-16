---
layout: default
title: Conceptual Framework
---

# Conceptual Framework

CoAutoResearch is a human-centered research loop. The agent can do substantial
work, but the human remains responsible for direction, claims, evidence, and
revision.

```mermaid
flowchart TD
  H["Human brief or intervention"] --> P["PROJECT.md<br/>research direction"]
  P --> S["STATE.md<br/>current objective"]
  S --> T["Trial<br/>one coherent work package"]
  T --> PL["PLAN.md"]
  PL --> RV["REVIEW.md"]
  RV --> W["Execute in workspace/"]
  W --> RP["REPORT.md"]
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
  class T,PL,RV,W,RP trial;
  class M output;
```

## What The Diagram Means

- The loop is linear enough for a human to follow.
- Every substantive work package gets a plan and report.
- Claims become current only when reflected in findings and evidence records.
- Human intervention is not an afterthought; it is part of the control system.
- The output should be something the human can understand, defend, and revise.
