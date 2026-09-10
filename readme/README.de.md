<!-- Translation basis is tracked in readme/translations.json. -->
<p align="center"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-hero-dark.svg">
  <img src="../assets/readme-hero-light.svg" width="1200" alt="CoAutoResearch — autonomous research and human–AI collaboration">
</picture></p>

<p align="center"><strong>An autonomous research partner that self-improves recursively and works with you.</strong></p>

<p align="center">Ein Open-Source-Forschungssystem für autonome Untersuchungen, rekursive Selbstverbesserung (recursive self-improvement) und die Zusammenarbeit zwischen Mensch und KI. Führe Experimente durch, verfeinere Forschungsmethoden anhand von Belegen und Feedback und erstelle Artikelentwürfe aus nachvollziehbaren Forschungsaufzeichnungen.</p>

<p align="center"><a href="#quick-start"><strong>Schnellstart →</strong></a> · <a href="#features">Funktionen</a> · <a href="#example-papers">Beispielberichte</a> · <a href="https://yihongt.github.io/CoAutoResearch/">Dokumentation</a></p>

<p align="center"><a href="../LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-d7b775" alt="Apache 2.0"></a> <a href="https://yihongt.github.io/CoAutoResearch/"><img src="https://img.shields.io/badge/docs-get_started-737269" alt="Documentation"></a></p>

<p align="center"><a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a><br><a href="README.pt-BR.md">Português brasileiro</a> · <a href="README.fr.md">Français</a> · <strong>Deutsch</strong> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a></p>

<p align="center"><sub>Dies sind Übersetzungen der README. Oberfläche und vollständige Dokumentation sind auf Englisch; der Agent antwortet in deiner Sprache.</sub></p>

![Starte mit einer Frage, einem Vorschlag oder einer laufenden Arbeit.](../assets/homepage.png)

*Starte mit einer Frage, einem Vorschlag oder einer laufenden Arbeit.*

<a id="news"></a>

## 📰 Neuigkeiten

- **2026-09-09** — Beispielberichte zu Digits und Ising, verbesserte Wiederaufnahme und strengere Prüfungen bei der Berichtserstellung wurden ergänzt.
- **2026-09-07** — Das Quellcode-Update 2.0 ergänzt parallele Forschungsdiskussionen, klarere Bedienelemente und die Berichtserstellung im Produkt.

