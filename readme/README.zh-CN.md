<!-- Translation basis is tracked in readme/translations.json. -->
<p align="center"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/logo.svg">
  <img src="../assets/logo-white.svg" width="88" alt="CoAutoResearch">
</picture></p>

<h1 align="center">CoAutoResearch</h1>

<p align="center"><strong>An autonomous research partner you can question, guide, and build with.</strong></p>

由 Codex 或 Claude Code 驱动的开源研究工作区。从一个问题开始，让 agent 查找资料、执行实验，在研究推进时讨论发现，并将已记录的证据整理成论文草稿。

让研究自主推进，在需要你的判断时持续参与。

<p align="center"><a href="../README.md">English</a> · <strong>简体中文</strong> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a><br><a href="README.pt-BR.md">Português brasileiro</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a></p>

<small>这里提供的是 README 翻译。界面与完整文档使用英文；agent 的回复跟随你的语言。</small>

<p align="center"><a href="#quick-start">快速开始</a> · <a href="#features">功能特点</a> · <a href="#example-papers">示例论文</a> · <a href="https://yihongt.github.io/CoAutoResearch/">文档</a></p>

<p align="center"><a href="../LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-d7b775" alt="Apache 2.0"></a> <a href="https://yihongt.github.io/CoAutoResearch/"><img src="https://img.shields.io/badge/docs-get_started-737269" alt="Documentation"></a></p>

![从一个问题、提案或已有工作开始。](../assets/homepage.png)

*从一个问题、提案或已有工作开始。*

<a id="news"></a>

## 📰 最新动态

- **2026-09-09** — 新增 Digits 和 Ising 示例论文，改进研究恢复流程与论文生成检查。
- **2026-09-07** — 2.0 源码更新加入并行研究讨论、更清晰的控制和产品内论文生成。

