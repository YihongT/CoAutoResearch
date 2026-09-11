<!-- Translation basis is tracked in readme/translations.json. -->
<p align="center"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme-hero-dark.svg">
  <img src="assets/readme-hero-light.svg" width="1200" alt="CoAutoResearch — autonomous research and human–AI collaboration">
</picture></p>

<p align="center"><strong>An autonomous research partner that self-improves recursively and works with you.</strong></p>

<p align="center">Define a question. Run experiments. Discuss findings. Refine the next step.<br>Build a manuscript and paper draft from evidence you can trace.</p>

<p align="center"><a href="#quick-start"><strong>Quick start →</strong></a> · <a href="#features">Features</a> · <a href="#example-papers">Example papers</a> · <a href="https://yihongt.github.io/CoAutoResearch/">Documentation</a></p>

<details>
<summary>🌐 Languages</summary>

<p align="center"><strong>English</strong> · <a href="readme/README.zh-CN.md">简体中文</a> · <a href="readme/README.zh-TW.md">繁體中文</a> · <a href="readme/README.ja.md">日本語</a> · <a href="readme/README.ko.md">한국어</a> · <a href="readme/README.es.md">Español</a><br><a href="readme/README.pt-BR.md">Português brasileiro</a> · <a href="readme/README.fr.md">Français</a> · <a href="readme/README.de.md">Deutsch</a> · <a href="readme/README.ru.md">Русский</a> · <a href="readme/README.ar.md">العربية</a></p>

<p align="center"><sub>These are README translations. The interface and full documentation are in English; agent replies follow your language.</sub></p>

</details>

<p align="center"><a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-d7b775" alt="Apache 2.0"></a> <a href="https://yihongt.github.io/CoAutoResearch/"><img src="https://img.shields.io/badge/docs-get_started-737269" alt="Documentation"></a></p>

<a id="news"></a>

## 📰 News

