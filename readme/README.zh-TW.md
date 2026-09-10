<!-- Translation basis is tracked in readme/translations.json. -->
<p align="center"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-hero-dark.svg">
  <img src="../assets/readme-hero-light.svg" width="1200" alt="CoAutoResearch — autonomous research and human–AI collaboration">
</picture></p>

<p align="center"><strong>An autonomous research partner you can question, guide, and build with.</strong></p>

<p align="center">由 Codex 或 Claude Code 驅動的開源研究工作區。從一個問題開始，讓 agent 查找資料、執行實驗，在研究推進時討論發現，並將已記錄的證據整理成論文草稿。</p>

<p align="center"><a href="#quick-start"><strong>快速開始 →</strong></a> · <a href="#features">功能特色</a> · <a href="#example-papers">範例論文</a> · <a href="https://yihongt.github.io/CoAutoResearch/">文件</a></p>

<p align="center"><a href="../LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-d7b775" alt="Apache 2.0"></a> <a href="https://yihongt.github.io/CoAutoResearch/"><img src="https://img.shields.io/badge/docs-get_started-737269" alt="Documentation"></a></p>

<p align="center"><a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <strong>繁體中文</strong> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a><br><a href="README.pt-BR.md">Português brasileiro</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a></p>

<p align="center"><sub>這裡提供的是 README 翻譯。介面與完整文件使用英文；agent 的回覆跟隨你的語言。</sub></p>

![從一個問題、提案或既有工作開始。](../assets/homepage.png)

*從一個問題、提案或既有工作開始。*

<a id="news"></a>

## 📰 最新動態

- **2026-09-09** — 新增 Digits 和 Ising 範例論文，改善研究恢復流程與論文生成檢查。
- **2026-09-07** — 2.0 原始碼更新加入平行研究討論、更清楚的控制及產品內論文生成。

