<!-- Translation basis is tracked in readme/translations.json. -->
<p align="center"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-hero-dark.svg">
  <img src="../assets/readme-hero-light.svg" width="1200" alt="CoAutoResearch — autonomous research and human–AI collaboration">
</picture></p>

<p align="center"><strong>An autonomous research partner that self-improves recursively and works with you.</strong></p>

<p align="center">問いを定め、実験し、結果を議論し、次の一歩を改善する。<br>追跡可能な根拠から研究原稿と論文草稿を作成します。</p>

<p align="center"><a href="#quick-start"><strong>クイックスタート →</strong></a> · <a href="#features">機能</a> · <a href="#example-papers">論文の例</a> · <a href="https://yihongt.github.io/CoAutoResearch/">ドキュメント</a></p>

<details>
<summary>🌐 Languages</summary>

<p align="center"><a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <strong>日本語</strong> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a><br><a href="README.pt-BR.md">Português brasileiro</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a></p>

<p align="center"><sub>ここで提供するのは README の翻訳です。画面と詳細ドキュメントは英語ですが、agent はユーザーの言語で応答します。</sub></p>

</details>

<p align="center"><a href="../LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-d7b775" alt="Apache 2.0"></a> <a href="https://yihongt.github.io/CoAutoResearch/"><img src="https://img.shields.io/badge/docs-get_started-737269" alt="Documentation"></a></p>

<a id="news"></a>

## 📰 ニュース

