# Concepts

CoAutoResearch combines autonomous research with continuing human direction.
The agent advances bounded research steps while the researcher can discuss
findings, question conclusions and guide the next move. A shared record connects
those decisions to evidence, limitations and the manuscript.

In v2.0, Markdown remains useful for people, but typed JSON and service-owned
receipts determine control flow. An agent may propose work; it may not publish
its own claims as canonical truth.

## Research Loop

```{mermaid}
flowchart TD
  H["Human brief or intervention"] --> O["Observe coherent canonical revision"]
  O --> T["One bounded trial proposal"]
  T --> S["Stage candidate files and material hash"]
  S --> R["Derive review route and close reviews"]
  R --> M["Service derives merge decision"]
  M --> G["Service evaluates goal gate"]
  G -->|publishable| X["Recoverable transaction"]
  X --> P["Publish receipt + next canonical revision"]
  P --> B["Research Board"]
  B --> O
  G -->|needs_human| H
  G -->|blocked or terminal| B

  classDef human fill:#111411,color:#fffdf6,stroke:#111411;
  classDef truth fill:#f4f7ef,stroke:#9aac9b,color:#20231f;
  classDef trial fill:#fffdf7,stroke:#d8cfbd,color:#20231f;
  classDef output fill:#edf3f6,stroke:#9bb4c2,color:#20231f;

  class H human;
  class O,P,B truth;
  class T,S,R,M,G trial;
  class X output;
```

## What the Diagram Means

- The loop is linear enough for a human to follow.
- Every invocation closes at most one trial boundary.
- Plans, reports, result cards, reviews, and human briefs remain distinct
  proposal or audit artifacts until publication.
- Review level and specialized coverage are derived from the staged material;
  the required reviewer set is not a worker assertion.
- Claims become current only through a merge decision and receipt-backed
  transaction.
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

The dashboard’s **Generate paper** action is a separate writing workflow. It
uses an isolated snapshot of recorded v2 evidence, four scientific skills and
local PDF tools. It does not execute new research. The resulting **Paper** is a
draft with review notes, not confirmation that a venue’s scientific requirements
have been met. See [paper generation](paper-generation.md).

## Collaboration boundary

Auxiliary chats can run alongside the main research session and inspect project
context without writing research files. **Add to research draft** transfers a
suggestion into the composer. The user reviews and sends it before it becomes
an instruction to the main research process. This preserves the distinction
between exploring an idea in conversation and applying it to research.

## Control Surfaces

| Surface | What it controls |
| --- | --- |
| `PROJECT.md` | Overall direction, scope, audience, and constraints. |
| `STATE.json` and typed line/campaign files | Service-owned current objective, executable bottleneck, claims, and readiness. |
| Markdown companions | Human-readable projections and legacy history; never a v2 control-flow bypass. |
| Human interventions | Explicit changes to scope, claim, venue, method, or priority. |
| Review manifest and reviewer outputs | Material-bound review closure at light, standard, full, or final level. |
| Goal gate and publish receipt | Derived stop/continue truth and proof of canonical publication. |

Gate states are distinct: `continue`, `pass`, `needs_human`, `blocked`,
`paused_budget`, `no_viable_line`, and `killed_by_human`. A completed trial,
approved plan, plausible venue fit, coherent manuscript architecture, or
targeted revision-ready draft is progress, not final pass.

## Compatibility

V1 projects remain readable without pretending their Markdown history is a v2
publication. The UI labels the synthesized board and trial cards as legacy,
uses the fixed-eight reviewer fallback, and keeps canonical revision unset.
Migration is additive, backup-first, idempotent, and reversible while no newer
v2 work depends on it.

## Research ownership

The shared record supports research ownership: the human should be able to explain why a claim exists,
where the evidence came from, which alternatives were rejected, and what work
remains open.