[Changelog](../CHANGELOG.md) · [Releases](https://github.com/YihongT/CoAutoResearch/releases)

<a id="features"></a>

## ✨ 功能特色

**邊研究，邊討論。** 在獨立對話中探索想法；希望建議影響研究時，先審閱再傳送。

**圍繞問題持續迭代。** Agent 按研究要求與預算規劃、執行、解釋及審查。你可以暫停思考，準備好後繼續。

**檢查證據。** 沿著發現、檢查紀錄與限制，逐步形成研究稿及論文草稿。

<a href="https://yihongt.github.io/CoAutoResearch/walkthrough.html#screenshots">
<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../assets/browser-tour.png">
  <img src="../assets/browser-tour.gif" alt="Digits: Trial → Manuscript → Paper">
</picture>
</a>

瀏覽已完成的 Digits 專案：研究紀錄、研究稿與 PDF。這段經剪輯、裁切的網頁導覽展示既有歷史，不是新一輪執行，也不代表實際研究速度。

<details>
<summary>三種開始方式</summary>

**新問題：**「在一個小型公開資料集上比較兩種方法。僅使用 CPU，明確設定預算，最終評估前先徵求確認。」

**既有工作：**「閱讀我的提案與附件，找出下一項有價值的實驗，準備方案供我審閱。」

**待核查的結果：**「檢查這個發現能否經得起更嚴格的比較。保留原始結果，並說明限制。」

</details>

<a id="quick-start"></a>

## 🚀 快速開始

將下面這段指令交給你的 coding agent：

```text
Set up and launch CoAutoResearch from
https://github.com/YihongT/CoAutoResearch.
Follow docs/agent-setup.md, reuse my existing coding-agent login,
configure paper generation, verify the setup, and open the dashboard.
```

安裝分三個檢查點：**網頁可開啟 → coding agent 已登入且可執行 → 論文工具已就緒**。互動式帳號登入由你本人完成。可用模型與用量限制取決於帳號；具體研究可能需要額外相依套件。

<details>
<summary>從原始碼手動啟動</summary>

需要 Node.js 20+、Python 3.10+、Git，以及已安裝並登入的 Codex 或 Claude Code CLI。

```bash
git clone https://github.com/YihongT/CoAutoResearch.git
cd CoAutoResearch
node bin/auto-research.js doctor
node bin/auto-research.js ui
```

開啟輸出的 URL，保持服務執行。網頁工作區無需安裝應用程式相依套件或建置。用 `--projects-dir /path/to/projects` 將研究存放在儲存庫外。

生成 PDF 還需要 Python 3.12+、四個固定版本的科學技能、LaTeX 與 Poppler。請依 agent setup 指南設定；使用原始碼不需要 npm 發布。

[Agent setup](../docs/agent-setup.md)

</details>

第一次使用：**Create project → 傳送研究要求 → 檢查方向 → Start autoresearch**。說明材料、計算預算及需要核准的決定。建立專案本身不會啟動研究。

[Setup](https://yihongt.github.io/CoAutoResearch/agent-setup.html) · [Walkthrough](https://yihongt.github.io/CoAutoResearch/walkthrough.html)

<a id="how-it-works"></a>

## 🔄 運作原理

每個 **Trial** 是一次有明確邊界的研究迭代。服務檢查擬議修改、記錄已接納的結果，並判斷繼續、暫停或請求人為決定。內部審查不等於外部同儕審查，也不能證明科學結論正確。

**Add to research draft** 只準備文字，不會傳送或套用建議。**Pause after current turn** 請求在 agent 回合結束處暫停，可能位於 Trial 中間。**Resume autoresearch** 從保留的狀態繼續。

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../assets/co-auto-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="../assets/co-auto-dark.gif">
  <img src="../assets/co-auto-light.gif" alt="運作原理">
</picture>

流程示意，動畫長度不代表實際執行速度；可查看靜態版本。 [SVG](../assets/co-auto-light.svg)

<details open>
<summary>🏗️ 瞭解系統架構</summary>

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../docs/_static/diagrams/architecture.svg">
  <source media="(prefers-color-scheme: dark)" srcset="../docs/_static/diagrams/architecture-dark.gif">
  <img src="../docs/_static/diagrams/architecture.gif" alt="瞭解系統架構">
</picture>

[Architecture and lifecycle](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html)

</details>

<a id="example-papers"></a>

## 📄 範例論文

<table>
<tr>
<td width="50%" valign="top"><a href="../docs/_static/examples/digits-paper.pdf"><img src="../docs/_static/examples/digits-preview.png" width="360" alt="共變異數收縮能否幫助手寫數字的小樣本分類？"></a><p><strong>共變異數收縮能否幫助手寫數字的小樣本分類？</strong></p><p>配對的小樣本比較與一次保留集評估；發現僅適用於該資料集與評估方案。</p><p><a href="../docs/_static/examples/digits-paper.pdf">閱讀論文 · PDF</a></p></td>
<td width="50%" valign="top"><a href="../docs/_static/examples/ising-paper.pdf"><img src="../docs/_static/examples/ising-preview.png" width="360" alt="筆記型電腦能多可靠地估計 Ising 相變？"></a><p><strong>筆記型電腦能多可靠地估計 Ising 相變？</strong></p><p>在 CPU 預算內進行估計及實作診斷。局部改善未達到聯合標準，保留的隨機種子未使用。</p><p><a href="../docs/_static/examples/ising-paper.pdf">閱讀論文 · PDF</a></p></td>
</tr>
</table>

兩篇論文均為開發者操作且包含人為介入的研究草稿，不是外部使用者案例。報告保留了限制；發表前需要人工科學審閱。

審查後的結果已記錄且專案 agent 閒置時，選擇 **Generate paper**。內部 agent 使用寫作、視覺化、引用及投稿格式技能，從凍結的證據快照寫作，不執行新實驗。

開啟 **Paper** 可縮放、捲動、下載 PDF 與原始碼。生成替代稿件時，舊稿仍可查看。

[範例論文](https://yihongt.github.io/CoAutoResearch/example-papers.html) · [Paper generation](https://yihongt.github.io/CoAutoResearch/paper-generation.html)

<a id="documentation"></a>

## 📚 文件

連結文件為英文。從 Setup 或 Walkthrough 開始；常見問題見 FAQ，平台支援邊界見 Platforms。

- [Setup](https://yihongt.github.io/CoAutoResearch/agent-setup.html)
- [Walkthrough](https://yihongt.github.io/CoAutoResearch/walkthrough.html)
- [Paper generation](https://yihongt.github.io/CoAutoResearch/paper-generation.html)
- [FAQ](https://yihongt.github.io/CoAutoResearch/faq.html)
- [Platforms](https://yihongt.github.io/CoAutoResearch/platforms.html)
- [CLI](https://yihongt.github.io/CoAutoResearch/cli.html)
- [Architecture](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html)
- [Upgrades](https://yihongt.github.io/CoAutoResearch/upgrading.html)

<a id="community"></a>

## 🤝 社群

歡迎驗證不同平台的安裝、回報可重現問題、改善研究流程、維護翻譯，或分享有紀錄的研究成果。請使用 Issues 並閱讀貢獻指南；安全問題請私下回報。

[Issues](https://github.com/YihongT/CoAutoResearch/issues) · [Contributing](../CONTRIBUTING.md) · [Translations](../readme/TRANSLATING.md) · [Security](../SECURITY.md) · [Code of conduct](../CODE_OF_CONDUCT.md)

<details>
<summary>引用 CoAutoResearch</summary>

引用軟體時，請記錄使用的版本或 commit。

```bibtex
@software{coautoresearch,
  title = {CoAutoResearch},
  author = {CoAutoResearch contributors},
  url = {https://github.com/YihongT/CoAutoResearch}
}
```

</details>

採用 Apache 2.0 授權。上游工具與技能保留各自的授權和署名要求。

聯絡: [yihong.tang@mail.mcgill.ca](mailto:yihong.tang@mail.mcgill.ca)
