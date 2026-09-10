# CoAutoResearch

**An autonomous research partner you can question, guide, and build with.**

An open-source research system built around your coding agent, with a browser
workspace for autonomous investigation, ongoing discussion, and paper generation.

CoAutoResearch brings autonomous investigation and human–AI collaboration into
one research workflow. Define a question, discuss emerging findings, guide the
next step, and build a manuscript from evidence you can trace.

## Start here

| You want to… | Start with |
|---|---|
| Set up the system using your coding agent | [Getting started](getting-started.md) |
| Understand the first research session | [Workflow walkthrough](walkthrough.md) |
| Read product-generated research drafts | [Example papers](example-papers.md) |
| Turn recorded findings into a PDF | [Paper generation](paper-generation.md) |
| Inspect or extend the system | [Architecture and lifecycle](conceptual-framework.md) |

Setup reuses your Codex or Claude Code login and checks dashboard and paper-tool
readiness separately. Creating a project does not start research: send your
brief, review the direction, and choose **Start autoresearch** when ready.

## Co + Auto

```{image} ../assets/co-auto-light.svg
:alt: Human direction, autonomous research and a shared evidence record.
:class: co-diagram-light
```

```{image} ../assets/co-auto-dark.svg
:alt: Human direction, autonomous research and a shared evidence record.
:class: co-diagram-dark
```

**Co — Research together.** Discuss a finding while the agent works. Prepare a
suggestion, review it, and send it into the research session.

**Auto — Keep research moving.** The agent plans, executes, interprets and reviews
bounded research steps within your direction and constraints.

**Research — Build on evidence.** Follow the question, results, limitations and
remaining decisions through a shared research record and into a manuscript.

## Example papers

[Read the Digits and Ising papers](example-papers.md): small-sample statistical
learning and computational statistical physics. Each PDF was generated through
the dashboard from recorded project evidence. These developer-operated runs
include human intervention; their scientific limitations remain in the papers.

```{toctree}
:caption: Get started
:maxdepth: 1

getting-started
agent-setup
walkthrough
example-papers
best-practices
paper-generation
faq
```

```{toctree}
:caption: Using the system
:maxdepth: 1

cli
multiple-projects
remote-server
platforms
upgrading
```

```{toctree}
:caption: Technical reference
:maxdepth: 1

conceptual-framework
```
