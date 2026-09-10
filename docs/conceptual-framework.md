# Concepts

CoAutoResearch combines autonomous research with continuing human direction.
The agent advances bounded research steps while the researcher can discuss
findings, question conclusions and guide the next move. A shared record connects
those decisions to evidence, limitations and the manuscript.

In v2.0, Markdown remains useful for people, but typed JSON and service-owned
receipts determine control flow. An agent may propose work; it may not publish
its own claims as canonical truth.

## System architecture

```{image} _static/diagrams/architecture.gif
:alt: The browser sends actions to the service, which supervises agents, validates changes and separates discussion from paper writing.
:class: co-diagram-light co-loop-motion
```

```{image} _static/diagrams/architecture-dark.gif
:alt: The browser sends actions to the service, which supervises agents, validates changes and separates discussion from paper writing.
:class: co-diagram-dark co-loop-motion
```

```{image} _static/diagrams/architecture.svg
:alt: The browser sends actions to the service, which supervises agents, validates changes and separates discussion from paper writing.
:class: co-diagram-light co-loop-static
```

```{image} _static/diagrams/architecture-dark.svg
:alt: The browser sends actions to the service, which supervises agents, validates changes and separates discussion from paper writing.
:class: co-diagram-dark co-loop-static
```

Illustrated workflow; timing is schematic. [Static diagram](_static/diagrams/architecture.svg).


The browser sends controls to the local service. The service supervises the
selected coding-agent CLI and records accepted research changes. Discussion
keeps its own history; paper generation uses a separate evidence snapshot.
Research data remains in the configured project folder. Context sent to the
selected model is processed by that provider.

## Research Loop

```{image} _static/diagrams/research-loop-light.gif
:alt: A staged proposal passes required reviews and the service goal gate. Publishable work is recorded; needs-human asks for direction; blocked or terminal stops advancement.
:class: co-diagram-light co-loop-motion
```

```{image} _static/diagrams/research-loop-dark.gif
:alt: A staged proposal passes required reviews and the service goal gate. Publishable work is recorded; needs-human asks for direction; blocked or terminal stops advancement.
:class: co-diagram-dark co-loop-motion
```

```{image} _static/diagrams/research-loop-light.svg
:alt: A staged proposal passes required reviews and the service goal gate. Publishable work is recorded; needs-human asks for direction; blocked or terminal stops advancement.
:class: co-diagram-light co-loop-static
```

```{image} _static/diagrams/research-loop-dark.svg
:alt: A staged proposal passes required reviews and the service goal gate. Publishable work is recorded; needs-human asks for direction; blocked or terminal stops advancement.
:class: co-diagram-dark co-loop-static
```

Illustrated workflow; timing is schematic. [Static diagram](_static/diagrams/research-loop-light.svg).


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

Manuscript preparation uses two artifacts:

| Artifact | Purpose |
| --- | --- |
| `manuscript/PAPER_PLAN.md` | Always-current venue-format plan, evidence obligations, planned displays, and blockers. |
| `manuscript/BLUEPRINT.md` | Exportable full-results manuscript blueprint containing only real, source-backed sections, results, figures, tables, references, and provenance. |

Before results exist, `BLUEPRINT.md` is only a stub that points to the plan and
Critical Path. The UI labels that state as a paper plan or research status, not
ready for paper writing. The Paper-Writing Pack is available only when the
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

## Record validation and repair

Agents write authoritative structured JSON. After the phase write-boundary audit,
the service validates the required bundle and generates missing or inconsistent
registered Markdown views before plan approval or stage freezing. Valid richer
views are retained, and JSON bytes are not rewritten just to format a companion.
Manuscript prose remains a writing task. Approved plans, prior reviews, and
committed stage material remain immutable.

Candidate card destinations and declared conflict resolutions are checked before
review as well as at final merge. An invalid proposal that has not been frozen can
be corrected in the same stage; changed reviewed material still requires a new
stage. Complete current validation findings are passed to the correcting agent,
so a long error list is not silently cut into successive repair attempts. These
checks reduce mechanical repair work; they do not replace scientific review or
guarantee that an agent will produce a correct proposal on its first attempt.

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
