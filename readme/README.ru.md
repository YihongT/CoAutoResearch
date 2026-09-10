<!-- Translation basis is tracked in readme/translations.json. -->
<p align="center"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-hero-dark.svg">
  <img src="../assets/readme-hero-light.svg" width="1200" alt="CoAutoResearch — autonomous research and human–AI collaboration">
</picture></p>

<p align="center"><strong>An autonomous research partner that self-improves recursively and works with you.</strong></p>

<p align="center">Сформулируйте вопрос. Проведите эксперименты. Обсудите результаты. Уточните следующий шаг.<br>Создайте рукопись и черновик статьи на основе прослеживаемых свидетельств.</p>

<p align="center"><a href="#quick-start"><strong>Быстрый старт →</strong></a> · <a href="#features">Возможности</a> · <a href="#example-papers">Примеры статей</a> · <a href="https://yihongt.github.io/CoAutoResearch/">Документация</a></p>

![Начните с вопроса, предложения или уже начатой работы.](../assets/homepage.png)

*Начните с вопроса, предложения или уже начатой работы.*

<details>
<summary>🌐 Languages</summary>

<p align="center"><a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a><br><a href="README.pt-BR.md">Português brasileiro</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <strong>Русский</strong> · <a href="README.ar.md">العربية</a></p>

<p align="center"><sub>Это переводы README. Интерфейс и полная документация — на английском; агент отвечает на вашем языке.</sub></p>

</details>

<p align="center"><a href="../LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-d7b775" alt="Apache 2.0"></a> <a href="https://yihongt.github.io/CoAutoResearch/"><img src="https://img.shields.io/badge/docs-get_started-737269" alt="Documentation"></a></p>

<a id="news"></a>

## 📰 Новости

- **2026-09-09** — Добавлены статьи Digits и Ising, улучшено восстановление исследований и усилены проверки генерации статей.
- **2026-09-07** — Обновление исходного кода 2.0 добавляет параллельные обсуждения, понятные элементы управления и создание статей в продукте.