- **2026-09-11** — [CoAutoResearch v2.0.0](https://github.com/YihongT/CoAutoResearch/releases/tag/v2.0.0) リリース.

<a id="features"></a>

## ✨ 機能

**研究中も議論できます。** 別のチャットで考えを検討し、研究に反映したい提案を確認してから送信します。

**再帰的な自己改善。** 記録された結果、レビューの指摘、再利用できる知見を次の試行に反映します。研究方針と予算の範囲で仮説・方法・判断を見直し、否定的な結果も残し、証拠が終了を示す場合は研究を締めくくります。

**証拠を確認できます。** 発見、検証記録、限界をたどり、研究原稿と論文草稿につなげます。

<a href="https://yihongt.github.io/CoAutoResearch/walkthrough.html#screenshots">
<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../assets/browser-tour.png">
  <img src="../assets/browser-tour.gif" alt="Digits: Trial → Manuscript → Paper">
</picture>
</a>

完了済みの Digits プロジェクトで、研究記録、原稿、PDF を閲覧します。編集・トリミングしたブラウザー案内であり、新規実行や実際の研究速度を示すものではありません。

<details>
<summary>三つの始め方</summary>

**新しい問い：**「小さな公開データセットで二つの手法を比較してください。CPU のみを使い、予算を明示し、最終評価の前に確認してください。」

**既存の研究：**「提案書と添付資料を読み、次に有用な実験を見つけ、確認用の計画を作成してください。」

**結果の検討：**「より厳密な比較でもこの発見が成り立つか確認してください。元の結果を保持し、限界を報告してください。」

</details>

<a id="quick-start"></a>

## 🚀 クイックスタート

**対応するコーディングエージェント:** ✓ Codex CLI · ✓ Claude Code

次の指示を coding agent に渡してください：

```text
Set up and launch CoAutoResearch from
https://github.com/YihongT/CoAutoResearch.
Follow docs/agent-setup.md, reuse my existing coding-agent login,
configure paper generation, verify the setup, and open the dashboard.
```

セットアップには三つの確認点があります：**画面が開く → coding agent が認証済みで実行可能 → 論文ツールが使用可能**。対話的なアカウント認証は本人が行ってください。モデルと利用上限はアカウントに依存し、研究には追加の依存関係が必要な場合があります。

<details>
<summary>ソースから手動で起動</summary>

Node.js 20+、Python 3.10+、Git、およびインストール・認証済みの Codex または Claude Code CLI が必要です。

```bash
git clone https://github.com/YihongT/CoAutoResearch.git
cd CoAutoResearch
node bin/auto-research.js doctor
node bin/auto-research.js ui
```

表示された URL を開き、サーバーを起動したままにします。画面用のアプリ依存関係のインストールやビルドは不要です。`--projects-dir /path/to/projects` で研究をリポジトリ外に保存できます。

PDF 生成には Python 3.12+、バージョン固定の四つの科学スキル、LaTeX、Poppler も必要です。agent setup ガイドに従ってください。ソースの利用に npm リリースは不要です。

[Agent setup](../docs/agent-setup.md)

</details>

最初の操作：**Create project → 研究方針を送信 → 方向を確認 → Start autoresearch**。資料、計算予算、承認が必要な判断を明記します。プロジェクトを作成するだけでは研究は始まりません。

[Setup](https://yihongt.github.io/CoAutoResearch/agent-setup.html) · [Walkthrough](https://yihongt.github.io/CoAutoResearch/walkthrough.html)

<a id="how-it-works"></a>

## 🔄 仕組み

各 **Trial** は範囲を限定した研究の反復です。サービスが変更案を確認して採用結果を記録し、続行、一時停止、人による判断の要求を決定します。内部レビューは外部査読でも科学的主張の証明でもありません。

**Add to research draft** は文章を準備するだけで、送信や適用はしません。**Pause after current turn** は agent のターン終了時の一時停止を要求し、Trial の途中になる場合もあります。**Resume autoresearch** は保持された状態から続行します。

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../assets/co-auto-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="../assets/co-auto-dark.gif">
  <img src="../assets/co-auto-light.gif" alt="仕組み">
</picture>

模式的なフローです。アニメーションの長さは実際の実行時間ではありません。静止図も利用できます。 [SVG](../assets/co-auto-light.svg)

<details open>
<summary>🏗️ システム構成を見る</summary>

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../docs/_static/diagrams/architecture.svg">
  <source media="(prefers-color-scheme: dark)" srcset="../docs/_static/diagrams/architecture-dark.gif">
  <img src="../docs/_static/diagrams/architecture.gif" alt="システム構成を見る">
</picture>

[Architecture and lifecycle](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html)

</details>

<a id="example-papers"></a>

## 📄 論文の例

<table>
<tr>
<td width="50%" valign="top"><a href="../docs/_static/examples/digits-paper.pdf"><img src="../docs/_static/examples/digits-preview.png" width="360" alt="共分散の縮小は少数の訓練データによる手書き数字分類に役立つか？"></a><p><strong>共分散の縮小は少数の訓練データによる手書き数字分類に役立つか？</strong></p><p>対応のある小標本比較と一度のホールドアウト評価。結果はこのデータセットと評価手順に限定されます。</p><p><a href="../docs/_static/examples/digits-paper.pdf">論文を読む · PDF</a></p></td>
<td width="50%" valign="top"><a href="../docs/_static/examples/ising-paper.pdf"><img src="../docs/_static/examples/ising-preview.png" width="360" alt="ノート PC で Ising 模型の相転移をどの程度安定して推定できるか？"></a><p><strong>ノート PC で Ising 模型の相転移をどの程度安定して推定できるか？</strong></p><p>CPU 予算内での推定と実装診断。一部の改善は複合基準を満たさず、保留した乱数シードは未使用です。</p><p><a href="../docs/_static/examples/ising-paper.pdf">論文を読む · PDF</a></p></td>
</tr>
</table>

両論文は開発者が操作し、人の介入を含む研究草稿で、外部ユーザーの事例ではありません。限界は報告書に残されており、公開前に人による科学的レビューが必要です。

レビュー済み結果が記録され、プロジェクトの agent が停止しているときに **Generate paper** を選びます。内部 agent は執筆、可視化、引用、投稿先書式のスキルを用い、凍結した証拠スナップショットから執筆します。新しい実験は行いません。

**Paper** で PDF の拡大縮小、スクロール、PDF とソースのダウンロードができます。新稿の生成中も旧稿を閲覧できます。

[論文の例](https://yihongt.github.io/CoAutoResearch/example-papers.html) · [Paper generation](https://yihongt.github.io/CoAutoResearch/paper-generation.html)

<a id="documentation"></a>

## 📚 ドキュメント

リンク先のガイドは英語です。Setup または Walkthrough から始め、よくある質問は FAQ、対応範囲は Platforms を参照してください。

- [Setup](https://yihongt.github.io/CoAutoResearch/agent-setup.html)
- [Walkthrough](https://yihongt.github.io/CoAutoResearch/walkthrough.html)
- [Paper generation](https://yihongt.github.io/CoAutoResearch/paper-generation.html)
- [FAQ](https://yihongt.github.io/CoAutoResearch/faq.html)
- [Platforms](https://yihongt.github.io/CoAutoResearch/platforms.html)
- [CLI](https://yihongt.github.io/CoAutoResearch/cli.html)
- [Architecture](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html)
- [Upgrades](https://yihongt.github.io/CoAutoResearch/upgrading.html)

<a id="community"></a>

## 🤝 コミュニティ

各プラットフォームの導入確認、再現可能な不具合報告、研究フローの改善、翻訳の保守、記録付き研究成果の共有を歓迎します。Issues と貢献ガイドをご利用ください。セキュリティ問題は非公開で報告してください。

[Issues](https://github.com/YihongT/CoAutoResearch/issues) · [Contributing](../CONTRIBUTING.md) · [Translations](../readme/TRANSLATING.md) · [Security](../SECURITY.md) · [Code of conduct](../CODE_OF_CONDUCT.md)

<details>
<summary>CoAutoResearch の引用</summary>

ソフトウェアを引用し、使用したバージョンまたは commit を記録してください。

```bibtex
@software{coautoresearch,
  title = {CoAutoResearch},
  author = {CoAutoResearch contributors},
  url = {https://github.com/YihongT/CoAutoResearch}
}
```

</details>

Apache 2.0 ライセンスです。上流のツールとスキルにはそれぞれのライセンスと帰属表示の条件が適用されます。

連絡先: [yihong.tang@mail.mcgill.ca](mailto:yihong.tang@mail.mcgill.ca)
