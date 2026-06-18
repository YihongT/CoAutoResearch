---
layout: default
title: Overview
description: Human-centered AI research scaffold with traceable evidence and steerable progress.
---

<section class="hero">
  <h1>Research automation that stays reviewable.</h1>
  <p class="lead">CoAutoResearch helps Codex do substantial research work while keeping the human author in control of direction, evidence, claims, and revision.</p>
  <div class="hero-actions">
    <a class="button primary" href="{{ '/getting-started.html' | relative_url }}">Get started</a>
    <a class="button" href="{{ '/conceptual-framework.html' | relative_url }}">Understand the model</a>
  </div>
</section>

## What It Does

<div class="card-grid">
  <section class="card">
    <h3>Frames the project</h3>
    <p>Turns an initial brief into a canonical <code>PROJECT.md</code> that the human can inspect and revise.</p>
  </section>
  <section class="card">
    <h3>Runs traceable work</h3>
    <p>Organizes research into trials with plans, reviews, reports, artifacts, and accepted findings.</p>
  </section>
  <section class="card">
    <h3>Keeps the author in charge</h3>
    <p>Records formal interventions so scope, claims, methods, and venue choices stay accountable.</p>
  </section>
</div>

## Quick Start

```bash
co-auto-research ui
```

The CLI starts the local UI. If you are not inside an existing generated
project, it opens a dashboard backed by `local-projects/`, where you can create
projects from the sidebar.

## Core Files

| Path | Purpose |
| --- | --- |
| `PROJECT.md` | Canonical project framing and scope. |
| `research_trajectory/STATE.md` | Current objective, plan, blockers, and gate status. |
| `research_trajectory/trials/` | Work packages with plans, reviews, reports, and artifacts. |
| `research_trajectory/CURRENT_FINDINGS.md` | Accepted, tentative, rejected, and open findings. |
| `resources/` | Raw inputs, papers, prior work, datasets, and notes. |
| `manuscript/` | Manuscript-facing blueprint, figure specs, reviews, and deliverables. |

## Common Paths

- New local project: [Getting Started](getting-started.html)
- Return to existing work: [CLI Reference](cli.html#return-to-existing-work)
- Existing folder of projects: [Multiple Projects](multiple-projects.html)
- SSH server use: [Remote Servers](remote-server.html)
- Windows/macOS/Linux notes: [Platform Support](platforms.html)

## Design Principle

The output should not be a black-box artifact. It should be a research trajectory
that the human can understand, defend, and continue.

## Contact

Questions, feedback, or collaboration: <yihong.tang.edu@gmail.com>
