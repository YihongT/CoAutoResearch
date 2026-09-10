<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo.svg">
    <img src="assets/logo-white.svg" width="88" alt="CoAutoResearch logo">
  </picture>
</p>

<h1 align="center">CoAutoResearch</h1>

<p align="center"><strong>An autonomous research partner you can question, guide, and build with.</strong></p>

CoAutoResearch brings autonomous investigation and human–AI collaboration into one research workflow. Define a question, discuss emerging findings, guide the next step, and build a manuscript from evidence you can trace.

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#features">Features</a> ·
  <a href="#example-papers">Example papers</a> ·
  <a href="https://yihongt.github.io/CoAutoResearch/">Documentation</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-d7b775" alt="License: Apache 2.0"></a>
  <a href="https://yihongt.github.io/CoAutoResearch/"><img src="https://img.shields.io/badge/docs-get_started-737269" alt="Documentation"></a>
</p>

![CoAutoResearch research workspace with recorded findings and research controls.](assets/workspace.png)

*Digits example: recorded findings, evidence, and limitations. Cropped from the live dashboard.*

## News

- **2026-09-09** — Added [Digits and Ising example papers](#example-papers), research recovery improvements, and stronger paper-generation checks.
- **2026-09-07** — The 2.0 source update adds parallel research discussion, clearer research controls, and in-product paper generation.

[Changelog](CHANGELOG.md) · [Published releases](https://github.com/YihongT/CoAutoResearch/releases)

## Features

**Discuss and guide.** Question a finding, discuss an alternative in a parallel chat, and send the suggestions you choose into the research session.

**Run autonomous research.** Let the agent plan, execute, interpret, and review research iterations within your brief. Follow progress, pause to reconsider, and resume when ready.

**Trace findings to evidence.** Keep proposals, observations, reviewed results, and limitations distinct as the research develops.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/co-auto-dark.svg">
  <img src="assets/co-auto-light.svg" alt="Human direction guides autonomous research through reviewed and sent suggestions. Findings return to the researcher and accumulate in a shared record supporting the next question, manuscript, and paper.">
</picture>

Use your existing **Codex or Claude Code** login in an open-source browser workspace. Start from a question, a proposal, or existing work. Keep the research direction, discussions, evidence, and writing together as the project develops.

## Quick start

Give your coding agent this instruction:

```text
Set up and launch CoAutoResearch from
https://github.com/YihongT/CoAutoResearch.
Follow docs/agent-setup.md, reuse my existing coding-agent login,
configure paper generation, verify the setup, and open the dashboard.
```

Setup reuses your **Codex or Claude Code** authentication and checks dashboard and paper-tool readiness separately. Complete any interactive provider login yourself. Model access and usage limits depend on your account; research may need additional scientific dependencies.

<details>
<summary>Manual setup from source</summary>

You need Node.js 20+, Python 3.10+, Git, and an installed, authenticated Codex or Claude Code CLI.

```bash
git clone https://github.com/YihongT/CoAutoResearch.git
cd CoAutoResearch
node bin/auto-research.js doctor
node bin/auto-research.js ui
```

Open the printed URL and keep the server terminal running. The dashboard has no application dependencies or build step. Use `--projects-dir /path/to/projects` to choose where research projects live.

PDF generation additionally needs Python 3.12+, four pinned scientific skills, LaTeX, and Poppler. Follow the [agent setup guide](docs/agent-setup.md) for installation and verification. You can use this source checkout without an npm release.

</details>

Your first session: **create a project → send a research brief → review the direction → Start autoresearch**. Include your question, available materials, resource budget, and any decisions that need your approval. Creating a project alone does not start research.

[First-run guide →](https://yihongt.github.io/CoAutoResearch/getting-started.html)

## How it works

Each **Trial** is a focused research iteration: plan the work, execute it, interpret the evidence, and submit the result to the applicable checks. The service records accepted changes and determines whether to continue, pause, or request a human decision.

You can discuss findings in a parallel chat while research runs. **Add to research draft** prepares a suggestion; review and send it when you want it to guide the main research. Discussion alone does not change research files.

**Pause after current turn** requests a stop at an agent-turn boundary, which can fall inside an unfinished Trial. **Resume autoresearch** continues from the retained state. Follow recorded results and open questions in **Manuscript**.

[Research controls and workflow →](https://yihongt.github.io/CoAutoResearch/walkthrough.html)

<details>
<summary>Explore the system architecture</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/_static/diagrams/architecture-dark.svg">
  <img src="docs/_static/diagrams/architecture.svg" alt="The browser communicates with a local service that supervises coding agents, maintains the research record, and coordinates parallel discussion and paper generation.">
</picture>

The research record connects directions, resources, results, reviews, and manuscript content. Technical contracts separate proposed work from recorded changes and support recovery after interruptions. Internal review is a workflow check, not external peer review or proof of scientific correctness.

[Architecture and lifecycle](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html)

</details>

## Example papers

Two research drafts generated through the dashboard from recorded project evidence.

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="docs/_static/examples/digits-paper.pdf"><img src="docs/_static/examples/digits-preview.png" width="360" alt="First page of the Digits report on covariance shrinkage in linear discriminant analysis"></a>
      <p><strong>Digits · Statistical learning</strong></p>
      <p>Covariance shrinkage for small-sample handwritten-digit classification.</p>
    </td>
    <td width="50%" valign="top">
      <a href="docs/_static/examples/ising-paper.pdf"><img src="docs/_static/examples/ising-preview.png" width="360" alt="First page of the Ising report on critical-temperature estimation and implementation diagnostics"></a>
      <p><strong>Ising · Statistical physics</strong></p>
      <p>Critical-temperature estimation and implementation diagnostics under a CPU budget.</p>
    </td>
  </tr>
  <tr>
    <td><a href="docs/_static/examples/digits-paper.pdf"><strong>Read paper · 11 pages</strong></a></td>
    <td><a href="docs/_static/examples/ising-paper.pdf"><strong>Read paper · 10 pages</strong></a></td>
  </tr>
</table>

Generated through CoAutoResearch in developer-operated evaluations. These research
drafts include human intervention and retain their limitations. Human scientific
review is required before publication. [About the papers →](https://yihongt.github.io/CoAutoResearch/example-papers.html)

**From your findings to a paper.** Once reviewed results are recorded and project agents are idle, choose **Generate paper**, select a general report or target venue, and check the writing model. The internal agent uses four scientific skills—writing, visualization, citations, and venue templates—to build from a frozen evidence snapshot without running new experiments.

Open **Paper** to zoom, scroll, and download the PDF and source. A previous draft remains available while its replacement is generated. [Paper setup and generation →](https://yihongt.github.io/CoAutoResearch/paper-generation.html)

## Documentation

| Start using it | Understand and extend it |
|---|---|
| [Setup](https://yihongt.github.io/CoAutoResearch/agent-setup.html) · [Walkthrough](https://yihongt.github.io/CoAutoResearch/walkthrough.html) | [Architecture](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html) · [CLI](https://yihongt.github.io/CoAutoResearch/cli.html) |
| [Paper generation](https://yihongt.github.io/CoAutoResearch/paper-generation.html) · [FAQ](https://yihongt.github.io/CoAutoResearch/faq.html) | [Platforms](https://yihongt.github.io/CoAutoResearch/platforms.html) · [Remote access](https://yihongt.github.io/CoAutoResearch/remote-server.html) · [Upgrades](https://yihongt.github.io/CoAutoResearch/upgrading.html) |

## Community

Share reproducible bugs and feature requests through [Issues](https://github.com/YihongT/CoAutoResearch/issues). Contributions to the product, documentation, and carefully documented research examples are welcome: read [Contributing](CONTRIBUTING.md), [Code of conduct](CODE_OF_CONDUCT.md), and [Security](SECURITY.md).

<details>
<summary>Cite CoAutoResearch</summary>

If you use CoAutoResearch in research, cite the software and record the version or commit used.

```bibtex
@software{coautoresearch,
  title = {CoAutoResearch},
  author = {CoAutoResearch contributors},
  url = {https://github.com/YihongT/CoAutoResearch}
}
```

</details>

Licensed under [Apache 2.0](LICENSE). Upstream tools and skills retain their own licenses and attribution requirements.

Contact: [yihong.tang@mail.mcgill.ca](mailto:yihong.tang@mail.mcgill.ca)
