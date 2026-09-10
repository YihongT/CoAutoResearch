<!-- Translation basis is tracked in readme/translations.json. -->
<p align="center"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-hero-dark.svg">
  <img src="../assets/readme-hero-light.svg" width="1200" alt="CoAutoResearch — autonomous research and human–AI collaboration">
</picture></p>

<p align="center"><strong>An autonomous research partner that self-improves recursively and works with you.</strong></p>

<p align="center">자율 연구, 재귀적 자기 개선(recursive self-improvement), 인간–AI 협업을 통합하는 오픈소스 연구 시스템입니다. 실험을 수행하고 근거와 피드백으로 연구 방법을 개선하며, 추적 가능한 연구 기록에서 논문 초안을 만듭니다.</p>

<p align="center"><a href="#quick-start"><strong>빠른 시작 →</strong></a> · <a href="#features">기능</a> · <a href="#example-papers">예시 논문</a> · <a href="https://yihongt.github.io/CoAutoResearch/">문서</a></p>

<p align="center"><a href="../LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-d7b775" alt="Apache 2.0"></a> <a href="https://yihongt.github.io/CoAutoResearch/"><img src="https://img.shields.io/badge/docs-get_started-737269" alt="Documentation"></a></p>

<p align="center"><a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <strong>한국어</strong> · <a href="README.es.md">Español</a><br><a href="README.pt-BR.md">Português brasileiro</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a></p>

<p align="center"><sub>여기서는 README 번역을 제공합니다. 인터페이스와 전체 문서는 영어이며, agent는 사용자의 언어로 답합니다.</sub></p>

![질문, 제안서 또는 진행 중인 연구에서 시작하세요.](../assets/homepage.png)

*질문, 제안서 또는 진행 중인 연구에서 시작하세요.*

<a id="news"></a>

## 📰 새 소식

- **2026-09-09** — Digits와 Ising 예시 논문, 연구 복구 개선, 논문 생성 검사 강화를 추가했습니다.
- **2026-09-07** — 2.0 소스 업데이트에는 병렬 연구 토론, 명확한 제어, 제품 내 논문 생성이 포함됩니다.