[Changelog](../CHANGELOG.md) · [Releases](https://github.com/YihongT/CoAutoResearch/releases)

<a id="features"></a>

## ✨ Funktionen

**Diskutiere während der Forschung.** Prüfe Ideen in einem separaten Chat. Lies einen Vorschlag durch und sende ihn, wenn er die Forschung leiten soll.

**Rekursive Selbstverbesserung.** Beziehe dokumentierte Ergebnisse, Prüfungsfeedback und wiederverwendbare Erkenntnisse in den nächsten Versuch ein. Überarbeite Hypothesen, Methoden und Entscheidungen innerhalb deiner Vorgaben und deines Budgets; bewahre negative Befunde und beende die Untersuchung, wenn die Belege dafür sprechen.

**Prüfe die Belege.** Verfolge Erkenntnisse, Prüfungen und Grenzen bis zum Manuskript und Berichtsentwurf.

<a href="https://yihongt.github.io/CoAutoResearch/walkthrough.html#screenshots">
<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../assets/browser-tour.png">
  <img src="../assets/browser-tour.gif" alt="Digits: Trial → Manuscript → Paper">
</picture>
</a>

Erkunde ein abgeschlossenes Digits-Projekt: Forschungsprotokoll, Manuskript und PDF. Diese geschnittene und zugeschnittene Browser-Tour zeigt vorhandene Aufzeichnungen, keinen neuen Lauf und keine tatsächliche Forschungsgeschwindigkeit.

<details>
<summary>Drei Einstiegsmöglichkeiten</summary>

**Eine neue Frage:** „Vergleiche zwei Methoden auf einem kleinen öffentlichen Datensatz. Nutze nur die CPU, nenne das Budget und frage vor der abschließenden Auswertung nach Zustimmung.“

**Vorhandene Arbeit:** „Lies meinen Vorschlag und die Anhänge. Finde das nächste sinnvolle Experiment und bereite einen Plan zur Prüfung vor.“

**Ein zu prüfendes Ergebnis:** „Prüfe, ob dieser Befund einem strengeren Vergleich standhält. Bewahre die ursprünglichen Ergebnisse und dokumentiere die Grenzen.“

</details>

<a id="quick-start"></a>

## 🚀 Schnellstart

**Unterstützte Coding-Agenten:** ✓ Codex CLI · ✓ Claude Code

Gib deinem Coding-Agenten diese Anweisung:

```text
Set up and launch CoAutoResearch from
https://github.com/YihongT/CoAutoResearch.
Follow docs/agent-setup.md, reuse my existing coding-agent login,
configure paper generation, verify the setup, and open the dashboard.
```

Die Einrichtung hat drei Prüfpunkte: **Dashboard öffnet sich → Coding-Agent ist angemeldet und einsatzbereit → Berichtswerkzeuge sind bereit**. Interaktive Anbieteranmeldungen führst du selbst durch. Modelle und Nutzungslimits hängen vom Konto ab; Forschung kann zusätzliche Abhängigkeiten benötigen.

<details>
<summary>Manuell aus dem Quellcode starten</summary>

Du brauchst Node.js 20+, Python 3.10+, Git und eine installierte, authentifizierte Codex- oder Claude-Code-CLI.

```bash
git clone https://github.com/YihongT/CoAutoResearch.git
cd CoAutoResearch
node bin/auto-research.js doctor
node bin/auto-research.js ui
```

Öffne die angezeigte URL und lass den Server laufen. Das Dashboard benötigt weder Anwendungsabhängigkeiten noch einen Build-Schritt. Mit `--projects-dir /path/to/projects` speicherst du Forschung außerhalb des Repositorys.

Für PDFs brauchst du außerdem Python 3.12+, vier wissenschaftliche Skills mit festgelegten Versionen, LaTeX und Poppler. Folge der Anleitung agent setup. Der Quellcode ist ohne npm-Veröffentlichung nutzbar.

[Agent setup](../docs/agent-setup.md)

</details>

Erste Sitzung: **Create project → Forschungsauftrag senden → Richtung prüfen → Start autoresearch**. Nenne Materialien, Rechenbudget und genehmigungspflichtige Entscheidungen. Das Anlegen eines Projekts startet noch keine Forschung.

[Setup](https://yihongt.github.io/CoAutoResearch/agent-setup.html) · [Walkthrough](https://yihongt.github.io/CoAutoResearch/walkthrough.html)

<a id="how-it-works"></a>

## 🔄 Funktionsweise

Jeder **Trial** ist eine begrenzte Forschungsiteration. Der Dienst prüft vorgeschlagene Änderungen, dokumentiert akzeptierte Ergebnisse und entscheidet über Fortsetzung, Pause oder eine menschliche Entscheidung. Interne Prüfung ist weder externe Begutachtung noch ein Beweis wissenschaftlicher Aussagen.

**Add to research draft** bereitet Text vor, sendet oder übernimmt ihn aber nicht. **Pause after current turn** fordert eine Pause am Ende eines Agenten-Turns an, gegebenenfalls innerhalb eines Trials. **Resume autoresearch** setzt am gespeicherten Zustand fort.

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../assets/co-auto-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="../assets/co-auto-dark.gif">
  <img src="../assets/co-auto-light.gif" alt="Funktionsweise">
</picture>

Schematischer Ablauf; die Animationsdauer entspricht nicht der Laufzeit. Statische Alternativen sind verfügbar. [SVG](../assets/co-auto-light.svg)

<details open>
<summary>🏗️ Systemarchitektur ansehen</summary>

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../docs/_static/diagrams/architecture.svg">
  <source media="(prefers-color-scheme: dark)" srcset="../docs/_static/diagrams/architecture-dark.gif">
  <img src="../docs/_static/diagrams/architecture.gif" alt="Systemarchitektur ansehen">
</picture>

[Architecture and lifecycle](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html)

</details>

<a id="example-papers"></a>

## 📄 Beispielberichte

<table>
<tr>
<td width="50%" valign="top"><a href="../docs/_static/examples/digits-paper.pdf"><img src="../docs/_static/examples/digits-preview.png" width="360" alt="Hilft Kovarianz-Shrinkage bei der Erkennung handgeschriebener Ziffern mit wenigen Trainingsdaten?"></a><p><strong>Hilft Kovarianz-Shrinkage bei der Erkennung handgeschriebener Ziffern mit wenigen Trainingsdaten?</strong></p><p>Gepaarte Vergleiche mit kleinen Stichproben und eine einmalige Holdout-Auswertung; die Befunde gelten für diesen Datensatz und dieses Protokoll.</p><p><a href="../docs/_static/examples/digits-paper.pdf">Bericht lesen · PDF</a></p></td>
<td width="50%" valign="top"><a href="../docs/_static/examples/ising-paper.pdf"><img src="../docs/_static/examples/ising-preview.png" width="360" alt="Wie zuverlässig kann ein Laptop einen Ising-Phasenübergang schätzen?"></a><p><strong>Wie zuverlässig kann ein Laptop einen Ising-Phasenübergang schätzen?</strong></p><p>Schätzung mit CPU-Budget und Implementierungsdiagnose. Teilverbesserungen erfüllten die gemeinsamen Kriterien nicht; reservierte Zufalls-Seeds blieben ungenutzt.</p><p><a href="../docs/_static/examples/ising-paper.pdf">Bericht lesen · PDF</a></p></td>
</tr>
</table>

Beide Berichte sind von Entwicklern durchgeführte Forschungsentwürfe mit menschlichen Eingriffen, keine externen Anwenderfallstudien. Grenzen bleiben dokumentiert; vor einer Veröffentlichung ist menschliche wissenschaftliche Prüfung nötig.

Wenn geprüfte Ergebnisse dokumentiert sind und keine Projektagenten laufen, wähle **Generate paper**. Der interne Agent nutzt Skills für Schreiben, Visualisierung, Zitate und Publikationsformat auf einem eingefrorenen Evidenzstand, ohne neue Experimente auszuführen.

Unter **Paper** kannst du zoomen, scrollen sowie PDF und Quellen herunterladen. Der bisherige Entwurf bleibt während der Neuerstellung verfügbar.

[Beispielberichte](https://yihongt.github.io/CoAutoResearch/example-papers.html) · [Paper generation](https://yihongt.github.io/CoAutoResearch/paper-generation.html)

<a id="documentation"></a>

## 📚 Dokumentation

Die verlinkten Anleitungen sind auf Englisch. Beginne mit Setup oder Walkthrough; FAQ beantwortet häufige Fragen, Platforms beschreibt die Supportgrenzen.

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

Hilf bei Installationsprüfungen, reproduzierbaren Fehlermeldungen, besseren Forschungsabläufen, Übersetzungen oder dokumentierten Forschungsergebnissen. Nutze Issues und lies den Beitragsleitfaden; Sicherheitsprobleme bitte vertraulich melden.

[Issues](https://github.com/YihongT/CoAutoResearch/issues) · [Contributing](../CONTRIBUTING.md) · [Translations](../readme/TRANSLATING.md) · [Security](../SECURITY.md) · [Code of conduct](../CODE_OF_CONDUCT.md)

<details>
<summary>CoAutoResearch zitieren</summary>

Zitiere die Software und dokumentiere die verwendete Version oder den Commit.

```bibtex
@software{coautoresearch,
  title = {CoAutoResearch},
  author = {CoAutoResearch contributors},
  url = {https://github.com/YihongT/CoAutoResearch}
}
```

</details>

Lizenziert unter Apache 2.0. Externe Werkzeuge und Skills behalten ihre jeweiligen Lizenzen und Namensnennungspflichten.

Kontakt: [yihong.tang@mail.mcgill.ca](mailto:yihong.tang@mail.mcgill.ca)