[Changelog](../CHANGELOG.md) · [Releases](https://github.com/YihongT/CoAutoResearch/releases)

<a id="features"></a>

## ✨ Возможности

**Обсуждайте во время исследования.** Рассматривайте идеи в отдельном чате. Проверьте и отправьте предложение, когда хотите направить исследование.

**Рекурсивное самосовершенствование.** Используйте записанные результаты, замечания проверок и полезный опыт в следующей итерации. Уточняйте гипотезы, методы и решения в пределах задания и бюджета; сохраняйте отрицательные результаты и завершайте работу, когда это оправдано свидетельствами.

**Проверяйте основания выводов.** Прослеживайте результаты, проверки и ограничения до рукописи и черновика статьи.

<a href="https://yihongt.github.io/CoAutoResearch/walkthrough.html#screenshots">
<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../assets/browser-tour.png">
  <img src="../assets/browser-tour.gif" alt="Digits: Trial → Manuscript → Paper">
</picture>
</a>

Обзор завершённого проекта Digits: записи, рукопись и PDF. Этот смонтированный обзор с обрезанными кадрами браузера показывает существующую историю, а не новый запуск или реальную скорость исследования.

<details>
<summary>Три способа начать</summary>

**Новый вопрос:** «Сравните два метода на небольшом открытом наборе данных. Используйте только CPU, укажите бюджет и запросите подтверждение перед итоговой оценкой».

**Начатая работа:** «Прочитайте моё предложение и приложения. Найдите следующий полезный эксперимент и подготовьте план для проверки».

**Проверка результата:** «Проверьте, сохраняется ли этот вывод при более строгом сравнении. Сохраните исходные результаты и опишите ограничения».

</details>

<a id="quick-start"></a>

## 🚀 Быстрый старт

**Поддерживаемые агенты программирования:** ✓ Codex CLI · ✓ Claude Code

Передайте coding agent следующую инструкцию:

```text
Set up and launch CoAutoResearch from
https://github.com/YihongT/CoAutoResearch.
Follow docs/agent-setup.md, reuse my existing coding-agent login,
configure paper generation, verify the setup, and open the dashboard.
```

Три контрольные точки настройки: **панель открывается → coding agent авторизован и готов → инструменты статей готовы**. Интерактивный вход в аккаунт выполните самостоятельно. Модели и лимиты зависят от аккаунта; исследованию могут потребоваться дополнительные зависимости.

<details>
<summary>Ручной запуск из исходного кода</summary>

Нужны Node.js 20+, Python 3.10+, Git и установленный, авторизованный Codex или Claude Code CLI.

```bash
git clone https://github.com/YihongT/CoAutoResearch.git
cd CoAutoResearch
node bin/auto-research.js doctor
node bin/auto-research.js ui
```

Откройте выведенный URL и оставьте сервер работающим. Панель не требует установки зависимостей приложения или сборки. Используйте `--projects-dir /path/to/projects`, чтобы хранить исследования вне репозитория.

Для PDF также нужны Python 3.12+, четыре научных навыка с закреплёнными версиями, LaTeX и Poppler. Следуйте руководству agent setup. Исходный код можно использовать без публикации в npm.

[Agent setup](../docs/agent-setup.md)

</details>

Первая сессия: **Create project → отправить задание → проверить направление → Start autoresearch**. Укажите материалы, вычислительный бюджет и решения, требующие одобрения. Создание проекта само по себе не запускает исследование.

[Setup](https://yihongt.github.io/CoAutoResearch/agent-setup.html) · [Walkthrough](https://yihongt.github.io/CoAutoResearch/walkthrough.html)

<a id="how-it-works"></a>

## 🔄 Как это работает

Каждый **Trial** — ограниченная исследовательская итерация. Сервис проверяет предлагаемые изменения, фиксирует принятые результаты и решает, продолжать ли работу, сделать паузу или запросить решение человека. Внутренняя проверка не является внешним рецензированием или доказательством научного утверждения.

**Add to research draft** готовит текст, но не отправляет и не применяет его. **Pause after current turn** запрашивает паузу после хода агента, возможно внутри Trial. **Resume autoresearch** продолжает с сохранённого состояния.

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../assets/co-auto-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="../assets/co-auto-dark.gif">
  <img src="../assets/co-auto-light.gif" alt="Как это работает">
</picture>

Схематический процесс; длительность анимации не отражает время выполнения. Доступны статичные версии. [SVG](../assets/co-auto-light.svg)

<details open>
<summary>🏗️ Архитектура системы</summary>

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../docs/_static/diagrams/architecture.svg">
  <source media="(prefers-color-scheme: dark)" srcset="../docs/_static/diagrams/architecture-dark.gif">
  <img src="../docs/_static/diagrams/architecture.gif" alt="Архитектура системы">
</picture>

[Architecture and lifecycle](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html)

</details>

<a id="example-papers"></a>

## 📄 Примеры статей

<table>
<tr>
<td width="50%" valign="top"><a href="../docs/_static/examples/digits-paper.pdf"><img src="../docs/_static/examples/digits-preview.png" width="360" alt="Помогает ли сжатие ковариационной матрицы классифицировать рукописные цифры при малом объёме обучающих данных?"></a><p><strong>Помогает ли сжатие ковариационной матрицы классифицировать рукописные цифры при малом объёме обучающих данных?</strong></p><p>Парные сравнения на малых выборках и однократная оценка на отложенных данных; выводы ограничены этим набором и протоколом.</p><p><a href="../docs/_static/examples/digits-paper.pdf">Читать статью · PDF</a></p></td>
<td width="50%" valign="top"><a href="../docs/_static/examples/ising-paper.pdf"><img src="../docs/_static/examples/ising-preview.png" width="360" alt="Насколько надёжно ноутбук может оценить фазовый переход модели Изинга?"></a><p><strong>Насколько надёжно ноутбук может оценить фазовый переход модели Изинга?</strong></p><p>Оценка с бюджетом CPU и диагностика реализации. Частичные улучшения не удовлетворили совместным критериям; отложенные случайные начальные значения не использовались.</p><p><a href="../docs/_static/examples/ising-paper.pdf">Читать статью · PDF</a></p></td>
</tr>
</table>

Обе статьи — исследовательские черновики, полученные разработчиками с вмешательством человека, а не примеры внешних пользователей. Ограничения сохранены; перед публикацией требуется научная проверка человеком.

Когда проверенные результаты зафиксированы и агенты проекта не работают, выберите **Generate paper**. Внутренний агент применяет навыки письма, визуализации, цитирования и оформления для издания к замороженному снимку данных, не выполняя новых экспериментов.

Откройте **Paper**, чтобы менять масштаб, прокручивать и скачивать PDF и исходники. Предыдущий черновик остаётся доступным во время создания нового.

[Примеры статей](https://yihongt.github.io/CoAutoResearch/example-papers.html) · [Paper generation](https://yihongt.github.io/CoAutoResearch/paper-generation.html)

<a id="documentation"></a>

## 📚 Документация

Руководства по ссылкам — на английском. Начните с Setup или Walkthrough; частые вопросы — в FAQ, границы поддержки — в Platforms.

- [Setup](https://yihongt.github.io/CoAutoResearch/agent-setup.html)
- [Walkthrough](https://yihongt.github.io/CoAutoResearch/walkthrough.html)
- [Paper generation](https://yihongt.github.io/CoAutoResearch/paper-generation.html)
- [FAQ](https://yihongt.github.io/CoAutoResearch/faq.html)
- [Platforms](https://yihongt.github.io/CoAutoResearch/platforms.html)
- [CLI](https://yihongt.github.io/CoAutoResearch/cli.html)
- [Architecture](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html)
- [Upgrades](https://yihongt.github.io/CoAutoResearch/upgrading.html)

<a id="community"></a>

## 🤝 Сообщество

Помогайте проверять установку, сообщать о воспроизводимых ошибках, улучшать исследовательские процессы, поддерживать переводы и делиться документированными результатами. Используйте Issues и руководство по участию; о проблемах безопасности сообщайте конфиденциально.

[Issues](https://github.com/YihongT/CoAutoResearch/issues) · [Contributing](../CONTRIBUTING.md) · [Translations](../readme/TRANSLATING.md) · [Security](../SECURITY.md) · [Code of conduct](../CODE_OF_CONDUCT.md)

<details>
<summary>Цитирование CoAutoResearch</summary>

Цитируйте программу и указывайте использованную версию или commit.

```bibtex
@software{coautoresearch,
  title = {CoAutoResearch},
  author = {CoAutoResearch contributors},
  url = {https://github.com/YihongT/CoAutoResearch}
}
```

</details>

Лицензия Apache 2.0. Сторонние инструменты и навыки сохраняют свои лицензии и требования к указанию авторства.

Контакты: [yihong.tang@mail.mcgill.ca](mailto:yihong.tang@mail.mcgill.ca)