[Changelog](../CHANGELOG.md) · [Releases](https://github.com/YihongT/CoAutoResearch/releases)

<a id="features"></a>

## ✨ 기능

**연구 중에도 토론하세요.** 별도 채팅에서 아이디어를 검토하고, 연구에 반영할 제안을 확인한 뒤 전송합니다.

**재귀적 자기 개선.** 기록된 결과, 검토 피드백, 재사용 가능한 교훈을 다음 시도에 반영합니다. 연구 지침과 예산 안에서 가설·방법·판단을 수정하고, 부정적 결과도 보존하며 근거에 따라 연구를 마무리합니다.

**근거를 확인하세요.** 발견, 검사 기록, 한계를 따라 연구 원고와 논문 초안을 만듭니다.

<a href="https://yihongt.github.io/CoAutoResearch/walkthrough.html#screenshots">
<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../assets/browser-tour.png">
  <img src="../assets/browser-tour.gif" alt="Digits: Trial → Manuscript → Paper">
</picture>
</a>

완료된 Digits 프로젝트의 연구 기록, 원고, PDF를 살펴봅니다. 편집하고 화면 일부를 잘라낸 브라우저 안내이며, 새 실행이나 실제 연구 속도를 보여 주지 않습니다.

<details>
<summary>세 가지 시작 방법</summary>

**새 질문:** “작은 공개 데이터셋에서 두 방법을 비교해 주세요. CPU만 사용하고 예산을 명시하며 최종 평가 전에 승인을 요청하세요.”

**기존 연구:** “제안서와 첨부 자료를 읽고, 다음으로 유용한 실험을 찾아 검토할 계획을 준비해 주세요.”

**검토할 결과:** “더 엄격한 비교에서도 이 발견이 유지되는지 확인해 주세요. 원래 결과를 보존하고 한계를 보고하세요.”

</details>

<a id="quick-start"></a>

## 🚀 빠른 시작

**지원하는 코딩 에이전트:** ✓ Codex CLI · ✓ Claude Code

다음 지시를 coding agent에 전달하세요:

```text
Set up and launch CoAutoResearch from
https://github.com/YihongT/CoAutoResearch.
Follow docs/agent-setup.md, reuse my existing coding-agent login,
configure paper generation, verify the setup, and open the dashboard.
```

설치에는 세 가지 확인 단계가 있습니다: **대시보드 열림 → coding agent 인증 및 실행 준비 → 논문 도구 준비**. 대화형 계정 로그인은 직접 완료하세요. 모델과 사용량 한도는 계정에 따라 다르며, 연구에 추가 의존성이 필요할 수 있습니다.

<details>
<summary>소스에서 직접 실행</summary>

Node.js 20+, Python 3.10+, Git, 설치 및 인증된 Codex 또는 Claude Code CLI가 필요합니다.

```bash
git clone https://github.com/YihongT/CoAutoResearch.git
cd CoAutoResearch
node bin/auto-research.js doctor
node bin/auto-research.js ui
```

출력된 URL을 열고 서버를 계속 실행하세요. 대시보드는 별도의 앱 의존성 설치나 빌드가 필요 없습니다. `--projects-dir /path/to/projects`로 연구를 저장소 밖에 보관하세요.

PDF 생성에는 Python 3.12+, 버전이 고정된 과학 스킬 네 개, LaTeX, Poppler도 필요합니다. agent setup 가이드를 따르세요. 소스 사용에는 npm 릴리스가 필요하지 않습니다.

[Agent setup](../docs/agent-setup.md)

</details>

첫 사용: **Create project → 연구 지침 전송 → 방향 검토 → Start autoresearch**. 자료, 계산 예산, 승인이 필요한 결정을 명시하세요. 프로젝트 생성만으로 연구가 시작되지는 않습니다.

[Setup](https://yihongt.github.io/CoAutoResearch/agent-setup.html) · [Walkthrough](https://yihongt.github.io/CoAutoResearch/walkthrough.html)

<a id="how-it-works"></a>

## 🔄 작동 방식

각 **Trial**은 범위가 정해진 연구 반복입니다. 서비스가 변경 제안을 검사하고 채택된 결과를 기록하며 계속, 일시 정지, 사람의 판단 요청을 결정합니다. 내부 검토는 외부 동료 심사나 과학적 주장에 대한 증명이 아닙니다.

**Add to research draft**는 글을 준비할 뿐 전송하거나 적용하지 않습니다. **Pause after current turn**은 agent 턴 경계에서의 일시 정지를 요청하며 Trial 도중일 수 있습니다. **Resume autoresearch**는 보존된 상태에서 계속합니다.

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../assets/co-auto-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="../assets/co-auto-dark.gif">
  <img src="../assets/co-auto-light.gif" alt="작동 방식">
</picture>

개념적인 흐름입니다. 애니메이션 시간은 실제 실행 시간이 아니며 정적 그림도 제공됩니다. [SVG](../assets/co-auto-light.svg)

<details open>
<summary>🏗️ 시스템 구조 보기</summary>

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../docs/_static/diagrams/architecture.svg">
  <source media="(prefers-color-scheme: dark)" srcset="../docs/_static/diagrams/architecture-dark.gif">
  <img src="../docs/_static/diagrams/architecture.gif" alt="시스템 구조 보기">
</picture>

[Architecture and lifecycle](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html)

</details>

<a id="example-papers"></a>

## 📄 예시 논문

<table>
<tr>
<td width="50%" valign="top"><a href="../docs/_static/examples/digits-paper.pdf"><img src="../docs/_static/examples/digits-preview.png" width="360" alt="공분산 축소가 적은 학습 데이터로 손글씨 숫자를 분류하는 데 도움이 될까요?"></a><p><strong>공분산 축소가 적은 학습 데이터로 손글씨 숫자를 분류하는 데 도움이 될까요?</strong></p><p>대응된 소표본 비교와 한 번의 홀드아웃 평가입니다. 발견은 해당 데이터셋과 평가 절차에 한정됩니다.</p><p><a href="../docs/_static/examples/digits-paper.pdf">논문 읽기 · PDF</a></p></td>
<td width="50%" valign="top"><a href="../docs/_static/examples/ising-paper.pdf"><img src="../docs/_static/examples/ising-preview.png" width="360" alt="노트북으로 Ising 상전이를 얼마나 신뢰성 있게 추정할 수 있을까요?"></a><p><strong>노트북으로 Ising 상전이를 얼마나 신뢰성 있게 추정할 수 있을까요?</strong></p><p>CPU 예산 내 추정과 구현 진단입니다. 일부 개선은 공동 기준을 충족하지 못했고, 보류한 난수 시드는 사용하지 않았습니다.</p><p><a href="../docs/_static/examples/ising-paper.pdf">논문 읽기 · PDF</a></p></td>
</tr>
</table>

두 논문은 개발자가 조작하고 사람의 개입이 포함된 연구 초안이며, 외부 사용자 사례가 아닙니다. 보고서에 한계가 명시되어 있고 출판 전 사람의 과학적 검토가 필요합니다.

검토된 결과가 기록되고 프로젝트 agent가 실행 중이 아닐 때 **Generate paper**를 선택하세요. 내부 agent가 글쓰기, 시각화, 인용, 투고 형식 스킬로 고정된 근거 스냅샷에서 작성하며 새 실험은 수행하지 않습니다.

**Paper**에서 PDF 확대·축소, 스크롤, PDF와 소스 다운로드가 가능합니다. 새 초안 생성 중에도 이전 초안을 볼 수 있습니다.

[예시 논문](https://yihongt.github.io/CoAutoResearch/example-papers.html) · [Paper generation](https://yihongt.github.io/CoAutoResearch/paper-generation.html)

<a id="documentation"></a>

## 📚 문서

링크된 가이드는 영어입니다. Setup이나 Walkthrough에서 시작하고, 일반 질문은 FAQ, 지원 범위는 Platforms를 확인하세요.

- [Setup](https://yihongt.github.io/CoAutoResearch/agent-setup.html)
- [Walkthrough](https://yihongt.github.io/CoAutoResearch/walkthrough.html)
- [Paper generation](https://yihongt.github.io/CoAutoResearch/paper-generation.html)
- [FAQ](https://yihongt.github.io/CoAutoResearch/faq.html)
- [Platforms](https://yihongt.github.io/CoAutoResearch/platforms.html)
- [CLI](https://yihongt.github.io/CoAutoResearch/cli.html)
- [Architecture](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html)
- [Upgrades](https://yihongt.github.io/CoAutoResearch/upgrading.html)

<a id="community"></a>

## 🤝 커뮤니티

플랫폼별 설치 확인, 재현 가능한 버그 보고, 연구 흐름 개선, 번역 유지, 기록이 있는 연구 결과 공유를 환영합니다. Issues와 기여 가이드를 이용하고 보안 문제는 비공개로 보고하세요.

[Issues](https://github.com/YihongT/CoAutoResearch/issues) · [Contributing](../CONTRIBUTING.md) · [Translations](../readme/TRANSLATING.md) · [Security](../SECURITY.md) · [Code of conduct](../CODE_OF_CONDUCT.md)

<details>
<summary>CoAutoResearch 인용</summary>

소프트웨어를 인용하고 사용한 버전 또는 commit을 기록하세요.

```bibtex
@software{coautoresearch,
  title = {CoAutoResearch},
  author = {CoAutoResearch contributors},
  url = {https://github.com/YihongT/CoAutoResearch}
}
```

</details>

Apache 2.0 라이선스입니다. 상위 도구와 스킬에는 각자의 라이선스와 출처 표기 요건이 적용됩니다.

연락처: [yihong.tang@mail.mcgill.ca](mailto:yihong.tang@mail.mcgill.ca)