[Changelog](../CHANGELOG.md) · [Releases](https://github.com/YihongT/CoAutoResearch/releases)

<a id="features"></a>

## ✨ 功能特点

**边研究，边讨论。** 在独立聊天中探索想法；希望建议影响研究时，先审阅再发送。

**围绕问题持续迭代。** Agent 按研究要求与预算规划、执行、解释和审查。你可以暂停思考，准备好后继续。

**检查证据。** 沿着发现、检查记录和局限，逐步形成研究稿与论文草稿。

<a href="https://yihongt.github.io/CoAutoResearch/walkthrough.html#screenshots">
<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../assets/browser-tour.png">
  <img src="../assets/browser-tour.gif" alt="Digits: Trial → discussion → Manuscript → Paper">
</picture>
</a>

浏览已完成的 Digits 项目：研究记录、讨论、研究稿与 PDF。这段经剪辑、裁切的网页导览展示已有历史，不是新一轮运行，也不代表实际研究速度。原始对话为中文。

<details>
<summary>三种开始方式</summary>

**新问题：**“在一个小型公开数据集上比较两种方法。仅使用 CPU，明确预算，最终评价前先征求确认。”

**已有工作：**“阅读我的提案和附件，找出下一项有价值的实验，准备方案供我审阅。”

**待核查的结果：**“检查这个发现能否经受更严格的比较。保留原始结果，并报告局限。”

</details>

<a id="quick-start"></a>

## 🚀 快速开始

把下面这段指令交给你的 coding agent：

```text
Set up and launch CoAutoResearch from
https://github.com/YihongT/CoAutoResearch.
Follow docs/agent-setup.md, reuse my existing coding-agent login,
configure paper generation, verify the setup, and open the dashboard.
```

安装分三个检查点：**网页可打开 → coding agent 已登录且可运行 → 论文工具已就绪**。交互式账号登录由你本人完成。可用模型与用量限制取决于账号；具体研究可能需要额外依赖。

<details>
<summary>从源码手动启动</summary>

需要 Node.js 20+、Python 3.10+、Git，以及已安装并登录的 Codex 或 Claude Code CLI。

```bash
git clone https://github.com/YihongT/CoAutoResearch.git
cd CoAutoResearch
node bin/auto-research.js doctor
node bin/auto-research.js ui
```

打开输出的 URL，保持服务运行。网页工作区无需应用依赖安装或构建。用 `--projects-dir /path/to/projects` 将研究存放在仓库外。

生成 PDF 还需要 Python 3.12+、四个固定版本的科学技能、LaTeX 和 Poppler。按 agent setup 指南配置；使用源码不需要发布 npm。

[Agent setup](../docs/agent-setup.md)

</details>

第一次使用：**Create project → 发送研究要求 → 检查方向 → Start autoresearch**。说明材料、计算预算及需要批准的决定。创建项目本身不会启动研究。

[Setup](https://yihongt.github.io/CoAutoResearch/agent-setup.html) · [Walkthrough](https://yihongt.github.io/CoAutoResearch/walkthrough.html)

<a id="how-it-works"></a>

## 🔄 工作原理

每个 **Trial** 是一次有边界的研究迭代。服务检查拟议修改、记录已接纳的结果，并判断继续、暂停或请求人工决定。内部审查不等于外部同行评审，也不能证明科学结论正确。

**Add to research draft** 只准备文字，不会发送或应用建议。**Pause after current turn** 请求在 agent 回合结束处暂停，可能位于 Trial 中间。**Resume autoresearch** 从保留的状态继续。

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../assets/co-auto-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="../assets/co-auto-dark.gif">
  <img src="../assets/co-auto-light.gif" alt="工作原理">
</picture>

流程示意，动画时长不代表实际运行速度；可查看静态版本。 [SVG](../assets/co-auto-light.svg)

<details open>
<summary>🏗️ 了解系统架构</summary>

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../docs/_static/diagrams/architecture.svg">
  <source media="(prefers-color-scheme: dark)" srcset="../docs/_static/diagrams/architecture-dark.gif">
  <img src="../docs/_static/diagrams/architecture.gif" alt="了解系统架构">
</picture>

[Architecture and lifecycle](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html)

</details>

<a id="example-papers"></a>

## 📄 示例论文

<table>
<tr>
<td width="50%" valign="top"><a href="../docs/_static/examples/digits-paper.pdf"><img src="../docs/_static/examples/digits-preview.png" width="360" alt="协方差收缩能否帮助小样本手写数字分类？"></a><p><strong>协方差收缩能否帮助小样本手写数字分类？</strong></p><p>配对的小样本比较与一次保留集评价；发现仅适用于该数据集和评价方案。</p><p><a href="../docs/_static/examples/digits-paper.pdf">阅读论文 · PDF</a></p></td>
<td width="50%" valign="top"><a href="../docs/_static/examples/ising-paper.pdf"><img src="../docs/_static/examples/ising-preview.png" width="360" alt="笔记本电脑能多可靠地估计 Ising 相变？"></a><p><strong>笔记本电脑能多可靠地估计 Ising 相变？</strong></p><p>在 CPU 预算内进行估计和实现诊断。局部提升未达到联合标准，保留种子未使用。</p><p><a href="../docs/_static/examples/ising-paper.pdf">阅读论文 · PDF</a></p></td>
</tr>
</table>

两篇论文均为开发者操作并包含人工介入的研究草稿，不是外部用户案例。报告保留了局限；发表前需要人工科学审阅。

审查后的结果已记录且项目 agent 空闲时，选择 **Generate paper**。内部 agent 使用写作、可视化、引用和场地格式技能，从冻结的证据快照写作，不运行新实验。

打开 **Paper** 可缩放、滚动、下载 PDF 和源码。生成替代稿件时，旧稿仍可查看。

[示例论文](https://yihongt.github.io/CoAutoResearch/example-papers.html) · [Paper generation](https://yihongt.github.io/CoAutoResearch/paper-generation.html)

<a id="documentation"></a>

## 📚 文档

链接文档为英文。从 Setup 或 Walkthrough 开始；常见问题见 FAQ，平台支持边界见 Platforms。

- [Setup](https://yihongt.github.io/CoAutoResearch/agent-setup.html)
- [Walkthrough](https://yihongt.github.io/CoAutoResearch/walkthrough.html)
- [Paper generation](https://yihongt.github.io/CoAutoResearch/paper-generation.html)
- [FAQ](https://yihongt.github.io/CoAutoResearch/faq.html)
- [Platforms](https://yihongt.github.io/CoAutoResearch/platforms.html)
- [CLI](https://yihongt.github.io/CoAutoResearch/cli.html)
- [Architecture](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html)
- [Upgrades](https://yihongt.github.io/CoAutoResearch/upgrading.html)

<a id="community"></a>

## 🤝 社区

欢迎验证不同平台的安装、报告可复现问题、改进研究流程、维护翻译，或分享有记录的研究成果。请使用 Issues 并阅读贡献指南；安全问题请私下报告。

[Issues](https://github.com/YihongT/CoAutoResearch/issues) · [Contributing](../CONTRIBUTING.md) · [Translations](../readme/TRANSLATING.md) · [Security](../SECURITY.md) · [Code of conduct](../CODE_OF_CONDUCT.md)

<details>
<summary>引用 CoAutoResearch</summary>

引用软件时，请记录使用的版本或 commit。

```bibtex
@software{coautoresearch,
  title = {CoAutoResearch},
  author = {CoAutoResearch contributors},
  url = {https://github.com/YihongT/CoAutoResearch}
}
```

</details>

采用 Apache 2.0 许可证。上游工具与技能保留各自的许可证和署名要求。

联系: [yihong.tang@mail.mcgill.ca](mailto:yihong.tang@mail.mcgill.ca)