- **2026-09-11** — [CoAutoResearch v2.0.0](https://github.com/YihongT/CoAutoResearch/releases/tag/v2.0.0) released.

<a id="features"></a>

## ✨ Features

**Discuss while research runs.** Explore ideas in a separate chat. Review and send a suggestion when you want it to guide the research.

**Recursive self-improvement.** Feed recorded results, review feedback and reusable lessons into the next trial. Refine hypotheses, methods and research decisions within your brief and budget; keep negative findings and stop when the evidence calls for it.

**Inspect the evidence.** Follow findings, checks and limitations into a manuscript and a paper draft.

<a href="https://yihongt.github.io/CoAutoResearch/walkthrough.html#screenshots">
<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="assets/browser-tour.png">
  <img src="assets/browser-tour.gif" alt="Digits: Trial → Manuscript → Paper">
</picture>
</a>

Browse a completed Digits project: research records, manuscript and PDF. This edited, cropped browser tour shows existing history, not a new run or actual research speed.

<details>
<summary>Three ways to begin</summary>

**A new question:** “Compare two methods on a small public dataset. Use CPU only, state the budget, and ask before final evaluation.”

**Existing work:** “Read my proposal and attached materials. Identify the next useful experiment and prepare a plan for review.”

**A result to investigate:** “Check whether this finding survives a stronger comparison. Preserve the original results and report limitations.”

</details>

<a id="quick-start"></a>

## 🚀 Quick start

**Supported coding agents:** ✓ Codex CLI · ✓ Claude Code

Give your coding agent this instruction:

```text
Set up and launch CoAutoResearch from
https://github.com/YihongT/CoAutoResearch.
Follow docs/agent-setup.md, reuse my existing coding-agent login,
configure paper generation, verify the setup, and open the dashboard.
```

Setup has three checkpoints: **dashboard opens → coding agent is authenticated and ready → paper tools are ready**. Complete interactive provider login yourself. Model availability and usage limits depend on your account; research can require additional dependencies.

<details>
<summary>Manual setup from source</summary>

You need Node.js 20+, Python 3.10+, Git, and an installed, authenticated Codex or Claude Code CLI.

```bash
git clone https://github.com/YihongT/CoAutoResearch.git
cd CoAutoResearch
node bin/auto-research.js doctor
node bin/auto-research.js ui
```

Open the printed URL and keep the server running. The dashboard needs no application dependencies or build step. Use `--projects-dir /path/to/projects` to keep research outside the checkout.

PDF generation additionally needs Python 3.12+, four pinned scientific skills, LaTeX and Poppler. Follow the agent setup guide. You can use this source checkout without an npm release.

[Agent setup](docs/agent-setup.md)

</details>

Your first session: **Create project → send a research brief → review the direction → Start autoresearch**. Include your materials, compute budget and decisions that require approval. Creating a project alone does not start research.

[Setup](https://yihongt.github.io/CoAutoResearch/agent-setup.html) · [Walkthrough](https://yihongt.github.io/CoAutoResearch/walkthrough.html)

<a id="how-it-works"></a>

## 🔄 How it works

Each **Trial** is a bounded research iteration. The service checks proposed changes, records accepted results and determines whether to continue, pause or request a human decision. Internal review is not external peer review or proof of a scientific claim.

**Add to research draft** prepares text; it does not send or apply it. **Pause after current turn** requests a pause at an agent-turn boundary, possibly inside a Trial. **Resume autoresearch** continues from the retained state.

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="assets/co-auto-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="assets/co-auto-dark.gif">
  <img src="assets/co-auto-light.gif" alt="How it works">
</picture>

Illustrated workflow; timing is schematic. Static alternatives are available. [SVG](assets/co-auto-light.svg)

<details open>
<summary>🏗️ Explore the system architecture</summary>

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="docs/_static/diagrams/architecture.svg">
  <source media="(prefers-color-scheme: dark)" srcset="docs/_static/diagrams/architecture-dark.gif">
  <img src="docs/_static/diagrams/architecture.gif" alt="Explore the system architecture">
</picture>

[Architecture and lifecycle](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html)

</details>

<a id="example-papers"></a>

## 📄 Example papers

<table>
<tr>
<td width="50%" valign="top"><a href="docs/_static/examples/digits-paper.pdf"><img src="docs/_static/examples/digits-preview.png" width="360" alt="Can covariance shrinkage help classify handwritten digits with little training data?"></a><p><strong>Can covariance shrinkage help classify handwritten digits with little training data?</strong></p><p>Matched small-sample comparisons and a single held-out evaluation; findings remain specific to this dataset and protocol.</p><p><a href="docs/_static/examples/digits-paper.pdf">Read paper · PDF</a></p></td>
<td width="50%" valign="top"><a href="docs/_static/examples/ising-paper.pdf"><img src="docs/_static/examples/ising-preview.png" width="360" alt="How reliably can a laptop estimate an Ising phase transition?"></a><p><strong>How reliably can a laptop estimate an Ising phase transition?</strong></p><p>CPU-bounded estimation and implementation diagnosis. Partial gains did not meet the joint criteria; held-out seeds stayed unused.</p><p><a href="docs/_static/examples/ising-paper.pdf">Read paper · PDF</a></p></td>
</tr>
</table>

Both papers are developer-operated research drafts with human intervention, not external user case studies. Their limitations remain in the reports; human scientific review is required before publication.

When reviewed results are recorded and project agents are idle, choose **Generate paper**. The internal agent uses writing, visualization, citation and venue skills on a frozen evidence snapshot, without running new experiments.

Open **Paper** to zoom, scroll and download the PDF and source. A previous draft remains available while its replacement is generated.

[Example papers](https://yihongt.github.io/CoAutoResearch/example-papers.html) · [Paper generation](https://yihongt.github.io/CoAutoResearch/paper-generation.html)

<a id="documentation"></a>

## 📚 Documentation

The linked guides are in English. Start with Setup or Walkthrough; consult FAQ for common questions and Platforms for support boundaries.

- [Setup](https://yihongt.github.io/CoAutoResearch/agent-setup.html)
- [Walkthrough](https://yihongt.github.io/CoAutoResearch/walkthrough.html)
- [Paper generation](https://yihongt.github.io/CoAutoResearch/paper-generation.html)
- [FAQ](https://yihongt.github.io/CoAutoResearch/faq.html)
- [Platforms](https://yihongt.github.io/CoAutoResearch/platforms.html)
- [CLI](https://yihongt.github.io/CoAutoResearch/cli.html)
- [Architecture](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html)
- [Upgrades](https://yihongt.github.io/CoAutoResearch/upgrading.html)

<a id="community"></a>

## 🤝 Community

Help verify installation on your platform, report reproducible bugs, improve research workflows, maintain translations, or share documented research outcomes. Use Issues and read the contribution guide; report security issues privately.

[Issues](https://github.com/YihongT/CoAutoResearch/issues) · [Contributing](CONTRIBUTING.md) · [Translations](readme/TRANSLATING.md) · [Security](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md)

<details>
<summary>Cite CoAutoResearch</summary>

Cite the software and record the version or commit used.

```bibtex
@software{coautoresearch,
  title = {CoAutoResearch},
  author = {CoAutoResearch contributors},
  url = {https://github.com/YihongT/CoAutoResearch}
}
```

</details>

Licensed under Apache 2.0. Upstream tools and skills retain their own licenses and attribution requirements.

Contact: [yihong.tang@mail.mcgill.ca](mailto:yihong.tang@mail.mcgill.ca)
